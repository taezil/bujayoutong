"""실제 서버(로컬 Worker + 로컬 D1)와 PC 프로그램 동기화 로직 통합 테스트.

CI 에서 tests/desk-e2e.mjs 다음에 실행:  python desk/tests/live_sync.py http://localhost:4173
- 두 PC(직원 2명) 동시 동기화 / 같은 주문 중복 알림 방지
- 네트워크 끊김 → 재연결 후 빠진 주문 알림
- 프로그램 재시작 후 미처리 주문 유지
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from buja_desk.core.api import DeskApi  # noqa: E402
from buja_desk.core.storage import NotificationLog  # noqa: E402
from buja_desk.core.sync import SyncEngine  # noqa: E402

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173").rstrip("/")
RESULTS: list[str] = []
FAILED = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global FAILED
    line = f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else "")
    RESULTS.append(line)
    print(line, flush=True)
    if not ok:
        FAILED += 1


def kst_date(offset: int = 0) -> str:
    return (datetime.now(timezone(timedelta(hours=9))) + timedelta(days=offset)).strftime("%Y-%m-%d")


class Customer:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers["Origin"] = BASE
        r = self.session.post(f"{BASE}/api/customer/login", json={"identifier": "12013", "password": "12013"}, timeout=20)
        r.raise_for_status()
        products = self.session.get(f"{BASE}/api/store", timeout=30).json()["products"]
        sellable = [p for p in products if not p.get("soldout") and p.get("packOptions")]
        self.items = [{"productId": p["id"], "optionLabel": p["packOptions"][0]["label"], "quantity": p["packOptions"][0].get("step") or 1}
                      for p in sellable[8:10]]

    def order(self, offset_days: int = 3) -> str:
        r = self.session.post(f"{BASE}/api/orders", json={
            "items": self.items, "note": "PC 통합테스트", "requestId": str(uuid.uuid4()),
            "deliveryDate": kst_date(offset_days), "confirmAnomaly": True,
        }, timeout=30)
        body = r.json()
        assert r.status_code == 200 and body.get("ok"), body
        return body["order"]["id"]


def make_pc(username: str, pin: str, device: str) -> tuple[SyncEngine, Path]:
    home = Path(tempfile.mkdtemp(prefix=f"desk-{device}-"))
    api = DeskApi(BASE)
    api.login(username, pin, device)
    engine = SyncEngine(api, NotificationLog(home), reminder_minutes=lambda: None)
    return engine, home


def ids(notices) -> list[str]:
    return [i for n in notices for i in n.order_ids]


def main() -> int:
    info = json.loads(Path("desk-e2e.json").read_text()) if Path("desk-e2e.json").exists() else {
        "staff": [{"username": "lee", "pin": "246813"}, {"username": "jung", "pin": "135792"}]}
    (u1, p1), (u2, p2) = [(s["username"], s["pin"]) for s in info["staff"][:2]]
    pc_a, home_a = make_pc(u1, p1, "통합-A")
    pc_b, _ = make_pc(u2, p2, "통합-B")
    baseline_a = pc_a.poll()
    baseline_b = pc_b.poll()
    check("두 PC 첫 동기화", baseline_a.connected and baseline_b.connected and baseline_a.orders is not None)

    customer = Customer()
    order1 = customer.order()
    a1, b1 = pc_a.poll(), pc_b.poll()
    check("PC A 신규 주문 알림", order1 in ids(a1.notices), str([n.title for n in a1.notices]))
    check("PC B 신규 주문 알림", order1 in ids(b1.notices), str([n.title for n in b1.notices]))
    a2 = pc_a.poll()
    check("같은 주문 중복 알림 없음 (다음 확인)", order1 not in ids(a2.notices))

    # PC A 입력 시작 → PC B 에 반영
    pc_a.api.change_state(order1, "start")
    b2 = pc_b.poll()
    seen = next((o for o in (b2.orders or pc_b.orders or []) if o["id"] == order1), None)
    check("PC A '입력 중' → PC B 목록에 즉시 반영", bool(seen) and seen["desk"]["state"] == "entering", json.dumps(seen and seen["desk"], ensure_ascii=False))
    check("처리상태 변경으로는 알림 안 뜸", order1 not in ids(b2.notices))

    # 네트워크 끊김 (PC A)
    real_url = pc_a.api.server_url
    pc_a.api.server_url = "http://127.0.0.1:9"
    lost = pc_a.poll()
    check("네트워크 끊김 감지", not lost.connected and pc_a.next_delay(7) > 7, lost.error)
    order2 = customer.order()
    still_lost = pc_a.poll()
    check("끊긴 동안 오류 없이 재시도", not still_lost.connected)
    pc_a.api.server_url = real_url
    back = pc_a.poll()
    check("재연결 후 자동 동기화 + 빠진 주문 알림", back.connected and back.orders is not None and order2 in ids(back.notices),
          str(ids(back.notices)))
    check("재연결 후 재시도 간격 정상", pc_a.next_delay(7) == 7)

    # 프로그램 재시작 (PC A): 같은 데이터 폴더로 새 엔진
    restarted = SyncEngine(DeskApi(BASE, pc_a.api.token), NotificationLog(home_a), reminder_minutes=lambda: None)
    r1 = restarted.poll()
    open_ids = {o["id"] for o in (r1.orders or [])}
    check("재시작 후 미처리 주문 모두 표시", {order1, order2} <= open_ids, str(len(open_ids)))
    check("재시작 후 이미 알린 주문 다시 알리지 않음", not ({order1, order2} & set(ids(r1.notices))), str(ids(r1.notices)))

    # PC B 입력완료 → PC A 목록에서 사라짐
    pc_b.api.change_state(order2, "done")
    time.sleep(1.1)
    r2 = restarted.poll()
    open_ids = {o["id"] for o in (restarted.orders or [])}
    check("PC B 입력완료 → PC A 목록에서 제외", order2 not in open_ids and order1 in open_ids)
    pc_a.api.change_state(order1, "done")
    r3 = restarted.poll()
    check("입력완료 후 미처리 목록에서 제외", order1 not in {o["id"] for o in (restarted.orders or [])})

    print("\n================ SUMMARY ================")
    print("\n".join(RESULTS))
    print(f"\n{len(RESULTS) - FAILED}/{len(RESULTS)} passed")
    Path("desk-live-summary.txt").write_text(f"{len(RESULTS) - FAILED}/{len(RESULTS)} passed\n" + "\n".join(RESULTS) + "\n", encoding="utf-8")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
