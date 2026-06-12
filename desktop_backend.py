"""Desktop backend entry point for PyInstaller/Tauri sidecar builds."""
from __future__ import annotations

import os

import uvicorn


def main() -> None:
    os.environ.setdefault("POSTDOC_DESKTOP", "1")
    os.environ.setdefault("POSTDOC_DISABLE_REPLY_POLLER", "1")
    os.environ.setdefault(
        "POSTDOC_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://tauri.localhost,https://tauri.localhost,tauri://localhost",
    )
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), log_level="info")


if __name__ == "__main__":
    main()
