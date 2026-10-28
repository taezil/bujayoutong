"""Qt 없이 실행되는 핵심 로직 테스트: python -m pytest desk/tests/test_core.py"""
from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from buja_desk.core.api import AuthError, ConflictError, DeskApi, NetworkError  # noqa: E402
from buja_desk.core.model import order_as_text  # noqa: E402
from buja_desk.core.storage import NotificationLog, Settings, SettingsStore, TokenStore, normalize_server_url  # noqa: E402
from buja_desk.core.sync import SyncEngine, diff_notifications  # noqa: E402


def make_order(order_id: str, *, version: str = "v1", state: str = "new", additional: bool = False,
               cancelled: bool = False, created: str = "2026-10-28T00:12:00Z") -> dict:
    return {
        "id": order_id, "customerCode": "00124", "customerName": "태승급식소 118-13", "deliveryDate": "2026-10-29",
        "orderPeriod": "AM", "createdAt": created, "isAdditional": additional, "cancelled": cancelled,
        "contentVersion": version, "note": "",
        "items": [{"productName": "돈까스", "spec": "1.5kg", "unit": "박스", "quantity": 2},
                  {"productName": "새우튀김", "spec": "", "unit": "봉", "quantity": 3}],
        "desk": {"state": state, "revision": 0},
    }


class FakeApi(DeskApi):
    def __init__(self):
        super().__init__("https://example.invalid", "a" * 64)
        self.orders: list[dict] = []
        self.marker = "m1"
        self.offline = False
        self.unauthorized = False
        self.full_calls = 0

    def pulse(self):
        if self.unauthorized:
            raise AuthError("expired", 401)
        if self.offline:
            raise NetworkError("offline")
        return {"ok": True, "marker": self.marker, "openCount": len(self.orders), "serverTime": "2026-10-28T00:30:00Z",
                "staff": {"id": "S-LEE", "username": "lee", "displayName": "이혜선 대리님", "role": "ADMIN", "deviceName": "사무실1"}}

    def open_orders(self):
        if self.offline:
            raise NetworkError("offline")
        self.full_calls += 1
        return {"ok": True, "orders": [dict(o) for o in self.orders], "marker": self.marker}


class Clock:
    def __init__(self, start: float):
        self.now = start

    def __call__(self) -> float:
        return self.now


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("BUJA_DESK_HOME", str(tmp_path))
    monkeypatch.delenv("BUJA_DESK_SERVER", raising=False)
    return tmp_path


def test_new_order_notified_once_and_survives_restart(home):
    log = NotificationLog(home)
    notices = diff_notifications([make_order("O1")], log)
    assert [n.kind for n in notices] == ["new"]
    assert diff_notifications([make_order("O1")], log) == []
    log.save()
    # 프로그램 재시작: 같은 주문으로 다시 알림 없음
    restarted = NotificationLog(home)
    assert diff_notifications([make_order("O1")], restarted) == []


def test_additional_changed_cancelled(home):
    log = NotificationLog(home)
    notices = diff_notifications([make_order("O1"), make_order("O2", additional=True)], log)
    assert [n.kind for n in notices] == ["new", "additional"]
    assert "추가발주" in notices[1].title
    changed = diff_notifications([make_order("O1", version="v2"), make_order("O2", additional=True)], log)
    assert [n.kind for n in changed] == ["changed"] and changed[0].order_id == "O1"
    cancelled = diff_notifications([make_order("O1", version="v3", cancelled=True)], log)
    assert [n.kind for n in cancelled] == ["cancelled"]


def test_silent_for_already_taken_or_cancelled(home):
    log = NotificationLog(home)
    notices = diff_notifications([make_order("O1", state="entering"), make_order("O2", cancelled=True)], log)
    assert notices == []


def test_many_new_orders_are_summarized(home):
    log = NotificationLog(home)
    notices = diff_notifications([make_order(f"O{i}") for i in range(6)], log)
    assert len(notices) == 1 and notices[0].kind == "summary" and len(notices[0].order_ids) == 6


