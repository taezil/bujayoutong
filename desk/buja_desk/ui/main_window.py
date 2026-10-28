"""메인 화면: [처리할 발주] 목록 + 상세, [처리내역] 검색."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from PySide6.QtCore import QByteArray, QDate, Qt, QTimer
from PySide6.QtGui import QAction, QCloseEvent, QIcon
from PySide6.QtWidgets import (
    QAbstractItemView, QCheckBox, QComboBox, QDateEdit, QFrame, QHBoxLayout, QHeaderView, QLabel, QLineEdit,
    QListWidget, QListWidgetItem, QMainWindow, QMenu, QPushButton, QSplitter, QStatusBar, QTableWidget,
    QTableWidgetItem, QTabWidget, QToolButton, QVBoxLayout, QWidget,
)

from .. import APP_NAME, __version__
from ..core.model import (
    customer_label, delivery_label, items_summary, kst_datetime, kst_time, period_label, state_of, today_kst,
)
from .detail import OrderDetailView
from .theme import COLORS, badge_style

if TYPE_CHECKING:  # pragma: no cover
    from .app import DeskController


def _sort_key(order: dict[str, Any]) -> tuple:
    state = state_of(order)
    if order.get("cancelled"):
        rank = 0  # 취소 확인이 필요한 주문은 맨 위
    elif state == "new":
        rank = 1
    else:
        rank = 2
    return (rank, str(order.get("createdAt", "")), str(order.get("id", "")))


def _matches(order: dict[str, Any], query: str) -> bool:
    if not query:
        return True
    q = query.lower().replace(" ", "")
    hay = [order.get("customerName", ""), order.get("customerCode", ""), order.get("id", ""),
           (order.get("deliveryLocation") or {}).get("name", "") if order.get("deliveryLocation") else ""]
    hay += [i.get("productName", "") for i in order.get("items") or []]
    return any(q in str(text).lower().replace(" ", "") for text in hay)


class OrderCard(QFrame):
    def __init__(self, order: dict[str, Any], my_staff_id: str):
        super().__init__()
        self.setObjectName("Card")
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 10, 14, 10)
        layout.setSpacing(4)
        state = state_of(order)
        desk = order.get("desk") or {}

        top = QHBoxLayout()
        top.setSpacing(6)
        badges: list[tuple[str, str]] = []
        if order.get("cancelled"):
            badges.append(("취소됨", "cancelled"))
        elif state == "new":
            badges.append(("신규", "new"))
        else:
            mine = desk.get("enteringById") == my_staff_id
            badges.append((f"입력 중 · {'나' if mine else desk.get('enteringBy') or '?'}", "entering"))
        if order.get("isAdditional"):
            badges.append(("추가발주 🚨", "additional"))
        for text, kind in badges:
            badge = QLabel(text)
            badge.setObjectName("Badge")
            badge.setStyleSheet(badge_style(kind))
            top.addWidget(badge)
        top.addStretch(1)
        when = QLabel(kst_time(str(order.get("createdAt", ""))))
        when.setStyleSheet(f"color: {COLORS['muted']}; font-weight: 700;")
        top.addWidget(when)
        layout.addLayout(top)

        name = QLabel(f"{customer_label(order)}")
        name.setStyleSheet("font-size: 13pt; font-weight: 800;" + (f"color: {COLORS['cancelled']}; text-decoration: line-through;" if order.get("cancelled") else ""))
        name.setWordWrap(True)
        layout.addWidget(name)
        info = QLabel(f"배송 {delivery_label(str(order.get('deliveryDate', '')))} · {period_label(order)}발주 · {len(order.get('items') or [])}품목")
        info.setStyleSheet(f"color: {COLORS['muted']};")
        layout.addWidget(info)
        summary = QLabel(items_summary(order))
        summary.setStyleSheet(f"color: {COLORS['muted']}; font-size: 10pt;")
        summary.setWordWrap(True)
        layout.addWidget(summary)
        if state == "new" and not order.get("cancelled"):
            self.setStyleSheet(f"QFrame#Card {{ border-left: 6px solid {COLORS['additional'] if order.get('isAdditional') else COLORS['new']}; }}")

    def set_selected(self, selected: bool) -> None:
        self.setProperty("selected", "true" if selected else "false")
        self.style().unpolish(self)
        self.style().polish(self)


class MainWindow(QMainWindow):
    def __init__(self, controller: "DeskController", icon: QIcon):
        super().__init__()
        self.controller = controller
        self.setWindowTitle(APP_NAME)
        self.setWindowIcon(icon)
        self.resize(1280, 800)
        self.setMinimumSize(980, 620)
        self.orders: list[dict[str, Any]] = []
        self._orders_signature: tuple = ()
        self._pending_open = ""
        self.my_staff_id = ""

        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        root.addWidget(self._build_top_bar())

        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        root.addWidget(self.tabs, 1)
        self.tabs.addTab(self._build_open_tab(), "처리할 발주")
        self.tabs.addTab(self._build_history_tab(), "처리내역")
        self.tabs.currentChanged.connect(self._tab_changed)

        self.status = QStatusBar()
        self.setStatusBar(self.status)
        self.undo_button = QPushButton("되돌리기")
        self.undo_button.setVisible(False)
        self.status.addPermanentWidget(self.undo_button)
        self._undo_timer = QTimer(self)
        self._undo_timer.setSingleShot(True)
        self._undo_timer.timeout.connect(lambda: self.undo_button.setVisible(False))

        geometry = controller.settings.window_geometry
        if geometry:
            try:
                self.restoreGeometry(QByteArray.fromBase64(geometry.encode("ascii")))
            except Exception:  # noqa: BLE001
                pass

    # ---------- 화면 구성 ----------
    def _build_top_bar(self) -> QFrame:
        bar = QFrame()
        bar.setObjectName("TopBar")
        layout = QHBoxLayout(bar)
        layout.setContentsMargins(18, 10, 14, 10)
        layout.setSpacing(10)
        title = QLabel("부자유통 발주 알림센터")
        title.setObjectName("AppTitle")
        layout.addWidget(title)
        self.count_label = QLabel("신규 0")
        self.count_label.setObjectName("CountNew")
        layout.addWidget(self.count_label)
        self.entering_label = QLabel("")
        layout.addWidget(self.entering_label)
        layout.addStretch(1)
        self.connection = QLabel("연결 중...")
        self.connection.setObjectName("Pill")
        self.connection.setProperty("state", "ok")
        layout.addWidget(self.connection)
        self.staff_label = QLabel("")
        layout.addWidget(self.staff_label)
        self.sound_button = QPushButton()
        self.sound_button.setObjectName("TopButton")
        self.sound_button.setCheckable(True)
        self.sound_button.clicked.connect(lambda checked: self.controller.set_sound(checked))
        layout.addWidget(self.sound_button)
        refresh = QPushButton("새로고침")
        refresh.setObjectName("TopButton")
        refresh.clicked.connect(self.controller.request_refresh)
        layout.addWidget(refresh)
        self.menu_button = QToolButton()
        self.menu_button.setText("설정 ▾")
        self.menu_button.setObjectName("TopButton")
        self.menu_button.setStyleSheet("QToolButton { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.35); color: white; border-radius: 8px; padding: 8px 12px; font-weight: 700; } QToolButton::menu-indicator { image: none; }")
        self.menu_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.menu_button.setMenu(self._build_menu())
        layout.addWidget(self.menu_button)
        self.update_sound_button()
        return bar

    def _build_menu(self) -> QMenu:
        menu = QMenu(self)
        self.autostart_action = QAction("Windows 시작 시 자동 실행", self)
        self.autostart_action.setCheckable(True)
        self.autostart_action.toggled.connect(self.controller.set_autostart)
        menu.addAction(self.autostart_action)
        self.popup_action = QAction("알림 팝업 표시", self)
        self.popup_action.setCheckable(True)
        self.popup_action.toggled.connect(self.controller.set_popup)
        menu.addAction(self.popup_action)
        self.reminder_action = QAction("미처리 발주 10분마다 다시 알림", self)
        self.reminder_action.setCheckable(True)
        self.reminder_action.toggled.connect(self.controller.set_reminder)
        menu.addAction(self.reminder_action)
        menu.addSeparator()
        test = QAction("알림 테스트 (소리·팝업)", self)
        test.triggered.connect(self.controller.test_notification)
        menu.addAction(test)
        logs = QAction("기록(로그) 폴더 열기", self)
        logs.triggered.connect(self.controller.open_data_folder)
        menu.addAction(logs)
        menu.addSeparator()
        logout = QAction("사용자 변경 (로그아웃)", self)
        logout.triggered.connect(self.controller.logout)
        menu.addAction(logout)
        about = QAction(f"프로그램 정보 (v{__version__})", self)
        about.triggered.connect(self.controller.show_about)
        menu.addAction(about)
        menu.addSeparator()
        quit_action = QAction("프로그램 종료", self)
        quit_action.triggered.connect(self.controller.quit_with_confirm)
        menu.addAction(quit_action)
        menu.aboutToShow.connect(self._sync_menu)
        return menu

    def _sync_menu(self) -> None:
        settings = self.controller.settings
        for action, value in ((self.autostart_action, self.controller.autostart_enabled()),
                              (self.popup_action, settings.popup_enabled),
                              (self.reminder_action, settings.reminder_enabled)):
            action.blockSignals(True)
            action.setChecked(bool(value))
            action.blockSignals(False)
        self.reminder_action.setText(f"미처리 발주 {settings.reminder_minutes}분마다 다시 알림")
        self.autostart_action.setEnabled(self.controller.autostart_supported())

    def _build_open_tab(self) -> QWidget:
        page = QWidget()
        layout = QHBoxLayout(page)
        layout.setContentsMargins(14, 12, 14, 12)
        splitter = QSplitter(Qt.Orientation.Horizontal)
        layout.addWidget(splitter)

        left = QWidget()
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(0, 0, 8, 0)
        left_layout.setSpacing(8)
        self.search = QLineEdit()
        self.search.setPlaceholderText("거래처 · 상품명 검색")
        self.search.setClearButtonEnabled(True)
        self.search.textChanged.connect(self._render_list)
        left_layout.addWidget(self.search)
        filters = QHBoxLayout()
        self.date_filter = QComboBox()
        self.date_filter.currentIndexChanged.connect(self._render_list)
        filters.addWidget(self.date_filter, 1)
        self.state_filter = QComboBox()
        self.state_filter.addItems(["전체 상태", "신규만", "입력 중만"])
        self.state_filter.currentIndexChanged.connect(self._render_list)
        filters.addWidget(self.state_filter, 1)
        left_layout.addLayout(filters)
        self.group_check = QCheckBox("거래처별로 묶어 보기")
        self.group_check.setChecked(self.controller.settings.group_by_customer)
        self.group_check.toggled.connect(self._group_toggled)
        left_layout.addWidget(self.group_check)
        self.list = QListWidget()
        self.list.setVerticalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        self.list.currentItemChanged.connect(self._list_selection_changed)
        left_layout.addWidget(self.list, 1)
        self.list_info = QLabel("")
        self.list_info.setStyleSheet(f"color: {COLORS['muted']};")
        left_layout.addWidget(self.list_info)
        splitter.addWidget(left)

        self.detail = OrderDetailView()
        self.detail.actionRequested.connect(self.controller.change_state)
        self.detail.copyRequested.connect(self.controller.copy_order)
        splitter.addWidget(self.detail)
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)
        splitter.setSizes([400, 860])
        return page

    def _build_history_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(8)
        filters = QHBoxLayout()
        self.history_field = QComboBox()
        self.history_field.addItems(["접수일 기준", "배송일 기준"])
        filters.addWidget(self.history_field)
        today = today_kst()
        self.history_from = QDateEdit(QDate(today.year, today.month, today.day).addDays(-6))
        self.history_to = QDateEdit(QDate(today.year, today.month, today.day))
        for edit in (self.history_from, self.history_to):
            edit.setCalendarPopup(True)
            edit.setDisplayFormat("yyyy-MM-dd")
        filters.addWidget(self.history_from)
        filters.addWidget(QLabel("~"))
        filters.addWidget(self.history_to)
        self.history_state = QComboBox()
        self.history_state.addItems(["입력완료", "전체", "미처리"])
        filters.addWidget(self.history_state)
        self.history_query = QLineEdit()
        self.history_query.setPlaceholderText("거래처 · 상품명 · 주문번호")
        self.history_query.returnPressed.connect(self.search_history)
        filters.addWidget(self.history_query, 1)
        go = QPushButton("조회")
        go.setObjectName("Start")
        go.setStyleSheet("font-size: 11pt; padding: 8px 20px;")
        go.clicked.connect(self.search_history)
        filters.addWidget(go)
        layout.addLayout(filters)

        splitter = QSplitter(Qt.Orientation.Vertical)
        self.history_table = QTableWidget(0, 8)
        self.history_table.setHorizontalHeaderLabels(["접수시간", "배송일", "구분", "거래처", "품목", "상태", "처리자", "처리시간"])
        self.history_table.verticalHeader().setVisible(False)
        self.history_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.history_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.history_table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.history_table.setStyleSheet("font-size: 11pt;")
        header = self.history_table.horizontalHeader()
        for column in range(8):
            header.setSectionResizeMode(column, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        self.history_table.itemSelectionChanged.connect(self._history_selected)
        splitter.addWidget(self.history_table)
        self.history_detail = OrderDetailView(history_mode=True)
        self.history_detail.actionRequested.connect(self.controller.change_state)
        self.history_detail.copyRequested.connect(self.controller.copy_order)
        splitter.addWidget(self.history_detail)
        splitter.setSizes([320, 420])
        layout.addWidget(splitter, 1)
        self.history_info = QLabel("")
        self.history_info.setStyleSheet(f"color: {COLORS['muted']};")
        layout.addWidget(self.history_info)
        self.history_orders: list[dict[str, Any]] = []
        return page

    # ---------- 데이터 반영 ----------
    def set_staff(self, staff_id: str, text: str) -> None:
        self.my_staff_id = staff_id
        self.staff_label.setText(text)
        self.detail.set_my_staff(staff_id)
        self.history_detail.set_my_staff(staff_id)

    def set_connection(self, ok: bool, text: str) -> None:
        self.connection.setText(text)
        self.connection.setProperty("state", "ok" if ok else "bad")
        self.connection.style().unpolish(self.connection)
        self.connection.style().polish(self.connection)

    def update_sound_button(self) -> None:
        enabled = self.controller.settings.sound_enabled
        self.sound_button.setChecked(enabled)
        self.sound_button.setText("🔔 알림음 켬" if enabled else "🔕 알림음 끔")

    def set_orders(self, orders: list[dict[str, Any]]) -> None:
        signature = tuple((o.get("id"), o.get("contentVersion"), (o.get("desk") or {}).get("revision"),
                           (o.get("desk") or {}).get("state")) for o in orders)
        self.orders = orders
        new_count = sum(1 for o in orders if state_of(o) == "new" and not o.get("cancelled"))
        entering = sum(1 for o in orders if state_of(o) == "entering")
        cancelled = sum(1 for o in orders if o.get("cancelled"))
        self.count_label.setText(f"신규 {new_count}건")
        extra = []
        if entering:
            extra.append(f"입력 중 {entering}")
        if cancelled:
            extra.append(f"취소 확인 {cancelled}")
        self.entering_label.setText(" · ".join(extra))
        self.tabs.setTabText(0, f"처리할 발주 ({len(orders)})")
        if signature != self._orders_signature:
            self._orders_signature = signature
            self._refresh_date_filter()
            self._render_list()
        # 상세화면의 주문이 바뀌었으면 최신으로 (입력완료로 목록에서 빠진 경우는 그대로 둠)
        current = self.detail.current_id()
        if current:
            fresh = next((o for o in orders if o.get("id") == current), None)
            if fresh is not None:
                self.detail.set_order(fresh)
        if self._pending_open:
            self.open_order(self._pending_open)

    def _refresh_date_filter(self) -> None:
        current = self.date_filter.currentData()
        dates = sorted({str(o.get("deliveryDate", "")) for o in self.orders if o.get("deliveryDate")})
        self.date_filter.blockSignals(True)
        self.date_filter.clear()
        self.date_filter.addItem("전체 배송일", "")
        for value in dates:
            count = sum(1 for o in self.orders if o.get("deliveryDate") == value)
            self.date_filter.addItem(f"배송 {delivery_label(value)} ({count})", value)
        index = self.date_filter.findData(current) if current else 0
        self.date_filter.setCurrentIndex(max(0, index))
        self.date_filter.blockSignals(False)

    def _filtered(self) -> list[dict[str, Any]]:
        query = self.search.text().strip()
        date_value = self.date_filter.currentData() or ""
        state_index = self.state_filter.currentIndex()
        result = []
        for order in self.orders:
            if date_value and order.get("deliveryDate") != date_value:
                continue
            state = state_of(order)
            if state_index == 1 and (state != "new" or order.get("cancelled")):
                continue
            if state_index == 2 and state != "entering":
                continue
            if not _matches(order, query):
                continue
            result.append(order)
        return sorted(result, key=_sort_key)

    def _group_toggled(self, checked: bool) -> None:
        self.controller.settings.group_by_customer = checked
        self.controller.save_settings()
        self._render_list()

    def _render_list(self) -> None:
        selected = self.detail.current_id()
        orders = self._filtered()
        self.list.blockSignals(True)
        self.list.clear()
        if self.group_check.isChecked():
            groups: dict[str, list[dict[str, Any]]] = {}
            for order in orders:
                groups.setdefault(f"{order.get('customerCode', '')} {order.get('customerName', '')}", []).append(order)
            ordered = sorted(groups.items(), key=lambda kv: min(_sort_key(o) for o in kv[1]))
            for title, group in ordered:
                header = QListWidgetItem()
                header.setFlags(Qt.ItemFlag.NoItemFlags)
                label = QLabel(f"{title}  ·  {len(group)}건")
                label.setObjectName("GroupHeader")
                header.setSizeHint(label.sizeHint())
                self.list.addItem(header)
                self.list.setItemWidget(header, label)
                for order in group:
                    self._add_card(order)
        else:
            for order in orders:
                self._add_card(order)
        self.list.blockSignals(False)
        if not orders:
            self.list_info.setText("처리할 발주가 없습니다." if not self.orders else "조건에 맞는 주문이 없습니다.")
        else:
            self.list_info.setText(f"{len(orders)}건 표시 · 오래된 주문이 위에 있습니다")
        if selected:
            self._select_in_list(selected)
        self._update_card_selection()

    def _add_card(self, order: dict[str, Any]) -> None:
        item = QListWidgetItem()
        item.setData(Qt.ItemDataRole.UserRole, order.get("id"))
        card = OrderCard(order, self.my_staff_id)
        item.setSizeHint(card.sizeHint())
        self.list.addItem(item)
        self.list.setItemWidget(item, card)

    def _select_in_list(self, order_id: str) -> bool:
        for row in range(self.list.count()):
            item = self.list.item(row)
            if item.data(Qt.ItemDataRole.UserRole) == order_id:
                self.list.blockSignals(True)
                self.list.setCurrentItem(item)
                self.list.blockSignals(False)
                self.list.scrollToItem(item)
                return True
        return False

    def _update_card_selection(self) -> None:
        current = self.detail.current_id()
        for row in range(self.list.count()):
            item = self.list.item(row)
            widget = self.list.itemWidget(item)
            if isinstance(widget, OrderCard):
                widget.set_selected(item.data(Qt.ItemDataRole.UserRole) == current)

    def _list_selection_changed(self, current: QListWidgetItem | None, _previous) -> None:
        if current is None:
            return
        order_id = current.data(Qt.ItemDataRole.UserRole)
        order = next((o for o in self.orders if o.get("id") == order_id), None)
        if order is not None:
            self.detail.set_order(order)
            self._update_card_selection()

    def open_order(self, order_id: str) -> None:
        """알림 클릭 등으로 특정 주문 상세 열기."""
        self.tabs.setCurrentIndex(0)
        order = next((o for o in self.orders if o.get("id") == order_id), None)
        if order is None:
            # 아직 목록을 받기 전이면 받은 뒤 열기, 이미 입력완료된 주문이면 서버에서 직접 조회
            self._pending_open = order_id
            self.controller.fetch_single(order_id)
            return
        self._pending_open = ""
        if self.search.text() or self.date_filter.currentIndex() or self.state_filter.currentIndex():
            if not self._select_in_list(order_id):
                self.search.clear()
                self.date_filter.setCurrentIndex(0)
                self.state_filter.setCurrentIndex(0)
        self.detail.set_order(order)
        self._select_in_list(order_id)
        self._update_card_selection()

    def show_single(self, order: dict[str, Any]) -> None:
        """목록에 없는(이미 입력완료된) 주문을 처리내역 탭에서 보여줌."""
        self._pending_open = ""
        self.tabs.setCurrentIndex(1)
        self.history_detail.set_order(order)

    def after_action(self, order: dict[str, Any], action: str) -> None:
        order_id = str(order.get("id"))
        if self.history_detail.current_id() == order_id:
            self.history_detail.set_order(order)
        if self.detail.current_id() == order_id:
            if action == "done" and self.tabs.currentIndex() == 0:
                # 다음 주문으로 자동 이동
                remaining = [o for o in self._filtered() if o.get("id") != order_id]
                if remaining:
                    self.detail.set_order(remaining[0])
                    self._select_in_list(str(remaining[0].get("id")))
                else:
                    self.detail.set_order(None)
            else:
                self.detail.set_order(order)
        # 목록에도 즉시 반영 (서버 동기화 전)
        merged = [o for o in self.orders if o.get("id") != order_id]
        if state_of(order) != "done":
            merged.append(order)
        self.set_orders(merged)

    def set_busy(self, busy: bool) -> None:
        self.detail.set_busy(busy)
        self.history_detail.set_busy(busy)

    def show_message(self, text: str, undo=None, seconds: int = 8) -> None:
        self.status.showMessage(text, seconds * 1000)
        try:
            self.undo_button.clicked.disconnect()
        except (RuntimeError, TypeError):
            pass
        if undo is not None:
            self.undo_button.clicked.connect(lambda: (self.undo_button.setVisible(False), undo()))
            self.undo_button.setVisible(True)
            self._undo_timer.start(seconds * 1000)
        else:
            self.undo_button.setVisible(False)

    # ---------- 처리내역 ----------
    def _tab_changed(self, index: int) -> None:
        if index == 1 and not self.history_orders:
            self.search_history()

    def search_history(self) -> None:
        state = {0: "done", 1: "all", 2: "open"}[self.history_state.currentIndex()]
        params = {
            "date_from": self.history_from.date().toString("yyyy-MM-dd"),
            "date_to": self.history_to.date().toString("yyyy-MM-dd"),
            "query": self.history_query.text().strip(),
            "date_field": "delivery" if self.history_field.currentIndex() == 1 else "created",
            "state": state,
        }
        self.history_info.setText("조회 중...")
        self.controller.load_history(params)

    def set_history(self, orders: list[dict[str, Any]] | None, error: str = "") -> None:
        if orders is None:
            self.history_info.setText(f"조회하지 못했습니다: {error}")
            return
        self.history_orders = orders
        table = self.history_table
        table.setRowCount(len(orders))
        for row, order in enumerate(orders):
            desk = order.get("desk") or {}
            state = state_of(order)
            state_text = {"new": "신규", "entering": "입력 중", "done": "입력완료"}[state]
            if order.get("cancelled"):
                state_text += " (취소된 주문)"
            kind = "추가 🚨" if order.get("isAdditional") else "신규"
            who = desk.get("doneBy") if state == "done" else desk.get("enteringBy", "")
            when = desk.get("doneAt") if state == "done" else desk.get("enteringAt", "")
            values = [
                kst_datetime(str(order.get("createdAt", ""))),
                f"{delivery_label(str(order.get('deliveryDate', '')))} {period_label(order)}",
                kind,
                f"{order.get('customerCode', '')} {customer_label(order)}",
                f"{len(order.get('items') or [])}품목",
                state_text,
                str(who or ""),
                kst_datetime(str(when or "")),
            ]
            for column, text in enumerate(values):
                cell = QTableWidgetItem(text)
                cell.setData(Qt.ItemDataRole.UserRole, order.get("id"))
                table.setItem(row, column, cell)
        table.resizeRowsToContents()
        self.history_info.setText(f"{len(orders)}건" + (" (최대 300건까지 표시)" if len(orders) >= 300 else ""))
        current = self.history_detail.current_id()
        fresh = next((o for o in orders if o.get("id") == current), None)
        self.history_detail.set_order(fresh)

    def _history_selected(self) -> None:
        rows = self.history_table.selectionModel().selectedRows()
        if not rows:
            return
        order_id = self.history_table.item(rows[0].row(), 0).data(Qt.ItemDataRole.UserRole)
        order = next((o for o in self.history_orders if o.get("id") == order_id), None)
        self.history_detail.set_order(order)

    # ---------- 창 닫기 = 트레이로 숨김 ----------
    def closeEvent(self, event: QCloseEvent) -> None:  # noqa: N802
        self.controller.settings.window_geometry = bytes(self.saveGeometry().toBase64()).decode("ascii")
        self.controller.save_settings()
        if self.controller.quitting:
            event.accept()
            return
        event.ignore()
        self.hide()
        self.controller.on_window_hidden()
