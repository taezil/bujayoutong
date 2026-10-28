"""빌드된 EXE 점검용 (--self-test). 서버에 접속하지 않고 화면/팝업/트레이/자원 파일만 확인합니다.

결과는 데이터 폴더의 selftest.txt 와 종료코드(0=정상)로 남깁니다.
"""
from __future__ import annotations

import os
import sys
import tempfile
import traceback
from pathlib import Path


def _sample_orders() -> list[dict]:
    base = {
        "customerCode": "00124", "customerName": "태승급식소 118-13", "deliveryDate": "2026-10-29", "orderPeriod": "AM",
        "createdAt": "2026-10-28T00:12:00Z", "updatedAt": "2026-10-28T00:12:00Z", "cancelled": False, "note": "",
        "source": "app", "sourceLabel": "거래처 주문", "deliveryLocation": None, "total": 0,
        "items": [
            {"productName": "돈까스", "spec": "1.5kg", "unit": "박스", "quantity": 2},
            {"productName": "새우튀김", "spec": "", "unit": "봉", "quantity": 3},
            {"productName": "치킨텐더", "spec": "1kg", "unit": "박스", "quantity": 1},
        ],
    }
    return [
        {**base, "id": "OTEST1", "isAdditional": False, "contentVersion": "1", "desk": {"state": "new", "revision": 0}},
        {**base, "id": "OTEST2", "isAdditional": True, "contentVersion": "1", "note": "오전 10시 전 도착",
         "desk": {"state": "entering", "revision": 1, "enteringById": "S-X", "enteringBy": "정승영 주임님", "enteringAt": "2026-10-28T00:20:00Z"}},
    ]


def run_self_test(argv: list[str]) -> int:
    os.environ.setdefault("BUJA_DESK_HOME", tempfile.mkdtemp(prefix="buja-selftest-"))
    out = Path(os.environ["BUJA_DESK_HOME"]) / "selftest.txt"
    lines: list[str] = []
    code = 1
    try:
        from PySide6.QtCore import QTimer
        from PySide6.QtWidgets import QApplication

        from ..core.paths import resource_path
        from ..core.sync import Notice
        from .app import DeskController
        from .theme import STYLESHEET

        app = QApplication.instance() or QApplication(argv)
        app.setStyleSheet(STYLESHEET)
        for name in ("icon.png", "alert.wav", "reminder.wav"):
            path = resource_path("assets", name)
            if not path.exists():
                raise RuntimeError(f"자원 파일 없음: {path}")
            lines.append(f"asset ok: {name}")
        controller = DeskController(app, start_minimized=True)
        controller.settings.sound_enabled = False
        controller.window.show()
        controller.window.set_staff("S-ME", "점검용 · 테스트PC")
        orders = _sample_orders()
        controller.open_orders = orders
        controller.window.set_orders(orders)
        controller.window.open_order("OTEST1")
        assert controller.window.detail.current_id() == "OTEST1", "상세화면 열기 실패"
        assert controller.window.detail.start_button.isVisible() or not controller.window.isVisible()
        controller.window.open_order("OTEST2")
        controller.window.group_check.setChecked(True)
        controller.window.set_history(orders)
        controller.notify(Notice("new", "🚨 신규 발주", "셀프 테스트", ["OTEST1"]))
        controller.notify(Notice("additional", "🚨 추가발주", "셀프 테스트", ["OTEST2"]))
        lines.append(f"list rows: {controller.window.list.count()}")
        lines.append(f"toasts: {len(controller.toasts._toasts)}")
        assert len(controller.toasts._toasts) == 2, "팝업 표시 실패"
        QTimer.singleShot(1500, app.quit)
        app.exec()
        controller.quitting = True
        controller.toasts.clear()
        controller.background.shutdown()
        controller.tray.hide()
        lines.append("SELFTEST OK")
        code = 0
    except Exception:  # noqa: BLE001
        lines.append("SELFTEST FAILED")
        lines.append(traceback.format_exc())
    out.write_text("\n".join(lines), encoding="utf-8")
    if sys.stdout is not None:
        print("\n".join(lines))
    return code
