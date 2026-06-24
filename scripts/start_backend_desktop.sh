#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${POSTDOC_BACKEND_VENV:-/tmp/postdoc-backend-venv}"
PYTHON_BIN="${POSTDOC_PYTHON:-python3}"

if [ ! -x "$VENV/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV"
  "$VENV/bin/python" -m pip install --upgrade pip
  "$VENV/bin/pip" install -r "$ROOT/requirements.txt"
fi

cd "$ROOT"
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
export PYTHONDONTWRITEBYTECODE=1
export POSTDOC_DESKTOP=1
export POSTDOC_DISABLE_REPLY_POLLER="${POSTDOC_DISABLE_REPLY_POLLER:-1}"
export POSTDOC_CORS_ORIGINS="${POSTDOC_CORS_ORIGINS:-http://localhost:1420,http://127.0.0.1:1420,http://tauri.localhost,https://tauri.localhost,tauri://localhost,null}"

exec "$VENV/bin/uvicorn" app.main:app --host 127.0.0.1 --port "${PORT:-8000}" --log-level info
