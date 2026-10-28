"""주문 상세화면 (v1.1 디자인).

위: 거래처 동그라미 + 이름 + 꼬리표(상태·추가발주·합침·B그룹·행사·기사발주)
가운데: 배송일 / 배송 시간 / 배송처 / 접수 정보 상자, 요청사항, 품목표(카테고리 순)
아래: 고정 버튼줄 [복사] [삭제] … [입력 시작] [입력완료]
합친 발주(묶음)도 같은 화면에서 보이며, 버튼은 묶음 안의 주문 전체에 적용됩니다.
"""
from __future__ import annotations

from typing import Any

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QFont
from PySide6.QtWidgets import (
    QAbstractItemView, QFrame, QGridLayout, QHBoxLayout, QHeaderView, QLabel, QPushButton, QSizePolicy,
    QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
)

from ..core.model import (
    customer_label, delivery_label, headline, is_price_group_b, kst_datetime, kst_time, period_label, quantity_text,
    slot_label, state_of, won,
)
from .theme import COLORS, avatar_style, avatar_text, badge_style


def _badge(text: str, kind: str) -> QLabel:
    label = QLabel(text)
    label.setObjectName("Badge")
    label.setStyleSheet(badge_style(kind))
    return label


class InfoBox(QFrame):
    def __init__(self, key: str):
        super().__init__()
        self.setObjectName("InfoBox")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 9)
        layout.setSpacing(2)
        self.key = QLabel(key)
        self.key.setObjectName("InfoKey")
        self.value = QLabel("")
        self.value.setObjectName("InfoValue")
        self.value.setWordWrap(True)
        self.value.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        layout.addWidget(self.key)
        layout.addWidget(self.value)

    def set(self, text: str, accent: bool = False, color: str = "") -> None:
        self.value.setText(text)
        self.setProperty("accent", "true" if accent else "false")
        self.value.setStyleSheet(f"color: {color};" if color else "")
        self.style().unpolish(self)
        self.style().polish(self)


