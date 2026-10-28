"""알림음 재생 (Windows: 내장 wav 비동기 재생, 그 외: 시스템 비프)."""
from __future__ import annotations

import logging
import sys

from ..core.paths import resource_path

log = logging.getLogger(__name__)


def play_alert(kind: str = "new") -> None:
    name = "reminder.wav" if kind == "reminder" else "alert.wav"
    path = resource_path("assets", name)
    if sys.platform == "win32":
        try:
            import winsound

            flags = winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT
            winsound.PlaySound(str(path), flags)
            return
        except Exception:  # noqa: BLE001
            log.exception("알림음 재생 실패")
    try:
        from PySide6.QtWidgets import QApplication

        QApplication.beep()
    except Exception:  # noqa: BLE001
        pass
