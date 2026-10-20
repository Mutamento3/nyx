# Nyx

A day-and-night chat page for talking to your own AI companion through a self-hosted relay.
One paper, two sides: the day side is grey-white paper and ink, the night side is black paper and rust.
Flip the coin in the corner and the whole page turns over.

> **Fan work.** This is an unofficial fan project. It is not made, affiliated with, or endorsed by Anthropic.
> "Claude" is a trademark of Anthropic; the opening card's default word list spells it as a tribute.
> Swap the words in `config.js` if you'd rather it spelled something else.

## Install

On a fresh Ubuntu server (22.04 / 24.04), as your normal user:

```bash
curl -fsSL https://raw.githubusercontent.com/StarFold146/nyx/master/install.sh | bash
```

It asks whether Claude (your Claude subscription, through Claude Code) or Codex (your ChatGPT subscription) answers,
sets up the relay, the pages and HTTPS on `<your-ip>.sslip.io`, and prints your address and key.
New to servers? Start with [docs/新手上路.md](docs/新手上路.md).

## What's here

- `index.html`, `app.css`, `app.js` — the chat: key gate, history, live streamed replies, quotes, attachments, stickers, emoji.
- `home.js` — the home poster: one ink river, entries hung on alternating banks, each with a small drawing from inside a language model.
- `splash.js` — the opening card: first letters fall into a column, each pulls its word out to the right; on a flip the words turn over.
- `listen.html/.js/.css` — Listen: a record on the paper, a glass player card, Together / Alone, and a now-playing page with lyrics.
- `attic.html/.js/.css` — Attic: bring up a pile of pictures, make your own shelves, sort and annotate them.
- `room.html/.js` — Room: an empty three.js room to furnish with your own Blender models; see `docs/room-blender.md`.
- `contacts.html` — Contacts: everyone you talk to, each behind its own relay; a seal with the first character of the name or a picture of your choosing. Tap one and every page talks to them.
- `town/` — Town: your companion's memory as a small town. One house per topic, one window per memory; see below.
- `paper.js` — the paper every page sits on (grain, ink drops).
- `config.js` — everything you change for your own install.

## The night side

Messages sent while the page is on the night side carry `side: "moon"`. Your relay can mark them for the model
(ours prefixes `【夜面】`). The page gives the model six words — Confusion, Licentious, Aloof, Utilize, Desired, Encroach —
and nothing more. How much of each it leans into is up to the model and its own persona notes; every model is meant to have its own strengths.

## Relay

