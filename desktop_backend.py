"""Desktop backend entry point for PyInstaller/Tauri sidecar builds."""
from __future__ import annotations

import logging
import os
import sys

import uvicorn


def configure_logging() -> None:
    from app.runtime import data_dir

    log_path = data_dir() / "backend.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        handlers=[
            logging.FileHandler(log_path, encoding="utf-8"),
            logging.StreamHandler(sys.stderr),
        ],
        force=True,
    )
    logging.getLogger("quill.desktop").info("Desktop backend starting; log_path=%s", log_path)


def main() -> None:
    os.environ.setdefault("POSTDOC_DESKTOP", "1")
    os.environ.setdefault("POSTDOC_DISABLE_REPLY_POLLER", "1")
    os.environ.setdefault(
        "POSTDOC_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://tauri.localhost,https://tauri.localhost,tauri://localhost,null",
    )
    configure_logging()
    port = int(os.environ.get("PORT", "8000"))
    logging.getLogger("quill.desktop").info("Starting Uvicorn on 127.0.0.1:%s", port)
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=port,
        log_config=None,
        log_level="info",
    )


if __name__ == "__main__":
    main()
