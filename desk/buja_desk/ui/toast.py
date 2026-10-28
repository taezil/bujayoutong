"""화면 오른쪽 아래 알림 팝업.

- 작업 중인 창의 입력 포커스를 빼앗지 않음 (WindowDoesNotAcceptFocus, ShowWithoutActivating)
- 정해진 시간이 지나면 자동으로 닫힘 (마우스를 올리면 멈춤)
- 동시에 최대 3개까지 쌓이고, 그 이상은 가장 오래된 것부터 닫힘
- 클릭하면 해당 주문 상세화면이 열림
"""
from __future__ import annotations

from typing import Callable

from PySide6.QtCore import QPoint, Qt, QTimer, Signal
from PySide6.QtGui import QGuiApplication, QMouseEvent
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget

from ..core.sync import Notice

MAX_TOASTS = 3
WIDTH = 380


class ToastWidget(QWidget):
    clicked = Signal(object)  # Notice
    closed = Signal(object)  # ToastWidget

    def __init__(self, notice: Notice, seconds: int):
        super().__init__(None, Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint | Qt.WindowType.WindowDoesNotAcceptFocus)
        self.notice = notice
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating, True)
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        self.setFixedWidth(WIDTH)
        self.setCursor(Qt.CursorShape.PointingHandCursor)

        frame = QFrame(self)
        frame.setObjectName("Toast")
        frame.setProperty("kind", notice.kind)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(frame)

        layout = QVBoxLayout(frame)
        layout.setContentsMargins(16, 12, 12, 12)
        layout.setSpacing(4)
        top = QHBoxLayout()
        title = QLabel(notice.title)
        title.setObjectName("ToastTitle")
        top.addWidget(title, 1)
        close = QPushButton("✕")
        close.setObjectName("ToastClose")
        close.setCursor(Qt.CursorShape.ArrowCursor)
        close.setToolTip("닫기")
        close.clicked.connect(self.close)
        top.addWidget(close, 0, Qt.AlignmentFlag.AlignTop)
        layout.addLayout(top)
        body = QLabel(notice.body)
        body.setObjectName("ToastBody")
        body.setWordWrap(True)
        layout.addWidget(body)
        hint = QLabel("클릭하면 주문 상세를 엽니다" if notice.order_id else "클릭하면 발주 목록을 엽니다")
        hint.setObjectName("ToastHint")
        layout.addWidget(hint)

        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self.close)
        self._seconds = seconds
        self._timer.start(seconds * 1000)
        self.adjustSize()

    def enterEvent(self, event) -> None:  # noqa: N802
        self._timer.stop()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:  # noqa: N802
        self._timer.start(max(4, self._seconds // 2) * 1000)
        super().leaveEvent(event)

    def mousePressEvent(self, event: QMouseEvent) -> None:  # noqa: N802
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit(self.notice)
            self.close()
        super().mousePressEvent(event)

    def closeEvent(self, event) -> None:  # noqa: N802
        self.closed.emit(self)
        super().closeEvent(event)


class ToastManager:
    def __init__(self, on_click: Callable[[Notice], None], seconds: Callable[[], int]):
        self._on_click = on_click
        self._seconds = seconds
        self._toasts: list[ToastWidget] = []

    def show(self, notice: Notice) -> None:
        toast = ToastWidget(notice, self._seconds())
        toast.clicked.connect(self._on_click)
        toast.closed.connect(self._forget)
        self._toasts.append(toast)
        while len(self._toasts) > MAX_TOASTS:
            oldest = self._toasts.pop(0)
            oldest.close()
        toast.show()
        self._layout()

    def clear(self) -> None:
        for toast in list(self._toasts):
            toast.close()
        self._toasts.clear()

    def _forget(self, toast: ToastWidget) -> None:
        if toast in self._toasts:
            self._toasts.remove(toast)
            self._layout()

    def _layout(self) -> None:
        screen = QGuiApplication.primaryScreen()
        if screen is None:
            return
        area = screen.availableGeometry()
        y = area.bottom() - 12
        for toast in reversed(self._toasts):
            toast.adjustSize()
            y -= toast.height()
            toast.move(QPoint(area.right() - WIDTH - 12, y))
            y -= 10
