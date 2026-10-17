#!/usr/bin/env bash
# Nyx — one-line install on a fresh Ubuntu server (22.04 / 24.04).
#
#   curl -fsSL https://raw.githubusercontent.com/StarFold146/nyx/master/install.sh | bash
#   (or, from a clone:  bash install.sh)
#
# Options:  --ai claude|codex   --ai-name NAME   --me-name NAME   --dir PATH (default ~/nyx)
#
# What it does: installs the relay (Python), the web pages, Caddy with automatic HTTPS on
# <your-ip>.sslip.io, and either Claude Code + the channel plugin or Codex + the bridge;
# sets everything to start at boot; prints the address and the key.
# Run it as your normal user (not root). It asks for sudo when it needs it.
set -euo pipefail

AI=""; AI_NAME=""; ME_NAME=""; DIR="$HOME/nyx"; REPO="https://github.com/StarFold146/nyx.git"
while [ $# -gt 0 ]; do
  case "$1" in
    --ai) AI=$2; shift 2 ;;
    --ai-name) AI_NAME=$2; shift 2 ;;
    --me-name) ME_NAME=$2; shift 2 ;;
    --dir) DIR=$2; shift 2 ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ask()  { local v; read -r -p "$1 " v </dev/tty; printf '%s' "${v:-$2}"; }
[ "$(id -u)" = 0 ] && { echo "Run this as your normal user, not root (it uses sudo when needed)."; exit 1; }
command -v sudo >/dev/null || { echo "sudo is required."; exit 1; }

[ -n "$AI" ] || AI=$(ask "Who answers — claude or codex? [claude]" claude)
case "$AI" in claude|codex) ;; *) echo "--ai must be claude or codex"; exit 2 ;; esac
[ -n "$AI_NAME" ] || AI_NAME=$(ask "Your companion's name? [Companion]" Companion)
[ -n "$ME_NAME" ] || ME_NAME=$(ask "Your name? [Me]" Me)

say "1/7 System packages"
sudo apt-get update -qq
sudo apt-get install -y -qq git curl rsync python3 python3-venv tmux debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq caddy >/dev/null
fi

say "2/7 Code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q --ff-only; elif [ -f "$(dirname "$0")/relay/app.py" ] 2>/dev/null; then DIR=$(cd "$(dirname "$0")" && pwd); else git clone -q "$REPO" "$DIR"; fi
cd "$DIR"

