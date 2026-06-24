#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${POSTDOC_BACKEND_VENV:-/tmp/postdoc-backend-venv}"
PYTHON_BIN="${POSTDOC_PYTHON:-/opt/homebrew/opt/python@3.12/bin/python3.12}"

if [ ! -x "$VENV/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV"
  "$VENV/bin/python" -m pip install --upgrade pip
  "$VENV/bin/pip" install -r "$ROOT/requirements.txt"
fi

find "$ROOT/app" -type d -name __pycache__ -prune -exec rm -rf {} +

cd "$ROOT"
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
export PYTHONDONTWRITEBYTECODE=1
export POSTDOC_DB="${POSTDOC_DB:-$ROOT/data/postdoc.db}"
export APPLICATIONS_MD="${APPLICATIONS_MD:-$ROOT/../applications.md}"
export POSTDOC_DISABLE_REPLY_POLLER="${POSTDOC_DISABLE_REPLY_POLLER:-1}"

exec "$VENV/bin/uvicorn" app.main:app --host 127.0.0.1 --port "${PORT:-8000}" --log-level info
