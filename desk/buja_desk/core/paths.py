"""프로그램 데이터 위치.

Windows: %LOCALAPPDATA%\\BujaOrderAlert  (설정, 알림 기록, 로그인 토큰(암호화), 로그)
테스트: 환경변수 BUJA_DESK_HOME 으로 바꿀 수 있음
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from .. import APP_ID


def data_dir() -> Path:
    override = os.environ.get("BUJA_DESK_HOME")
    if override:
        path = Path(override)
    elif sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser(r"~\AppData\Local")
        path = Path(base) / APP_ID
    else:
        path = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / APP_ID
    path.mkdir(parents=True, exist_ok=True)
    return path


def resource_path(*parts: str) -> Path:
    """PyInstaller 로 묶었을 때와 소스로 실행할 때 모두 assets 폴더를 찾음."""
    package_dir = Path(__file__).resolve().parent.parent  # buja_desk/
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        candidate = Path(bundle, "buja_desk", *parts)
        if candidate.exists():
            return candidate
    return package_dir.joinpath(*parts)