say "3/7 Relay"
python3 -m venv relay/venv
relay/venv/bin/pip install -q -r relay/requirements.txt
if [ ! -f relay/relay.env ]; then
  SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
  IP=$(curl -fsS --max-time 8 https://api.ipify.org || hostname -I | awk '{print $1}')
  HOST="${IP//./-}.sslip.io"
  umask 077
  cat > relay/relay.env <<EOF
RELAY_SECRET=$SECRET
RELAY_AI_NAME=$AI_NAME
RELAY_HUMAN_NAME=$ME_NAME
RELAY_PUBLIC_PREFIX=/relay
RELAY_ALLOW_ORIGINS=https://$HOST
RELAY_TMUX_SESSION=companion
NYX_HOST=$HOST
EOF
  umask 022
fi
HOST=$(sed -n 's/^NYX_HOST=//p' relay/relay.env)
SECRET=$(sed -n 's/^RELAY_SECRET=//p' relay/relay.env)
sudo tee /etc/systemd/system/nyx-relay.service >/dev/null <<EOF
[Unit]
Description=Nyx relay
After=network.target

[Service]
User=$USER
WorkingDirectory=$DIR/relay
EnvironmentFile=$DIR/relay/relay.env
ExecStart=$DIR/relay/venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 3011 --timeout-graceful-shutdown 3
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

say "4/7 Web pages + HTTPS ($HOST)"
sudo mkdir -p /var/www/nyx
sudo rsync -a --delete --exclude '.git' --exclude 'relay' --exclude 'channel' --exclude 'bridge' --exclude 'docs' \
  --exclude '*.md' --exclude '*.sh' --exclude 'LICENSE' --exclude 'config.js' ./ /var/www/nyx/
if [ ! -f /var/www/nyx/config.js ]; then   # names go in through Python so quotes and slashes can't break the file
  AI_NAME="$AI_NAME" ME_NAME="$ME_NAME" python3 -c '
import json, os, sys
s = open("config.js", encoding="utf-8").read()
s = s.replace("aiName: \"Companion\"", "aiName: " + json.dumps(os.environ["AI_NAME"], ensure_ascii=False))
s = s.replace("meName: \"Me\"", "meName: " + json.dumps(os.environ["ME_NAME"], ensure_ascii=False))
sys.stdout.write(s)' | sudo tee /var/www/nyx/config.js >/dev/null
fi
[ -f /etc/caddy/Caddyfile ] && sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%Y%m%d%H%M%S)"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$HOST {
	encode gzip
	handle_path /relay/* {
		request_body {
			max_size 12MB
		}
		reverse_proxy 127.0.0.1:3011 {
			flush_interval -1
		}
	}
	handle {
		root * /var/www/nyx
		header Cache-Control "no-cache"
		file_server
	}
}
EOF

say "5/7 Your companion's folder"
mkdir -p "$HOME/companion"
PERSONA_NOTE="You are $AI_NAME, talking with $ME_NAME through a private chat app on their phone. Write like a person texting: short messages, plain words. Replace this file with who you really are."

if [ "$AI" = claude ]; then
  say "6/7 Claude Code + channel plugin"
  command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash
  command -v bun >/dev/null || [ -x "$HOME/.bun/bin/bun" ] || curl -fsSL https://bun.sh/install | bash
  BUN=$(command -v bun || echo "$HOME/.bun/bin/bun"); CLAUDE=$(command -v claude || echo "$HOME/.local/bin/claude")
  (cd channel && "$BUN" install --no-summary >/dev/null)
  mkdir -p "$HOME/.claude/channels/companion"; umask 077
  printf 'RELAY_URL=http://127.0.0.1:3011\nRELAY_SECRET=%s\nRELAY_AI_NAME=%s\nRELAY_HUMAN_NAME=%s\n' "$SECRET" "$AI_NAME" "$ME_NAME" > "$HOME/.claude/channels/companion/.env"
  umask 022
  cat > channel/mcp.json <<EOF
{ "mcpServers": { "companion": { "command": "$BUN", "args": ["$DIR/channel/server.ts"],
  "env": { "RELAY_STATE_DIR": "$HOME/.claude/channels/companion" } } } }
EOF
  [ -f "$HOME/companion/CLAUDE.md" ] || printf '%s\n\nMessages from %s arrive as <channel source="companion"> blocks; answer with the reply tool, a sentence or two per message.\n' "$PERSONA_NOTE" "$ME_NAME" > "$HOME/companion/CLAUDE.md"
  # status line → usage limits for the floating ball
  python3 - "$DIR/relay/statusline-usage.sh" <<'PY'
import json, os, sys
p = os.path.expanduser("~/.claude/settings.json"); os.makedirs(os.path.dirname(p), exist_ok=True)
try: s = json.load(open(p))
except Exception: s = {}
s.setdefault("statusLine", {"type": "command", "command": sys.argv[1]})
json.dump(s, open(p, "w"), indent=2)
PY
  chmod +x relay/statusline-usage.sh channel/start-channel.sh
  sudo tee /etc/systemd/system/nyx-companion.service >/dev/null <<EOF
[Unit]
Description=Nyx companion (Claude Code)
After=network-online.target nyx-relay.service
Wants=network-online.target

[Service]
Type=oneshot
User=$USER
Environment=PATH=$(dirname "$CLAUDE"):$(dirname "$BUN"):/usr/local/bin:/usr/bin:/bin
ExecStart=$DIR/channel/start-channel.sh companion $HOME/companion $DIR/channel/mcp.json $DIR/relay/model
ExecStop=/usr/bin/tmux kill-session -t companion
RemainAfterExit=yes
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
EOF
  LOGIN="cd ~/companion && claude      (log in with your Claude subscription, then type /exit)"
else
  say "6/7 Codex + bridge"
  if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null && sudo apt-get install -y -qq nodejs >/dev/null
  fi
  command -v codex >/dev/null || sudo npm i -g -s @openai/codex
  [ -f "$HOME/companion/AGENTS.md" ] || printf '%s\n' "$PERSONA_NOTE" > "$HOME/companion/AGENTS.md"
  sudo tee /etc/systemd/system/nyx-companion.service >/dev/null <<EOF
[Unit]
Description=Nyx companion (Codex bridge)
After=network-online.target nyx-relay.service

[Service]
User=$USER
EnvironmentFile=$DIR/relay/relay.env
Environment=RELAY_URL=http://127.0.0.1:3011
Environment=BRIDGE_CWD=$HOME/companion
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=$DIR/relay/venv/bin/python $DIR/bridge/codex_bridge.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  LOGIN="codex login --device-auth      (open the link on your phone, type the code)"
fi

say "7/7 Starting"
sudo systemctl daemon-reload
sudo systemctl enable -q --now nyx-relay
sudo systemctl enable -q caddy && sudo systemctl restart caddy
sudo systemctl enable -q nyx-companion

cat <<EOF

────────────────────────────────────────────────────────────
  Nyx is installed.

  Address : https://$HOST
  Key     : $SECRET
            (this is the only key — keep it to yourself; it's also in $DIR/relay/relay.env)

  Two steps left:
    1. $LOGIN
    2. sudo systemctl start nyx-companion

  Then open the address on your phone, type the key,
  and add it to your home screen (iPhone: Share → Add to Home Screen;
  Android Chrome: ⋮ → Install app).

  Your companion's persona lives in ~/companion/$([ "$AI" = claude ] && echo CLAUDE.md || echo AGENTS.md) — make it yours.
────────────────────────────────────────────────────────────
EOF
