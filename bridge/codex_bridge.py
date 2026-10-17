#!/usr/bin/env python3
"""Nyx · Codex bridge — let a ChatGPT-subscription Codex be the companion behind the relay.

It sits where the Claude Code channel plugin sits:

    phone ──▶ relay ──(SSE /channel/in)──▶ this bridge ──(JSON-RPC, stdio)──▶ codex app-server
    phone ◀── relay ◀──(POST /channel/out, streamed)──┘

One long-lived `codex app-server` keeps one conversation thread. Each message from the phone
becomes a new turn in that same thread, so the context stays; the reply streams back word by word.
The thread id is saved, so a restart resumes the same conversation.

Setup (once):  codex login --device-auth      (open the link on your phone, type the code)
Run:           RELAY_URL=http://127.0.0.1:3011 RELAY_SECRET=... python3 codex_bridge.py

Settings (environment):
  RELAY_URL, RELAY_SECRET   the relay, same secret as the relay's relay.env (required)
  CODEX_BIN                 path to codex (default: codex on PATH)
  BRIDGE_DIR                state + downloaded pictures (default: ~/.nyx-bridge)
  BRIDGE_CWD                the folder Codex works in; an AGENTS.md there is read as its persona
                            (default: BRIDGE_DIR/home)
  BRIDGE_PERSONA            optional extra persona file, passed as developer instructions
  BRIDGE_SANDBOX            read-only (default) | workspace-write (Codex may edit files in BRIDGE_CWD)
  BRIDGE_MODEL, BRIDGE_EFFORT   optional model / reasoning effort overrides
  BRIDGE_THINKING           1 = also show Codex's reasoning summary as a thinking bubble (default 1)
  BRIDGE_NUDGE_MIN          if set (minutes), when the chat has been quiet that long, Codex gets a
                            chance to say something first; it can stay silent
  RELAY_HUMAN_NAME          how the bridge refers to you in those nudges (default: "they")

Part of the Nyx relay (a modified version of Tidal Echo), GNU AGPL v3.
"""
import asyncio
import itertools
import json
import os
import sys
import time
from pathlib import Path

import httpx

RELAY = os.environ.get("RELAY_URL", "").rstrip("/")
SECRET = os.environ.get("RELAY_SECRET", "")
CODEX = os.environ.get("CODEX_BIN", "codex")
DIR = Path(os.environ.get("BRIDGE_DIR", str(Path.home() / ".nyx-bridge")))
CWD = Path(os.environ.get("BRIDGE_CWD", str(DIR / "home")))
PERSONA = os.environ.get("BRIDGE_PERSONA", "")
SANDBOX = os.environ.get("BRIDGE_SANDBOX", "read-only")
MODEL = os.environ.get("BRIDGE_MODEL") or None
EFFORT = os.environ.get("BRIDGE_EFFORT") or None
THINKING = os.environ.get("BRIDGE_THINKING", "1") == "1"
NUDGE_MIN = float(os.environ.get("BRIDGE_NUDGE_MIN") or 0)
HUMAN = os.environ.get("RELAY_HUMAN_NAME", "they")
SILENT = "<quiet>"
AUTH = {"Authorization": f"Bearer {SECRET}"}
IMAGE_TYPES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)


class Codex:
    """A tiny JSON-RPC client for `codex app-server` over stdio (one JSON object per line)."""

    def __init__(self, on_note):
        self.on_note, self.ids, self.wait, self.proc = on_note, itertools.count(1), {}, None

    async def start(self):
        self.proc = await asyncio.create_subprocess_exec(
            CODEX, "app-server", stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, limit=16 * 1024 * 1024)
        asyncio.create_task(self._read())
        await self.call("initialize", {"clientInfo": {"name": "nyx-bridge", "version": "0.1"}})
        await self._send({"method": "initialized"})

    async def _send(self, obj):
        self.proc.stdin.write((json.dumps(obj) + "\n").encode())
        await self.proc.stdin.drain()

    async def call(self, method, params):
        rid = next(self.ids)
        fut = asyncio.get_running_loop().create_future()
        self.wait[rid] = fut
        await self._send({"id": rid, "method": method, "params": params})
        return await fut

    async def _read(self):
        while True:
            line = await self.proc.stdout.readline()
            if not line:
                for f in self.wait.values():
                    if not f.done():
                        f.set_exception(RuntimeError("codex app-server exited"))
                log("codex app-server exited")
                return
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if "id" in msg and "method" not in msg:          # a response to one of our calls
                f = self.wait.pop(msg["id"], None)
                if f and not f.done():
                    if "error" in msg:
                        f.set_exception(RuntimeError(json.dumps(msg["error"], ensure_ascii=False)))
                    else:
                        f.set_result(msg.get("result"))
            elif "id" in msg:                                 # codex asks us something (approvals)
                await self._send({"id": msg["id"], "result": {"decision": "decline"}})
            else:
                try:
                    await self.on_note(msg.get("method", ""), msg.get("params") or {})
                except Exception as e:
                    log("note handler:", e)


