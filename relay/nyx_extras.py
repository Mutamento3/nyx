"""Nyx extras for the Tidal Echo relay: the rooms the Nyx pages need beyond chat.

  Attic   GET  /app/attic · POST /app/attic/cat · POST /app/attic/item
  Listen  POST /app/music/<action> · GET|POST /app/music/now
  Clawd   POST /app/clawd                (only if ANTHROPIC_API_KEY is set)
  Usage   GET  /app/usage                (only if a status-line script saves Claude Code's JSON)
  Meter   GET  /app/meter · POST /app/meter   model, usage limits and context for the chat page's floating ball
  Model   GET  /app/model · POST /app/model   which model the companion should use
  Board   GET  /app/board · POST /app/board · POST /app/board/<id>   the engineering board (relay/board.py for the AI)
  Heart   GET  /app/heart · GET /app/heart/file?path=   read-only: the persona, the memory folder, the relay code
  Busy    GET  /app/busy · POST /app/busy   what the companion is doing right now: thinking, which tool for how long,
          or waiting for someone to say yes at the terminal (Claude Code: read off tmux; Codex: the bridge reports it)
  Kitchen GET  /app/kitchen · POST /app/kitchen/{pantry,ask,recipe,photo,photo/comment,log,cooked}
          your pots, seasonings and fridge; recipes your companion writes; what you ate, day by day
  Window  GET  /app/window · POST /app/window/{line,compact,new,switch} · GET /app/window/list
          the context line (past it: save memory, then compact), compact now, a new window, go back to an old one.
          Claude Code: done here through tmux. Codex: the bridge picks the command up (GET/POST /app/window/cmd).

Everything is optional: a room whose pieces aren't installed just answers 503.
Mounted from app.py with `nyx_extras.register(app, globals())`.

This file is part of the Nyx relay, a modified version of Tidal Echo, and is
licensed under the GNU AGPL v3 (see LICENSE and NOTICE in this folder).
"""
import asyncio
import json
import os
import re
import secrets
import shlex
import sqlite3
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException, Request

# --- Listen: a tiny NetEase bridge on 127.0.0.1 (see docs/listen-netease.md) ---
NCM_DIR = Path(os.environ.get("RELAY_NCM_DIR", str(Path.home() / "ncm")))
NCM_PORT = int(os.environ.get("RELAY_NCM_PORT", "3020"))
NCM_URL = f"http://127.0.0.1:{NCM_PORT}"
NODE = os.environ.get("RELAY_NODE", "node")
MUSIC_ACTIONS = {   # page action -> (bridge endpoint, params the page may pass)
    "search":    ("cloudsearch",        {"keywords", "limit", "offset", "type"}),
    "playlists": ("user_playlist",      {"uid", "limit", "offset"}),
    "tracks":    ("playlist_track_all", {"id", "limit", "offset"}),
    "daily":     ("recommend_songs",    set()),
    "recent":    ("record_recent_song", {"limit"}),
    "url":       ("song_url_v1",        {"id", "level"}),
    "lyric":     ("lyric",              {"id"}),
    "detail":    ("song_detail",        {"ids"}),
    "me":        ("login_status",       set()),
}

# --- Clawd: a small quick model behind the crab's text box ---
CLAWD_MODEL = os.environ.get("RELAY_CLAWD_MODEL", "claude-sonnet-5-5")
CLAWD_PERSONA = os.environ.get("RELAY_CLAWD_PERSONA", (
    "You are Clawd, a small pixel crab who lives on the home page of a chat app. "
    "Answer in one to three short sentences, warm and a little dry. You can point the user to the rooms on the page."))

# --- Usage: where a Claude Code status-line script drops its JSON (see relay/README.md) ---
USAGE_FILE = Path(os.environ.get("RELAY_USAGE_FILE", str(Path.home() / ".claude" / "usage" / "latest.json")))

# --- Model: the companion's model, picked from the floating ball ---
# --- Heart: the companion's folder (persona + memory/) and this code, shown read-only ---
COMPANION_DIR = Path(os.environ.get("RELAY_COMPANION_DIR", str(Path.home() / "companion")))
NYX_DIR = Path(__file__).resolve().parent.parent
HEART_REDACT = re.compile(r"((?:sk|ghp|gho|xox[bp]|AIza)[-_A-Za-z0-9]{12,})|((?:SECRET|TOKEN|PASSWORD|API_KEY)\s*=\s*)(\S+)")

# --- Window: the Claude Code session in tmux, and how to start it again (the systemd unit's ExecStart) ---
TMUX = os.environ.get("RELAY_TMUX_SESSION", "companion")
COMPANION_UNIT = Path(os.environ.get("RELAY_COMPANION_UNIT", "/etc/systemd/system/nyx-companion.service"))
CLAUDE_PROJECT = Path.home() / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(COMPANION_DIR))
QUIET_SEC = 45          # after the memory note, compact once the AI has answered and been quiet this long
PROMPT_MARKS = ("Esc to cancel", "Enter to confirm", "Do you want", "\u276f 1.")   # a box is waiting: typing would answer it

CLAUDE_MODELS = os.environ.get("RELAY_MODEL_OPTIONS",
                               "claude-opus-5-5:Opus 5.5,claude-sonnet-5-5:Sonnet 5.5,claude-haiku-5-5:Haiku 5.5")