def test_engine_pulse_marker_and_reconnect(home):
    api = FakeApi()
    clock = Clock(1_000_000.0)
    engine = SyncEngine(api, NotificationLog(home), reminder_minutes=lambda: None, clock=clock)
    api.orders = [make_order("O1")]
    first = engine.poll()
    assert first.connected and first.orders is not None and [n.kind for n in first.notices] == ["new"]
    clock.now += 7
    second = engine.poll()
    assert second.connected and second.orders is None  # 변경 없으면 전체 목록 다시 받지 않음
    assert api.full_calls == 1

    # 인터넷 끊김 → 재시도 간격 증가, 그 사이 들어온 주문은 재연결 후 알림
    api.offline = True
    clock.now += 7
    lost = engine.poll()
    assert not lost.connected and engine.next_delay(7) > 7
    api.orders.append(make_order("O2"))
    api.marker = "m2"
    api.offline = False
    clock.now += 14
    back = engine.poll()
    assert back.connected and back.orders is not None and [n.order_id for n in back.notices] == ["O2"]
    assert engine.next_delay(7) == 7


def test_engine_auth_required(home):
    api = FakeApi()
    api.unauthorized = True
    engine = SyncEngine(api, NotificationLog(home), reminder_minutes=lambda: None)
    result = engine.poll()
    assert result.auth_required and not result.connected


def test_reminder_for_unprocessed(home):
    api = FakeApi()
    api.orders = [make_order("O1", created="2026-10-28T00:00:00Z")]
    # 서버시각 00:30, 주문 00:00 → 30분 경과
    clock = Clock(1_000_000.0)
    engine = SyncEngine(api, NotificationLog(home), reminder_minutes=lambda: 10, clock=clock)
    engine.poll()  # 첫 알림
    clock.now += 11 * 60
    result = engine.poll()
    assert any(n.kind == "reminder" for n in result.notices)
    clock.now += 60
    assert not any(n.kind == "reminder" for n in engine.poll().notices)  # 10분에 한 번만


def test_settings_and_server_url(home, monkeypatch):
    assert normalize_server_url("http://evil.example.com") == "https://order.bujafood.kr"
    assert normalize_server_url("http://localhost:4173/") == "http://localhost:4173"
    store = SettingsStore(home)
    store.settings.sound_enabled = False
    store.save()
    assert SettingsStore(home).settings.sound_enabled is False
    monkeypatch.setenv("BUJA_DESK_SERVER", "http://127.0.0.1:9")
    assert SettingsStore(home).settings.server_url == "http://127.0.0.1:9"
    assert Settings.from_dict({"poll_seconds": 1}).poll_seconds == 5


def test_token_store_roundtrip_and_corrupt(home):
    store = TokenStore(home)
    assert store.load() == ""
    store.save("ab" * 32)
    assert store.load() == "ab" * 32
    store.path.write_bytes(b"garbage!!")
    assert store.load() == ""
    store.clear()
    assert not store.path.exists()


def test_corrupt_notified_file_recovers(home):
    (home / "notified.json").write_text("{not json", encoding="utf-8")
    log = NotificationLog(home)
    assert log.entries == {}


def test_order_text_for_erp():
    text = order_as_text(make_order("O1"))
    assert "돈까스 (1.5kg)\t2\t박스" in text and "00124" in text
    assert "오후 배송" in order_as_text({**make_order("O2"), "deliverySlot": "PM"})
    assert "가격 변동그룹" in order_as_text({**make_order("O3"), "priceGroup": "B"})


def test_group_b_notice_title(home):
    log = NotificationLog(home)
    notices = diff_notifications([{**make_order("O1"), "priceGroup": "B"}], log)
    assert "가격 변동그룹" in notices[0].title


