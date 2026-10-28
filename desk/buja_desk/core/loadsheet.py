"""상차준비표 (Qt 와 무관 → 단위 테스트 가능).

- 배송일 하루치 발주를 구역(1단지·2단지…)별로 묶고, 상품을 창고 위치 순서(관리자 '창고 위치' 순서)로 나열
- 상품마다 구역 전체 합계 수량 + 거래처별 수량
- 위치가 없는 상품은 맨 뒤 '위치 미지정 · 냉동/냉장/공산품'으로 (카테고리 보관 구분)
- 마지막에 거래처별 확인표 (실을 때 빠진 것 확인)
- 구역마다 새 쪽에서 시작. 브라우저로 열어 인쇄
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from .model import KST, WEEKDAYS, quantity_text

STORAGE_ORDER = {"frozen": 0, "chilled": 1, "dry": 2, "": 3}
STORAGE_LABEL = {"frozen": "❄ 냉동", "chilled": "🧊 냉장", "dry": "📦 공산품", "": "기타"}
STORAGE_CLASS = {"frozen": "frozen", "chilled": "chilled", "dry": "dry", "": "etc"}
UNASSIGNED = "__none"


@dataclass
class SheetOptions:
    delivery_date: str
    zone: str = ""  # "" = 모든 구역(구역마다 새 쪽), "__none" = 구역 미지정, 그 외 구역 이름
    slot: str = "all"  # all | AM | PM
    run: int = 0  # 오후 차수 (0 = 오후 전체)
    only_new: bool = False  # 아직 상차준비표를 출력하지 않은 발주만
    include_customers: bool = True


@dataclass
class Row:
    name: str
    spec: str
    unit: str
    total: float = 0.0
    parts: list[tuple[str, float]] = field(default_factory=list)
    sort_key: tuple = ()


@dataclass
class Section:
    title: str
    storage: str
    rows: list[Row]


@dataclass
class CustomerLine:
    name: str
    code: str
    items: list[tuple[str, float, str]]
    notes: list[str]
    order_count: int
    slot_text: str
    driver: bool


@dataclass
class Sheet:
    zone: str
    sections: list[Section]
    customers: list[CustomerLine]
    order_ids: list[str]

    @property
    def customer_count(self) -> int:
        return len(self.customers)

    @property
    def line_count(self) -> int:
        return sum(len(section.rows) for section in self.sections)


def slot_text(slot: str, run: int) -> str:
    if slot == "PM":
        return f"오후 {run}차" if run else "오후"
    if slot == "AM":
        return "오전"
    return "시간 미지정"


def options_label(options: SheetOptions) -> str:
    if options.slot == "AM":
        return "오전 배송"
    if options.slot == "PM":
        return f"오후 {options.run}차 배송" if options.run else "오후 배송 전체"
    return "오전·오후 전체"


def short_name(order: dict[str, Any]) -> str:
    """'태승급식소 120-13/2단지' → '태승급식소 120-13' (+ 추가 배송처 이름)"""
    name = re.sub(r"\s*/.*$", "", str(order.get("customerName") or "")).strip() or str(order.get("customerCode") or "")
    location = str(order.get("deliveryLocationName") or "").strip()
    return f"{name}·{location}" if location else name


def matches(order: dict[str, Any], options: SheetOptions, zones: list[str]) -> bool:
    zone = str(order.get("zone") or "")
    if options.zone == UNASSIGNED and zone in zones:
        return False
    if options.zone and options.zone != UNASSIGNED and zone != options.zone:
        return False
    slot = str(order.get("deliverySlot") or "")
    if options.slot == "AM" and slot != "AM":
        return False
    if options.slot == "PM":
        if slot != "PM":
            return False
        if options.run and int(order.get("deliveryRun") or 0) != options.run:
            return False
    if options.only_new and str(order.get("loadPrintedAt") or ""):
        return False
    return True


def filter_orders(data: dict[str, Any], options: SheetOptions) -> list[dict[str, Any]]:
    zones = list(data.get("zones") or [])
    return [order for order in data.get("orders") or [] if matches(order, options, zones)]


def group_by_zone(data: dict[str, Any], orders: list[dict[str, Any]]) -> list[tuple[str, list[dict[str, Any]]]]:
    zones = list(data.get("zones") or [])
    groups: dict[str, list[dict[str, Any]]] = {}
    for order in orders:
        zone = str(order.get("zone") or "")
        key = zone if zone in zones else "구역 미지정"
        groups.setdefault(key, []).append(order)
    ordered = [zone for zone in zones if zone in groups]
    if "구역 미지정" in groups:
        ordered.append("구역 미지정")
    return [(zone, groups[zone]) for zone in ordered]


def _location_key(location: str, storage: str, locations: dict[str, dict[str, Any]]) -> tuple:
    if location and location in locations:
        return (0, int(locations[location].get("sortOrder") or 0), location)
    if location:
        return (1, 0, location)
    return (2, STORAGE_ORDER.get(storage, 3), "")


def build_sheet(zone: str, orders: list[dict[str, Any]], data: dict[str, Any]) -> Sheet:
    locations = {str(row.get("name")): row for row in data.get("locations") or []}
    category_storage = dict(data.get("categoryStorage") or {})
    sections: dict[tuple, Section] = {}
    rows: dict[tuple, Row] = {}
    customers: dict[str, CustomerLine] = {}
    customer_order: list[str] = []

    for order in sorted(orders, key=lambda o: (str(o.get("customerCode") or ""), str(o.get("createdAt") or ""))):
        who = short_name(order)
        customer_key = f"{order.get('customerId')}|{order.get('deliveryLocationName') or ''}"
        line = customers.get(customer_key)
        if line is None:
            line = CustomerLine(who, str(order.get("customerCode") or ""), [], [], 0, "", False)
            customers[customer_key] = line
            customer_order.append(customer_key)
        line.order_count += 1
        line.driver = line.driver or order.get("source") == "driver"
        slot = slot_text(str(order.get("deliverySlot") or ""), int(order.get("deliveryRun") or 0))
        if slot not in line.slot_text.split(" · "):
            line.slot_text = f"{line.slot_text} · {slot}" if line.slot_text else slot
        note = str(order.get("note") or "").strip()
        if note:
            line.notes.append(note)
        for item in order.get("items") or []:
            location = str(item.get("location") or "").strip()
            storage = str((locations.get(location) or {}).get("storage") or "") if location in locations else ""
            if not storage:
                storage = str(category_storage.get(str(item.get("category") or ""), "") or "")
            section_key = _location_key(location, storage, locations)
            if section_key not in sections:
                title = location or f"위치 미지정 · {STORAGE_LABEL.get(storage, '기타').split(' ')[-1]}"
                sections[section_key] = Section(title, storage, [])
            quantity = float(item.get("quantity") or 0)
            row_key = (section_key, str(item.get("productId") or item.get("productName")), str(item.get("unit") or ""), str(item.get("spec") or ""))
            row = rows.get(row_key)
            if row is None:
                key = item.get("sortKey")
                row = Row(str(item.get("productName") or ""), str(item.get("spec") or ""), str(item.get("unit") or ""),
                          sort_key=tuple(key) if isinstance(key, (list, tuple)) else (9999, 9999, 999999, 99))
                rows[row_key] = row
                sections[section_key].rows.append(row)
            row.total += quantity
            for index, (name, amount) in enumerate(row.parts):
                if name == who:
                    row.parts[index] = (name, amount + quantity)
                    break
            else:
                row.parts.append((who, quantity))
            # 거래처별 확인표: 같은 상품은 합쳐서
            for index, (name, amount, unit) in enumerate(line.items):
                if name == row.name and unit == row.unit:
                    line.items[index] = (name, amount + quantity, unit)
                    break
            else:
                line.items.append((row.name, quantity, row.unit))

    ordered_sections = [sections[key] for key in sorted(sections)]
    for section in ordered_sections:
        section.rows.sort(key=lambda r: (r.sort_key, r.name))
    # 거래처별 확인표의 품목도 창고 위치 순서로
    rank_by_name: dict[tuple[str, str], tuple] = {}
    for section_index, section in enumerate(ordered_sections):
        for row_index, row in enumerate(section.rows):
            rank_by_name.setdefault((row.name, row.unit), (section_index, row_index))
    for line in customers.values():
        line.items.sort(key=lambda item: rank_by_name.get((item[0], item[2]), (999, 999)))
    return Sheet(zone, ordered_sections, [customers[key] for key in customer_order], [str(o.get("id")) for o in orders])


def build_sheets(data: dict[str, Any], options: SheetOptions) -> list[Sheet]:
    orders = filter_orders(data, options)
    return [build_sheet(zone, members, data) for zone, members in group_by_zone(data, orders)]


def date_label(value: str) -> str:
    try:
        day = date.fromisoformat(value)
    except ValueError:
        return value
    return f"{day.month}/{day.day}({WEEKDAYS[day.weekday()]})"


def _q(value: float) -> str:
    return quantity_text(value)


def render_html(sheets: list[Sheet], options: SheetOptions, *, staff_name: str = "", printed_at: datetime | None = None,
                auto_print: bool = True) -> str:
    now = (printed_at or datetime.now(KST)).astimezone(KST)
    esc = html.escape
    pages: list[str] = []
    for sheet in sheets:
        orders = len(sheet.order_ids)
        head = (
            f'<header class="head"><div><h1>상차준비표 · {esc(sheet.zone)}</h1>'
            f'<p>배송 {esc(date_label(options.delivery_date))} {esc(options_label(options))} · 거래처 {sheet.customer_count}곳 · 발주 {orders}건'
            f'{" · 새로 들어온 발주만" if options.only_new else ""}</p></div>'
            f'<div class="meta">출력 {now:%m/%d %H:%M}{(" · " + esc(staff_name)) if staff_name else ""}<br>품목 {sheet.line_count}줄</div></header>'
        )
        body: list[str] = [head]
        for section in sheet.sections:
            css = STORAGE_CLASS.get(section.storage, "etc")
            icon = STORAGE_LABEL.get(section.storage, "").split(" ")[0] if section.storage else "▪"
            body.append(f'<section class="loc"><h2 class="{css}"><span>{icon} {esc(section.title)}</span><span>{len(section.rows)}품목</span></h2>'
                        '<table><colgroup><col class="c-chk"><col><col class="c-unit"><col class="c-qty"><col class="c-who"></colgroup>')
            for row in section.rows:
                parts = " · ".join(f"<b>{esc(name)}</b> {_q(amount)}" for name, amount in row.parts)
                spec = f' <small>{esc(row.spec)}</small>' if row.spec and row.spec != row.unit else ""
                body.append(f'<tr><td><i class="box"></i></td><td class="name">{esc(row.name)}{spec}</td><td class="unit">{esc(row.unit)}</td>'
                            f'<td class="qty">{_q(row.total)}</td><td class="who">{parts}</td></tr>')
            body.append("</table></section>")
        if options.include_customers and sheet.customers:
            body.append('<section class="customers"><h2 class="list"><span>거래처별 확인표</span><span>실을 때 빠진 것 확인</span></h2>'
                        '<table><colgroup><col class="c-chk"><col class="c-cust"><col><col class="c-note"></colgroup>')
            for line in sheet.customers:
                flags = []
                if line.order_count > 1:
                    flags.append(f'<em class="add">발주 {line.order_count}건 합침</em>')
                if line.driver:
                    flags.append('<em class="drv">기사 발주</em>')
                items = " · ".join(f"{esc(name)} {_q(amount)}{esc(unit)}" for name, amount, unit in line.items)
                body.append(f'<tr><td><i class="box"></i></td><td class="cust"><b>{esc(line.name)}</b><small>{esc(line.code)} · {esc(line.slot_text)}</small>{"".join(flags)}</td>'
                            f'<td class="items">{items}</td><td class="note">{esc(" / ".join(line.notes))}</td></tr>')
            body.append("</table></section>")
        pages.append(f'<article class="page">{"".join(body)}</article>')
    if not pages:
        pages.append(f'<article class="page empty"><h1>출력할 발주가 없습니다</h1><p>배송 {esc(date_label(options.delivery_date))} {esc(options_label(options))}</p></article>')
    script = "<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},350)});</script>" if auto_print else ""
    title = f"상차준비표 {options.delivery_date} {options_label(options)}"
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>{esc(title)}</title><style>{PRINT_CSS}</style></head>
<body>{''.join(pages)}{script}</body></html>"""


