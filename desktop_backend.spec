# PyInstaller spec for the Tauri backend sidecar.
#
# Build locally:
#   pyinstaller desktop_backend.spec
#
# The resulting executable must be copied into web/src-tauri/binaries with the
# target triple suffix that Tauri expects, for example:
#   web/src-tauri/binaries/postdoc-backend-aarch64-apple-darwin

from pathlib import Path
import sys

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


ROOT = Path(SPECPATH).resolve()
sys.path.insert(0, str(ROOT))


hiddenimports = [
    *collect_submodules("app"),
    *collect_submodules("ai"),
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
    ("app/static", "app/static"),
    ("ai/prompts", "ai/prompts"),
    *collect_data_files("fastapi"),
]


a = Analysis(
    ["desktop_backend.py"],
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
    name="postdoc-backend",
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