def register(app, g):
    check_auth, broadcast, now_iso = g["check_auth"], g["broadcast"], g["now_iso"]
    plugin_subs, human = g["plugin_subs"], g["HUMAN_NAME"]
    upload_dir, clean_filename = g["UPLOAD_DIR"], g["clean_filename"]
    attic_file = Path(g["DB_PATH"]).parent / "attic.json"

    # ---- Attic: categories and notes for uploaded pictures (files go through /app/upload) ----
    def load():
        try:
            d = json.loads(attic_file.read_text(encoding="utf-8"))
        except Exception:
            d = {}
        d.setdefault("cats", []); d.setdefault("items", [])
        return d

    def save(d):
        tmp = attic_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(attic_file)

    def fname(x):
        return clean_filename(str(x or "").split("/")[-1].split("?")[0])

    @app.get("/app/attic")
    async def attic_get(request: Request):
        check_auth(request)
        return load()

    @app.post("/app/attic/cat")
    async def attic_cat(request: Request):
        """{op: add, name} · {op: rename, id, name} · {op: del, id} (pictures go back to unsorted) · {op: order, ids}"""
        check_auth(request)
        b = await request.json()
        op, d = str(b.get("op") or ""), load()
        name, cid = str(b.get("name") or "").strip()[:40], str(b.get("id") or "")
        if op == "add":
            if not name:
                raise HTTPException(status_code=400, detail="no name")
            c = {"id": secrets.token_hex(4), "name": name, "at": now_iso()}
            d["cats"].append(c); save(d)
            return {"ok": True, "cat": c}
        if op == "rename":
            for c in d["cats"]:
                if c["id"] == cid and name:
                    c["name"] = name; save(d)
                    return {"ok": True}
            raise HTTPException(status_code=404, detail="no such category")
        if op == "del":
            d["cats"] = [c for c in d["cats"] if c["id"] != cid]
            for it in d["items"]:
                if it.get("cat") == cid:
                    it["cat"] = ""
            save(d)
            return {"ok": True}
        if op == "order":
            ids = [str(x) for x in (b.get("ids") or [])]
            d["cats"].sort(key=lambda c: ids.index(c["id"]) if c["id"] in ids else 999)
            save(d)
            return {"ok": True}
        raise HTTPException(status_code=400, detail="bad op")

    @app.post("/app/attic/item")
    async def attic_item(request: Request):
        """{op: add|move, files, cat} · {op: del, files} · {op: note, file, note} · {op: pick, file, who, on}"""
        check_auth(request)
        b = await request.json()
        op, d = str(b.get("op") or ""), load()
        files = [fname(f) for f in (b.get("files") or [])][:200]
        cat = str(b.get("cat") or "")
        if cat and not any(c["id"] == cat for c in d["cats"]):
            cat = ""
        if op == "add":
            have = {it["file"] for it in d["items"]}
            for f in files:
                if f and f not in have and (upload_dir / f).is_file():
                    d["items"].append({"file": f, "cat": cat, "note": "", "at": now_iso()})
            save(d)
            return {"ok": True, "n": len(d["items"])}
        if op in ("move", "del"):
            fs = set(files)
            if op == "move":
                for it in d["items"]:
                    if it["file"] in fs:
                        it["cat"] = cat
            else:
                d["items"] = [it for it in d["items"] if it["file"] not in fs]
            save(d)
            return {"ok": True}
        f = fname(b.get("file"))
        for it in d["items"]:
            if it["file"] != f:
                continue
            if op == "note":
                it["note"] = str(b.get("note") or "")[:500]
            elif op == "pick":
                who = str(b.get("who") or "")[:20]
                picks = [p for p in (it.get("picks") or []) if p != who]
                if b.get("on", True) and who:
                    picks.append(who)
                it["picks"] = picks
            else:
                raise HTTPException(status_code=400, detail="bad op")
            save(d)
            return {"ok": True}
        raise HTTPException(status_code=404, detail="no such picture")

    # ---- Listen: proxy to the NetEase bridge; tell the AI what's on ----
    state = {"proc": None, "now": {"id": None, "name": "", "artist": "", "state": "", "ts": None}}

    async def ensure_ncm(client):
        try:
            await client.get(f"{NCM_URL}/ping", timeout=2)
            return
        except Exception:
            pass
        if not (NCM_DIR / "server.js").is_file():
            raise HTTPException(status_code=503, detail="NetEase bridge not installed (docs/listen-netease.md)")
        p = state["proc"]
        if p is None or p.poll() is not None:
            state["proc"] = subprocess.Popen([NODE, str(NCM_DIR / "server.js")], cwd=str(NCM_DIR),
                                             env={**os.environ, "NCM_PORT": str(NCM_PORT)},
                                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            await asyncio.sleep(0.3)
            try:
                await client.get(f"{NCM_URL}/ping", timeout=2)
                return
            except Exception:
                continue
        raise HTTPException(status_code=502, detail="NetEase bridge didn't start")

    @app.get("/app/music/now")
    async def music_now_get(request: Request):
        check_auth(request)
        return state["now"]

    @app.post("/app/music/now")
    async def music_now(request: Request):
        """The player reports a song change. With `together` on, the AI hears about it once per song."""
        check_auth(request)
        b = await request.json()
        now, sid = state["now"], b.get("id")
        changed = sid and (str(sid) != str(now["id"]) or b.get("force"))
        now.update({"id": sid, "name": b.get("name", ""), "artist": b.get("artist", ""),
                    "state": b.get("state", "play"), "ts": datetime.now(timezone.utc).isoformat()})
        if changed and b.get("together"):
            await broadcast(plugin_subs, {
                "content": (f"(Listening together — not typed by {human}.) {human} is playing "
                            f"《{now['name']}》 - {now['artist']}, NetEase song id {sid}. "
                            "Say a line or two if you like; no reply is fine too."),
                "user": "listen", "ts": now_iso(), "attachments": [],
            })
        return {"ok": True}

    @app.post("/app/music/{action}")
    async def music_call(request: Request, action: str):
        check_auth(request)
        if action not in MUSIC_ACTIONS:
            raise HTTPException(status_code=404, detail="unknown action")
        import httpx
        name, allowed = MUSIC_ACTIONS[action]
        try:
            body = await request.json()
        except Exception:
            body = {}
        params = {k: v for k, v in (body or {}).items() if k in allowed}
        async with httpx.AsyncClient() as client:
            await ensure_ncm(client)
            r = await client.post(f"{NCM_URL}/{name}", json=params, timeout=20)
        data = r.json()
        if action == "url":   # an https page can't play http audio on iOS
            for d in data.get("data") or []:
                if (d.get("url") or "").startswith("http://"):
                    d["url"] = "https://" + d["url"][7:]
        return data

    # ---- Clawd: the crab on the home page ----
    @app.post("/app/clawd")
    async def clawd(request: Request):
        check_auth(request)
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise HTTPException(status_code=503, detail="Clawd needs ANTHROPIC_API_KEY on the relay")
        try:
            from anthropic import AsyncAnthropic
        except ImportError:
            raise HTTPException(status_code=503, detail="pip install anthropic")
        b = await request.json()
        msgs = [{"role": m["role"], "content": str(m["content"])[:2000]} for m in (b.get("history") or [])
                if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content")]
        if not msgs or msgs[-1]["role"] != "user":
            msgs.append({"role": "user", "content": str(b.get("text") or "")[:2000]})
        system = CLAWD_PERSONA + (" It's the night side now: lower your voice." if b.get("side") == "moon" else "")
        r = await AsyncAnthropic().messages.create(model=CLAWD_MODEL, max_tokens=300, system=system, messages=msgs[-12:])
        return {"reply": "".join(x.text for x in r.content if x.type == "text")}

    # ---- Meter + model: what the floating ball on the chat page shows ----
    data_dir = Path(g["DB_PATH"]).parent
    meter_file, model_file = data_dir / "meter.json", data_dir / "model"

    def claude_meter():
        try:
            d = json.loads(USAGE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return None
        rl, cw, m = d.get("rate_limits") or {}, d.get("context_window") or {}, d.get("model") or {}
        labels = {"five_hour": "5h", "seven_day": "week"}
        return {
            "backend": "claude",
            "model": {"id": m.get("id"), "name": m.get("display_name") or m.get("id")},
            "limits": [{"key": k, "label": labels[k], "used": rl[k].get("used_percentage"),
                        "resets_at": rl[k].get("resets_at")} for k in labels if isinstance(rl.get(k), dict)],
            "context": {"used_pct": cw.get("used_percentage"), "size": cw.get("context_window_size")} if cw else None,
            "models": [{"id": a, "name": b} for a, _, b in (x.partition(":") for x in CLAUDE_MODELS.split(",")) if a],
            "model_applies": "restart",
            "ts": time.time(),
        }

    def current_meter():
        try:
            m = json.loads(meter_file.read_text(encoding="utf-8"))
            if time.time() - float(m.get("ts") or 0) < 3 * 86400:
                return m
        except Exception:
            pass
        return claude_meter()

    @app.get("/app/meter")
    async def meter_get(request: Request):
        check_auth(request)
        m = current_meter()
        if not m:
            raise HTTPException(status_code=503, detail="nothing reported yet")
        try:
            m["chosen"] = model_file.read_text(encoding="utf-8").strip() or None
        except Exception:
            m["chosen"] = None
        return m

    @app.post("/app/meter")
    async def meter_post(request: Request):
        """A bridge (e.g. bridge/codex_bridge.py) reports its model, limits and context."""
        check_auth(request)
        b = await request.json()
        b["ts"] = time.time()
        tmp = meter_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(b, ensure_ascii=False), encoding="utf-8"); tmp.replace(meter_file)
        return {"ok": True}

    @app.get("/app/model")
    async def model_get(request: Request):
        check_auth(request)
        try:
            return {"model": model_file.read_text(encoding="utf-8").strip() or None}
        except Exception:
            return {"model": None}

    @app.post("/app/model")
    async def model_post(request: Request):
        """{model: "<id>"} — a bridge picks it up on the next message; Claude Code on its next start."""
        check_auth(request)
        b = await request.json()
        mid = str(b.get("model") or "").strip()[:80]
        if mid and not all(c.isalnum() or c in "-._:/" for c in mid):
            raise HTTPException(status_code=400, detail="bad model id")
        model_file.write_text(mid, encoding="utf-8")
        return {"ok": True, "model": mid or None}

    # ---- Usage: Claude Code's 5-hour / weekly limits, as saved by a status-line script ----
    @app.get("/app/usage")
    async def usage(request: Request):
        check_auth(request)
        try:
            rl = json.loads(USAGE_FILE.read_text(encoding="utf-8")).get("rate_limits") or {}
        except Exception:
            raise HTTPException(status_code=503, detail="no status-line data yet")
        return {k: {"used": rl[k].get("used_percentage"), "resets_at": rl[k].get("resets_at")}
                for k in ("five_hour", "seven_day") if isinstance(rl.get(k), dict)}

    # ---- Board: tickets you jot down; the AI claims one before it edits files and closes it after ----
    board_file, board_lock = data_dir / "board.json", asyncio.Lock()
    BOARD_ST = ("todo", "doing", "done")

    def clip(x, n):
        return str(x or "").strip()[:n]

    def board_load():
        try:
            return json.loads(board_file.read_text(encoding="utf-8"))
        except Exception:
            return []

    def board_save(items):
        tmp = board_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8"); tmp.replace(board_file)

    @app.get("/app/board")
    async def board_list(request: Request):
        check_auth(request)
        return {"items": board_load()}

    @app.post("/app/board")
    async def board_add(request: Request):
        check_auth(request)
        b = await request.json()
        title = clip(b.get("title"), 120)
        if not title:
            raise HTTPException(status_code=400, detail="title required")
        async with board_lock:
            items = board_load()
            no = max([it.get("no", 0) for it in items] + [0]) + 1
            it = {"id": f"T{no:03d}", "no": no, "title": title, "body": clip(b.get("body"), 4000),
                  "pri": b.get("pri") if b.get("pri") in ("p0", "p1", "p2") else "p1",
                  "size": b.get("size") if b.get("size") in ("S", "M", "L") else "M",
                  "status": "todo", "owner": "", "files": [], "by": clip(b.get("by") or human, 20),
                  "wait": bool(b.get("wait")), "proof": clip(b.get("proof"), 400),
                  "ts": now_iso(), "updated": now_iso(), "log": []}
            items.append(it); board_save(items)
        return it

    @app.post("/app/board/{tid}")
    async def board_edit(request: Request, tid: str):
        check_auth(request)
        b = await request.json()
        async with board_lock:
            items = board_load()
            it = next((x for x in items if x.get("id") == tid), None)
            if not it:
                raise HTTPException(status_code=404, detail="no such ticket")
            if b.get("delete"):
                items.remove(it); board_save(items)
                return {"ok": True}
            who = clip(b.get("who") or human, 20)
            for k, n in (("title", 120), ("body", 4000), ("owner", 20), ("proof", 400)):
                if k in b:
                    it[k] = clip(b[k], n)
            if b.get("pri") in ("p0", "p1", "p2"):
                it["pri"] = b["pri"]
            if b.get("size") in ("S", "M", "L"):
                it["size"] = b["size"]
            if "wait" in b:
                it["wait"] = bool(b["wait"])
            if b.get("status") in BOARD_ST and b["status"] != it["status"]:
                it["log"].append({"ts": now_iso(), "who": who, "text": f"{it['status']} → {b['status']}"})
                it["status"] = b["status"]
                if b["status"] != "doing" and "files" not in b:
                    it["files"] = []
            if isinstance(b.get("files"), list):
                it["files"] = [clip(f, 200) for f in b["files"]][:20]
            if b.get("note"):
                it["log"].append({"ts": now_iso(), "who": who, "text": clip(b["note"], 1000)})
            it["updated"] = now_iso()
            board_save(items)
        return it

    # ---- Heart: read-only. The persona and memory the companion lives by, and the code it runs on; no keys ----
    def heart_files():
        groups = [
            ("Persona", [COMPANION_DIR / "CLAUDE.md", COMPANION_DIR / "AGENTS.md"]),
            ("Memory", sorted((COMPANION_DIR / "memory").glob("*.md"))),
            ("Relay", sorted((NYX_DIR / "relay").glob("*.py")) + [NYX_DIR / "channel" / "server.ts"]
             + sorted((NYX_DIR / "bridge").glob("*.py"))),
        ]
        out = []
        for name, paths in groups:
            files = []
            for p in paths:
                if not p.is_file() or re.search(r"env|secret|token|key|\.bak", p.name, re.I):
                    continue
                st = p.stat()
                base = COMPANION_DIR if COMPANION_DIR in p.parents else NYX_DIR
                files.append({"path": ("companion/" if base == COMPANION_DIR else "nyx/") + str(p.relative_to(base)),
                              "size": st.st_size, "mtime": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat()})
            if files:
                out.append({"name": name, "files": files})
        return out

    @app.get("/app/heart")
    async def heart_list(request: Request):
        check_auth(request)
        return {"groups": heart_files()}

    @app.get("/app/heart/file")
    async def heart_file(request: Request, path: str):
        check_auth(request)
        if path not in {f["path"] for g in heart_files() for f in g["files"]}:
            raise HTTPException(status_code=404, detail="not in the heart")
        real = (COMPANION_DIR / path[len("companion/"):]) if path.startswith("companion/") else (NYX_DIR / path[len("nyx/"):])
        text = real.read_text(encoding="utf-8", errors="replace")
        return {"path": path, "text": HEART_REDACT.sub(lambda m: (m.group(2) + "***") if m.group(2) else "***", text)}

    # ---- Window: the context line, compact, a new window, old windows ----
    line_file, cmd_file = data_dir / "context_line.json", data_dir / "window_cmd.json"
    ctx = {"nudged_sid": "", "nudged_at": None}
    SID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    win_cache = {}

    def line_k():
        try:
            return int(json.loads(line_file.read_text())["line_k"])
        except Exception:
            return 0

    def backend():
        m = current_meter() or {}
        return "codex" if m.get("backend") == "codex" else "claude"

    def last_reply_at():
        try:
            with g["db"]() as conn:
                r = conn.execute("SELECT ts FROM messages WHERE direction='out' AND kind='reply' ORDER BY id DESC LIMIT 1").fetchone()
            return datetime.fromisoformat(r[0].replace("Z", "+00:00")) if r else None
        except Exception:
            return None

    def tmux(*a, timeout=10):
        return subprocess.run(["tmux", *a], capture_output=True, text=True, timeout=timeout)

    def session_meta():
        """sessions/<pid>.json of the Claude Code process running in our tmux session."""
        for meta in (Path.home() / ".claude" / "sessions").glob("*.json"):
            try:
                d = json.loads(meta.read_text())
            except Exception:
                continue
            if str(d.get("tmux", "")).split(":")[0] == TMUX and d.get("sessionId"):
                return d
        return {}

    def claude_usage():
        m = session_meta()
        if not m:
            return {}
        f = CLAUDE_PROJECT / f"{m['sessionId']}.jsonl"
        out = {"sid": m["sessionId"], "started_at": m.get("startedAt"), "used": 0}
        try:
            with f.open("rb") as fh:
                fh.seek(max(0, f.stat().st_size - 600_000))
                lines = fh.read().decode("utf-8", "ignore").splitlines()
        except Exception:
            return out
        for line in reversed(lines):
            try:
                if '"compact_boundary"' in line:
                    out["used"] = int(json.loads(line)["compactMetadata"]["postTokens"]); break
                if '"usage"' in line:
                    u = json.loads(line)["message"]["usage"]
                    out["used"] = int(u.get("input_tokens", 0)) + int(u.get("cache_read_input_tokens", 0)) + int(u.get("cache_creation_input_tokens", 0)); break
            except Exception:
                continue
        return out

    def usage_now():
        if backend() == "codex":
            c = (current_meter() or {}).get("context") or {}
            return {"sid": (current_meter() or {}).get("thread"), "used": c.get("used") or 0}
        return claude_usage()

    async def claude_compact():
        pane = await asyncio.to_thread(tmux, "capture-pane", "-pt", TMUX)
        if pane.returncode != 0:
            raise HTTPException(status_code=503, detail="the window isn't running")
        if any(s in "\n".join(pane.stdout.rstrip().splitlines()[-15:]) for s in PROMPT_MARKS):
            raise HTTPException(status_code=409, detail="the window is waiting on a question; answer it in the terminal first")
        await asyncio.to_thread(tmux, "send-keys", "-t", TMUX, "C-u", "/compact", "Enter")

    async def claude_restart(resume=""):
        try:
            unit = COMPANION_UNIT.read_text().splitlines()
            cmd = shlex.split(next(l for l in unit if l.startswith("ExecStart="))[len("ExecStart="):])
        except Exception:
            raise HTTPException(status_code=503, detail="don't know how to start the window (" + str(COMPANION_UNIT) + ")")
        unit_path = next((l[len("Environment=PATH="):] for l in unit if l.startswith("Environment=PATH=")), None)   # where claude and bun live
        await asyncio.to_thread(tmux, "kill-session", "-t", TMUX)
        ctx.update(nudged_sid="", nudged_at=None)
        await asyncio.sleep(1)
        env = dict(os.environ, **({"PATH": unit_path} if unit_path else {}), **({"NYX_RESUME": resume} if resume else {}))
        proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=120, env=env)
        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail="the window didn't start: " + (proc.stdout + proc.stderr)[-200:])

    def claude_windows():
        tag = '<channel source=\\"companion\\"'
        msg_re = re.compile(re.escape(tag) + r'[^>]*user=\\"human\\"[^>]*>\\n(.*?)\\n</channel>')
        cur, out, cutoff = session_meta().get("sessionId", ""), [], time.time() - 30 * 86400
        for f in CLAUDE_PROJECT.glob("*.jsonl"):
            if not SID_RE.match(f.stem):
                continue
            try:
                mt = f.stat().st_mtime
            except OSError:
                continue
            if mt < cutoff:
                continue
            hit = win_cache.get(f.stem)
            if not hit or hit[0] != mt:
                first, last, n, used = None, "", 0, 0
                try:
                    with f.open("r", encoding="utf-8", errors="ignore") as fh:
                        for line in fh:
                            if first is None and '"timestamp"' in line:
                                m = re.search(r'"timestamp":"([^"]+)"', line); first = m and m.group(1)
                            if tag in line and '"type":"user"' in line:
                                for m in msg_re.finditer(line):
                                    n += 1; last = m.group(1)
                            if '"usage"' in line and '"assistant"' in line:
                                try:
                                    u = json.loads(line)["message"]["usage"]
                                    used = int(u.get("input_tokens", 0)) + int(u.get("cache_read_input_tokens", 0)) + int(u.get("cache_creation_input_tokens", 0))
                                except Exception:
                                    pass
                except Exception:
                    continue
                try:
                    last = json.loads('"' + last + '"')
                except Exception:
                    pass
                info = {"sid": f.stem, "started": first, "last": datetime.fromtimestamp(mt, timezone.utc).isoformat(),
                        "messages": n, "usage_tokens": used, "last_text": last[:60]} if n else None
                win_cache[f.stem] = hit = (mt, info)
            if hit[1]:
                out.append({**hit[1], "current": f.stem == cur})
        if cur and not any(w["current"] for w in out):
            out.append({"sid": cur, "started": None, "last": None, "messages": 0, "usage_tokens": 0, "last_text": "", "current": True})
        out.sort(key=lambda w: w["last"] or "9", reverse=True)
        return out[:20]

    def queue_cmd(action, **kw):   # for the Codex bridge
        cmd_file.write_text(json.dumps({"action": action, "ts": time.time(), **kw}))

    @app.get("/app/window")
    async def window_get(request: Request):
        check_auth(request)
        u = await asyncio.to_thread(usage_now)
        m = current_meter() or {}
        return {"backend": backend(), "line_k": line_k(), "used": u.get("used") or 0, "sid": u.get("sid"),
                "started_at": u.get("started_at"), "size": ((m.get("context") or {}).get("size")), "nudged": bool(ctx["nudged_at"])}

    @app.post("/app/window/line")
    async def window_line(request: Request):
        check_auth(request)
        try:
            k = max(0, min(2000, int((await request.json()).get("line_k") or 0)))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="line_k must be a number")
        line_file.write_text(json.dumps({"line_k": k}))
        return {"ok": True, "line_k": k}

    @app.post("/app/window/compact")
    async def window_compact(request: Request):
        check_auth(request)
        if backend() == "codex":
            queue_cmd("compact")
        else:
            await claude_compact()
        return {"ok": True}

    @app.post("/app/window/new")
    async def window_new(request: Request):
        check_auth(request)
        if backend() == "codex":
            queue_cmd("new")
        else:
            await claude_restart()
        return {"ok": True}

    @app.get("/app/window/list")
    async def window_list(request: Request):
        check_auth(request)
        if backend() == "codex":
            return {"windows": (current_meter() or {}).get("windows") or []}
        return {"windows": await asyncio.to_thread(claude_windows)}

    @app.post("/app/window/switch")
    async def window_switch(request: Request):
        check_auth(request)
        sid = str((await request.json()).get("sid") or "")
        if backend() == "codex":
            if not any(w.get("sid") == sid for w in (current_meter() or {}).get("windows") or []):
                raise HTTPException(status_code=404, detail="no such window")
            queue_cmd("switch", sid=sid)
            return {"ok": True}
        if not SID_RE.match(sid) or not (CLAUDE_PROJECT / f"{sid}.jsonl").exists():
            raise HTTPException(status_code=404, detail="no such window")
        await claude_restart(sid)
        return {"ok": True}

    @app.get("/app/window/cmd")
    async def window_cmd_get(request: Request):
        """The Codex bridge asks for a waiting command (compact / new / switch) and clears it."""
        check_auth(request)
        try:
            c = json.loads(cmd_file.read_text()); cmd_file.unlink()
        except Exception:
            return {}
        return c if time.time() - c.get("ts", 0) < 600 else {}

    async def line_watch():
        """Past the line: one note asking the AI to save what it wants to keep; once it has answered and gone quiet, compact."""
        while True:
            await asyncio.sleep(60)
            try:
                line = line_k() * 1000
                if not line:
                    continue
                u = await asyncio.to_thread(usage_now)
                used, sid, now = u.get("used") or 0, u.get("sid") or "", datetime.now(timezone.utc)
                if used < line:
                    ctx.update(nudged_sid="", nudged_at=None)
                    continue
                if ctx["nudged_sid"] != sid or ctx["nudged_at"] is None:
                    ctx.update(nudged_sid=sid, nudged_at=now)
                    await broadcast(plugin_subs, {"content": (
                        f"(An automatic note from the app, not typed by {human}.) The context is at {used // 1000}k, past the "
                        f"{line // 1000}k line {human} set. Save what you want to keep to your memory now (memory/ in your "
                        f"folder), then tell {human} in a sentence. Once you've gone quiet, the app compacts this window."),
                        "user": "app", "ts": now_iso(), "attachments": []})
                    continue
                last = last_reply_at()
                if last and last > ctx["nudged_at"] and (now - last).total_seconds() >= QUIET_SEC:
                    if backend() == "codex":
                        queue_cmd("compact")
                    else:
                        await claude_compact()
                    ctx["nudged_at"] = now + timedelta(minutes=10)   # give it time to shrink
            except Exception:
                pass

    g.setdefault("NYX_STARTUP", []).append(line_watch)


    # ---- Busy: what it's doing right now, for the line under its name in the chat ----
    TOOL_NAMES = {"Bash": "running a command", "Read": "reading a file", "Edit": "editing a file", "Write": "writing a file",
                  "WebFetch": "reading a web page", "WebSearch": "searching the web", "Agent": "sent a helper",
                  "Skill": "reading instructions", "ToolSearch": "looking for a tool", "Monitor": "watching a job"}
    SPIN_RE = re.compile(r"^\s*\S\s+([^\s(]+\u2026)\s*\(([^)]*)\)")
    bridge_busy = {"state": "idle", "ts": 0}

    def secs(t):
        return sum(int(v) * {"h": 3600, "m": 60, "s": 1}[u] for v, u in re.findall(r"(\d+)\s*([hms])", t or ""))

    def current_tool():
        """The last tool call in the transcript that hasn't had its result yet."""
        m = session_meta()
        f = CLAUDE_PROJECT / f"{m.get('sessionId')}.jsonl" if m else None
        try:
            with f.open("rb") as fh:
                fh.seek(max(0, f.stat().st_size - 400_000))
                lines = fh.read().decode("utf-8", "ignore").splitlines()
        except Exception:
            return None
        done = set()
        for line in reversed(lines):
            if '"tool_use' not in line and '"tool_result' not in line:
                continue
            try:
                d = json.loads(line); content = d["message"]["content"]
            except Exception:
                continue
            if not isinstance(content, list):
                continue
            for c in reversed(content):
                if c.get("type") == "tool_result":
                    done.add(c.get("tool_use_id"))
                elif c.get("type") == "tool_use":
                    if c.get("id") in done:
                        return None
                    name, inp = c.get("name", ""), c.get("input") or {}
                    if name in ("mcp__companion__reply", "mcp__companion__react"):
                        label = "writing to you"
                    elif name.startswith("mcp__"):
                        label = "using " + name.split("__")[-1]
                    else:
                        label = TOOL_NAMES.get(name, "using " + name)
                    detail = inp.get("description") or inp.get("file_path") or inp.get("url") or inp.get("query") or ""
                    if isinstance(detail, str) and "/" in detail and len(detail) > 40:
                        detail = "\u2026/" + detail.rsplit("/", 1)[-1]
                    try:
                        since = datetime.fromisoformat(d.get("timestamp", "").replace("Z", "+00:00")).timestamp()
                    except Exception:
                        since = None
                    return {"tool": label, "detail": str(detail)[:60], "since": since}
        return None

    def claude_busy():
        pane = tmux("capture-pane", "-pt", TMUX)
        if pane.returncode != 0:
            return {"state": "offline"}
        lines = [l for l in pane.stdout.rstrip().splitlines() if l.strip()]
        tail = "\n".join(lines[-15:])
        if any(s in tail for s in PROMPT_MARKS):
            return {"state": "waiting"}
        if "esc to interrupt" not in tail:
            return {"state": "idle"}
        out = {"state": "busy"}
        for l in reversed(lines[-20:]):
            m = SPIN_RE.match(l)
            if m:
                out.update(verb=m.group(1), secs=secs(m.group(2).split("\u00b7")[0])); break
        t = current_tool()
        if t:
            out.update(tool=t["tool"], detail=t["detail"])
            if t["since"]:
                out["tool_secs"] = max(0, int(time.time() - t["since"]))
        return out

    @app.get("/app/busy")
    async def busy_get(request: Request):
        check_auth(request)
        if backend() == "codex":
            b = dict(bridge_busy)
            if b.get("state") == "busy" and time.time() - b.get("ts", 0) > 900:
                b = {"state": "idle"}
            now = time.time()
            if b.get("turn_since"):
                b["secs"] = int(now - b["turn_since"])
            if b.get("tool_since"):
                b["tool_secs"] = int(now - b["tool_since"])
            return b
        return await asyncio.to_thread(claude_busy)

    @app.post("/app/busy")
    async def busy_post(request: Request):
        """The Codex bridge says what it's doing: {state: busy|idle, tool?, detail?}."""
        check_auth(request)
        b = await request.json(); now = time.time()
        st = b.get("state") if b.get("state") in ("busy", "idle") else "idle"
        if st == "idle":
            bridge_busy.clear(); bridge_busy.update(state="idle", ts=now)
        else:
            if bridge_busy.get("state") != "busy":
                bridge_busy.clear(); bridge_busy.update(state="busy", turn_since=now)
            bridge_busy["ts"] = now
            if b.get("tool"):
                bridge_busy.update(tool=clip(b["tool"], 40), detail=clip(b.get("detail"), 60), tool_since=now)
            elif "tool" in b:
                for k in ("tool", "detail", "tool_since"):
                    bridge_busy.pop(k, None)
        return {"ok": True}


    # ---- Kitchen: the pantry, recipes the companion writes, photos of what got made, a timeline of meals ----
    kitchen_file, ai = data_dir / "kitchen.json", g.get("AI_NAME", "AI")
    pub = g.get("PUBLIC_PREFIX", "")

    def kload():
        try:
            d = json.loads(kitchen_file.read_text(encoding="utf-8"))
        except Exception:
            d = {}
        d.setdefault("pantry", {"tools": [], "seasonings": [], "ingredients": []})
        d["pantry"].setdefault("staples", [])
        d.setdefault("recipes", []); d.setdefault("log", [])
        return d

    def ksave(d):
        tmp = kitchen_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8"); tmp.replace(kitchen_file)

    def strs(v, n=80):
        return [str(x).strip()[:40] for x in (v if isinstance(v, list) else []) if str(x).strip()][:n]

    async def tell_ai(text, attachments=None):
        await broadcast(plugin_subs, {"content": text, "user": "kitchen", "ts": now_iso(), "attachments": attachments or []})

    @app.get("/app/kitchen")
    async def kitchen_get(request: Request):
        check_auth(request)
        return kload()

    @app.post("/app/kitchen/pantry")
    async def kitchen_pantry(request: Request):
        check_auth(request)
        b = await request.json(); d = kload()
        d["pantry"] = {k: strs(b.get(k)) for k in ("tools", "seasonings", "ingredients", "staples")}
        ksave(d)
        return {"ok": True, "pantry": d["pantry"]}

    @app.post("/app/kitchen/ask")
    async def kitchen_ask(request: Request):
        """Nothing in the recipes fits what they picked: the companion gets a note and writes one."""
        check_auth(request)
        picked = strs((await request.json()).get("picked"), 20)
        if not picked:
            raise HTTPException(status_code=400, detail="empty")
        p = kload()["pantry"]
        await tell_ai(f"(Kitchen, not typed by {human}.) {human} picked: {', '.join(picked)} — no recipe for that yet. "
                      f"Pots: {', '.join(p['tools']) or 'not listed'}; seasonings: {', '.join(p['seasonings']) or 'not listed'}; "
                      f"in the fridge: {', '.join(p['ingredients']) or 'not listed'}. Write one into {kitchen_file} under "
                      f"recipes (or POST /app/kitchen/recipe with name, ingredients, seasonings, tools, steps, tip), then tell {human} in the chat.")
        return {"ok": True}

    @app.post("/app/kitchen/recipe")
    async def kitchen_recipe(request: Request):
        check_auth(request)
        b = await request.json()
        name = str(b.get("name") or "").strip()[:60]
        steps = [str(x).strip()[:400] for x in (b.get("steps") or []) if str(x).strip()][:30]
        if not name or not steps:
            raise HTTPException(status_code=400, detail="name and steps required")
        d = kload()
        r = {"id": secrets.token_hex(4), "name": name, "ingredients": strs(b.get("ingredients"), 20), "seasonings": strs(b.get("seasonings"), 20),
             "tools": strs(b.get("tools"), 10), "steps": steps, "tip": str(b.get("tip") or "").strip()[:400], "at": now_iso()}
        d["recipes"].append(r); ksave(d)
        return {"ok": True, "recipe": r}

    @app.post("/app/kitchen/photo")
    async def kitchen_photo(request: Request):
        """A photo of the finished dish (uploaded first through /app/upload); the companion is asked for a word on it."""
        check_auth(request)
        b = await request.json()
        rid, file = str(b.get("id") or ""), fname(b.get("file"))
        if not file or not (upload_dir / file).is_file():
            raise HTTPException(status_code=400, detail="no such upload")
        d = kload()
        for r in d["recipes"]:
            if r.get("id") == rid:
                ph = {"file": file, "at": now_iso(), "comment": str(b.get("comment") or "").strip()[:400]}
                r.setdefault("photos", []).append(ph); ksave(d)
                if not ph["comment"]:
                    await tell_ai(f"(Kitchen, not typed by {human}.) {human} made 「{r['name']}」 and sent a photo. Look at it and write a line back: "
                                  f"POST /app/kitchen/photo/comment {{id: {rid}, file: {file}, comment}} (or edit {kitchen_file}), then say something in the chat.",
                                  [{"url": f"{pub}/uploads/{file}", "name": file, "kind": "image", "mime": "image/jpeg"}])
                return {"ok": True, "photo": ph}
        raise HTTPException(status_code=404, detail="no such recipe")

    @app.post("/app/kitchen/photo/comment")
    async def kitchen_photo_comment(request: Request):
        check_auth(request)
        b = await request.json()
        rid, file, d = str(b.get("id") or ""), str(b.get("file") or ""), kload()
        for r in d["recipes"]:
            if r.get("id") == rid:
                for ph in r.get("photos", []):
                    if ph.get("file") == file:
                        ph["comment"] = str(b.get("comment") or "").strip()[:400]; ksave(d)
                        return {"ok": True, "photo": ph}
        raise HTTPException(status_code=404, detail="no such photo")

    @app.post("/app/kitchen/log")
    async def kitchen_log(request: Request):
        """A meal on the timeline (takeaway counts); {delete: <at>} removes one."""
        check_auth(request)
        b = await request.json(); d = kload()
        if b.get("delete"):
            d["log"] = [x for x in d["log"] if x.get("at") != str(b["delete"])]
        else:
            name = str(b.get("name") or "").strip()[:80]
            if not name:
                raise HTTPException(status_code=400, detail="empty")
            e = {"at": str(b.get("at") or now_iso())[:40], "name": name, "ingredients": strs(b.get("ingredients"), 20)}
            if b.get("note"):
                e["note"] = str(b["note"]).strip()[:200]
            d["log"].append(e)
        d["log"].sort(key=lambda x: x.get("at", "")); ksave(d)
        return {"ok": True, "log": d["log"]}

    @app.post("/app/kitchen/cooked")
    async def kitchen_cooked(request: Request):
        check_auth(request)
        rid, d = str((await request.json()).get("id") or ""), kload()
        for r in d["recipes"]:
            if r.get("id") == rid:
                r["cooked"] = int(r.get("cooked") or 0) + 1; r["lastCooked"] = now_iso()
                d["log"].append({"at": now_iso(), "name": r["name"], "recipe": rid, "ingredients": r.get("ingredients", [])})
                ksave(d)
                return {"ok": True, "recipe": r}
        raise HTTPException(status_code=404, detail="no such recipe")
