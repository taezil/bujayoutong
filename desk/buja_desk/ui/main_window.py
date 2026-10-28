"""메인 화면 (v1.1 디자인).

왼쪽: 진한 초록 세로 메뉴 (발주 · 처리내역 · 알림음 · 새로고침 · 설정 · 연결 상태)
오른쪽 위: 제목 + 오늘 요약(신규 · 입력 중 · 오늘 완료 · 오늘 접수) + 로그인 직원
오른쪽: [발주] 카드 목록 + 상세 / [처리내역] 검색표 + 상세
같은 거래처·배송일·배송처·배송 시간의 '신규' 발주는 자동으로 합쳐서 한 장으로 보입니다 (core/bundle.py).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from PySide6.QtCore import QByteArray, QDate, QSize, Qt, QTimer
from PySide6.QtGui import QAction, QCloseEvent, QIcon, QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView, QButtonGroup, QCheckBox, QComboBox, QDateEdit, QFrame, QHBoxLayout, QHeaderView, QLabel,
    QLineEdit, QListWidget, QListWidgetItem, QMainWindow, QMenu, QPushButton, QSplitter, QStatusBar, QTableWidget,
    QTableWidgetItem, QTabWidget, QToolButton, QVBoxLayout, QWidget,
)

from .. import APP_NAME, __version__
from ..core.bundle import find_entry, merge_orders
from ..core.model import (
    customer_label, delivery_label, delivery_text, items_summary, kst_datetime, parse_utc, state_of, today_kst,
)
from .theme import COLORS, avatar_style, avatar_text, badge_style
from .detail import OrderDetailView

if TYPE_CHECKING:  # pragma: no cover
    from .app import DeskController

WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]


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


def _ago(value: str) -> str:
    moment = parse_utc(value)
    if not moment:
        return ""
    minutes = int((datetime.now(timezone.utc) - moment).total_seconds() // 60)
    if minutes < 1:
        return "방금"
    if minutes < 60:
        return f"{minutes}분 전"
    if minutes < 24 * 60:
        return f"{minutes // 60}시간 전"
    return f"{minutes // (24 * 60)}일 전"


def _badge(text: str, kind: str) -> QLabel:
    label = QLabel(text)
    label.setObjectName("Badge")
    label.setStyleSheet(badge_style(kind) + " font-size: 9pt; padding: 2px 8px;")
    return label


class OrderCard(QFrame):
    def __init__(self, order: dict[str, Any], my_staff_id: str):
        super().__init__()
        self.setObjectName("Card")
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        state = state_of(order)
        desk = order.get("desk") or {}
        cancelled = bool(order.get("cancelled"))

        row = QHBoxLayout(self)
        row.setContentsMargins(12, 10, 12, 10)
        row.setSpacing(10)
        name = str(order.get("customerName") or "")
        avatar = QLabel(avatar_text(name))
        avatar.setObjectName("Avatar")
        avatar.setFixedSize(36, 36)
        avatar.setAlignment(Qt.AlignmentFlag.AlignCenter)
        avatar.setStyleSheet(avatar_style(name) + " border-radius: 18px; font-weight: 900; font-size: 12pt;")
        row.addWidget(avatar, 0, Qt.AlignmentFlag.AlignTop)

        col = QVBoxLayout()
        col.setSpacing(3)
        top = QHBoxLayout()
        title = QLabel(customer_label(order))
        title.setObjectName("CardName")
        if cancelled:
            title.setStyleSheet(f"color: {COLORS['cancelled']}; text-decoration: line-through;")
        top.addWidget(title, 1)
        when = QLabel(_ago(str(order.get("lastCreatedAt") or order.get("createdAt") or "")))
        when.setObjectName("CardTime")
        top.addWidget(when, 0, Qt.AlignmentFlag.AlignTop)
        col.addLayout(top)

        meta_text = f"{delivery_text(order)} · {len(order.get('items') or [])}품목"
        if state == "entering":
            mine = desk.get("enteringById") == my_staff_id
            meta_text = f"입력 중 · {'나' if mine else desk.get('enteringBy') or '?'}  ·  " + meta_text
        meta = QLabel(meta_text)
        meta.setObjectName("CardMeta")
        if state == "entering":
            meta.setStyleSheet(f"color: {COLORS['entering']}; font-weight: 700;")
        col.addWidget(meta)
        summary = QLabel(items_summary(order))
        summary.setObjectName("CardMeta")
        summary.setStyleSheet(f"color: {COLORS['faint']};")
        summary.setWordWrap(True)
        col.addWidget(summary)

        badges = QHBoxLayout()
        badges.setSpacing(4)
        has_badge = False
        if cancelled:
            badges.addWidget(_badge("취소됨", "cancelled")); has_badge = True
        elif state == "new":
            badges.addWidget(_badge("신규", "new")); has_badge = True
        if order.get("isBundle"):
            badges.addWidget(_badge(f"🔗{order.get('mergedCount', 2)}건", "merged")); has_badge = True
        if order.get("isAdditional"):
            badges.addWidget(_badge("추가🚨", "additional")); has_badge = True
        if order.get("priceGroup") == "B":
            badges.addWidget(_badge("B그룹", "group_b")); has_badge = True
        drivers = order.get("driverNames") or ([order.get("createdByStaffName")] if order.get("source") == "driver" else [])
        drivers = [d for d in drivers if d]
        if drivers or order.get("source") == "driver":
            badges.addWidget(_badge(f"🚚{drivers[0] if drivers else '기사'}", "driver")); has_badge = True
        badges.addStretch(1)
        if has_badge:
            col.addLayout(badges)
        row.addLayout(col, 1)

        accent = None
        if not cancelled and state == "new":
            accent = COLORS["additional"] if order.get("isAdditional") else COLORS["new"]
        if accent:
            self.setStyleSheet(f"QFrame#Card {{ border-left: 5px solid {accent}; }}")

    def set_selected(self, selected: bool) -> None:
        self.setProperty("selected", "true" if selected else "false")
        self.style().unpolish(self)
        self.style().polish(self)


class StatBox(QFrame):
    def __init__(self, label: str, color: str):
        super().__init__()
        self.setObjectName("Stat")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 8, 14, 8)
        layout.setSpacing(0)
        self.value = QLabel("0")
        self.value.setObjectName("StatValue")
        self.value.setStyleSheet(f"color: {color};")
        caption = QLabel(label)
        caption.setObjectName("StatLabel")
        layout.addWidget(self.value)
        layout.addWidget(caption)
        self.setMinimumWidth(96)


class MainWindow(QMainWindow):
    def __init__(self, controller: "DeskController", icon: QIcon):
        super().__init__()
        self.controller = controller
        self.setWindowTitle(APP_NAME)
        self.setWindowIcon(icon)
        self.resize(1320, 820)
        self.setMinimumSize(1040, 640)
        self.orders: list[dict[str, Any]] = []  # 서버에서 받은 미처리 주문 (원본)
        self.entries: list[dict[str, Any]] = []  # 화면 목록 (합친 발주 포함)
        self._entries_signature: tuple = ()
        self._pending_open = ""
        self.my_staff_id = ""

        central = QWidget()
        self.setCentralWidget(central)
        root = QHBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        root.addWidget(self._build_rail(icon))

        workspace = QWidget()
        workspace.setObjectName("Workspace")
        work = QVBoxLayout(workspace)
        work.setContentsMargins(18, 14, 18, 8)
        work.setSpacing(12)
        work.addLayout(self._build_header())
        self.tabs = QTabWidget()
        self.tabs.tabBar().hide()
        self.tabs.addTab(self._build_open_tab(), "처리할 발주")
        self.tabs.addTab(self._build_history_tab(), "처리내역")
        self.tabs.currentChanged.connect(self._tab_changed)
        work.addWidget(self.tabs, 1)
        root.addWidget(workspace, 1)

        self.status = QStatusBar()
        self.setStatusBar(self.status)
        self.update_button = QPushButton("")
        self.update_button.setVisible(False)
        self.update_button.setStyleSheet(f"color: {COLORS['brand_dark']};")
        self.update_button.clicked.connect(lambda: self.controller.check_update(manual=True))
        self.undo_button = QPushButton("되돌리기")
        self.undo_button.setVisible(False)
        self.status.addPermanentWidget(self.undo_button)
        self._undo_timer = QTimer(self)
        self._undo_timer.setSingleShot(True)
        self._undo_timer.timeout.connect(lambda: self.undo_button.setVisible(False))
        # 'n분 전' 표시 갱신
        self._tick = QTimer(self)
        self._tick.timeout.connect(self._render_list)
        self._tick.start(60_000)
        # 창 크기를 바꾸면 카드 폭 다시 맞춤
        self._resize_timer = QTimer(self)
        self._resize_timer.setSingleShot(True)
        self._resize_timer.timeout.connect(self._render_list)

        geometry = controller.settings.window_geometry
        if geometry:
            try:
                self.restoreGeometry(QByteArray.fromBase64(geometry.encode("ascii")))
            except Exception:  # noqa: BLE001
                pass

    # ---------- 왼쪽 세로 메뉴 ----------
    def _rail_button(self, text: str, checkable: bool = False) -> QToolButton:
        button = QToolButton()
        button.setObjectName("RailButton")
        button.setText(text)
        button.setCheckable(checkable)
        button.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextUnderIcon)
        button.setCursor(Qt.CursorShape.PointingHandCursor)
        button.setFixedWidth(72)
        return button

    def _build_rail(self, icon: QIcon) -> QFrame:
        rail = QFrame()
        rail.setObjectName("Rail")
        rail.setFixedWidth(88)
        layout = QVBoxLayout(rail)
        layout.setContentsMargins(8, 14, 8, 12)
        layout.setSpacing(6)
        logo = QLabel()
        logo.setObjectName("RailLogo")
        logo.setFixedSize(48, 48)
        logo.setAlignment(Qt.AlignmentFlag.AlignCenter)
        logo.setPixmap(icon.pixmap(QSize(38, 38)))
        layout.addWidget(logo, 0, Qt.AlignmentFlag.AlignHCenter)
        layout.addSpacing(10)

        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)
        self.nav_orders = self._rail_button("🔔\n발주", checkable=True)
        self.nav_orders.setChecked(True)
        self.nav_history = self._rail_button("🗂\n처리내역", checkable=True)
        for index, button in enumerate((self.nav_orders, self.nav_history)):
            self.nav_group.addButton(button, index)
            layout.addWidget(button, 0, Qt.AlignmentFlag.AlignHCenter)
        self.nav_group.idClicked.connect(lambda index: self.tabs.setCurrentIndex(index))
        self.rail_badge = QLabel("", self.nav_orders)
        self.rail_badge.setObjectName("RailBadge")
        self.rail_badge.move(44, 2)
        self.rail_badge.setVisible(False)

        layout.addSpacing(4)
        self.load_sheet_button = self._rail_button("🧾\n상차준비표")
        self.load_sheet_button.setToolTip("구역별 상차준비표 인쇄")
        self.load_sheet_button.clicked.connect(self.controller.open_load_sheet)
        layout.addWidget(self.load_sheet_button, 0, Qt.AlignmentFlag.AlignHCenter)

        layout.addStretch(1)
        self.sound_button = self._rail_button("", checkable=True)
        self.sound_button.clicked.connect(lambda checked: self.controller.set_sound(checked))
        layout.addWidget(self.sound_button, 0, Qt.AlignmentFlag.AlignHCenter)
        refresh = self._rail_button("⟳\n새로고침")
        refresh.clicked.connect(self.controller.request_refresh)
        layout.addWidget(refresh, 0, Qt.AlignmentFlag.AlignHCenter)
        self.menu_button = self._rail_button("⚙\n설정")
        self.menu_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.menu_button.setMenu(self._build_menu())
        layout.addWidget(self.menu_button, 0, Qt.AlignmentFlag.AlignHCenter)
        layout.addSpacing(6)
        self.connection = QLabel("● 연결 중")
        self.connection.setObjectName("RailStatus")
        self.connection.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.connection.setWordWrap(True)
        layout.addWidget(self.connection)
        self.update_sound_button()
        return rail

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
        update = QAction("업데이트 확인", self)
        update.triggered.connect(lambda: self.controller.check_update(manual=True))
        menu.addAction(update)
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

    # ---------- 상단 ----------
    def _build_header(self) -> QHBoxLayout:
        header = QHBoxLayout()
        header.setSpacing(10)
        titles = QVBoxLayout()
        titles.setSpacing(0)
        self.page_title = QLabel("처리할 발주")
        self.page_title.setObjectName("PageTitle")
        titles.addWidget(self.page_title)
        today = today_kst()
        self.page_sub = QLabel(f"{today:%Y년 %m월 %d일} ({WEEKDAYS[today.weekday()]}) · 부자유통 발주 알림센터")
        self.page_sub.setObjectName("PageSub")
        titles.addWidget(self.page_sub)
        self.count_label = QLabel("신규 0건")
        self.count_label.setObjectName("PageSub")
        self.count_label.setStyleSheet(f"color: {COLORS['new']}; font-weight: 800;")
        titles.addWidget(self.count_label)
        header.addLayout(titles)
        header.addStretch(1)
        self.stat_new = StatBox("신규", COLORS["new"])
        self.stat_entering = StatBox("입력 중", COLORS["entering"])
        self.stat_done = StatBox("오늘 완료", COLORS["done"])
        self.stat_received = StatBox("오늘 접수", COLORS["ink"])
        self.stats = QWidget()
        stats = QHBoxLayout(self.stats)
        stats.setContentsMargins(0, 0, 0, 0)
        stats.setSpacing(8)
        for box in (self.stat_new, self.stat_entering, self.stat_done, self.stat_received):
            stats.addWidget(box)
        header.addWidget(self.stats)
        self.staff_label = QLabel("")
        self.staff_label.setObjectName("StaffChip")
        header.addWidget(self.staff_label, 0, Qt.AlignmentFlag.AlignTop)
        self.entering_label = QLabel("")  # 이전 버전 호환 (사용 안 함)
        self.entering_label.setVisible(False)
        return header

    def set_today_stats(self, received: int, done: int) -> None:
        self.stat_received.value.setText(str(received))
        self.stat_done.value.setText(str(done))

    # ---------- 발주 탭 ----------
    def _build_open_tab(self) -> QWidget:
        page = QWidget()
        layout = QHBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setHandleWidth(12)
        layout.addWidget(splitter)

        left = QFrame()
        left.setObjectName("ListPanel")
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(12, 12, 12, 10)
        left_layout.setSpacing(8)
        self.search = QLineEdit()
        self.search.setPlaceholderText("🔍 거래처 · 상품명 검색")
        self.search.setClearButtonEnabled(True)
        self.search.textChanged.connect(self._render_list)
        left_layout.addWidget(self.search)

        chips = QHBoxLayout()
        chips.setSpacing(6)
        self.state_group = QButtonGroup(self)
        self.state_group.setExclusive(True)
        self.chip_all = QPushButton("전체")
        self.chip_new = QPushButton("신규")
        self.chip_entering = QPushButton("입력 중")
        for index, chip in enumerate((self.chip_all, self.chip_new, self.chip_entering)):
            chip.setObjectName("Chip")
            chip.setCheckable(True)
            chip.setCursor(Qt.CursorShape.PointingHandCursor)
            self.state_group.addButton(chip, index)
            chips.addWidget(chip)
        self.chip_all.setChecked(True)
        self.state_group.idClicked.connect(lambda _id: self._render_list())
        chips.addStretch(1)
        left_layout.addLayout(chips)
        # 이전 버전 호환: 상태 필터 콤보는 칩과 연결
        self.state_filter = _ChipIndex(self.state_group)

        filters = QHBoxLayout()
        self.date_filter = QComboBox()
        self.date_filter.currentIndexChanged.connect(self._render_list)
        filters.addWidget(self.date_filter, 1)
        left_layout.addLayout(filters)
        self.group_check = QCheckBox("거래처별로 묶어 보기")
        self.group_check.setChecked(self.controller.settings.group_by_customer)
        self.group_check.toggled.connect(self._group_toggled)
        left_layout.addWidget(self.group_check)
        self.list = QListWidget()
        self.list.setVerticalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        self.list.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.list.setResizeMode(QListWidget.ResizeMode.Adjust)
        self.list.viewport().installEventFilter(self)
        self.list.currentItemChanged.connect(self._list_selection_changed)
        left_layout.addWidget(self.list, 1)
        self.list_info = QLabel("")
        self.list_info.setStyleSheet(f"color: {COLORS['faint']}; font-size: 9.5pt;")
        left_layout.addWidget(self.list_info)
        splitter.addWidget(left)

        self.detail = OrderDetailView()
        self.detail.actionRequested.connect(self.controller.change_state)
        self.detail.copyRequested.connect(self.controller.copy_order)
        splitter.addWidget(self.detail)
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)
        splitter.setSizes([390, 840])
        return page

    # ---------- 처리내역 탭 ----------
    def _build_history_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)
        bar = QFrame()
        bar.setObjectName("ListPanel")
        filters = QHBoxLayout(bar)
        filters.setContentsMargins(12, 10, 12, 10)
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
        self.history_query.setPlaceholderText("🔍 거래처 · 상품명 · 주문번호")
        self.history_query.returnPressed.connect(self.search_history)
        filters.addWidget(self.history_query, 1)
        go = QPushButton("조회")
        go.setObjectName("Start")
        go.setStyleSheet("font-size: 11pt; padding: 8px 22px;")
        go.clicked.connect(self.search_history)
        filters.addWidget(go)
        layout.addWidget(bar)

        splitter = QSplitter(Qt.Orientation.Vertical)
        splitter.setHandleWidth(10)
        table_panel = QFrame()
        table_panel.setObjectName("ListPanel")
        table_layout = QVBoxLayout(table_panel)
        table_layout.setContentsMargins(8, 8, 8, 8)
        self.history_table = QTableWidget(0, 8)
        self.history_table.setHorizontalHeaderLabels(["접수시간", "배송", "구분", "거래처", "품목", "상태", "처리자", "처리시간"])
        self.history_table.verticalHeader().setVisible(False)
        self.history_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.history_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.history_table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.history_table.setAlternatingRowColors(True)
        self.history_table.setShowGrid(False)
        self.history_table.setStyleSheet("font-size: 10.5pt;")
        header = self.history_table.horizontalHeader()
        for column in range(8):
            header.setSectionResizeMode(column, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        header.setDefaultAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        self.history_table.itemSelectionChanged.connect(self._history_selected)
        table_layout.addWidget(self.history_table)
        self.history_info = QLabel("")
        self.history_info.setStyleSheet(f"color: {COLORS['faint']}; font-size: 9.5pt;")
        table_layout.addWidget(self.history_info)
        splitter.addWidget(table_panel)
        self.history_detail = OrderDetailView(history_mode=True)
        self.history_detail.actionRequested.connect(self.controller.change_state)
        self.history_detail.copyRequested.connect(self.controller.copy_order)
        splitter.addWidget(self.history_detail)
        splitter.setSizes([380, 400])
        layout.addWidget(splitter, 1)
        self.history_orders: list[dict[str, Any]] = []
        return page

    # ---------- 데이터 반영 ----------
    def set_staff(self, staff_id: str, text: str, can_delete: bool = False) -> None:
        self.my_staff_id = staff_id
        self.staff_label.setText(f"👤 {text}")
        self.detail.set_my_staff(staff_id, can_delete)
        self.history_detail.set_my_staff(staff_id, can_delete)

    def set_connection(self, ok: bool, text: str) -> None:
        short = text.replace("● ", "")
        if "·" in short:
            head, tail = short.split("·", 1)
            short = f"{head.strip()}\n{tail.strip()}"
        self.connection.setText(f"● {short}")
        self.connection.setStyleSheet(f"color: {'#5DCAA5' if ok else '#F09595'};")

    def update_sound_button(self) -> None:
        enabled = self.controller.settings.sound_enabled
        self.sound_button.setChecked(enabled)
        self.sound_button.setText("🔔\n소리 켬" if enabled else "🔕\n소리 끔")

    def set_orders(self, orders: list[dict[str, Any]]) -> None:
        self.orders = orders
        entries = merge_orders(orders)
        self.entries = entries
        new_count = sum(1 for o in orders if state_of(o) == "new" and not o.get("cancelled"))
        entering = sum(1 for o in orders if state_of(o) == "entering")
        self.count_label.setText(f"신규 {new_count}건 대기" if new_count else "신규 발주 없음")
        self.stat_new.value.setText(str(new_count))
        self.stat_entering.value.setText(str(entering))
        self.rail_badge.setText(str(new_count))
        self.rail_badge.adjustSize()
        self.rail_badge.setVisible(new_count > 0)
        self.chip_all.setText(f"전체 {len(entries)}")
        self.chip_new.setText(f"신규 {sum(1 for e in entries if state_of(e) == 'new' and not e.get('cancelled'))}")
        self.chip_entering.setText(f"입력 중 {sum(1 for e in entries if state_of(e) == 'entering')}")
        self.tabs.setTabText(0, f"처리할 발주 ({len(entries)})")
        signature = tuple((e.get("id"), e.get("contentVersion"), (e.get("desk") or {}).get("revision"),
                           (e.get("desk") or {}).get("state")) for e in entries)
        if signature != self._entries_signature:
            self._entries_signature = signature
            self._refresh_date_filter()
            self._render_list()
        # 상세화면 최신화: 보고 있던 주문이 다른 주문과 합쳐졌으면 합친 화면으로
        current = self.detail.current_id()
        if current:
            base_id = current.split("bundle:", 1)[-1]
            fresh = next((e for e in entries if e.get("id") == current), None) or find_entry(entries, base_id)
            if fresh is None and self.detail.order and self.detail.order.get("isBundle"):
                for member in self.detail.order.get("memberIds") or []:
                    fresh = find_entry(entries, member)
                    if fresh:
                        break
            if fresh is not None:
                self.detail.set_order(fresh)
                self._select_in_list(str(fresh.get("id")))
                self._update_card_selection()
        if self._pending_open:
            self.open_order(self._pending_open)

    def _refresh_date_filter(self) -> None:
        current = self.date_filter.currentData()
        dates = sorted({str(o.get("deliveryDate", "")) for o in self.entries if o.get("deliveryDate")})
        self.date_filter.blockSignals(True)
        self.date_filter.clear()
        self.date_filter.addItem("📅 전체 배송일", "")
        for value in dates:
            count = sum(1 for o in self.entries if o.get("deliveryDate") == value)
            self.date_filter.addItem(f"배송 {delivery_label(value)} ({count})", value)
        index = self.date_filter.findData(current) if current else 0
        self.date_filter.setCurrentIndex(max(0, index))
        self.date_filter.blockSignals(False)

    def _filtered(self) -> list[dict[str, Any]]:
        query = self.search.text().strip()
        date_value = self.date_filter.currentData() or ""
        state_index = self.state_group.checkedId()
        result = []
        for entry in self.entries:
            if date_value and entry.get("deliveryDate") != date_value:
                continue
            state = state_of(entry)
            if state_index == 1 and (state != "new" or entry.get("cancelled")):
                continue
            if state_index == 2 and state != "entering":
                continue
            if not _matches(entry, query):
                continue
            result.append(entry)
        return sorted(result, key=_sort_key)

    def _group_toggled(self, checked: bool) -> None:
        self.controller.settings.group_by_customer = checked
        self.controller.save_settings()
        self._render_list()

    def _render_list(self) -> None:
        selected = self.detail.current_id()
        scroll = self.list.verticalScrollBar().value()
        entries = self._filtered()
        self.list.blockSignals(True)
        self.list.clear()
        if self.group_check.isChecked():
            groups: dict[str, list[dict[str, Any]]] = {}
            for entry in entries:
                groups.setdefault(f"{entry.get('customerCode', '')} {entry.get('customerName', '')}", []).append(entry)
            ordered = sorted(groups.items(), key=lambda kv: min(_sort_key(o) for o in kv[1]))
            for title, group in ordered:
                header = QListWidgetItem()
                header.setFlags(Qt.ItemFlag.NoItemFlags)
                label = QLabel(f"{title}  ·  {len(group)}건")
                label.setObjectName("GroupHeader")
                header.setSizeHint(label.sizeHint())
                self.list.addItem(header)
                self.list.setItemWidget(header, label)
                for entry in group:
                    self._add_card(entry)
        else:
            for entry in entries:
                self._add_card(entry)
        self.list.blockSignals(False)
        self.list.verticalScrollBar().setValue(scroll)
        if not entries:
            self.list_info.setText("🎉 처리할 발주가 없습니다." if not self.entries else "조건에 맞는 발주가 없습니다.")
        else:
            merged = sum(1 for e in entries if e.get("isBundle"))
            self.list_info.setText(f"{len(entries)}건 표시" + (f" · 합친 발주 {merged}건" if merged else "") + " · 오래된 발주가 위")
        if selected:
            self._select_in_list(selected)
        self._update_card_selection()

    def _add_card(self, entry: dict[str, Any]) -> None:
        item = QListWidgetItem()
        item.setData(Qt.ItemDataRole.UserRole, entry.get("id"))
        card = OrderCard(entry, self.my_staff_id)
        width = max(240, self.list.viewport().width() - 4)
        card.setFixedWidth(width)
        item.setSizeHint(QSize(width, card.sizeHint().height()))
        self.list.addItem(item)
        self.list.setItemWidget(item, card)

    def _select_in_list(self, entry_id: str) -> bool:
        for row in range(self.list.count()):
            item = self.list.item(row)
            if item.data(Qt.ItemDataRole.UserRole) == entry_id:
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
        entry_id = current.data(Qt.ItemDataRole.UserRole)
        entry = next((o for o in self.entries if o.get("id") == entry_id), None)
        if entry is not None:
            self.detail.set_order(entry)
            self._update_card_selection()

    def open_order(self, order_id: str) -> None:
        """알림 클릭 등으로 특정 주문(또는 그 주문이 들어 있는 합친 발주) 상세 열기."""
        self.tabs.setCurrentIndex(0)
        entry = find_entry(self.entries, order_id)
        if entry is None:
            self._pending_open = order_id
            self.controller.fetch_single(order_id)
            return
        self._pending_open = ""
        entry_id = str(entry.get("id"))
        if not self._select_in_list(entry_id):
            self.search.clear()
            self.date_filter.setCurrentIndex(0)
            self.chip_all.setChecked(True)
            self._render_list()
        self.detail.set_order(entry)
        self._select_in_list(entry_id)
        self._update_card_selection()

    def show_single(self, order: dict[str, Any]) -> None:
        """목록에 없는(이미 입력완료된) 주문을 처리내역 탭에서 보여줌."""
        self._pending_open = ""
        self.tabs.setCurrentIndex(1)
        self.history_detail.set_order(order)

    def after_action(self, order: dict[str, Any], action: str) -> None:
        self.after_actions([order] if order else [], action)

    def after_actions(self, updated: list[dict[str, Any]], action: str) -> None:
        """서버 처리 결과(주문들)를 화면에 바로 반영 (다음 동기화 전)."""
        updated = [o for o in updated if o and o.get("id")]
        ids = {str(o.get("id")) for o in updated}
        for order in updated:
            if self.history_detail.current_id() == str(order.get("id")):
                self.history_detail.set_order(order)
        current = self.detail.order
        current_ids = set((current or {}).get("memberIds") or [(current or {}).get("id")])
        finished = action == "done" and current is not None and current_ids & ids \
            and all(state_of(o) == "done" for o in updated if str(o.get("id")) in current_ids)
        next_entry = None
        if finished and self.tabs.currentIndex() == 0:
            remaining = [e for e in self._filtered() if not (set(e.get("memberIds") or [e.get("id")]) & ids)]
            next_entry = remaining[0] if remaining else None
        merged = [o for o in self.orders if str(o.get("id")) not in ids]
        merged += [o for o in updated if state_of(o) != "done"]
        if finished:
            self.detail.set_order(None)
        self.set_orders(merged)
        if finished:
            if next_entry is not None:
                fresh = next((e for e in self.entries if e.get("id") == next_entry.get("id")), next_entry)
                self.detail.set_order(fresh)
                self._select_in_list(str(fresh.get("id")))
                self._update_card_selection()
        elif current is not None and current_ids & ids:
            entry = find_entry(self.entries, next(iter(current_ids & ids)))
            if entry is not None:
                self.detail.set_order(entry)
                self._select_in_list(str(entry.get("id")))
                self._update_card_selection()

    def show_update_ready(self, version: str) -> None:
        self.update_button.setText(f"⬆ 새 버전 v{version} 설치")
        self.update_button.setToolTip("창을 닫아 두거나 다른 프로그램을 쓰는 동안 자동으로 설치됩니다. 지금 설치하려면 누르세요.")
        if not self.update_button.isVisible():
            self.status.addPermanentWidget(self.update_button)
            self.update_button.setVisible(True)

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
        button = self.nav_group.button(index)
        if button is not None and not button.isChecked():
            button.setChecked(True)
        self.page_title.setText("처리할 발주" if index == 0 else "처리내역")
        self.stats.setVisible(index == 0)
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
            if desk.get("deleted"):
                state_text = "삭제됨"
            elif order.get("cancelled"):
                state_text += " (취소된 주문)"
            kind = "추가 🚨" if order.get("isAdditional") else "신규"
            if order.get("priceGroup") == "B":
                kind += " · B그룹"
            if order.get("source") == "driver":
                kind += " · 🚚"
            who = desk.get("doneBy") if state == "done" else desk.get("enteringBy", "")
            when = desk.get("doneAt") if state == "done" else desk.get("enteringAt", "")
            values = [
                kst_datetime(str(order.get("createdAt", ""))),
                delivery_text(order),
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
    def eventFilter(self, watched, event) -> bool:  # noqa: N802
        from PySide6.QtCore import QEvent

        if watched is self.list.viewport() and event.type() == QEvent.Type.Resize and hasattr(self, "_resize_timer"):
            self._resize_timer.start(120)
        return super().eventFilter(watched, event)

    def resizeEvent(self, event) -> None:  # noqa: N802
        super().resizeEvent(event)
        if hasattr(self, "_resize_timer"):
            self._resize_timer.start(150)

    def closeEvent(self, event: QCloseEvent) -> None:  # noqa: N802
        self.controller.settings.window_geometry = bytes(self.saveGeometry().toBase64()).decode("ascii")
        self.controller.save_settings()
        if self.controller.quitting:
            event.accept()
            return
        event.ignore()
        self.hide()
        self.controller.on_window_hidden()


class _ChipIndex:
    """이전 코드에서 쓰던 state_filter.currentIndex()/setCurrentIndex() 를 칩 버튼으로 연결."""

    def __init__(self, group: QButtonGroup):
        self._group = group

    def currentIndex(self) -> int:  # noqa: N802
        return max(0, self._group.checkedId())

    def setCurrentIndex(self, index: int) -> None:  # noqa: N802
        button = self._group.button(index)
        if button is not None:
            button.setChecked(True)
