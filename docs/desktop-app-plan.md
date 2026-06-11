# Desktop App Plan

Goal: ship Postdoc Dashboard as a local-first desktop app that a non-technical user can install, open, connect Claude/Codex, and use without running terminal commands.

## Architecture

- Tauri desktop shell hosts the React UI.
- FastAPI runs locally on `127.0.0.1:8000`.
- SQLite, uploaded documents, and local secrets live in the user app data folder when `POSTDOC_DESKTOP=1`.
- Claude CLI and Codex CLI are detected from the user's `PATH` or explicit Settings paths.
- API keys remain optional fallback providers.

## Implemented Foundation

- `app/runtime.py` centralizes desktop-safe runtime paths.
- `POSTDOC_DESKTOP=1` switches default storage from repo-local `data/` to OS app data:
  - macOS: `~/Library/Application Support/PostdocDashboard`
  - Windows: `%APPDATA%/PostdocDashboard`
  - Linux: `$XDG_DATA_HOME/PostdocDashboard` or `~/.local/share/PostdocDashboard`
- `/api/desktop/status` exposes backend, storage, and provider readiness.
- Settings shows the active local runtime and storage paths.
- `scripts/start_backend_desktop.sh` starts FastAPI in desktop mode.
- `web/src-tauri` contains the initial Tauri shell scaffold.
- `VITE_API_BASE` lets the bundled frontend call the local backend from Tauri.

## Remaining Production Work

1. Bundle Python/FastAPI as a sidecar binary instead of launching the source-tree script.
2. Add first-run setup wizard:
   - confirm storage location
   - detect Claude/Codex
   - test selected provider
   - optionally save API keys
3. Add installer builds:
   - macOS `.dmg`
   - Windows `.msi` or `.exe`
   - Linux `.AppImage` or `.deb`
4. Add code signing and notarization for macOS.
5. Add GitHub Actions release workflow.
6. Add auto-update once installer signing is stable.

## Developer Commands

Frontend/browser dev:

```bash
scripts/start_backend_local.sh
npm --prefix web run dev -- --host 0.0.0.0 --port 5173
```

Desktop backend dev:

```bash
scripts/start_backend_desktop.sh
```

Tauri dev, requires Rust/Cargo installed:

```bash
cd web
npm run desktop:dev
```

Desktop build, requires Rust/Cargo and Tauri platform dependencies:

```bash
cd web
npm run desktop:build
```
