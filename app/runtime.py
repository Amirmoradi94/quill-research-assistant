"""Runtime paths for local web, Docker, and desktop builds."""
from __future__ import annotations

import os
import platform
from pathlib import Path


APP_NAME = "QuillResearchAssistant"
LEGACY_APP_NAME = "PostdocDashboard"
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def is_desktop_mode() -> bool:
    return os.environ.get("POSTDOC_DESKTOP", "").lower() in {"1", "true", "yes"}


def default_user_data_dir() -> Path:
    override = os.environ.get("POSTDOC_DATA_DIR")
    if override:
        return Path(override).expanduser()

    system = platform.system()
    if system == "Darwin":
        base = Path.home() / "Library" / "Application Support"
        path = base / APP_NAME
        legacy = base / LEGACY_APP_NAME
        return legacy if legacy.exists() and not path.exists() else path
    if system == "Windows":
        base = os.environ.get("APPDATA")
        root = Path(base or (Path.home() / "AppData" / "Roaming"))
        path = root / APP_NAME
        legacy = root / LEGACY_APP_NAME
        return legacy if legacy.exists() and not path.exists() else path
    root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    path = root / APP_NAME
    legacy = root / LEGACY_APP_NAME
    return legacy if legacy.exists() and not path.exists() else path


def data_dir() -> Path:
    if is_desktop_mode() or os.environ.get("POSTDOC_DATA_DIR"):
        path = default_user_data_dir()
    else:
        path = PROJECT_ROOT / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path


def db_path() -> Path:
    return Path(os.environ.get("POSTDOC_DB", data_dir() / "postdoc.db")).expanduser()


def documents_dir() -> Path:
    path = Path(os.environ.get("POSTDOC_DOCUMENTS_DIR", data_dir() / "documents")).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    return path


def smtp_key_path() -> Path:
    return data_dir() / ".smtp_key"
