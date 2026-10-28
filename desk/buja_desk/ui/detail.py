"""주문 상세화면: 거래처/배송일/오전·오후/접수시간 + 품목표 + 입력 시작/입력완료 버튼."""
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
from .theme import COLORS, badge_style


class OrderDetailView(QFrame):
    actionRequested = Signal(str, str, bool)  # action, orderId, force
    copyRequested = Signal(object)  # order dict

    def __init__(self, parent: QWidget | None = None, *, history_mode: bool = False):
        super().__init__(parent)
        self.setObjectName("Panel")
        self.history_mode = history_mode
        self.order: dict[str, Any] | None = None
        self.my_staff_id = ""
        self.can_delete = False
        self._busy = False

        root = QVBoxLayout(self)
        root.setContentsMargins(22, 18, 22, 18)
        root.setSpacing(12)

        self.empty = QLabel("왼쪽 목록에서 주문을 선택하세요." if not history_mode else "목록에서 주문을 선택하세요.")
        self.empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty.setStyleSheet(f"color: {COLORS['muted']}; font-size: 13pt;")
        root.addWidget(self.empty, 1)

        self.body = QWidget()
        body = QVBoxLayout(self.body)
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(12)
        root.addWidget(self.body, 1)

        head = QHBoxLayout()
        self.headline = QLabel()
        self.headline.setObjectName("Headline")
        head.addWidget(self.headline)
        self.state_badge = QLabel()
        self.state_badge.setObjectName("Badge")
        head.addWidget(self.state_badge, 0, Qt.AlignmentFlag.AlignVCenter)
        self.group_badge = QLabel("₩ 가격 변동그룹 주문 (B그룹)")
        self.group_badge.setObjectName("Badge")
        self.group_badge.setStyleSheet("color: #633806; background: #FAEEDA;")
        head.addWidget(self.group_badge, 0, Qt.AlignmentFlag.AlignVCenter)
        self.promo_badge = QLabel("행사품목 포함")
        self.promo_badge.setObjectName("Badge")
        self.promo_badge.setStyleSheet("color: #72243E; background: #FBEAF0;")
        head.addWidget(self.promo_badge, 0, Qt.AlignmentFlag.AlignVCenter)
        self.driver_badge = QLabel("")
        self.driver_badge.setObjectName("Badge")
        self.driver_badge.setStyleSheet("color: #3C3489; background: #EEEDFE;")
        head.addWidget(self.driver_badge, 0, Qt.AlignmentFlag.AlignVCenter)
        head.addStretch(1)
        self.order_no = QLabel()
        self.order_no.setStyleSheet(f"color: {COLORS['muted']}; font-size: 9pt;")
        self.order_no.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        head.addWidget(self.order_no, 0, Qt.AlignmentFlag.AlignBottom)
        body.addLayout(head)

        self.banner = QLabel()
        self.banner.setObjectName("Banner")
        self.banner.setWordWrap(True)
        body.addWidget(self.banner)

        grid = QGridLayout()
        grid.setHorizontalSpacing(18)
        grid.setVerticalSpacing(6)
        self.values: dict[str, QLabel] = {}
        fields = [("customer", "거래처"), ("delivery", "배송일"), ("slot", "배송 시간"), ("period", "발주 구분"),
                  ("received", "접수시간"), ("location", "배송처"), ("source", "주문 경로")]
        for index, (key, label) in enumerate(fields):
            k = QLabel(label)
            k.setObjectName("InfoKey")
            v = QLabel()
            v.setObjectName("InfoValue")
            v.setWordWrap(True)
            v.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
            row, col = divmod(index, 2)
            grid.addWidget(k, row, col * 2)
            grid.addWidget(v, row, col * 2 + 1)
            self.values[key] = v
            self.values[f"{key}_label"] = k
        grid.setColumnStretch(1, 1)
        grid.setColumnStretch(3, 1)
        body.addLayout(grid)

        self.note = QLabel()
        self.note.setObjectName("Note")
        self.note.setWordWrap(True)
        self.note.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        body.addWidget(self.note)

        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["상품명", "규격", "단위", "수량", "단가"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setAlternatingRowColors(False)
        self.table.setWordWrap(True)
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        for column in (1, 2, 3, 4):
            header.setSectionResizeMode(column, QHeaderView.ResizeMode.ResizeToContents)
        self.table.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        body.addWidget(self.table, 1)

        self.summary = QLabel()
        self.summary.setStyleSheet(f"color: {COLORS['muted']};")
        body.addWidget(self.summary)

        self.processed = QLabel()
        self.processed.setStyleSheet(f"color: {COLORS['muted']}; font-size: 10pt;")
        self.processed.setWordWrap(True)
        body.addWidget(self.processed)

        buttons = QHBoxLayout()
        buttons.setSpacing(10)
        self.copy_button = QPushButton("📋 품목 복사")
        self.copy_button.setObjectName("Secondary")
        self.copy_button.setToolTip("얼마에요 입력할 때 보기 좋게 주문 내용을 복사합니다")
        self.copy_button.clicked.connect(lambda: self.order and self.copyRequested.emit(self.order))
        buttons.addWidget(self.copy_button)
        self.release_button = QPushButton("입력 중 해제")
        self.release_button.setObjectName("Secondary")
        self.release_button.clicked.connect(lambda: self._emit("release"))
        buttons.addWidget(self.release_button)
        self.reopen_button = QPushButton("입력완료 취소")
        self.reopen_button.setObjectName("Danger")
        self.reopen_button.clicked.connect(lambda: self._emit("reopen"))
        buttons.addWidget(self.reopen_button)
        self.delete_button = QPushButton("🗑 발주 삭제")
        self.delete_button.setObjectName("Danger")
        self.delete_button.setToolTip("잘못 들어온 발주를 삭제합니다 (모든 PC 목록에서 빠지고 처리내역에 '삭제됨'으로 남음)")
        self.delete_button.clicked.connect(lambda: self.order and self.actionRequested.emit("delete", str(self.order.get("id")), False))
        buttons.addWidget(self.delete_button)
        buttons.addStretch(1)
        self.start_button = QPushButton("입력 시작")
        self.start_button.setObjectName("Start")
        self.start_button.setMinimumWidth(160)
        self.start_button.clicked.connect(lambda: self._emit("start"))
        buttons.addWidget(self.start_button)
        self.done_button = QPushButton("입력완료")
        self.done_button.setObjectName("Primary")
        self.done_button.setMinimumWidth(180)
        self.done_button.clicked.connect(lambda: self._emit("done"))
        buttons.addWidget(self.done_button)
        body.addLayout(buttons)

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
        if order is None:
            return
        state = state_of(order)
        desk = order.get("desk") or {}
        cancelled = bool(order.get("cancelled"))

        title = headline(order)
        color = COLORS["cancelled"] if cancelled else COLORS["additional"] if order.get("isAdditional") else COLORS["new"]
        if state == "done" and not cancelled:
            title = title.replace(" 🚨", "")
            color = COLORS["done"]
        self.headline.setText(title)
        self.headline.setStyleSheet(f"color: {color};")

        state_kind = "cancelled" if cancelled and state != "done" else {"new": "new", "entering": "entering", "done": "done"}[state]
        state_text = {"new": "신규", "entering": "입력 중", "done": "입력완료"}[state]
        if desk.get("deleted"):
            state_text = "삭제됨"
            state_kind = "cancelled"
        if cancelled and state != "done":
            state_text = "취소 확인 필요"
        self.state_badge.setText(state_text)
        self.state_badge.setStyleSheet(badge_style(state_kind))
        group_b = is_price_group_b(order)
        self.group_badge.setVisible(group_b)
        self.promo_badge.setVisible(bool(order.get("hasPromo")))
        self.driver_badge.setVisible(order.get("source") == "driver")
        self.driver_badge.setText(f"🚚 기사발주 · {order.get('createdByStaffName') or '배송기사'}")
        self.table.horizontalHeaderItem(4).setText("B그룹 단가" if group_b else "단가")
        self.order_no.setText(f"주문번호 {order.get('id', '')}")

        banner = ""
        banner_kind = "entering"
        if cancelled and state != "done":
            banner = "거래처가 취소한 주문입니다. 얼마에요에 이미 입력했다면 삭제·수정한 뒤 [취소 확인]을 눌러 주세요."
            banner_kind = "cancelled"
        elif state == "entering":
            who = desk.get("enteringBy") or "다른 직원"
            device = f" · {desk.get('enteringDevice')}" if desk.get("enteringDevice") else ""
            mine = desk.get("enteringById") == self.my_staff_id
            banner = (f"내가 입력 중입니다 ({kst_time(str(desk.get('enteringAt', '')))} 시작). 얼마에요 입력이 끝나면 [입력완료]를 눌러 주세요."
                      if mine else f"{who}님이 입력 중입니다{device} ({kst_time(str(desk.get('enteringAt', '')))} 시작). 중복 입력에 주의하세요.")
        elif order.get("isAdditional") and state != "done":
            banner = "같은 배송일에 이미 받은 주문이 있는 거래처의 추가발주입니다."
            banner_kind = "additional"
        self.banner.setText(banner)
        self.banner.setVisible(bool(banner))
        self.banner.setStyleSheet(badge_style(banner_kind) + " border-radius: 8px; padding: 10px 12px; font-size: 12pt; font-weight: 700;")

        self.values["customer"].setText(f"{order.get('customerName', '')}  ({order.get('customerCode', '')})")
        self.values["delivery"].setText(delivery_label(str(order.get("deliveryDate", "")), with_year=True))
        slot = slot_label(order)
        self.values["slot"].setText(slot or "지정 안 함")
        self.values["slot"].setStyleSheet(f"color: {COLORS['entering']};" if slot else f"color: {COLORS['muted']};")
        self.values["period"].setText(f"{period_label(order)}발주")
        self.values["received"].setText(kst_datetime(str(order.get("createdAt", ""))))
        location = order.get("deliveryLocation") or None
        location_text = ""
        if location:
            location_text = location.get("name", "")
            if location.get("address"):
                location_text += f"\n{location['address']}"
        self.values["location"].setText(location_text or "기본 배송처")
        source = str(order.get("sourceLabel") or "")
        if order.get("createdByStaffName"):
            source += f" ({order['createdByStaffName']})"
        self.values["source"].setText(source)

        note = str(order.get("note") or "").strip()
        self.note.setText(f"요청사항: {note}")
        self.note.setVisible(bool(note))

        items = order.get("items") or []
        self.table.setRowCount(len(items))
        bold = QFont()
        bold.setBold(True)
        bold.setPointSize(15)
        for row, item in enumerate(items):
            price = won(item.get("unitPrice"))
            list_price = item.get("listPrice")
            discounted = group_b and list_price is not None and float(list_price) != float(item.get("unitPrice") or 0)
            if discounted:
                price = f"{price}  (정가 {won(list_price)})"
            cells = [
                str(item.get("productName", "")) + ("  [행사]" if item.get("isPromo") else ""),
                str(item.get("spec", "")),
                str(item.get("unit", "")),
                quantity_text(item.get("quantity")),
                price,
            ]
            for column, text in enumerate(cells):
                cell = QTableWidgetItem(text)
                if column == 3:
                    cell.setFont(bold)
                    cell.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                    cell.setForeground(QColor(COLORS["ink"]))
                elif column == 2:
                    cell.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                elif column == 4:
                    cell.setTextAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
                    if discounted:
                        cell.setForeground(QColor(COLORS["brand"]))
                if cancelled:
                    cell.setForeground(QColor(COLORS["cancelled"]))
                self.table.setItem(row, column, cell)
        self.table.resizeRowsToContents()
        if not same:
            self.table.scrollToTop()
        self.summary.setText(f"총 {len(items)}품목")

        lines = []
        if desk.get("doneBy"):
            lines.append(f"입력완료: {desk['doneBy']} · {kst_datetime(str(desk.get('doneAt', '')))}")
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
        self.start_button.setVisible(state == "new" and not cancelled)
        self.start_button.setText("입력 시작")
        if state == "entering" and not mine and not cancelled:
            self.start_button.setVisible(True)
            self.start_button.setText("이어받기")
        self.done_button.setVisible(state != "done")
        self.done_button.setText("취소 확인" if cancelled else "입력완료")
        self.release_button.setVisible(state == "entering")
        self.reopen_button.setVisible(state == "done" and not desk.get("deleted"))
        self.delete_button.setVisible(self.can_delete and not desk.get("deleted") and order.get("status") != "shipped")
        for button in (self.start_button, self.done_button, self.release_button, self.reopen_button, self.delete_button):
            button.setEnabled(not self._busy)
