"""Desktop Scrapling scraper entry point for PyInstaller/Tauri sidecar builds."""
from __future__ import annotations

import os

import uvicorn


def main() -> None:
    os.environ.setdefault("POSTDOC_DESKTOP", "1")
    uvicorn.run(
        "scraper.main:app",
        host="127.0.0.1",
        port=int(os.environ.get("SCRAPER_PORT", "8001")),
        log_level="warning",
    )


if __name__ == "__main__":
    main()
