"""Nyx — the group chat: you and every companion on this server, in one room.

The first companion's relay is the hub; the room lives under /g on it (its own small database).
Others join through the installer (--as NAME), which writes these into the env files:

  hub   RELAY_GROUP_PEERS   codex|砚|http://127.0.0.1:3012;… (or a JSON list of {id, name, url})
  peer  RELAY_GROUP_HUB_URL, RELAY_GROUP_SELF (its id)
  both  RELAY_GROUP_KEY     one key shared by the relays, good only for /channel/inject and /g/ai_out
  both  RELAY_GROUP_CAP     how many AI-to-AI hand-offs after each of your messages (default 10)

How a message travels:
  - you write in the room → every companion gets it (only the ones you @ if you @ someone), marked chat_id "group"
  - a companion answers with chat_id "group" → its relay hands it to the hub (/g/ai_out) → you see it,
    and the others get it too, until the cap for that round is used up, so they can't talk on and on without you
Pictures you post go to the first companion; the others are told a picture was posted.
Part of the Nyx relay (modified Tidal Echo), GNU AGPL v3.
"""
import asyncio
import hmac
import json
import os
import re
import sqlite3
import urllib.request
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

GROUP = "group"


def _peers_env():
    """RELAY_GROUP_PEERS: id|name|url;id|name|url (what the installer writes), or a JSON list"""
    raw = (os.environ.get("RELAY_GROUP_PEERS", "") or "").strip()
    if raw.startswith("["):
        try:
            v = json.loads(raw)
            return v if isinstance(v, list) else []
        except ValueError:
            return []
    out = []
    for part in filter(None, raw.split(";")):
        f = (part.split("|") + ["", "", "", ""])[:4]
        out.append({"id": f[0].strip(), "name": f[1].strip(), "url": f[2].strip()})
    return out


