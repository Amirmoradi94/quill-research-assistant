# PyInstaller spec for the Tauri Scrapling scraper sidecar.

from pathlib import Path
import sys

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


ROOT = Path(SPECPATH).resolve()
sys.path.insert(0, str(ROOT))


hiddenimports = [
    *collect_submodules("scraper"),
    *collect_submodules("scrapling"),
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
]

datas = [
    *collect_data_files("apify_fingerprint_datapoints"),
    *collect_data_files("browserforge"),
    *collect_data_files("camoufox"),
    *collect_data_files("fastapi"),
    *collect_data_files("language_tags"),
    *collect_data_files("scrapling"),
]


a = Analysis(
    ["desktop_scraper.py"],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="postdoc-scraper",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
