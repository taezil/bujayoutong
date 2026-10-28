"""실제 화면 코드(PySide6)를 화면 없이(offscreen) 실행해서 서버와 함께 점검.

CI:  QT_QPA_PLATFORM=offscreen python desk/tests/ui_live.py http://localhost:4173
- 저장된 로그인으로 시작 → 신규 주문 목록 표시 → 알림 팝업 → 팝업 클릭 시 상세 열림
- [입력 시작] → 서버 상태 '입력 중' → [입력완료] → 처리내역 이동
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173").rstrip("/")
os.environ["BUJA_DESK_HOME"] = tempfile.mkdtemp(prefix="desk-ui-")
os.environ["BUJA_DESK_SERVER"] = BASE
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PySide6.QtWidgets import QApplication  # noqa: E402

from buja_desk.core.api import DeskApi  # noqa: E402
from buja_desk.core.paths import data_dir  # noqa: E402
from buja_desk.core.storage import TokenStore  # noqa: E402
from buja_desk.ui.app import DeskController  # noqa: E402
from buja_desk.ui.theme import STYLESHEET  # noqa: E402

RESULTS: list[str] = []
FAILED = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global FAILED
    line = f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else "")
    RESULTS.append(line)
    print(line, flush=True)
    if not ok:
        FAILED += 1


def pump(app: QApplication, until, timeout: float = 25.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        app.processEvents()
        try:
            if until():
                return True
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.05)
    return False


def place_order() -> str:
    session = requests.Session()
    session.headers["Origin"] = BASE
    session.post(f"{BASE}/api/customer/login", json={"identifier": "12013", "password": "12013"}, timeout=20).raise_for_status()
    products = session.get(f"{BASE}/api/store", timeout=30).json()["products"]
    sellable = [p for p in products if not p.get("soldout") and p.get("packOptions")][10:12]
    delivery = (datetime.now(timezone(timedelta(hours=9))) + timedelta(days=4)).strftime("%Y-%m-%d")
    r = session.post(f"{BASE}/api/orders", json={
        "items": [{"productId": p["id"], "optionLabel": p["packOptions"][0]["label"], "quantity": p["packOptions"][0].get("step") or 1} for p in sellable],
        "requestId": str(uuid.uuid4()), "deliveryDate": delivery, "note": "화면 테스트", "confirmAnomaly": True,
    }, timeout=30)
    body = r.json()
    assert body.get("ok"), body
    return body["order"]["id"]


def main() -> int:
    api = DeskApi(BASE)
    token, _ = api.login("jung", "135792", "화면테스트")
    TokenStore(data_dir()).save(token)

    app = QApplication(sys.argv)
    app.setStyleSheet(STYLESHEET)
    controller = DeskController(app)
    controller.settings.sound_enabled = False
    controller.settings.poll_seconds = 5
    controller.start()
    window = controller.window
    check("저장된 로그인으로 자동 연결", pump(app, lambda: controller.connected and controller.staff is not None),
          controller.last_error)
    check("직원 이름 표시", "정승영" in window.staff_label.text() or bool(window.staff_label.text()), window.staff_label.text())

    order_id = place_order()
    check("새 주문이 목록에 자동 표시", pump(app, lambda: any(o.get("id") == order_id for o in window.orders), 30))
    check("알림 팝업 표시", pump(app, lambda: any(order_id in t.notice.order_ids for t in controller.toasts._toasts), 5),
          str([t.notice.title for t in controller.toasts._toasts]))
    toast = next((t for t in controller.toasts._toasts if order_id in t.notice.order_ids), None)
    if toast is not None:
        controller._toast_clicked(toast.notice)
    check("팝업 클릭 → 해당 주문 상세", window.detail.current_id() == order_id, window.detail.current_id())
    check("상세 품목표 표시", window.detail.table.rowCount() == 2, str(window.detail.table.rowCount()))
    check("신규 주문 → [입력 시작] 버튼", window.detail.start_button.isVisibleTo(window.detail) and window.detail.start_button.text() == "입력 시작")
    check("신규 건수 표시", window.count_label.text().startswith("신규"), window.count_label.text())

    window.detail.start_button.click()
    check("[입력 시작] → 서버 상태 '입력 중'", pump(app, lambda: api.order(order_id)["desk"]["state"] == "entering", 15))
    check("화면에도 '입력 중' 반영", pump(app, lambda: (window.detail.order or {}).get("desk", {}).get("state") == "entering", 10))
    check("내가 입력 중 → [입력 중 해제] 표시", window.detail.release_button.isVisibleTo(window.detail))

    window.detail.done_button.click()
    check("[입력완료] → 서버 상태 '입력완료'", pump(app, lambda: api.order(order_id)["desk"]["state"] == "done", 15))
    check("입력완료 → 처리할 목록에서 빠짐", pump(app, lambda: not any(o.get("id") == order_id for o in window.orders), 15))
    check("되돌리기 버튼 제공", window.undo_button.isVisibleTo(window))

    window.tabs.setCurrentIndex(1)
    window.history_state.setCurrentIndex(1)
    window.search_history()
    check("처리내역에 표시", pump(app, lambda: any(o.get("id") == order_id for o in window.history_orders), 15))

    controller.quitting = True
    controller.toasts.clear()
    controller._stop_sync()
    if controller._sync_thread is not None:
        controller._sync_thread.quit()
        controller._sync_thread.wait(3000)
    controller.background.shutdown()

    print("\n================ SUMMARY ================")
    print("\n".join(RESULTS))
    print(f"\n{len(RESULTS) - FAILED}/{len(RESULTS)} passed")
    Path("desk-ui-summary.txt").write_text(f"{len(RESULTS) - FAILED}/{len(RESULTS)} passed\n" + "\n".join(RESULTS) + "\n", encoding="utf-8")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
