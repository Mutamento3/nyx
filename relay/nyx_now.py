"""The "right now" card: what time it is on your side and where you are, on top of what you send.

A model has no clock, and after a window compacts it also forgets that you flew home on Tuesday.
So the relay reads one small file, `memory/now.md` in your companion's folder, and puts it on your messages:

  - every message gets one short line:  【now · Sun 3/8 21:40 · Lisbon】
  - the card's bullet lines come along only now and then: after an hour of quiet, when the file changed,
    or when they haven't been sent for three hours.

Your companion keeps the file itself (its persona note tells it to); you can read it in the Heart.
The file looks like this; only `Time zone:`, `Place:` and lines starting with "- " are read:

    Time zone: Europe/Lisbon
    Place: Lisbon
    - Exams all week, the last one Friday morning.
    - Visiting family over the weekend.

No file, no card; delete it to turn this off. `时区：` and `地点：` work as well.
Mounted from app.py with `nyx_now.register(app, globals())`.

This file is part of the Nyx relay, a modified version of Tidal Echo, and is
licensed under the GNU AGPL v3 (see LICENSE and NOTICE in this folder).
"""
import os
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

COMPANION_DIR = Path(os.environ.get("RELAY_COMPANION_DIR", str(Path.home() / "companion")))
CARD = Path(os.environ.get("RELAY_NOW_CARD", str(COMPANION_DIR / "memory" / "now.md")))
GAP_SEC = 60 * 60          # quiet this long → send the whole card again
REPEAT_SEC = 3 * 60 * 60   # and at least this often
MAX_LINES = 8
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _key(s: str, *names: str):
    for n in names:
        for sep in (":", "："):
            if s.lower().startswith((n + sep).lower()):
                return s[len(n) + 1:].strip()
    return None


def read_card():
    """(mtime, tz name, place, bullet lines) or None when there's no card."""
    try:
        mtime = CARD.stat().st_mtime
        lines = CARD.read_text("utf-8").splitlines()
    except OSError:
        return None
    tz, place, body = "", "", []
    for ln in lines:
        s = ln.strip()
        v = _key(s, "Time zone", "Timezone", "时区")
        if v is not None:
            tz = v or tz
            continue
        v = _key(s, "Place", "地点")
        if v is not None:
            place = v
            continue
        if s.startswith("- "):
            body.append(s)
    return mtime, tz, place, body[:MAX_LINES]


def register(app, g):
    st = {"last": 0.0, "body_at": 0.0, "mtime": 0.0}
    log = g.get("log")

    async def now_card(pl: dict, body: dict) -> dict:
        got = read_card()
        if not got:
            return pl
        mtime, tz, place, lines = got
        try:
            z = ZoneInfo(tz) if tz else None
        except Exception:
            z = None
        now = time.time()
        d = datetime.fromtimestamp(now, z) if z else datetime.utcfromtimestamp(now)
        when = f"{DAYS[d.weekday()]} {d.month}/{d.day} {d:%H:%M}" + ("" if z else " UTC")
        head = f"【now · {when}" + (f" · {place}" if place else "")
        whole = lines and (now - st["last"] >= GAP_SEC or mtime != st["mtime"] or now - st["body_at"] >= REPEAT_SEC)
        st["last"] = now
        if whole:
            st.update(body_at=now, mtime=mtime)
            head += f" | {CARD.name}, change it when this changes】\n" + "\n".join(lines)
        else:
            head += "】"
        return {**pl, "content": f"{head}\n\n{pl.get('content', '')}"}

    g["HOOKS"]["inbound_payload"].append(now_card)
    if log:
        log.info("now card: %s", CARD)
