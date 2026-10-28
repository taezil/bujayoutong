"""서버 동기화 + 알림 판단 (Qt 와 무관).

동작
1. 몇 초마다 /api/desk/pulse 로 변경 여부만 가볍게 확인
2. 바뀌었거나 2분이 지났으면 입력완료 전 주문 전체(/api/desk/orders)를 받음
3. 이미 알림을 띄운 주문(notified.json)과 비교해서 새 주문/변경/취소 알림을 만듦
4. 인터넷이 끊기면 재시도 간격을 늘리고, 다시 연결되면 전체를 다시 받아 빠진 주문이 없게 함
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable

from .api import ApiError, AuthError, DeskApi, NetworkError, StaffInfo
from .model import customer_label, delivery_label, items_summary, parse_utc, period_label, state_of
from .storage import NotificationLog

FULL_REFRESH_SECONDS = 120
SUMMARY_THRESHOLD = 3  # 한 번에 이보다 많이 들어오면 알림 하나로 묶음


@dataclass
class Notice:
    kind: str  # new | additional | changed | cancelled | summary | reminder
    title: str
    body: str
    order_ids: list[str] = field(default_factory=list)
    sound: bool = True

    @property
    def order_id(self) -> str:
        return self.order_ids[0] if len(self.order_ids) == 1 else ""


@dataclass
class SyncResult:
    connected: bool
    orders: list[dict[str, Any]] | None = None  # None 이면 변경 없음
    notices: list[Notice] = field(default_factory=list)
    staff: StaffInfo | None = None
    auth_required: bool = False
    error: str = ""
    open_count: int = 0
    synced_at: float = 0.0


def _order_notice(order: dict[str, Any], kind: str) -> Notice:
    who = f"{order.get('customerCode', '')} {customer_label(order)}".strip()
    when = f"배송 {delivery_label(str(order.get('deliveryDate', '')))} · {period_label(order)}발주"
    count = len(order.get("items") or [])
    if kind == "cancelled":
        return Notice(kind, "주문 취소됨", f"{who}\n{when}\n거래처가 주문을 취소했습니다.", [str(order["id"])])
    if kind == "changed":
        return Notice(kind, "주문 내용 변경", f"{who}\n{when}\n거래처가 주문을 수정했습니다. 다시 확인해 주세요.", [str(order["id"])])
    title = "🚨 추가발주" if kind == "additional" else "🚨 신규 발주"
    return Notice(kind, title, f"{who}\n{when} · {count}품목\n{items_summary(order)}", [str(order["id"])])


def diff_notifications(orders: list[dict[str, Any]], log: NotificationLog) -> list[Notice]:
    """알림을 띄울 주문을 고르고 기록에 반영. 같은 주문(같은 내용)으로는 다시 알리지 않음."""
    fresh: list[Notice] = []
    updates: list[Notice] = []
    for order in orders:
        order_id = str(order.get("id", ""))
        if not order_id:
            continue
        version = str(order.get("contentVersion") or "")
        state = state_of(order)
        entry = log.get(order_id)
        if entry is None:
            if order.get("cancelled") or state != "new":
                # 이미 취소됐거나 다른 직원이 처리 중인 주문은 조용히 목록에만 표시
                log.mark(order_id, version, "silent")
                continue
            kind = "additional" if order.get("isAdditional") else "new"
            fresh.append(_order_notice(order, kind))
            log.mark(order_id, version, kind)
        elif entry.version != version:
            if state == "done":
                log.mark(order_id, version, entry.kind)
                continue
            kind = "cancelled" if order.get("cancelled") else "changed"
            updates.append(_order_notice(order, kind))
            log.mark(order_id, version, kind)
    if len(fresh) > SUMMARY_THRESHOLD:
        additional = sum(1 for n in fresh if n.kind == "additional")
        body = f"처리할 발주 {len(fresh)}건이 새로 들어왔습니다."
        if additional:
            body += f"\n(추가발주 {additional}건 포함)"
        fresh = [Notice("summary", f"🚨 새 발주 {len(fresh)}건", body, [i for n in fresh for i in n.order_ids])]
    if len(updates) > SUMMARY_THRESHOLD:
        updates = [Notice("changed", f"주문 변경/취소 {len(updates)}건", "거래처가 주문을 수정하거나 취소했습니다. 목록을 확인해 주세요.",
                          [i for n in updates for i in n.order_ids])]
    return fresh + updates


class SyncEngine:
    def __init__(self, api: DeskApi, log: NotificationLog, *, reminder_minutes: Callable[[], int | None] = lambda: 10,
                 clock: Callable[[], float] = time.time):
        self.api = api
        self.log = log
        self.clock = clock
        self.reminder_minutes = reminder_minutes
        self.last_marker = ""
        self.last_full = 0.0
        self.orders: list[dict[str, Any]] | None = None
        self.failures = 0
        self.connected = False
        self.force_full = True
        self.server_offset = 0.0  # 서버시각 - PC시각 (초)
        self.last_reminder = clock()
        self.staff: StaffInfo | None = None

    def request_full_refresh(self) -> None:
        self.force_full = True

    def next_delay(self, base_seconds: int) -> float:
        if self.failures <= 0:
            return float(base_seconds)
        return float(min(30, base_seconds * (1 + self.failures)))

    def poll(self) -> SyncResult:
        now = self.clock()
        try:
            pulse = self.api.pulse()
        except AuthError as error:
            self.connected = False
            return SyncResult(connected=False, auth_required=True, error=str(error))
        except (NetworkError, ApiError) as error:
            return self._failed(error)

        was_disconnected = not self.connected
        self.connected = True
        self.failures = 0
        self.staff = StaffInfo.from_json(pulse.get("staff") or {}) if pulse.get("staff") else self.staff
        server_time = parse_utc(str(pulse.get("serverTime") or ""))
        if server_time:
            self.server_offset = server_time.timestamp() - now
        marker = str(pulse.get("marker") or "")
        need_full = (self.force_full or was_disconnected or self.orders is None or marker != self.last_marker
                     or now - self.last_full >= FULL_REFRESH_SECONDS)
        result = SyncResult(connected=True, staff=self.staff, open_count=int(pulse.get("openCount") or 0), synced_at=now)
        if need_full:
            try:
                data = self.api.open_orders()
            except AuthError as error:
                self.connected = False
                return SyncResult(connected=False, auth_required=True, error=str(error))
            except (NetworkError, ApiError) as error:
                return self._failed(error)
            orders = list(data.get("orders") or [])
            self.orders = orders
            self.last_marker = marker  # 펄스 시점 값 저장 → 그 사이 바뀐 것은 다음 확인 때 다시 받음
            self.last_full = now
            self.force_full = False
            result.orders = orders
            result.open_count = len(orders)
            result.notices = diff_notifications(orders, self.log)
            if not self.log.initialized:
                self.log.mark_initialized()
            self.log.prune({str(o.get("id")) for o in orders})
            self.log.save()
            if any(n.kind in ("new", "additional", "summary") for n in result.notices):
                self.last_reminder = now
        reminder = self._reminder(now)
        if reminder:
            result.notices.append(reminder)
        return result

    def _failed(self, error: Exception) -> SyncResult:
        self.failures += 1
        self.connected = False
        return SyncResult(connected=False, error=str(error))

    def unprocessed_new(self, older_than_minutes: int) -> list[dict[str, Any]]:
        if not self.orders:
            return []
        limit = self.clock() + self.server_offset - older_than_minutes * 60
        result = []
        for order in self.orders:
            if order.get("cancelled") or state_of(order) != "new":
                continue
            created = parse_utc(str(order.get("createdAt") or ""))
            if created and created.timestamp() <= limit:
                result.append(order)
        return result

    def _reminder(self, now: float) -> Notice | None:
        minutes = self.reminder_minutes()
        if not minutes:
            return None
        if now - self.last_reminder < minutes * 60:
            return None
        waiting = self.unprocessed_new(minutes)
        if not waiting:
            return None
        self.last_reminder = now
        return Notice("reminder", f"⏰ 미처리 발주 {len(waiting)}건",
                      f"{minutes}분 넘게 '신규' 상태인 발주가 있습니다.\n입력 시작 또는 입력완료를 눌러 주세요.",
                      [str(o.get("id")) for o in waiting])
