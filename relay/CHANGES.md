# 改了什么 · What changed from Tidal Echo

底子是 [Tidal Echo](https://github.com/anhe2021212-spec/Tidal_Echo)（作者 anhe2021212-spec，commit `860e5de`）。原作者已经停更，这里接着维护，改动都写在这儿。
Based on Tidal Echo by anhe2021212-spec (commit `860e5de`). The original is no longer maintained; changes are listed here.

## `relay/app.py`（只动了三处，都标了 `[Nyx]`）

1. `/app/send` 收下 Nyx 聊天页发来的 `quote`（引用的气泡）和 `side`（`sun` 白天 / `moon` 夜里），存进消息的 `meta`。
2. 推给 AI 的那条消息里，引用写成一行「（引用谁：「…」）」放在前面；夜里发的消息开头加 `RELAY_NIGHT_MARK`（默认 `【夜面】`），AI 就知道现在是哪一面。
3. 文件末尾挂上 `nyx_extras.py`。

## `relay/nyx_extras.py`（新文件）

Nyx 其他房间要的接口，每个都可以不装，没装的那个只回 503：

- 阁楼 Attic：`GET /app/attic`、`POST /app/attic/cat`、`POST /app/attic/item`
- 一起听 Listen：`POST /app/music/<action>`、`GET|POST /app/music/now`，接本机的网易云小桥（见 `docs/listen-netease.md`）
- 小螃蟹 Clawd：`POST /app/clawd`，设了 `ANTHROPIC_API_KEY` 才开
- 额度 Usage：`GET /app/usage`，读 Claude Code 状态栏存下来的五小时 / 一周用量

## `channel/`

`server.ts` 原样未改。新增 `start-channel.sh` 和 `claude-companion.service`：让 Claude Code 在服务器上的 tmux 里常驻、开机自启，并自动点掉新版 Claude Code 加载开发中 channel 时弹的确认。原版假设 AI 跑在你自己电脑上。

## `bridge/`（新增）

`codex_bridge.py`：用 Codex 官方 app-server 把 ChatGPT 订阅接成后台的「AI 那一头」。一条常驻对话串、回话流式、可选主动开口。原版只有 Claude Code 插件和付费 API 两条路，这是第三条。
