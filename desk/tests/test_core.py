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
