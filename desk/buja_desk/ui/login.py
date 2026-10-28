"""직원 로그인 창 (아이디 + 6자리 PIN). 비밀번호/토큰은 프로그램에 들어 있지 않습니다."""
from __future__ import annotations

import socket

from PySide6.QtCore import Qt
from PySide6.QtGui import QIcon, QRegularExpressionValidator
from PySide6.QtCore import QRegularExpression
from PySide6.QtWidgets import (
    QDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout,
)

from .. import APP_NAME
from ..core.api import ApiError, DeskApi, StaffInfo
from .workers import Background


class LoginDialog(QDialog):
    def __init__(self, server_url: str, background: Background, *, username: str = "", device_name: str = "",
                 message: str = "", icon: QIcon | None = None, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"{APP_NAME} - 로그인")
        if icon is not None:
            self.setWindowIcon(icon)
        self.setMinimumWidth(440)
        self._server_url = server_url
        self._background = background
        self.token = ""
        self.staff: StaffInfo | None = None

        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 24, 28, 24)
        layout.setSpacing(14)
        title = QLabel("부자유통 발주 알림센터")
        title.setStyleSheet("font-size: 17pt; font-weight: 900;")
        layout.addWidget(title)
        guide = QLabel("부자유통 직원 아이디와 6자리 PIN으로 로그인해 주세요.\n(배송기사 앱/관리자 화면에서 쓰는 직원 계정과 같습니다)")
        guide.setWordWrap(True)
        guide.setStyleSheet("color: #5F6B7A;")
        layout.addWidget(guide)

        form = QFormLayout()
        form.setSpacing(10)
        self.username = QLineEdit(username)
        self.username.setPlaceholderText("예: lee")
        self.pin = QLineEdit()
        self.pin.setEchoMode(QLineEdit.EchoMode.Password)
        self.pin.setMaxLength(6)
        self.pin.setValidator(QRegularExpressionValidator(QRegularExpression(r"\d{0,6}"), self))
        self.pin.setPlaceholderText("숫자 6자리")
        self.device = QLineEdit(device_name or socket.gethostname()[:40])
        self.device.setMaxLength(40)
        self.device.setToolTip("처리자 기록에 함께 남는 PC 이름입니다. 예: 사무실1")
        form.addRow("아이디", self.username)
        form.addRow("PIN", self.pin)
        form.addRow("PC 이름", self.device)
        layout.addLayout(form)

        self.error = QLabel(message)
        self.error.setWordWrap(True)
        self.error.setStyleSheet("color: #C92A2A; font-weight: 700;")
        self.error.setVisible(bool(message))
        layout.addWidget(self.error)

        buttons = QHBoxLayout()
        buttons.addStretch(1)
        self.cancel_button = QPushButton("닫기")
        self.cancel_button.clicked.connect(self.reject)
        self.login_button = QPushButton("로그인")
        self.login_button.setObjectName("Start")
        self.login_button.setDefault(True)
        self.login_button.clicked.connect(self._submit)
        buttons.addWidget(self.cancel_button)
        buttons.addWidget(self.login_button)
        layout.addLayout(buttons)

        server = QLabel(f"서버: {server_url}")
        server.setStyleSheet("color: #8A94A3; font-size: 9pt;")
        layout.addWidget(server)
        (self.pin if username else self.username).setFocus(Qt.FocusReason.OtherFocusReason)

    def _submit(self) -> None:
        username = self.username.text().strip()
        pin = self.pin.text().strip()
        device = self.device.text().strip() or socket.gethostname()[:40]
        if not username or len(pin) != 6:
            self._show_error("아이디와 PIN 6자리를 입력해 주세요.")
            return
        self.login_button.setEnabled(False)
        self.login_button.setText("확인 중...")
        self.error.setVisible(False)
        api = DeskApi(self._server_url)

        def done(result, error) -> None:
            self.login_button.setEnabled(True)
            self.login_button.setText("로그인")
            if error is not None:
                self.pin.clear()
                self._show_error(str(error) if isinstance(error, ApiError) else f"로그인 오류: {error}")
                return
            self.token, self.staff = result
            self.accept()

        self._background.run(lambda: api.login(username, pin, device), done)

    def _show_error(self, text: str) -> None:
        self.error.setText(text)
        self.error.setVisible(True)

    @property
    def device_name(self) -> str:
        return self.device.text().strip()