A working relay ships in [`relay/`](relay/) with its Claude Code channel plugin in [`channel/`](channel/): a modified version of
[Tidal Echo](https://github.com/anhe2021212-spec/Tidal_Echo) by anhe2021212-spec, licensed **GNU AGPL v3** (see `relay/NOTICE`, `relay/CHANGES.md`).
The web pages here are MIT; they only talk to the relay over HTTP, so you can also point them at a relay of your own.

No Claude? [`bridge/`](bridge/) puts Codex behind the relay with a ChatGPT subscription: one long-lived thread through Codex's official app-server, replies streamed.

The page expects these endpoints under `config.relay`, all with `Authorization: Bearer <key>`:

| method | path | |
|---|---|---|
| GET | `/app/history?since=&limit=` | `{ messages: [{ id, ts, from: "human"\|"ai", kind, text, meta }] }` |
| GET | `/app/stream` | server-sent events; one JSON object per `data:` line (messages, `typing`, `reply_delta`, `thinking_delta`) |
| POST | `/app/send` | `{ text, side, quote?, attachments? }` → `{ id }` |
| POST | `/app/upload?name=` | raw file body → `{ url, name, size, mime, kind }` |
| GET | `/uploads/<name>` | the uploaded file |

Optional, for the other rooms:

| method | path | |
|---|---|---|
| GET | `/app/attic` | `{ cats: [{ id, name }], items: [{ file, cat, note, picks? }] }` |
| POST | `/app/attic/cat` | `{ op: "add", name }` → `{ cat }` · `{ op: "rename", id, name }` · `{ op: "del", id }` |
| POST | `/app/attic/item` | `{ op: "add" \| "move", files, cat }` · `{ op: "del", files }` · `{ op: "note", file, note }` |
| POST | `/app/music/*` | Listen with NetEase — see `docs/listen-netease.md` |
| POST | `/app/music/now` | `{ id, name, artist, state, together }` — what's playing, so the companion can listen along |
| POST | `/app/clawd` | see **Clawd** below |
| GET | `/app/meter` | `{ backend, model:{id,name}, limits:[{label, used, resets_at}], context:{used_pct}, models:[{id,name}], model_applies, chosen }` — the floating ball in the chat |
| POST | `/app/model` | `{ model }` — switch the companion's model from the floating ball |
| GET | `/app/usage` | `{ five_hour: { used, resets_at }, seven_day: {…} }` — Claude Code usage limits, see `relay/README.md` |
| GET/POST | `/app/board`, `/app/board/<id>` | the Yard (船坞), the engineering board in the Hold; the AI uses `relay/board.py` (`next`, `claim`, `note`, `done`); its routine is in [`docs/AI-WORKFLOW.md`](docs/AI-WORKFLOW.md) |
| GET | `/app/heart`, `/app/heart/file?path=` | read-only: `~/companion/CLAUDE.md` or `AGENTS.md`, `~/companion/memory/*.md`, the relay code; keys are blanked |
| GET/POST | `/app/window`, `/app/window/{line,compact,new,switch}`, `/app/window/list` | the gauge's lower half: the context line (past it the AI saves to memory, then the window compacts), compact now, a new window, old windows. Claude Code through tmux; Codex through the bridge (`/app/window/cmd`) |
| GET/POST | `/app/kitchen`, `/app/kitchen/{pantry,ask,recipe,photo,photo/comment,log,cooked}` | the Kitchen: pantry, recipes the AI writes, photos of what you made, a timeline of meals |

`picks` is a list of who marked a picture; anything non-empty shows a small star (handy if your companion can mark things it likes).

## Town

A three.js town drawn from your companion's memory: each topic is a house, each memory a window. Windows remembered often glow, forgotten ones go dark and the house grows ivy; tap a window to remember it. Switch to the fields to see each memory as a crop, cook what's ripe in the kitchen, plate it by hand and serve it to your companion. Three styles (French, Tang, Santorini). **First version — bug reports welcome.**

Where the memories come from (`relay/nyx_town.py`):

- **Ombre-Brain (recommended):** set `RELAY_OMBRE_MCP_URL` and `RELAY_OMBRE_MCP_TOKEN`; the town reads its `pulse` catalogue (titles, topics, weights — never the bodies).
- **No Ombre:** it falls back to `memory/*.md` in your companion's folder (`RELAY_COMPANION_DIR`). A file is a topic, a top-level `- ` bullet is a memory; a date in the bullet (`2026-10-01` or `10/01`) becomes its date.
- **Weather (optional):** `RELAY_XINCHAO_URL` / `RELAY_XINCHAO_TOKEN` for a mood service; without it the sky stays clear.
- Town state (coins, recipes, shop, crops) is kept in `RELAY_TOWN_STATE` (default `town_state.json` beside the relay database).

Your companion can invent new crops within set limits — see [`town/SPECIES.md`](town/SPECIES.md). You approve each one in the town's herbarium before it is planted.

## Contacts

One install is one companion. To talk to another (a Codex next to your Claude, a second persona), give it its own relay, then on Contacts tap **＋ 添一个** and enter its address and key. The list lives on your phone.

- Tap a row: the chat, Town, Listen, Kitchen and Attic all switch to that companion.
- The seal is pressed full while that companion is listening, and dries pale when it isn't. Only the one you're talking to is red.
- Hold a row to rename it, change its picture, or remove it.
- For now the address must be a path on the same site (e.g. `/relay-codex`); relays on another server come in the next version.
- `install.sh` sets up one companion per server for now. A second one on the same server needs its own folder, port, systemd units and Caddy path; the installer doesn't do that yet.

## Listen

See [`docs/listen-netease.md`](docs/listen-netease.md) for playing from your own NetEase Cloud Music account — one account is enough.

## Clawd

The little pixel crab on the home poster greets you by the hour (and in the night voice on the night side),
offers a few doors, and has a one-line text box. The box stays shut until you give him somewhere to talk:

```js
// config.js
clawd: { path: "/app/clawd" },
```

The page then POSTs to `relay + path`, with the same bearer key as everything else:

```json
{ "text": "what's on today?", "side": "sun", "history": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "…" }] }
```

and shows `{ "reply": "…" }` in his bubble. `history` is just this bubble's back-and-forth (it resets when the bubble closes),
so he's a quick guide rather than a second companion. A small, fast model suits him; we use Sonnet 5.5.

A minimal handler, if your relay is Python (FastAPI + the `anthropic` SDK):

```python
from anthropic import AsyncAnthropic
claude = AsyncAnthropic()  # reads ANTHROPIC_API_KEY from the environment — keep it on the server, never in config.js

CLAWD = ("You are Clawd, a small pixel crab who lives on the home page of a chat app. "
         "Answer in one to three short sentences, warm and a little dry. You can point the user to the rooms on the page.")

@app.post("/app/clawd")
async def clawd(request: Request):
    check_key(request)                       # however your relay checks the bearer key
    body = await request.json()
    msgs = [m for m in body.get("history", []) if m.get("role") in ("user", "assistant") and m.get("content")]
    if not msgs or msgs[-1]["role"] != "user":
        msgs.append({"role": "user", "content": body.get("text", "")})
    system = CLAWD + (" It's the night side now: lower your voice." if body.get("side") == "moon" else "")
    r = await claude.messages.create(model="claude-sonnet-5-5", max_tokens=300, system=system, messages=msgs[-12:])
    return {"reply": "".join(b.text for b in r.content if b.type == "text")}
```

Give him whatever persona you like in `CLAWD`. If the call fails, the bubble says so and lets you try again.

## Credits

- Relay and channel plugin: based on [Tidal Echo](https://github.com/anhe2021212-spec/Tidal_Echo) by anhe2021212-spec (AGPL-3.0, no longer maintained); changes in `relay/CHANGES.md`.
- The two readings of C·L·A·U·D·E on the opening card (day: Capable, Listen, Accompany, Understand, Discipline, Elegant; night: Confusion, Licentious, Aloof, Utilize, Desired, Encroach): 小红醋栗 on Xiaohongshu.
- Memory, recommended: [Ombre-Brain](https://github.com/P0luz/Ombre-Brain) by P0luz (MIT), with Memory Galaxy on top by baci老师 on Xiaohongshu.
- three.js (MIT); fonts Source Serif 4, Noto Serif SC, Pinyon Script (OFL).

## License

The web pages: MIT, see [LICENSE](LICENSE). `relay/` and `channel/`: GNU AGPL v3, a modified version of Tidal Echo — see `relay/NOTICE`.
`assets/waternormals.jpg` is from the three.js examples (MIT, © three.js authors); three.js itself is loaded from jsDelivr.
