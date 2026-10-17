# Nychthemeron

A day-and-night chat page for talking to your own AI companion through a self-hosted relay.
One paper, two sides: the day side is grey-white paper and ink, the night side is black paper and rust.
Flip the coin in the corner and the whole page turns over.

> **Fan work.** This is an unofficial fan project. It is not made, affiliated with, or endorsed by Anthropic.
> "Claude" is a trademark of Anthropic; the opening card's default word list spells it as a tribute.
> Swap the words in `config.js` if you'd rather it spelled something else.

## What's here

- `index.html`, `app.css`, `app.js` — the chat: key gate, history, live streamed replies, quotes, attachments, stickers, emoji.
- `home.js` — the home poster: one ink river, entries hung on alternating banks, each with a small drawing from inside a language model.
- `splash.js` — the opening card: first letters fall into a column, each pulls its word out to the right; on a flip the words turn over.
- `listen.html/.js/.css` — Listen: a record on the paper, a glass player card, Together / Alone, and a now-playing page with lyrics.
- `attic.html/.js/.css` — Attic: bring up a pile of pictures, make your own shelves, sort and annotate them.
- `room.html/.js` — Room: an empty three.js room to furnish with your own Blender models; see `docs/room-blender.md`.
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

`picks` is a list of who marked a picture; anything non-empty shows a small star (handy if your companion can mark things it likes).

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

## License

The web pages: MIT, see [LICENSE](LICENSE). `relay/` and `channel/`: GNU AGPL v3, a modified version of Tidal Echo — see `relay/NOTICE`.
