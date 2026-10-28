# -*- mode: python ; coding: utf-8 -*-
# PyInstaller 빌드 설정:  pyinstaller desk/packaging/BujaOrderAlert.spec  (desk 폴더에서 실행)
from pathlib import Path

ROOT = Path(SPECPATH).parent  # desk/
ASSETS = ROOT / "buja_desk" / "assets"

a = Analysis(
    [str(ROOT / "packaging" / "launcher.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[(str(ASSETS), "buja_desk/assets")],
    hiddenimports=["buja_desk.ui.selftest"],
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        "tkinter", "unittest", "pydoc", "PySide6.QtQml", "PySide6.QtQuick", "PySide6.QtWebEngineCore",
        "PySide6.QtPdf", "PySide6.QtSql", "PySide6.QtTest", "PySide6.QtOpenGL", "PySide6.QtDBus",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="BujaOrderAlert",
    icon=str(ASSETS / "icon.ico"),
    console=False,
    disable_windowed_traceback=False,
    version=str(ROOT / "packaging" / "version_info.txt"),
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="BujaOrderAlert")
