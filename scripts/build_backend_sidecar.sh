#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${POSTDOC_BACKEND_VENV:-/tmp/postdoc-backend-venv}"
PYTHON_BIN="${POSTDOC_PYTHON:-python3}"

if [ ! -x "$VENV/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV"
fi

"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/pip" install -r "$ROOT/requirements.txt"
"$VENV/bin/pyinstaller" "$ROOT/desktop_backend.spec" --distpath "$ROOT/dist-sidecar" --workpath "$ROOT/build-sidecar" --noconfirm

target_triple="$(rustc --print host-tuple 2>/dev/null || rustc -Vv | awk '/host:/ {print $2}')"
if [ -z "$target_triple" ]; then
  echo "Could not determine Rust target triple." >&2
  exit 1
fi

ext=""
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ext=".exe" ;;
esac

mkdir -p "$ROOT/web/src-tauri/binaries"
cp "$ROOT/dist-sidecar/postdoc-backend$ext" "$ROOT/web/src-tauri/binaries/postdoc-backend-$target_triple$ext"
chmod +x "$ROOT/web/src-tauri/binaries/postdoc-backend-$target_triple$ext"
echo "Built sidecar: web/src-tauri/binaries/postdoc-backend-$target_triple$ext"