class OrderDetailView(QWidget):
    actionRequested = Signal(str, str, bool)  # action, orderId(또는 묶음 id), force
    copyRequested = Signal(object)  # order dict

    def __init__(self, parent: QWidget | None = None, *, history_mode: bool = False):
        super().__init__(parent)
        self.history_mode = history_mode
        self.order: dict[str, Any] | None = None
        self.my_staff_id = ""
        self.can_delete = False
        self._busy = False

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(10)

        self.panel = QFrame()
        self.panel.setObjectName("Panel")
        outer.addWidget(self.panel, 1)
        root = QVBoxLayout(self.panel)
        root.setContentsMargins(22, 18, 22, 16)
        root.setSpacing(12)

        self.empty = QLabel("왼쪽 목록에서 발주를 선택하세요." if not history_mode else "목록에서 주문을 선택하세요.")
        self.empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty.setStyleSheet(f"color: {COLORS['faint']}; font-size: 13pt;")
        root.addWidget(self.empty, 1)

        self.body = QWidget()
        body = QVBoxLayout(self.body)
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(12)
        root.addWidget(self.body, 1)

        # ---- 머리 ----
        head = QHBoxLayout()
        head.setSpacing(12)
        self.avatar = QLabel("?")
        self.avatar.setObjectName("Avatar")
        self.avatar.setFixedSize(46, 46)
        self.avatar.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.avatar.setStyleSheet("border-radius: 23px; font-size: 16pt; font-weight: 900;")
        head.addWidget(self.avatar, 0, Qt.AlignmentFlag.AlignTop)
        titles = QVBoxLayout()
        titles.setSpacing(2)
        self.headline = QLabel()
        self.headline.setObjectName("Headline")
        self.headline.setWordWrap(True)
        titles.addWidget(self.headline)
        self.subline = QLabel()
        self.subline.setObjectName("DetailSub")
        self.subline.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        titles.addWidget(self.subline)
        head.addLayout(titles, 1)
        self.badges_box = QHBoxLayout()
        self.badges_box.setSpacing(6)
        head.addLayout(self.badges_box)
        body.addLayout(head)

        self.banner = QLabel()
        self.banner.setObjectName("Banner")
        self.banner.setWordWrap(True)
        body.addWidget(self.banner)

        # ---- 정보 상자 ----
        grid = QGridLayout()
        grid.setHorizontalSpacing(8)
        grid.setVerticalSpacing(8)
        self.box_date = InfoBox("배송일")
        self.box_slot = InfoBox("배송 시간")
        self.box_location = InfoBox("배송처")
        self.box_received = InfoBox("접수")
        for index, box in enumerate((self.box_date, self.box_slot, self.box_location, self.box_received)):
            grid.addWidget(box, 0, index)
            grid.setColumnStretch(index, 1)
        body.addLayout(grid)

        self.note = QLabel()
        self.note.setObjectName("Note")
        self.note.setWordWrap(True)
        self.note.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        body.addWidget(self.note)

        # ---- 품목표 ----
        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(["상품명", "규격", "단위", "수량", "내역", "단가"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setAlternatingRowColors(True)
        self.table.setShowGrid(False)
        self.table.setWordWrap(True)
        self.table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        for column in (1, 2, 3, 4, 5):
            header.setSectionResizeMode(column, QHeaderView.ResizeMode.ResizeToContents)
        header.setDefaultAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        self.table.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        body.addWidget(self.table, 1)

        foot = QHBoxLayout()
        self.summary = QLabel()
        self.summary.setStyleSheet(f"color: {COLORS['muted']}; font-weight: 700;")
        foot.addWidget(self.summary)
        foot.addStretch(1)
        self.processed = QLabel()
        self.processed.setStyleSheet(f"color: {COLORS['muted']}; font-size: 10pt;")
        foot.addWidget(self.processed)
        body.addLayout(foot)

        # ---- 아래 고정 버튼줄 ----
        self.action_bar = QFrame()
        self.action_bar.setObjectName("ActionBar")
        buttons = QHBoxLayout(self.action_bar)
        buttons.setContentsMargins(12, 10, 12, 10)
        buttons.setSpacing(8)
        self.copy_button = QPushButton("📋 품목 복사")
        self.copy_button.setObjectName("Secondary")
        self.copy_button.setToolTip("얼마에요 입력할 때 보기 좋게 주문 내용을 복사합니다")
        self.copy_button.clicked.connect(lambda: self.order and self.copyRequested.emit(self.order))
        buttons.addWidget(self.copy_button)
        self.delete_button = QPushButton("🗑 발주 삭제")
        self.delete_button.setObjectName("Danger")
        self.delete_button.setToolTip("잘못 들어온 발주를 삭제합니다 (모든 PC 목록에서 빠지고 처리내역에 '삭제됨'으로 남음)")
        self.delete_button.clicked.connect(lambda: self.order and self.actionRequested.emit("delete", str(self.order.get("id")), False))
        buttons.addWidget(self.delete_button)
        self.release_button = QPushButton("입력 중 해제")
        self.release_button.setObjectName("Secondary")
        self.release_button.clicked.connect(lambda: self._emit("release"))
        buttons.addWidget(self.release_button)
        self.reopen_button = QPushButton("입력완료 취소")
        self.reopen_button.setObjectName("Danger")
        self.reopen_button.clicked.connect(lambda: self._emit("reopen"))
        buttons.addWidget(self.reopen_button)
        buttons.addStretch(1)
        self.start_button = QPushButton("입력 시작")
        self.start_button.setObjectName("Start")
        self.start_button.setMinimumWidth(150)
        self.start_button.clicked.connect(lambda: self._emit("start"))
        buttons.addWidget(self.start_button)
        self.done_button = QPushButton("✓ 입력완료")
        self.done_button.setObjectName("Primary")
        self.done_button.setMinimumWidth(170)
        self.done_button.clicked.connect(lambda: self._emit("done"))
        buttons.addWidget(self.done_button)
        outer.addWidget(self.action_bar)

        self.set_order(None)

    # ---- 외부 호출 ----
    def set_my_staff(self, staff_id: str, can_delete: bool = False) -> None:
        self.my_staff_id = staff_id
        self.can_delete = can_delete
        self._refresh_buttons()

    def set_busy(self, busy: bool) -> None:
        self._busy = busy
        self._refresh_buttons()

    def current_id(self) -> str:
        return str(self.order.get("id")) if self.order else ""

    def set_order(self, order: dict[str, Any] | None) -> None:
        same = bool(order and self.order and order.get("id") == self.order.get("id"))
        self.order = order
        self.empty.setVisible(order is None)
        self.body.setVisible(order is not None)
        self.action_bar.setVisible(order is not None)
        if order is None:
            return
        state = state_of(order)
        desk = order.get("desk") or {}
        cancelled = bool(order.get("cancelled"))
        bundle = bool(order.get("isBundle"))
        group_b = is_price_group_b(order)

        name = str(order.get("customerName") or "")
        self.avatar.setText(avatar_text(name))
        self.avatar.setStyleSheet(avatar_style(name) + " border-radius: 23px; font-size: 16pt; font-weight: 900;")

        title = customer_label(order)
        self.headline.setText(title)
        kind_text = headline(order).replace(" 🚨", "")
        if bundle:
            kind_text += f" · {order.get('mergedCount', 2)}건 합침"
        sub = f"{order.get('customerCode', '')} · {kind_text}"
        if not bundle:
            sub += f" · 주문번호 {order.get('id', '')}"
        self.subline.setText(sub)
        headline_color = COLORS["cancelled"] if cancelled else COLORS["ink"]
        self.headline.setStyleSheet(f"color: {headline_color};" + (" text-decoration: line-through;" if cancelled else ""))

        # 꼬리표
        while self.badges_box.count():
            item = self.badges_box.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.hide()
                widget.setParent(None)
                widget.deleteLater()
        state_kind = {"new": "new", "entering": "entering", "done": "done"}[state]
        state_text = {"new": "신규", "entering": "입력 중", "done": "입력완료"}[state]
        if desk.get("deleted"):
            state_text, state_kind = "삭제됨", "cancelled"
        elif cancelled and state != "done":
            state_text, state_kind = "취소 확인 필요", "cancelled"
        self.badges_box.addWidget(_badge(state_text, state_kind))
        if order.get("isAdditional"):
            self.badges_box.addWidget(_badge("추가발주 🚨", "additional"))
        if bundle:
            self.badges_box.addWidget(_badge(f"🔗 {order.get('mergedCount', 2)}건 합침", "merged"))
        if group_b:
            self.badges_box.addWidget(_badge("₩ 가격 변동그룹 (B)", "group_b"))
        if order.get("hasPromo"):
            self.badges_box.addWidget(_badge("행사품목 포함", "additional"))
        drivers = order.get("driverNames") or ([order.get("createdByStaffName")] if order.get("source") == "driver" else [])
        drivers = [d for d in drivers if d]
        if drivers or order.get("source") == "driver":
            self.badges_box.addWidget(_badge(f"🚚 기사발주 · {', '.join(drivers) or '배송기사'}", "driver"))

        # 안내줄
        banner, banner_kind = "", "entering"
        if cancelled and state != "done":
            banner = "거래처가 취소한 주문입니다. 얼마에요에 이미 입력했다면 삭제·수정한 뒤 [취소 확인]을 눌러 주세요."
            banner_kind = "cancelled"
        elif state == "entering":
            who = desk.get("enteringBy") or "다른 직원"
            device = f" · {desk.get('enteringDevice')}" if desk.get("enteringDevice") else ""
            mine = desk.get("enteringById") == self.my_staff_id
            banner = (f"내가 입력 중입니다 ({kst_time(str(desk.get('enteringAt', '')))} 시작). 얼마에요 입력이 끝나면 [입력완료]를 눌러 주세요."
                      if mine else f"{who}님이 입력 중입니다{device} ({kst_time(str(desk.get('enteringAt', '')))} 시작). 중복 입력에 주의하세요.")
        elif bundle:
            times = ", ".join(kst_time(str(m.get("createdAt") or "")) for m in order.get("members") or [])
            banner = f"같은 거래처·배송일·배송 시간의 발주 {order.get('mergedCount', 2)}건({times})을 합쳤습니다. 같은 상품은 수량을 더했고, [입력완료]를 누르면 모두 처리됩니다."
            banner_kind = "merged"
        elif order.get("isAdditional") and state != "done":
            banner = "이미 처리했거나 처리 중인 발주가 있는 거래처의 추가발주입니다. 따로 입력해 주세요."
            banner_kind = "additional"
        self.banner.setText(banner)
        self.banner.setVisible(bool(banner))
        self.banner.setStyleSheet(badge_style(banner_kind) + " border-radius: 10px; padding: 10px 12px; font-size: 11.5pt; font-weight: 700;")

        # 정보 상자
        self.box_date.set(delivery_label(str(order.get("deliveryDate", "")), with_year=False))
        slot = slot_label(order)
        self.box_slot.set(slot or "지정 안 함", accent=bool(slot), color=COLORS["entering_text"] if slot else COLORS["muted"])
        location = order.get("deliveryLocation") or None
        self.box_location.set((location or {}).get("name") or "기본 배송처")
        received = kst_datetime(str(order.get("createdAt", "")))
        if bundle and order.get("lastCreatedAt"):
            received = f"{kst_time(str(order.get('createdAt')))} ~ {kst_time(str(order.get('lastCreatedAt')))}"
        source = ", ".join(order.get("sources") or []) if bundle else str(order.get("sourceLabel") or "")
        self.box_received.set(received)
        self.box_received.key.setText(f"접수 · {source} · {period_label(order)}발주")

        note = str(order.get("note") or "").strip()
        self.note.setText(f"요청사항  {note}")
        self.note.setVisible(bool(note))

        # 품목표
        items = order.get("items") or []
        self.table.setColumnHidden(4, not bundle)
        self.table.horizontalHeaderItem(5).setText("B그룹 단가" if group_b else "단가")
        self.table.setRowCount(len(items))
        qty_font = QFont()
        qty_font.setBold(True)
        qty_font.setPointSize(15)
        name_font = QFont()
        name_font.setBold(True)
        for row, item in enumerate(items):
            price = won(item.get("unitPrice"))
            list_price = item.get("listPrice")
            discounted = group_b and list_price is not None and float(list_price) != float(item.get("unitPrice") or 0)
            if discounted:
                price = f"{price}  (정가 {won(list_price)})"
            parts = item.get("parts") or []
            breakdown = " · ".join(f"{label} {quantity_text(q)}" for label, q in parts) if len(parts) > 1 else (parts[0][0] if parts else "")
            cells = [
                str(item.get("productName", "")) + ("  [행사]" if item.get("isPromo") else ""),
                str(item.get("spec", "")),
                str(item.get("unit", "")),
                quantity_text(item.get("quantity")),
                breakdown,
                price,
            ]
            for column, text in enumerate(cells):
                cell = QTableWidgetItem(text)
                if column == 0:
                    cell.setFont(name_font)
                elif column == 3:
                    cell.setFont(qty_font)
                    cell.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                elif column in (2,):
                    cell.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                elif column == 4:
                    cell.setForeground(QColor(COLORS["merged_text"] if len(parts) > 1 else COLORS["faint"]))
                elif column == 5:
                    cell.setTextAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
                    if discounted:
                        cell.setForeground(QColor(COLORS["brand"]))
                if cancelled:
                    cell.setForeground(QColor(COLORS["cancelled"]))
                self.table.setItem(row, column, cell)
        self.table.resizeRowsToContents()
        if not same:
            self.table.scrollToTop()
        total_qty = sum(float(i.get("quantity") or 0) for i in items)
        self.summary.setText(f"총 {len(items)}품목 · 수량 {quantity_text(total_qty)}")

        lines = []
        if desk.get("doneBy"):
            lines.append(f"{'삭제' if desk.get('deleted') else '입력완료'}: {desk['doneBy']} · {kst_datetime(str(desk.get('doneAt', '')))}")
        if state == "entering" and desk.get("enteringBy"):
            lines.append(f"입력 시작: {desk['enteringBy']} · {kst_datetime(str(desk.get('enteringAt', '')))}")
        self.processed.setText("   ".join(lines))
        self.processed.setVisible(bool(lines))
        self._refresh_buttons()

    # ---- 내부 ----
    def _emit(self, action: str) -> None:
        if not self.order or self._busy:
            return
        desk = self.order.get("desk") or {}
        force = state_of(self.order) == "entering" and desk.get("enteringById") != self.my_staff_id
        self.actionRequested.emit(action, str(self.order.get("id")), force)

    def _refresh_buttons(self) -> None:
        order = self.order
        if not order:
            return
        state = state_of(order)
        desk = order.get("desk") or {}
        cancelled = bool(order.get("cancelled"))
        mine = desk.get("enteringById") == self.my_staff_id
        bundle = bool(order.get("isBundle"))
        self.start_button.setVisible(state == "new" and not cancelled)
        self.start_button.setText("입력 시작")
        if state == "entering" and not mine and not cancelled:
            self.start_button.setVisible(True)
            self.start_button.setText("이어받기")
        self.done_button.setVisible(state != "done")
        self.done_button.setText("취소 확인" if cancelled else (f"✓ {order.get('mergedCount', 2)}건 입력완료" if bundle else "✓ 입력완료"))
        self.release_button.setVisible(state == "entering")
        self.reopen_button.setVisible(state == "done" and not desk.get("deleted") and not bundle)
        self.delete_button.setVisible(self.can_delete and not desk.get("deleted") and order.get("status") != "shipped")
        self.delete_button.setText(f"🗑 {order.get('mergedCount', 2)}건 삭제" if bundle else "🗑 발주 삭제")
        for button in (self.start_button, self.done_button, self.release_button, self.reopen_button, self.delete_button):
            button.setEnabled(not self._busy)
