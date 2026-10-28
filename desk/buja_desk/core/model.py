"""주문 데이터 표시용 도우미 (한국시간, 라벨)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

KST = timezone(timedelta(hours=9))
WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]

STATE_LABELS = {"new": "신규", "entering": "입력 중", "done": "입력완료"}


def parse_utc(value: str) -> datetime | None:
    if not value:
        return None
    text = value.strip().replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def kst(value: str) -> datetime | None:
    parsed = parse_utc(value)
    return parsed.astimezone(KST) if parsed else None


def kst_time(value: str) -> str:
    moment = kst(value)
    return moment.strftime("%H:%M") if moment else ""


def kst_datetime(value: str) -> str:
    moment = kst(value)
    if not moment:
        return ""
    return f"{moment:%m/%d}({WEEKDAYS[moment.weekday()]}) {moment:%H:%M}"


def today_kst() -> date:
    return datetime.now(KST).date()


def delivery_label(value: str, *, with_year: bool = False) -> str:
    try:
        day = date.fromisoformat(value)
    except (TypeError, ValueError):
        return value or "미지정"
    text = f"{day:%Y-%m-%d}" if with_year else f"{day:%m/%d}"
    text += f"({WEEKDAYS[day.weekday()]})"
    today = today_kst()
    if day == today:
        text += " 오늘"
    elif day == today + timedelta(days=1):
        text += " 내일"
    return text


def period_label(order: dict[str, Any]) -> str:
    return "오후" if order.get("orderPeriod") == "PM" else "오전"


def customer_label(order: dict[str, Any]) -> str:
    name = str(order.get("customerName") or "")
    location = order.get("deliveryLocation") or None
    if location and location.get("name"):
        return f"{name} · {location['name']}"
    return name


def quantity_text(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    return str(int(number)) if number.is_integer() else f"{number:g}"


def items_summary(order: dict[str, Any], limit: int = 2) -> str:
    items = order.get("items") or []
    if not items:
        return "품목 없음"
    names = [f"{i.get('productName', '')} {quantity_text(i.get('quantity'))}{i.get('unit', '')}" for i in items[:limit]]
    rest = len(items) - limit
    return ", ".join(names) + (f" 외 {rest}건" if rest > 0 else "")


def state_of(order: dict[str, Any]) -> str:
    return str((order.get("desk") or {}).get("state") or "new")


def headline(order: dict[str, Any]) -> str:
    if order.get("cancelled"):
        return "취소된 주문"
    if order.get("isAdditional"):
        return "추가발주 🚨"
    return "신규 발주 🚨"


def order_as_text(order: dict[str, Any]) -> str:
    """얼마에요 입력 시 보면서 칠 수 있게 복사하는 텍스트."""
    lines = [
        f"[{headline(order)}] {order.get('customerCode', '')} {customer_label(order)}",
        f"배송일 {delivery_label(str(order.get('deliveryDate', '')), with_year=True)} · {period_label(order)}발주 · 접수 {kst_datetime(str(order.get('createdAt', '')))}",
    ]
    location = order.get("deliveryLocation") or None
    if location and location.get("address"):
        lines.append(f"배송처 주소: {location['address']}")
    lines.append("")
    for item in order.get("items") or []:
        spec = f" ({item.get('spec')})" if item.get("spec") else ""
        lines.append(f"{item.get('productName', '')}{spec}\t{quantity_text(item.get('quantity'))}\t{item.get('unit', '')}")
    if order.get("note"):
        lines += ["", f"요청사항: {order['note']}"]
    return "\n".join(lines)