class Bridge:
    def __init__(self):
        self.http = httpx.AsyncClient(timeout=30)
        self.codex = Codex(self.on_note)
        self.thread = None
        self.queue = asyncio.Queue()
        self.turn_done = asyncio.Event()
        self.last_activity = time.time()
        self.nudging = False

    # ---- relay side ----
    async def out(self, body):
        try:
            await self.http.post(f"{RELAY}/channel/out", headers=AUTH, json=body)
        except Exception as e:
            log("relay out:", e)

    async def listen_relay(self):
        while True:
            try:
                async with self.http.stream("GET", f"{RELAY}/channel/in", headers=AUTH, timeout=None) as r:
                    r.raise_for_status()
                    log("connected to relay")
                    async for line in r.aiter_lines():
                        if line.startswith("data:"):
                            try:
                                m = json.loads(line[5:].strip())
                            except ValueError:
                                continue
                            if m.get("content") or m.get("attachments"):
                                await self.queue.put(m)
            except Exception as e:
                log("relay stream:", e)
            await asyncio.sleep(3)

    async def fetch_attachment(self, a):
        name = str(a.get("url") or a.get("name") or "").split("/")[-1].split("?")[0]
        if not name:
            return None
        dst = DIR / "inbox" / name
        if not dst.exists():
            r = await self.http.get(f"{RELAY}/uploads/{name}", headers=AUTH)
            r.raise_for_status()
            dst.write_bytes(r.content)
        return dst

    # ---- codex side ----
    async def open_thread(self):
        acct = await self.codex.call("account/read", {})
        if not (acct or {}).get("account"):
            log("Codex isn't logged in. Run:  codex login --device-auth")
        state = DIR / "state.json"
        persona = Path(PERSONA).read_text(encoding="utf-8") if PERSONA else None
        opts = {"cwd": str(CWD), "sandbox": SANDBOX, "approvalPolicy": "never",
                "developerInstructions": persona, "model": MODEL}
        try:
            tid = json.loads(state.read_text()).get("threadId")
        except Exception:
            tid = None
        if tid:
            try:
                await self.codex.call("thread/resume", {"threadId": tid, "excludeTurns": True, **opts})
                self.thread = tid
                log("resumed thread", tid)
                return
            except Exception as e:
                log("resume failed, starting a new thread:", e)
        res = await self.codex.call("thread/start", opts)
        self.thread = res["thread"]["id"]
        state.write_text(json.dumps({"threadId": self.thread}))
        log("new thread", self.thread)

    async def on_note(self, method, p):
        if method == "item/agentMessage/delta":
            await self.out({"type": "reply_delta", "stream_id": p["itemId"], "text": p["delta"]})
        elif method == "item/reasoning/summaryTextDelta" and THINKING and not self.nudging:
            await self.out({"type": "thinking_delta", "stream_id": p["itemId"] + ":t", "text": p.get("delta", "")})
        elif method == "item/completed":
            it = p.get("item") or {}
            if it.get("type") == "agentMessage":
                text = it.get("text") or ""
                if self.nudging and text.strip() == SILENT:
                    text = ""            # it chose to stay quiet; an empty final text saves nothing
                await self.out({"type": "reply_delta", "stream_id": it["id"], "text": "", "done": True, "final_text": text})
            elif it.get("type") == "reasoning" and THINKING and not self.nudging:
                await self.out({"type": "thinking_delta", "stream_id": it["id"] + ":t", "text": "", "done": True})
        elif method == "turn/completed":
            turn = p.get("turn") or {}
            if turn.get("status") == "failed":
                err = (turn.get("error") or {}).get("message") or "Codex couldn't answer this time."
                await self.out({"type": "reply", "text": f"（{err}）"})
            self.turn_done.set()
        elif method == "error":
            log("codex error:", json.dumps(p, ensure_ascii=False)[:300])

    async def run_turn(self, inputs, nudge=False):
        self.nudging = nudge
        self.turn_done.clear()
        params = {"threadId": self.thread, "input": inputs}
        if EFFORT:
            params["effort"] = EFFORT
        try:
            await self.codex.call("turn/start", params)
            await asyncio.wait_for(self.turn_done.wait(), timeout=900)
        except Exception as e:
            log("turn:", e)
            if not nudge:
                await self.out({"type": "reply", "text": f"（the bridge hit a problem: {str(e)[:200]}）"})
        finally:
            self.nudging = False
            self.last_activity = time.time()

    async def logged_in(self):
        try:
            return bool((await self.codex.call("account/read", {}) or {}).get("account"))
        except Exception:
            return False

    async def handle(self, m):
        if not await self.logged_in():
            await self.out({"type": "reply", "text": "（Codex isn't logged in yet. On the server, run: codex login --device-auth）"})
            return
        inputs, notes = [], []
        for a in m.get("attachments") or []:
            try:
                path = await self.fetch_attachment(a)
            except Exception as e:
                log("attachment:", e)
                continue
            if path and path.suffix.lower() in IMAGE_TYPES:
                inputs.append({"type": "localImage", "path": str(path)})
            elif path:
                notes.append(f"[file: {path}]")
        text = "\n".join(x for x in [m.get("content") or ""] + notes if x)
        inputs.insert(0, {"type": "text", "text": text or "(a picture)"})
        await self.run_turn(inputs)

    async def nudger(self):
        while NUDGE_MIN > 0:
            await asyncio.sleep(60)
            if self.queue.empty() and time.time() - self.last_activity > NUDGE_MIN * 60 and await self.logged_in():
                await self.queue.put({"nudge": True})

    async def worker(self):
        while True:
            m = await self.queue.get()
            if m.get("nudge"):
                await self.run_turn([{"type": "text", "text": (
                    f"(Not a message — nobody typed. It's been quiet for a while. If there's something you want to say to "
                    f"{HUMAN} right now, say it. If not, reply with exactly {SILENT} and nothing else.)")}], nudge=True)
            else:
                self.last_activity = time.time()
                await self.handle(m)

    async def main(self):
        if not RELAY or not SECRET:
            sys.exit("RELAY_URL and RELAY_SECRET are required")
        (DIR / "inbox").mkdir(parents=True, exist_ok=True)
        CWD.mkdir(parents=True, exist_ok=True)
        await self.codex.start()
        await self.open_thread()
        await asyncio.gather(self.listen_relay(), self.worker(), self.nudger())


if __name__ == "__main__":
    asyncio.run(Bridge().main())
