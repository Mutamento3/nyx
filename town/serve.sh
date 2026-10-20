#!/usr/bin/env bash
# Hesperides on its own, in one line:  bash town/serve.sh --memory ~/notes/memory
# Makes a small Python venv the first time, then starts town/serve.py with whatever you pass.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
if [ ! -x "$HERE/.venv/bin/python" ]; then
  python3 -m venv "$HERE/.venv"
  "$HERE/.venv/bin/pip" install -q fastapi uvicorn httpx
fi
exec "$HERE/.venv/bin/python" "$HERE/serve.py" "$@"
