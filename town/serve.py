#!/usr/bin/env python3
"""Hesperides on its own: the memory town without the rest of Nyx (no chat, no companion needed).

    python3 town/serve.py --memory ~/notes/memory            # a folder of .md files: one file = one house, one bullet = one window
    python3 town/serve.py --ombre https://your-ombre/mcp       # or an Ombre-Brain server
    options: --port 8090  --host 127.0.0.1 (use 0.0.0.0 to open it to your phone on the same network)

Needs: pip install fastapi uvicorn httpx   (town/serve.sh does that in a venv for you)
It prints an address with a key in it; open that once, the page keeps the key.
Town state (coins, recipes, crops) lives in town/.state.json; the key in town/.key.
Part of Nyx. The town is MIT; relay/nyx_town.py, which this reuses, is AGPL v3 like the rest of relay/.
"""
import argparse
import hmac
import os
import secrets
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

ap = argparse.ArgumentParser(description="Serve the memory town on its own.")
ap.add_argument("--memory", help="folder of .md memory files")
ap.add_argument("--ombre", help="Ombre-Brain MCP url (instead of a folder)")
ap.add_argument("--ombre-token", default=os.environ.get("RELAY_OMBRE_MCP_TOKEN", ""))
ap.add_argument("--port", type=int, default=8090)
ap.add_argument("--host", default="127.0.0.1")
a = ap.parse_args()
if not a.memory and not a.ombre:
    sys.exit("Give it --memory <folder of .md files> or --ombre <url>.")
if a.memory:
    os.environ["RELAY_MEMORY_DIR"] = str(Path(a.memory).expanduser().resolve())
if a.ombre:
    os.environ["RELAY_OMBRE_MCP_URL"] = a.ombre
    os.environ["RELAY_OMBRE_MCP_TOKEN"] = a.ombre_token
os.environ.setdefault("RELAY_TOWN_STATE", str(HERE / ".state.json"))

key_file = HERE / ".key"
if not key_file.exists():
    key_file.write_text(secrets.token_urlsafe(24)); key_file.chmod(0o600)
KEY = key_file.read_text().strip()

sys.path.insert(0, str(HERE.parent / "relay"))
from fastapi import FastAPI, HTTPException, Request   # noqa: E402
from fastapi.responses import HTMLResponse, RedirectResponse   # noqa: E402
from fastapi.staticfiles import StaticFiles   # noqa: E402
import nyx_town   # noqa: E402

api = FastAPI()


def check_auth(request: Request) -> None:
    h = request.headers.get("authorization", "")
    tok = h[7:] if h.startswith("Bearer ") else request.query_params.get("token", "")
    if not tok or not hmac.compare_digest(tok, KEY):
        raise HTTPException(status_code=401, detail="unauthorized")


nyx_town.register(api, {"check_auth": check_auth})


@api.post("/app/send")
async def no_chat(request: Request):
    """Serving a dish talks to a companion in Nyx; on its own there's nobody to tell, so it's just kept."""
    check_auth(request)
    return {"id": 0}


app = FastAPI()
app.mount("/relay", api)


@app.get("/")
async def door(token: str = ""):
    """Open the printed address once: the key goes into the page's storage, then on into the town."""
    if token and hmac.compare_digest(token, KEY):
        return HTMLResponse('<script>try{localStorage.setItem("nyx_key",' + repr(KEY) + ')}catch(e){}location.replace("town/index.html")</script>')
    return RedirectResponse("town/index.html")


app.mount("/town", StaticFiles(directory=str(HERE), html=True), name="town")

if __name__ == "__main__":
    import uvicorn
    shown = "localhost" if a.host in ("127.0.0.1", "0.0.0.0") else a.host
    print(f"\n  Hesperides is up:  http://{shown}:{a.port}/?token={KEY}\n  (open it once; the page remembers the key)\n", flush=True)
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
