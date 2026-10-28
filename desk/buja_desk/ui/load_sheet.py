"""상차준비표 출력 창.

배송일 · 구역 · 배송 시간(오전/오후 1차·2차)을 고르면 구역별로 묶은 상차준비표를 만들어
기본 브라우저로 열고 인쇄 창을 띄웁니다. (구역마다 새 쪽, 창고 위치 순서)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from PySide6.QtCore import QDate, QUrl, Qt
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDateEdit, QDialog, QFrame, QHBoxLayout, QLabel, QPushButton, QVBoxLayout,
)

from ..core.loadsheet import UNASSIGNED, SheetOptions, build_sheets, render_html
from ..core.model import KST, today_kst

if TYPE_CHECKING:  # pragma: no cover
    from .app import DeskController

log = logging.getLogger(__name__)


def default_date() -> QDate:
    """오후 3시가 지나면 내일 배송분을 기본으로."""
    now = datetime.now(KST)
    day = now.date() + timedelta(days=1) if now.hour >= 15 else now.date()
    return QDate(day.year, day.month, day.day)


class LoadSheetDialog(QDialog):
    def __init__(self, controller: "DeskController", parent=None):
        super().__init__(parent)
        self.controller = controller
        self.data: dict[str, Any] | None = None
        self.setWindowTitle("상차준비표 출력")
        self.setMinimumWidth(560)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(22, 20, 22, 18)
        layout.setSpacing(12)
        title = QLabel("🧾 상차준비표")
        title.setObjectName("PageTitle")
        layout.addWidget(title)
        hint = QLabel("구역 발주를 모두 합쳐 창고 위치 순서로 뽑습니다. 구역마다 새 쪽에서 시작합니다.")
        hint.setObjectName("PageSub")
        hint.setWordWrap(True)
        layout.addWidget(hint)

        row = QHBoxLayout()
        self.date_edit = QDateEdit(default_date())
        self.date_edit.setCalendarPopup(True)
        self.date_edit.setDisplayFormat("yyyy-MM-dd (ddd)")
        self.date_edit.dateChanged.connect(lambda _: self.reload())
        today = QPushButton("오늘")
        today.setObjectName("Chip")
        today.clicked.connect(lambda: self._set_day(0))
        tomorrow = QPushButton("내일")
        tomorrow.setObjectName("Chip")
        tomorrow.clicked.connect(lambda: self._set_day(1))
        row.addWidget(QLabel("배송일"))
        row.addWidget(self.date_edit, 1)
        row.addWidget(today)
        row.addWidget(tomorrow)
        layout.addLayout(row)

        row2 = QHBoxLayout()
        self.zone_combo = QComboBox()
        self.zone_combo.currentIndexChanged.connect(lambda _: self.update_summary())
        self.slot_combo = QComboBox()
        for label, value in (("오전·오후 전체", ("all", 0)), ("오전 배송", ("AM", 0)), ("오후 배송 전체", ("PM", 0)),
                             ("오후 1차", ("PM", 1)), ("오후 2차", ("PM", 2))):
            self.slot_combo.addItem(label, value)
        self.slot_combo.currentIndexChanged.connect(lambda _: self.update_summary())
        row2.addWidget(QLabel("구역"))
        row2.addWidget(self.zone_combo, 1)
        row2.addWidget(QLabel("배송 시간"))
        row2.addWidget(self.slot_combo, 1)
        layout.addLayout(row2)

        self.only_new = QCheckBox("상차준비표를 아직 뽑지 않은 발주만 (나중에 들어온 추가분)")
        self.only_new.toggled.connect(lambda _: self.update_summary())
        layout.addWidget(self.only_new)
        self.include_customers = QCheckBox("마지막에 거래처별 확인표 붙이기")
        self.include_customers.setChecked(True)
        layout.addWidget(self.include_customers)

        box = QFrame()
        box.setObjectName("InfoBox")
        box_layout = QVBoxLayout(box)
        box_layout.setContentsMargins(14, 12, 14, 12)
        self.summary = QLabel("불러오는 중…")
        self.summary.setWordWrap(True)
        self.summary.setTextFormat(Qt.TextFormat.RichText)
        box_layout.addWidget(self.summary)
        layout.addWidget(box)

        buttons = QHBoxLayout()
        reload_button = QPushButton("⟳ 다시 불러오기")
        reload_button.setObjectName("Secondary")
        reload_button.clicked.connect(self.reload)
        close = QPushButton("닫기")
        close.setObjectName("Secondary")
        close.clicked.connect(self.reject)
        self.print_button = QPushButton("🖨 인쇄하기")
        self.print_button.setObjectName("Primary")
        self.print_button.clicked.connect(self.print_sheet)
        buttons.addWidget(reload_button)
        buttons.addStretch(1)
        buttons.addWidget(close)
        buttons.addWidget(self.print_button)
        layout.addLayout(buttons)
        self.reload()

    def _set_day(self, offset: int) -> None:
        day = today_kst() + timedelta(days=offset)
        self.date_edit.setDate(QDate(day.year, day.month, day.day))

    def date_text(self) -> str:
        return self.date_edit.date().toString("yyyy-MM-dd")

    def options(self) -> SheetOptions:
        slot, run = self.slot_combo.currentData() or ("all", 0)
        return SheetOptions(self.date_text(), zone=str(self.zone_combo.currentData() or ""), slot=slot, run=int(run),
                            only_new=self.only_new.isChecked(), include_customers=self.include_customers.isChecked())

    def reload(self) -> None:
        self.summary.setText("불러오는 중…")
        self.print_button.setEnabled(False)
        api = self.controller.api()
        day = self.date_text()

        def done(result, error) -> None:
            if day != self.date_text():
                return
            if error is not None:
                self.data = None
                self.summary.setText(f"<span style='color:#A32D2D'>불러오지 못했습니다: {error}</span>")
                return
            self.data = result
            self._fill_zones()
            self.update_summary()

        self.controller.background.run(lambda: api.load_sheet(day), done)

    def _fill_zones(self) -> None:
        current = self.zone_combo.currentData()
        self.zone_combo.blockSignals(True)
        self.zone_combo.clear()
        self.zone_combo.addItem("전체 구역 (구역마다 새 쪽)", "")
        for zone in (self.data or {}).get("zones") or []:
            self.zone_combo.addItem(zone, zone)
        self.zone_combo.addItem("구역 미지정 거래처", UNASSIGNED)
        index = self.zone_combo.findData(current) if current is not None else 0
        self.zone_combo.setCurrentIndex(max(0, index))
        self.zone_combo.blockSignals(False)

    def update_summary(self) -> None:
        if not self.data:
            return
        sheets = build_sheets(self.data, self.options())
        if not sheets:
            self.summary.setText("<b>출력할 발주가 없습니다.</b><br>배송일·구역·배송 시간을 확인해 주세요.")
            self.print_button.setEnabled(False)
            return
        lines = [f"<b>{sheet.zone}</b> · 거래처 {sheet.customer_count}곳 · 발주 {len(sheet.order_ids)}건 · 품목 {sheet.line_count}줄"
                 for sheet in sheets]
        total = sum(len(sheet.order_ids) for sheet in sheets)
        self.summary.setText("<br>".join(lines) + f"<br><span style='color:#66707A'>모두 {len(sheets)}개 구역 · 발주 {total}건</span>")
        self.print_button.setEnabled(True)

    def print_sheet(self) -> None:
        if not self.data:
            return
        options = self.options()
        sheets = build_sheets(self.data, options)
        if not sheets:
            return
        staff = self.controller.staff.display_name if self.controller.staff else ""
        html_text = render_html(sheets, options, staff_name=staff)
        folder = Path(self.controller.directory) / "prints"
        folder.mkdir(parents=True, exist_ok=True)
        # 예전 출력 파일은 정리 (거래처 정보가 PC에 오래 남지 않게)
        for old in folder.glob("상차준비표-*.html"):
            try:
                if datetime.now().timestamp() - old.stat().st_mtime > 3 * 86400:
                    old.unlink()
            except OSError:
                pass
        path = folder / f"상차준비표-{options.delivery_date}-{datetime.now():%H%M%S}.html"
        path.write_text(html_text, encoding="utf-8")
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))
        ids = [order_id for sheet in sheets for order_id in sheet.order_ids]
        label = f"{options.delivery_date} {self.zone_combo.currentText()} {self.slot_combo.currentText()}"
        api = self.controller.api()
        self.controller.background.run(lambda: api.mark_load_printed(ids, label), lambda *_: None)
        self.summary.setText(self.summary.text() + "<br><b style='color:#0F6E56'>브라우저에서 인쇄 창이 열립니다.</b>")
