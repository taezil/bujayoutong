"""Windows 시작 시 자동 실행 (현재 사용자 HKCU\\...\\Run). 설치 프로그램도 같은 값 이름을 사용합니다."""
from __future__ import annotations

import logging
import sys

from .. import APP_ID

log = logging.getLogger(__name__)
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def _command() -> str:
    return f'"{sys.executable}" --minimized'


def supported() -> bool:
    return sys.platform == "win32" and bool(getattr(sys, "frozen", False))


def is_enabled() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            value, _ = winreg.QueryValueEx(key, APP_ID)
            return bool(value)
    except OSError:
        return False


def set_enabled(enabled: bool) -> bool:
    if sys.platform != "win32":
        return False
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enabled:
                winreg.SetValueEx(key, APP_ID, 0, winreg.REG_SZ, _command())
            else:
                try:
                    winreg.DeleteValue(key, APP_ID)
                except FileNotFoundError:
                    pass
        return True
    except OSError:
        log.exception("자동 실행 설정 실패")
        return False


def refresh_path_if_enabled() -> None:
    """프로그램 위치가 바뀌었을 수 있으니(업데이트 설치 등) 켜져 있으면 현재 경로로 다시 기록."""
    if supported() and is_enabled():
        set_enabled(True)
