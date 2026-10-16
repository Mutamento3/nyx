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
- `config.js` — everything you change for your own install.

## The night side

Messages sent while the page is on the night side carry `side: "moon"`. Your relay can mark them for the model
(ours prefixes `【夜面】`). The page gives the model six words — Confusion, Licentious, Aloof, Utilize, Desired, Encroach —
and nothing more. How much of each it leans into is up to the model and its own persona notes; every model is meant to have its own strengths.

## Relay

The page expects these endpoints under `config.relay`, all with `Authorization: Bearer <key>`:

| method | path | |
|---|---|---|
| GET | `/app/history?since=&limit=` | `{ messages: [{ id, ts, from: "human"\|"ai", kind, text, meta }] }` |
| GET | `/app/stream` | server-sent events; one JSON object per `data:` line (messages, `typing`, `reply_delta`, `thinking_delta`) |
| POST | `/app/send` | `{ text, side, quote?, attachments? }` → `{ id }` |
| POST | `/app/upload?name=` | raw file body → `{ url, name, size, mime, kind }` |
| GET | `/uploads/<name>` | the uploaded file |