# ---------- 실제 HTTP 로 DeskApi 오류 처리 확인 ----------


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # 조용히
        pass

    def _send(self, status: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        auth = self.headers.get("authorization", "")
        if auth != "Bearer " + "c" * 64:
            return self._send(401, {"error": "로그인이 필요합니다."})
        if self.path.startswith("/api/desk/pulse"):
            return self._send(200, {"ok": True, "marker": "x", "openCount": 0, "serverTime": "2026-10-28T00:00:00Z"})
        return self._send(500, {"error": "boom"})

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/api/desk/login":
            if body.get("pin") == "123456":
                return self._send(200, {"ok": True, "token": "c" * 64, "staff": {"id": "S1", "displayName": "직원"}})
            return self._send(401, {"error": "아이디와 PIN을 확인해 주세요."})
        if self.path == "/api/desk/orders":
            return self._send(409, {"error": "이혜선 대리님님이 입력 중인 주문입니다.", "conflict": True, "order": {"id": body.get("orderId")}})
        return self._send(404, {"error": "없음"})


def test_desk_api_http_errors():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f"http://127.0.0.1:{server.server_address[1]}"
        api = DeskApi(url)
        with pytest.raises(AuthError):
            api.pulse()  # 토큰 없음
        with pytest.raises(AuthError) as wrong:
            api.login("lee", "000000", "PC")
        assert "PIN" in str(wrong.value)
        token, staff = api.login("lee", "123456", "PC")
        assert token == "c" * 64 and staff.display_name == "직원"
        assert api.pulse()["marker"] == "x"
        with pytest.raises(NetworkError):
            api.open_orders()  # 500 → 재시도 대상
        with pytest.raises(ConflictError) as conflict:
            api.change_state("O1", "start")
        assert conflict.value.payload["order"]["id"] == "O1"
    finally:
        server.shutdown()
    with pytest.raises(NetworkError):
        DeskApi(url, "c" * 64).pulse()  # 서버 꺼짐


# ---------- 자동 업데이트 ----------

from buja_desk.core import updater  # noqa: E402


class _FakeResponse:
    def __init__(self, payload=None, body=b""):
        self._payload = payload
        self._body = body

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload

    def iter_content(self, chunk_size=0):
        yield self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class _FakeSession:
    def __init__(self, release, body=b""):
        self.release = release
        self.body = body

    def get(self, url, **kwargs):
        if url == updater.LATEST_URL:
            return _FakeResponse(self.release)
        return _FakeResponse(body=self.body)


def _release(version, body=b"installer", digest=True, url=None):
    import hashlib as _h
    return {
        "tag_name": f"desk-v{version}", "draft": False, "prerelease": False,
        "assets": [{
            "name": f"BujaOrderAlert-Setup-{version}.exe", "size": len(body),
            "browser_download_url": url or f"{updater.ALLOWED_PREFIX}desk-v{version}/BujaOrderAlert-Setup-{version}.exe",
            "digest": f"sha256:{_h.sha256(body).hexdigest()}" if digest else None,
        }],
    }


def test_updater_version_compare():
    assert updater.is_newer("1.0.10", "1.0.9")
    assert not updater.is_newer("1.0.2", "1.0.2")
    assert not updater.is_newer("0.9.9", "1.0.0")


def test_updater_finds_and_downloads(tmp_path):
    session = _FakeSession(_release("9.9.9"), b"installer")
    info = updater.check_latest(session, current="1.0.0")
    assert info and info.version == "9.9.9" and info.sha256
    path = updater.download(info, tmp_path, session)
    assert path.read_bytes() == b"installer"
    assert updater.check_latest(_FakeSession(_release("1.0.0")), current="1.0.0") is None


def test_updater_rejects_bad_hash_and_foreign_url(tmp_path):
    session = _FakeSession(_release("9.9.9", b"installer"), b"tampered!")
    info = updater.check_latest(session, current="1.0.0")
    with pytest.raises(OSError):
        updater.download(info, tmp_path, session)
    assert not list(tmp_path.glob("*.exe"))
    foreign = _FakeSession(_release("9.9.9", url="https://evil.example.com/x.exe"))
    assert updater.check_latest(foreign, current="1.0.0") is None


# ---------- 발주 자동 합치기 ----------

from buja_desk.core.bundle import find_entry, merge_orders  # noqa: E402


def _bundle_order(order_id, created, items, *, state="new", slot="AM", date="2026-10-30", customer="C1", entering_by="", cancelled=False):
    return {
        "id": order_id, "customerId": customer, "customerCode": "00124", "customerName": "태승급식소", "deliveryDate": date,
        "deliverySlot": slot, "deliveryLocationId": "", "createdAt": created, "contentVersion": "v1", "cancelled": cancelled,
        "note": "", "items": items,
        "desk": {"state": state, "revision": 0, "enteringById": entering_by},
    }


def _item(pid, name, qty, sort, unit="박스", price=1000):
    return {"productId": pid, "productName": name, "unit": unit, "unitPrice": price, "quantity": qty, "sortKey": sort}


def test_merge_same_customer_date_slot_sums_and_sorts():
    a = _bundle_order("O1", "2026-10-29T12:00:00Z", [_item("P-kimchi", "김치", 2, [2, 0, 5, 0]), _item("P-don", "돈까스", 1, [0, 0, 1, 0])])
    b = _bundle_order("O2", "2026-10-29T12:30:00Z", [_item("P-don", "돈까스", 1, [0, 0, 1, 0]), _item("P-ganjang", "간장", 1, [5, 1, 9, 0])])
    entries = merge_orders([a, b])
    assert len(entries) == 1
    bundle = entries[0]
    assert bundle["isBundle"] and bundle["memberIds"] == ["O1", "O2"] and bundle["mergedCount"] == 2
    names = [(i["productName"], i["quantity"]) for i in bundle["items"]]
    assert names == [("돈까스", 2.0), ("김치", 2.0), ("간장", 1.0)]
    assert [p[0] for p in bundle["items"][0]["parts"]] == ["1차", "추가"]
    assert find_entry(entries, "O2") is bundle


def test_merge_never_crosses_slot_date_state_or_cancel():
    base = [_item("P1", "돈까스", 1, [0, 0, 1, 0])]
    orders = [
        _bundle_order("A", "2026-10-29T10:00:00Z", base, slot="AM"),
        _bundle_order("B", "2026-10-29T10:01:00Z", base, slot="PM"),           # 배송 시간 다름
        _bundle_order("C", "2026-10-29T10:02:00Z", base, date="2026-10-31"),   # 배송일 다름
        _bundle_order("D", "2026-10-29T10:03:00Z", base, state="entering", entering_by="S1"),  # 이미 입력 중
        _bundle_order("E", "2026-10-29T10:04:00Z", base, cancelled=True),       # 취소
        _bundle_order("F", "2026-10-29T10:05:00Z", base, customer="C2"),       # 다른 거래처
    ]
    entries = merge_orders(orders)
    assert len(entries) == 6 and not any(e.get("isBundle") for e in entries)


def test_entering_bundle_stays_together_new_additional_separate():
    base = [_item("P1", "돈까스", 1, [0, 0, 1, 0])]
    orders = [
        _bundle_order("A", "2026-10-29T10:00:00Z", base, state="entering", entering_by="S1"),
        _bundle_order("B", "2026-10-29T10:01:00Z", base, state="entering", entering_by="S1"),
        _bundle_order("C", "2026-10-29T10:30:00Z", base),  # 입력 시작 후 들어온 추가발주 → 따로
    ]
    entries = merge_orders(orders)
    bundles = [e for e in entries if e.get("isBundle")]
    assert len(entries) == 2 and len(bundles) == 1 and bundles[0]["memberIds"] == ["A", "B"]


def test_pm_runs_are_never_merged_and_labelled():
    from buja_desk.core.model import slot_label

    base = [_item("P1", "돈까스", 1, [0, 0, 1, 0])]
    first = _bundle_order("R1", "2026-10-29T03:00:00Z", base, slot="PM")
    second = _bundle_order("R2", "2026-10-29T04:30:00Z", base, slot="PM")
    first["deliveryRun"], second["deliveryRun"] = 1, 2
    entries = merge_orders([first, second])
    assert len(entries) == 2 and not any(e.get("isBundle") for e in entries)
    assert slot_label(first) == "오후 1차 배송" and slot_label(second) == "오후 2차 배송"
    assert slot_label({"deliverySlot": "PM", "deliveryRun": 0}) == "오후 배송"
    assert slot_label({"deliverySlot": "AM", "deliveryRun": 2}) == "오전 배송"


def _sheet_data():
    def item(pid, name, qty, location, category="냉동식품", sort=(1, 1, 1, 1), unit="박스"):
        return {"productId": pid, "productName": name, "unit": unit, "spec": "", "quantity": qty, "location": location,
                "category": category, "sortKey": list(sort)}

    return {
        "zones": ["1단지", "2단지"],
        "locations": [
            {"name": "냉동창고 좌측", "storage": "frozen", "sortOrder": 1}, {"name": "냉동창고 우측", "storage": "frozen", "sortOrder": 2},
            {"name": "냉장창고", "storage": "chilled", "sortOrder": 3}, {"name": "창고1층", "storage": "dry", "sortOrder": 4},
            {"name": "창고2층", "storage": "dry", "sortOrder": 5}, {"name": "야외", "storage": "dry", "sortOrder": 6},
        ],
        "categoryStorage": {"냉동식품": "frozen", "김치": "chilled", "공산품": "dry"},
        "orders": [
            {"id": "O1", "customerId": "C1", "customerCode": "001", "customerName": "태승급식소 120-13/2단지", "zone": "2단지",
             "deliverySlot": "AM", "deliveryRun": 0, "note": "10시 전", "items": [
                 item("P-oil", "식용유", 2, "야외", "공산품", (9, 1, 1, 1), "통"), item("P-don", "돈까스", 2, "냉동창고 좌측"),
                 item("P-kim", "김치", 1, "냉장창고", "김치", (3, 1, 1, 1)), item("P-new", "신상품", 1, "", "냉동식품", (1, 9, 1, 1), "봉")]},
            {"id": "O2", "customerId": "C2", "customerCode": "002", "customerName": "남해분식 73-2", "zone": "2단지",
             "deliverySlot": "AM", "source": "driver", "items": [item("P-don", "돈까스", 3, "냉동창고 좌측"), item("P-mack", "고등어", 1, "냉동창고 우측")]},
            {"id": "O3", "customerId": "C1", "customerCode": "001", "customerName": "태승급식소 120-13/2단지", "zone": "2단지",
             "deliverySlot": "AM", "loadPrintedAt": "2026-10-29 01:00:00", "items": [item("P-don", "돈까스", 1, "냉동창고 좌측")]},
            {"id": "O4", "customerId": "C3", "customerCode": "003", "customerName": "동해식당", "zone": "1단지",
             "deliverySlot": "PM", "deliveryRun": 0, "items": [item("P-kim", "김치", 4, "냉장창고", "김치", (3, 1, 1, 1))]},
            {"id": "O5", "customerId": "C4", "customerCode": "004", "customerName": "서해", "zone": "2단지",
             "deliverySlot": "PM", "deliveryRun": 2, "items": [item("P-don", "돈까스", 5, "냉동창고 좌측")]},
            {"id": "O6", "customerId": "C5", "customerCode": "005", "customerName": "부평식당", "zone": "",
             "deliverySlot": "AM", "items": [item("P-cup", "종이컵", 1, "창고1층", "공산품", (9, 2, 1, 1))]},
        ],
    }


def test_load_sheet_groups_zone_and_sorts_by_warehouse_location():
    from buja_desk.core.loadsheet import SheetOptions, build_sheets

    sheets = build_sheets(_sheet_data(), SheetOptions("2026-10-30", slot="AM"))
    assert [s.zone for s in sheets] == ["2단지", "구역 미지정"]  # 관리자 구역 순서, 미지정은 맨 뒤
    zone2 = sheets[0]
    titles = [section.title for section in zone2.sections]
    assert titles == ["냉동창고 좌측", "냉동창고 우측", "냉장창고", "야외", "위치 미지정 · 냉동"]
    don = zone2.sections[0].rows[0]
    assert don.name == "돈까스" and don.total == 6  # 구역 전체 합계 (태승 2+1, 남해 3)
    assert don.parts == [("태승급식소 120-13", 3.0), ("남해분식 73-2", 3.0)]
    assert sorted(zone2.order_ids) == ["O1", "O2", "O3"]
    customers = {c.name: c for c in zone2.customers}
    assert customers["태승급식소 120-13"].order_count == 2 and customers["남해분식 73-2"].driver
    # 거래처별 확인표도 창고 순서 (돈까스 → 김치 → 식용유 → 미지정)
    assert [i[0] for i in customers["태승급식소 120-13"].items] == ["돈까스", "김치", "식용유", "신상품"]


def test_load_sheet_filters_slot_run_zone_and_only_new():
    from buja_desk.core.loadsheet import UNASSIGNED, SheetOptions, build_sheets, render_html

    data = _sheet_data()
    assert [s.zone for s in build_sheets(data, SheetOptions("2026-10-30", slot="PM"))] == ["1단지", "2단지"]
    run2 = build_sheets(data, SheetOptions("2026-10-30", slot="PM", run=2))
    assert len(run2) == 1 and run2[0].order_ids == ["O5"]
    assert build_sheets(data, SheetOptions("2026-10-30", zone="1단지"))[0].order_ids == ["O4"]
    assert build_sheets(data, SheetOptions("2026-10-30", zone=UNASSIGNED))[0].order_ids == ["O6"]
    only_new = build_sheets(data, SheetOptions("2026-10-30", zone="2단지", slot="AM", only_new=True))
    assert sorted(only_new[0].order_ids) == ["O1", "O2"]
    page = render_html(build_sheets(data, SheetOptions("2026-10-30")), SheetOptions("2026-10-30"), staff_name="테스트", auto_print=False)
    assert page.count('class="page"') == 3 and "상차준비표 · 2단지" in page and "break-before: page" in page
    assert "<script" not in page
    assert "<script" in render_html([], SheetOptions("2026-10-30"))
    assert "출력할 발주가 없습니다" in render_html([], SheetOptions("2026-10-30"), auto_print=False)
    # 거래처 이름 등은 HTML 이스케이프
    data["orders"][0]["customerName"] = "<b>해킹</b>"
    assert "<b>해킹</b>" not in render_html(build_sheets(data, SheetOptions("2026-10-30")), SheetOptions("2026-10-30"))