PRINT_CSS = """
@page { size: A4; margin: 9mm 9mm 11mm; @bottom-right { content: counter(page) " / " counter(pages); font: 9pt 'Malgun Gothic', sans-serif; color: #666; } }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; color: #111; font-size: 12.5px; line-height: 1.4; }
.page { padding: 4mm 0; }
.page + .page { break-before: page; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; border-bottom: 2.5px solid #111; padding-bottom: 6px; margin-bottom: 4px; }
.head h1 { margin: 0; font-size: 24px; letter-spacing: -.02em; }
.head p { margin: 2px 0 0; color: #444; font-size: 13px; }
.meta { text-align: right; color: #555; font-size: 11px; white-space: nowrap; }
section { break-inside: auto; }
h2 { display: flex; justify-content: space-between; margin: 12px 0 0; padding: 5px 9px; color: #fff; font-size: 14px; font-weight: 700; break-after: avoid; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h2.frozen { background: #1b2a44; } h2.chilled { background: #185FA5; } h2.dry { background: #5F5E5A; } h2.etc { background: #8a6d1c; } h2.list { background: #fff; color: #111; border-top: 2px dashed #888; padding: 10px 0 2px; margin-top: 16px; font-size: 15px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
tr { break-inside: avoid; }
td { padding: 6px 5px; border-bottom: .6px solid #c9ced4; vertical-align: top; }
col.c-chk { width: 24px; } col.c-unit { width: 52px; } col.c-qty { width: 52px; } col.c-who { width: 46%; } col.c-cust { width: 26%; } col.c-note { width: 24%; }
.box { display: inline-block; width: 14px; height: 14px; border: 1.6px solid #111; border-radius: 2px; margin-top: 2px; }
.name { font-size: 14px; font-weight: 700; }
.name small { color: #666; font-weight: 400; font-size: 11.5px; }
.unit { font-size: 13px; }
.qty { font-size: 19px; font-weight: 800; text-align: center; }
.who { color: #333; font-size: 12px; }
.who b, .cust b { color: #111; }
.cust small { display: block; color: #666; font-size: 11px; }
.cust em { display: inline-block; margin: 2px 4px 0 0; padding: 0 5px; border: 1px solid #999; border-radius: 3px; font-style: normal; font-size: 10.5px; }
.cust em.add { border-color: #C2255C; color: #C2255C; } .cust em.drv { border-color: #534AB7; color: #534AB7; }
.items { font-size: 12px; color: #222; }
.note { font-size: 11.5px; color: #8a3b00; overflow-wrap: anywhere; }
.empty { text-align: center; padding-top: 40mm; }
@media screen { body { background: #e9ecef; } .page { width: 210mm; min-height: 297mm; margin: 12px auto; padding: 10mm; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.15); } }
"""