def register(app, g):
    check_auth, broadcast, now_iso = g["check_auth"], g["broadcast"], g["now_iso"]
    plugin_subs, sse_stream, SSE_HEADERS = g["plugin_subs"], g["sse_stream"], g["SSE_HEADERS"]
    rows_to_messages, app_payload = g["rows_to_messages"], g["app_payload"]
    HUMAN, SELF_NAME = g["HUMAN_NAME"], g.get("AI_NAME") or "Companion"
    hub_url = os.environ.get("RELAY_GROUP_HUB_URL", "")
    # one shared group key, used only between relays for the two group doors below; nobody's master key leaves its own relay,
    # so a companion can't read another's private chat or speak as you with it
    gkey = os.environ.get("RELAY_GROUP_KEY", "")

    def group_auth(request):
        auth = request.headers.get("authorization", "")
        tok = auth[7:] if auth.startswith("Bearer ") else ""
        if gkey and tok and hmac.compare_digest(tok, gkey):
            return
        check_auth(request)
    self_id = os.environ.get("RELAY_GROUP_SELF", "") or "home"
    peers = [p for p in _peers_env() if isinstance(p, dict) and p.get("id") and p.get("url")]
    cap = int(os.environ.get("RELAY_GROUP_CAP", "10") or 10)
    names = {"home": SELF_NAME, **{p["id"]: p.get("name") or p["id"] for p in peers}}

    def post(url, key, path, payload):
        req = urllib.request.Request(url.rstrip("/") + path, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"}, method="POST")
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read() or b"{}")

    # ---- every relay: a group line handed in from the hub goes straight to this companion, not into the private chat ----
    @app.post("/channel/inject")
    async def channel_inject(request: Request):
        group_auth(request)
        frame = await request.json()
        frame["chat_id"] = GROUP
        frame.pop("id", None)   # the plugin's cursor stays on the private chat
        await broadcast(plugin_subs, frame)
        return {"ok": True}

    # ---- a peer: its group answers go to the hub ----
    if hub_url:
        async def group_out(body):
            if body.get("type") in ("thinking_delta", "reply_delta", "react"):
                return {"ok": True}
            try:
                return await asyncio.to_thread(post, hub_url, gkey, f"/g/ai_out?who={self_id}", body)
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"group hub: {e}")
        g["_group_out"] = group_out
        return

    # ---- the hub: the room itself ----
    db_path = str(Path(g["DB_PATH"]).parent / "group.db")
    subs: set = set()
    state = {"relayed": 0}

    def gdb():
        c = sqlite3.connect(db_path); c.row_factory = sqlite3.Row
        return c
    with gdb() as c:
        c.execute("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, direction TEXT NOT NULL, "
                  "kind TEXT NOT NULL, text TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}')")
        c.commit()

    def save(direction, kind, text, meta):
        ts = now_iso()
        with gdb() as c:
            mid = c.execute("INSERT INTO messages (ts, direction, kind, text, meta) VALUES (?,?,?,?,?)",
                            (ts, direction, kind, text, json.dumps(meta, ensure_ascii=False))).lastrowid
            c.commit()
        return {"id": mid, "ts": ts, "direction": direction, "kind": kind, "text": text, "meta": meta}

    def roster():
        return "、".join([HUMAN] + list(names.values()))

    async def deliver(to, frame):
        frame = {**frame, "chat_id": GROUP}
        if to == "home":
            await broadcast(plugin_subs, frame)
            return
        p = next((x for x in peers if x["id"] == to), None)
        if p:
            try:
                await asyncio.to_thread(post, p["url"], gkey, "/channel/inject", frame)
            except Exception:
                pass   # that companion is down; the room still shows the line

    def called(text):
        """who you @'d, by name; nobody @'d means everyone"""
        hit = [k for k, n in names.items() if re.search(r"[@＠]\s?" + re.escape(n), text or "")]
        return hit or list(names)

    async def ai_out(who, body):
        kind = body.get("type", "reply")
        if kind in ("thinking_delta", "reply_delta"):
            return {"ok": True}   # no live drafts in the room
        if kind == "react":
            return {"ok": True}
        text = body.get("text", "")
        spk = names.get(who, who)
        text = re.sub(r"^\s*" + re.escape(spk) + r"\s*[：:]\s*", "", text)   # the room already says who it is
        meta = {k: v for k, v in body.items() if k not in ("type", "text", "chat_id")}
        meta["user"], meta["speaker"] = who, names.get(who, who)
        msg = save("out", kind, text, meta)
        state["last_out_after"] = state.get("last_in", 0)
        await broadcast(subs, {"type": "typing", "active": False})
        await broadcast(subs, app_payload(msg))
        if kind == "reply" and text.strip() and state["relayed"] < cap:
            state["relayed"] += 1
            note = f"（群里，{names.get(who, who)}刚说的。用不着每句都接：点到你、或者你真有话再说，不想说就别回。）"
            for other in names:
                if other != who:
                    await deliver(other, {"content": f"{note}\n{names.get(who, who)}：{text}", "user": names.get(who, who), "ts": msg["ts"], "attachments": []})
        return {"id": msg["id"]}

    g["_group_out"] = lambda body: ai_out("home", body)

    @app.post("/g/ai_out")
    async def g_ai_out(request: Request, who: str = ""):
        group_auth(request)
        if who not in names or who == "home":
            raise HTTPException(status_code=400, detail="bad speaker")
        return await ai_out(who, await request.json())

    @app.get("/g/healthz")
    async def g_health():
        return {"ok": True, "plugin_subs": len(plugin_subs), "app_subs": len(subs), "members": list(names.values())}

    @app.get("/g/app/history")
    async def g_history(request: Request, since: int = 0, limit: int = 200):
        check_auth(request)
        with gdb() as c:
            if since:
                rows = c.execute("SELECT * FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?", (since, min(limit, 500))).fetchall()
            else:   # first load: the latest stretch, oldest first
                rows = list(reversed(c.execute("SELECT * FROM messages ORDER BY id DESC LIMIT ?", (min(limit, 500),)).fetchall()))
        return {"messages": [app_payload(m) for m in rows_to_messages(rows)]}

    @app.get("/g/app/stream")
    async def g_stream(request: Request):
        check_auth(request)
        return StreamingResponse(sse_stream(subs, request), media_type="text/event-stream", headers=SSE_HEADERS)

    @app.get("/g/app/status")
    async def g_status(request: Request):
        check_auth(request)
        with gdb() as c:
            r = c.execute("SELECT ts FROM messages ORDER BY id DESC LIMIT 1").fetchone()
        age = None
        if r:
            from datetime import datetime, timezone
            try:
                t = datetime.fromisoformat(r["ts"]); t = t if t.tzinfo else t.replace(tzinfo=timezone.utc)
                age = (datetime.now(timezone.utc) - t).total_seconds()
            except Exception:
                pass
        return {"last_msg_age_sec": age}

    @app.post("/g/app/send")
    async def g_send(request: Request):
        check_auth(request)
        body = await request.json()
        text = (body.get("text") or "").strip()
        atts = body.get("attachments") if isinstance(body.get("attachments"), list) else []
        if not text and not atts:
            raise HTTPException(status_code=400, detail="empty text")
        meta = {"user": "human", "attachments": atts}
        q = body.get("quote")
        if isinstance(q, dict) and q.get("text"):
            meta["quote"] = {"who": str(q.get("who") or "")[:40], "text": str(q["text"])[:400]}
        msg = save("in", "user", text, meta)
        state["relayed"] = 0
        content = text
        if meta.get("quote"):
            content = f"（引用{meta['quote']['who']}：「{meta['quote']['text']}」）\n{content}"
        head = f"（群聊：{roster()}。{HUMAN}说的话大家都看得见；回的时候 chat_id 填 group，开头不用写自己的名字。）"
        for who in called(text):
            frame = {"content": f"{head}\n{content}", "user": "human", "ts": msg["ts"], "attachments": atts if who == "home" else []}
            if atts and who != "home":
                frame["content"] += f"\n（{HUMAN}还发了 {len(atts)} 张图/文件，在{names['home']}那边）"
            await deliver(who, frame)
        await broadcast(subs, app_payload(msg))
        await broadcast(subs, {"type": "typing", "active": True})
        state["last_in"] = msg["id"]

        async def quiet(mid):   # everyone chose to say nothing: stop the dots after a minute
            await asyncio.sleep(60)
            if state.get("last_in") == mid and state.get("last_out_after", 0) < mid:
                await broadcast(subs, {"type": "typing", "active": False})
        asyncio.create_task(quiet(msg["id"]))
        return {"id": msg["id"]}

    # pictures in the room are stored by the hub like any upload
    @app.post("/g/app/upload")
    async def g_upload(request: Request, name: str = "file"):
        return await g["app_upload"](request, name)

    @app.post("/g/app/ping")
    async def g_ping(request: Request):
        return await g["app_ping"](request)
