"""발주 자동 합치기 (Qt 와 무관, 모든 PC 가 같은 규칙으로 계산 → 화면이 서로 같음).

규칙
- 같은 거래처 + 같은 배송일 + 같은 배송처 + 같은 배송 시간(오전/오후) 이면 하나로 합침
- '신규' 상태끼리만 합침. 누가 [입력 시작]한 묶음은 그 사람이 입력 중인 주문끼리 그대로 유지
- 이미 입력 중/입력완료인 발주 뒤에 들어온 발주는 합치지 않고 '추가발주'로 따로 표시
- 취소된 주문은 합치지 않음 (취소 확인 필요)
- 같은 상품·단위·단가는 수량을 더하고, 주문별 내역(1차 2 · 추가 1)을 함께 보관
- 품목은 서버가 준 카테고리 순서(sortKey)대로 정렬
"""
from __future__ import annotations

from typing import Any

from .model import state_of


def _group_key(order: dict[str, Any]) -> tuple | None:
    if order.get("cancelled"):
        return None
    state = state_of(order)
    desk = order.get("desk") or {}
    if state == "new":
        bucket = "new"
    elif state == "entering":
        bucket = f"entering:{desk.get('enteringById', '')}"
    else:
        return None
    location = order.get("deliveryLocationId") or ((order.get("deliveryLocation") or {}).get("name") if order.get("deliveryLocation") else "")
    return (order.get("customerId"), order.get("deliveryDate"), location or "", order.get("deliverySlot") or "", bucket)


def _sort_key(item: dict[str, Any]) -> tuple:
    key = item.get("sortKey")
    if isinstance(key, (list, tuple)) and key:
        return tuple(key)
    return (9999, 9999, 999999, 99)


def merge_orders(orders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """목록용 항목. 합칠 것이 없으면 원래 주문을 그대로, 2건 이상이면 '묶음' 하나로."""
    groups: dict[tuple, list[dict[str, Any]]] = {}
    singles: list[dict[str, Any]] = []
    for order in orders:
        key = _group_key(order)
        if key is None:
            singles.append(order)
        else:
            groups.setdefault(key, []).append(order)
    result = list(singles)
    for members in groups.values():
        if len(members) == 1:
            result.append(members[0])
        else:
            result.append(make_bundle(members))
    return result


def make_bundle(members: list[dict[str, Any]]) -> dict[str, Any]:
    members = sorted(members, key=lambda o: (str(o.get("createdAt", "")), str(o.get("id", ""))))
    first, last = members[0], members[-1]
    combined: dict[tuple, dict[str, Any]] = {}
    for index, order in enumerate(members):
        label = "1차" if index == 0 else f"추가{index}" if len(members) > 2 else "추가"
        for item in order.get("items") or []:
            key = (item.get("productId"), item.get("unit"), item.get("unitPrice"))
            entry = combined.get(key)
            if entry is None:
                entry = {**item, "quantity": 0, "parts": []}
                combined[key] = entry
            entry["quantity"] = float(entry["quantity"]) + float(item.get("quantity") or 0)
            entry["parts"].append((label, item.get("quantity")))
    items = sorted(combined.values(), key=_sort_key)
    notes = [f"[{_time(o)}] {o['note']}" for o in members if str(o.get("note") or "").strip()]
    member_ids = [str(o.get("id")) for o in members]
    revisions = ",".join(f"{o.get('id')}:{(o.get('desk') or {}).get('revision', 0)}:{o.get('contentVersion', '')}" for o in members)
    return {
        **first,
        "id": f"bundle:{first.get('id')}",
        "isBundle": True,
        "memberIds": member_ids,
        "members": members,
        "items": items,
        "note": "\n".join(notes),
        "createdAt": first.get("createdAt"),
        "lastCreatedAt": last.get("createdAt"),
        "isAdditional": bool(first.get("isAdditional")),
        "mergedCount": len(members),
        "hasPromo": any(o.get("hasPromo") for o in members),
        "priceGroup": "B" if any(o.get("priceGroup") == "B" for o in members) else first.get("priceGroup"),
        "total": sum(float(o.get("total") or 0) for o in members),
        "contentVersion": revisions,
        "sources": sorted({str(o.get("sourceLabel") or "") for o in members}),
        "driverNames": sorted({str(o.get("createdByStaffName") or "") for o in members if o.get("source") == "driver"} - {""}),
    }


def _time(order: dict[str, Any]) -> str:
    from .model import kst_time

    return kst_time(str(order.get("createdAt") or ""))


def member_ids(entry: dict[str, Any]) -> list[str]:
    return list(entry.get("memberIds") or [str(entry.get("id"))])


def find_entry(entries: list[dict[str, Any]], order_id: str) -> dict[str, Any] | None:
    """주문번호 또는 묶음 id 로 목록 항목 찾기 (알림 클릭 → 그 주문이 들어 있는 묶음 열기)."""
    for entry in entries:
        if entry.get("id") == order_id or order_id in (entry.get("memberIds") or []):
            return entry
    return None
