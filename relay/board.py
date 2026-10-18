#!/usr/bin/env python3
"""The engineering board, from the server's terminal — for the AI (and you).

  python3 ~/nyx/relay/board.py ls                       open tickets (add `all` for done ones too)
  python3 ~/nyx/relay/board.py show T003
  python3 ~/nyx/relay/board.py add "title" [-b "details"] [-p p0|p1|p2]
  python3 ~/nyx/relay/board.py claim T003 -f app.js -f app.css [--who NAME]   before you edit files
  python3 ~/nyx/relay/board.py done T003 "what changed" [--who NAME]           after
  python3 ~/nyx/relay/board.py note T003 "text"                                progress, in a line
  python3 ~/nyx/relay/board.py todo T003                                       put it back
  python3 ~/nyx/relay/board.py set T003 [--wait 1|0] [--proof URL] [-p p0]     needs a yes / what it looks like done
  python3 ~/nyx/relay/board.py next                                            what you may pick up on your own:
                                                                               open, nobody on it, not waiting for a yes

Talks to the relay on 127.0.0.1 with the key from relay.env next to this file. Before editing the pages or the
relay, `ls` first: if another window has claimed the same file, wait for it. How to work the board: docs/AI-WORKFLOW.md.

This file is part of the Nyx relay (GNU AGPL v3, see LICENSE and NOTICE in this folder).
"""
import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def env():
    e = {}
    try:
        for line in (HERE / "relay.env").read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1); e[k.strip()] = v.strip()
    except OSError:
        pass
    return e


E = env()
URL = os.environ.get("RELAY_URL", "http://127.0.0.1:3011")
KEY = os.environ.get("RELAY_SECRET") or E.get("RELAY_SECRET", "")
WHO = E.get("RELAY_AI_NAME", "AI")


def call(path, body=None):
    req = urllib.request.Request(URL + path, method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"{}")


def line(it):
    files = f"  [{', '.join(it['files'])}]" if it.get("files") else ""
    owner = f"  ({it['owner']})" if it.get("owner") else ""
    wait = "  waits for a yes" if it.get("wait") else ""
    return f"{it['id']} {it['status']:<5} {it['pri']} {it['size']}  {it['title']}{owner}{files}{wait}"


def main():
    ap = argparse.ArgumentParser(description="Nyx engineering board")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("ls"); p.add_argument("all", nargs="?")
    p = sub.add_parser("show"); p.add_argument("id")
    p = sub.add_parser("add"); p.add_argument("title"); p.add_argument("-b", "--body", default=""); p.add_argument("-p", "--pri", default="p1")
    p = sub.add_parser("claim"); p.add_argument("id"); p.add_argument("-f", "--file", action="append", default=[]); p.add_argument("--who", default=WHO)
    p = sub.add_parser("done"); p.add_argument("id"); p.add_argument("note", nargs="?", default=""); p.add_argument("--who", default=WHO)
    p = sub.add_parser("note"); p.add_argument("id"); p.add_argument("text"); p.add_argument("--who", default=WHO)
    p = sub.add_parser("todo"); p.add_argument("id"); p.add_argument("--who", default=WHO)
    p = sub.add_parser("set"); p.add_argument("id"); p.add_argument("--wait", choices=("0", "1")); p.add_argument("--proof")
    p.add_argument("-p", "--pri", choices=("p0", "p1", "p2")); p.add_argument("--who", default=WHO)
    sub.add_parser("next")
    a = ap.parse_args()
    if a.cmd == "ls":
        items = call("/app/board")["items"]
        for it in sorted(items, key=lambda x: (x["status"] == "done", x["pri"], x["id"])):
            if a.all or it["status"] != "done":
                print(line(it))
        busy = [f for it in items if it["status"] == "doing" for f in it.get("files", [])]
        if busy:
            print("\nbeing edited:", ", ".join(busy))
    elif a.cmd == "show":
        it = next((x for x in call("/app/board")["items"] if x["id"] == a.id), None)
        if not it:
            sys.exit(f"no {a.id}")
        print(line(it)); print(it.get("body") or "")
        for l in it.get("log", [])[-10:]:
            print(f"  {l['ts'][:16]} {l['who']}: {l['text']}")
    elif a.cmd == "add":
        print(line(call("/app/board", {"title": a.title, "body": a.body, "pri": a.pri, "by": WHO})))
    elif a.cmd == "claim":
        print(line(call(f"/app/board/{a.id}", {"status": "doing", "owner": a.who, "files": a.file, "who": a.who})))
    elif a.cmd == "done":
        print(line(call(f"/app/board/{a.id}", {"status": "done", "note": a.note, "who": a.who})))
    elif a.cmd == "note":
        print(line(call(f"/app/board/{a.id}", {"note": a.text, "who": a.who})))
    elif a.cmd == "todo":
        print(line(call(f"/app/board/{a.id}", {"status": "todo", "owner": "", "who": a.who})))
    elif a.cmd == "set":
        b = {"who": a.who}
        if a.wait is not None: b["wait"] = a.wait == "1"
        if a.proof is not None: b["proof"] = a.proof
        if a.pri: b["pri"] = a.pri
        print(line(call(f"/app/board/{a.id}", b)))
    elif a.cmd == "next":
        items = [x for x in call("/app/board")["items"] if x["status"] == "todo" and not x.get("owner") and not x.get("wait")]
        for it in sorted(items, key=lambda x: (x["pri"], x["id"])):
            print(line(it))
        if not items:
            print("nothing to pick up")


if __name__ == "__main__":
    main()
