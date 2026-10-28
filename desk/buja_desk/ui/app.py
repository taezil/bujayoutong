"""프로그램 본체: 트레이 상주, 로그인, 동기화 스레드, 알림 팝업/소리, 처리상태 변경."""
from __future__ import annotations

import logging
import os
import sys
from typing import Any

from PySide6.QtCore import QObject, QRect, Qt, QThread, QTimer, QUrl, Signal, Slot
from PySide6.QtGui import QAction, QColor, QDesktopServices, QFont, QGuiApplication, QIcon, QPainter, QPixmap
from PySide6.QtNetwork import QLocalServer, QLocalSocket
from PySide6.QtWidgets import QApplication, QMenu, QMessageBox, QSystemTrayIcon

from .. import APP_ID, APP_NAME, __version__
from ..core.api import ApiError, AuthError, ConflictError, DeskApi, NetworkError, StaffInfo
from ..core.model import kst_time, order_as_text, state_of
from ..core.paths import data_dir, resource_path
from ..core.storage import NotificationLog, SettingsStore, TokenStore
from ..core.sync import Notice, SyncResult
from . import autostart, sound
from ..core import updater
from .login import LoginDialog
from .main_window import MainWindow
from .theme import COLORS, STYLESHEET
from .toast import ToastManager
from .workers import Background, SyncWorker

log = logging.getLogger(__name__)
SINGLE_INSTANCE_KEY = f"{APP_ID}-{os.environ.get('USERNAME') or os.environ.get('USER') or 'user'}"


def updater_supported() -> bool:
    import sys as _sys

    return _sys.platform == "win32" and bool(getattr(_sys, "frozen", False))


def base_icon() -> QIcon:
    path = resource_path("assets", "icon.png")
    icon = QIcon(str(path)) if path.exists() else QIcon()
    if icon.isNull():
        pixmap = QPixmap(64, 64)
        pixmap.fill(QColor(COLORS["brand"]))
        icon = QIcon(pixmap)
    return icon


def badge_icon(base: QIcon, count: int, alert: bool) -> QIcon:
    pixmap = base.pixmap(64, 64)
    if count <= 0 and not alert:
        return QIcon(pixmap)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.setBrush(QColor(COLORS["danger"] if count else "#E8A400"))
    painter.setPen(QColor("white"))
    painter.drawEllipse(26, 0, 38, 38)
    font = QFont()
    font.setBold(True)
    font.setPointSize(16 if count < 10 else 12)
    painter.setFont(font)
    painter.drawText(QRect(26, 0, 38, 38), Qt.AlignmentFlag.AlignCenter, (str(count) if count < 100 else "99+") if count else "!")
    painter.end()
    return QIcon(pixmap)


class DeskController(QObject):
    setToken = Signal(str)
    refreshRequested = Signal()
    stopSync = Signal()

    def __init__(self, app: QApplication, *, start_minimized: bool = False):
        super().__init__()
        self.app = app
        self.quitting = False
        self.directory = data_dir()
        self.settings_store = SettingsStore(self.directory)
        self.token_store = TokenStore(self.directory)
        self.notification_log = NotificationLog(self.directory)
        self.background = Background(self)
        self.token = self.token_store.load()
        self.staff: StaffInfo | None = None
        self.connected = False
        self.last_sync = 0.0
        self.open_orders: list[dict[str, Any]] = []
        self._sync_thread: QThread | None = None
        self._sync_worker: SyncWorker | None = None
        self._login_open = False
        self._busy = False
        self.last_error = ""

        self.icon = base_icon()
        app.setWindowIcon(self.icon)
        self.window = MainWindow(self, self.icon)
        self.toasts = ToastManager(self._toast_clicked, lambda: self.settings.popup_seconds)
        self._build_tray()
        self._start_minimized = start_minimized
        self._status_timer = QTimer(self)
        self._status_timer.timeout.connect(self._refresh_connection_label)
        self._status_timer.start(1000)
        autostart.refresh_path_if_enabled()
        # 자동 업데이트: 시작 30초 후, 이후 3시간마다 확인. 내려받은 뒤 업무에 방해되지 않을 때 설치
        self._update_file: str = ""
        self._update_version = ""
        self._update_checking = False
        self._update_timer = QTimer(self)
        self._update_timer.timeout.connect(lambda: self.check_update(manual=False))
        self._install_timer = QTimer(self)
        self._install_timer.timeout.connect(self._try_install_update)
        if updater_supported():
            QTimer.singleShot(30_000, lambda: self.check_update(manual=False))
            self._update_timer.start(3 * 60 * 60 * 1000)
            self._install_timer.start(60_000)

    # ---------- 설정 ----------
    @property
    def settings(self):
        return self.settings_store.settings

    def save_settings(self) -> None:
        try:
            self.settings_store.save()
        except OSError:
            log.exception("설정 저장 실패")

    def set_sound(self, enabled: bool) -> None:
        self.settings.sound_enabled = bool(enabled)
        self.save_settings()
        self.window.update_sound_button()
        self._sync_tray_menu()

    def set_popup(self, enabled: bool) -> None:
        self.settings.popup_enabled = bool(enabled)
        self.save_settings()

    def set_reminder(self, enabled: bool) -> None:
        self.settings.reminder_enabled = bool(enabled)
        self.save_settings()

    def autostart_supported(self) -> bool:
        return autostart.supported()

    def autostart_enabled(self) -> bool:
        return autostart.is_enabled()

    def set_autostart(self, enabled: bool) -> None:
        if not autostart.set_enabled(bool(enabled)):
            self.window.show_message("자동 실행 설정을 바꾸지 못했습니다.")

    # ---------- 시작 / 로그인 ----------
    def start(self) -> None:
        if not self._start_minimized or self.settings.reopen_after_update:
            self.show_window()
        if self.settings.reopen_after_update:
            self.settings.reopen_after_update = False
            self.save_settings()
        if "--updated" in self.app.arguments():
            self.toasts.show(Notice("summary", f"v{__version__} 으로 업데이트되었습니다",
                                    "발주 알림은 계속 정상적으로 받습니다.", [], sound=False))
        if self.token:
            self._start_sync()
        else:
            QTimer.singleShot(0, lambda: self.require_login(""))

    def require_login(self, message: str) -> None:
        if self._login_open or self.quitting:
            return
        self._login_open = True
        self._stop_sync()
        self.show_window()
        dialog = LoginDialog(self.settings.server_url, self.background, username=self.settings.last_username,
                             device_name=self.settings.device_name, message=message, icon=self.icon, parent=self.window)
        accepted = bool(dialog.exec())
        self._login_open = False
        if not accepted or not dialog.token:
            if not self.token:
                answer = QMessageBox.question(self.window, APP_NAME,
                                              "로그인하지 않으면 발주 알림을 받을 수 없습니다.\n프로그램을 종료할까요?")
                if answer == QMessageBox.StandardButton.Yes:
                    self.quit()
                else:
                    QTimer.singleShot(0, lambda: self.require_login(""))
            return
        self.token = dialog.token
        self.staff = dialog.staff
        self.settings.last_username = dialog.username.text().strip()
        self.settings.device_name = dialog.device_name
        self.save_settings()
        try:
            self.token_store.save(self.token)
        except OSError:
            log.exception("로그인 정보 저장 실패")
            self.window.show_message("로그인 정보를 PC에 저장하지 못했습니다. 프로그램을 다시 켜면 다시 로그인해야 합니다.")
        self._apply_staff()
        self._start_sync()

    def _apply_staff(self) -> None:
        if self.staff:
            device = f" · {self.staff.device_name}" if self.staff.device_name else ""
            self.window.set_staff(self.staff.id, f"{self.staff.display_name}{device}", can_delete=self.staff.role == "ADMIN")

    def logout(self) -> None:
        answer = QMessageBox.question(self.window, APP_NAME, "로그아웃하고 다른 직원으로 로그인할까요?\n로그아웃 중에는 발주 알림이 오지 않습니다.")
        if answer != QMessageBox.StandardButton.Yes:
            return
        token = self.token
        self.token = ""
        self.token_store.clear()
        self._stop_sync()
        self.window.set_orders([])
        api = DeskApi(self.settings.server_url, token)
        self.background.run(api.logout, lambda *_: None)
        self.require_login("")

    # ---------- 동기화 ----------
    def _start_sync(self) -> None:
        if self._sync_worker is not None:
            self.setToken.emit(self.token)
            return
        thread = QThread(self)
        worker = SyncWorker(self.settings.server_url, self.token, self.notification_log,
                            lambda: self.settings.poll_seconds,
                            lambda: self.settings.reminder_minutes if self.settings.reminder_enabled else None)
        worker.moveToThread(thread)
        thread.started.connect(worker.start)
        worker.resultReady.connect(self._on_sync_result)
        self.setToken.connect(worker.set_token)
        self.refreshRequested.connect(worker.refresh_now)
        self.stopSync.connect(worker.stop)
        thread.start()
        self._sync_thread = thread
        self._sync_worker = worker

    def _stop_sync(self) -> None:
        if self._sync_worker is not None:
            self.stopSync.emit()

    def request_refresh(self) -> None:
        if self._sync_worker is None:
            return
        self.refreshRequested.emit()

    @Slot(object)
    def _on_sync_result(self, result: SyncResult) -> None:
        if result.auth_required:
            self.connected = False
            self.token = ""
            self.token_store.clear()
            self._refresh_connection_label()
            QTimer.singleShot(0, lambda: self.require_login(result.error or "로그인이 만료되었습니다. 다시 로그인해 주세요."))
            return
        was_connected = self.connected
        self.connected = result.connected
        if result.connected:
            self.last_sync = result.synced_at
            if result.staff and (self.staff is None or self.staff.id != result.staff.id or self.staff.device_name != result.staff.device_name):
                self.staff = result.staff
                self._apply_staff()
        else:
            self.last_error = result.error
            if was_connected:
                self.window.show_message(f"서버 연결이 끊겼습니다. 자동으로 다시 연결합니다. ({result.error})", seconds=15)
        if result.today_received is not None:
            self.window.set_today_stats(int(result.today_received or 0), int(result.today_done or 0))
        if result.orders is not None:
            self.open_orders = result.orders
            self.window.set_orders(result.orders)
            self._update_tray()
        for notice in result.notices:
            self.notify(notice)
        self._refresh_connection_label()

    def _refresh_connection_label(self) -> None:
        import time

        if self.connected and self.last_sync:
            age = int(time.time() - self.last_sync)
            text = f"● 연결됨 · {age}초 전 확인" if age < 60 else f"● 연결됨 · {age // 60}분 전 확인"
            self.window.set_connection(age < 90, text if age < 90 else "● 응답 지연 · 확인 중")
        elif self.token:
            self.window.set_connection(False, "● 연결 끊김 · 다시 연결 중")
        else:
            self.window.set_connection(False, "● 로그인 필요")

    # ---------- 알림 ----------
    def notify(self, notice: Notice) -> None:
        log.info("알림: %s / %s", notice.title, notice.order_ids)
        if self.settings.popup_enabled:
            self.toasts.show(notice)
        if self.settings.sound_enabled and notice.sound:
            sound.play_alert(notice.kind)
        if self.window.isVisible():
            QApplication.alert(self.window, 0)
        self._update_tray(alert=True)

    def _toast_clicked(self, notice: Notice) -> None:
        self.show_window()
        if notice.order_id:
            self.window.open_order(notice.order_id)
            self._refresh_one(notice.order_id)
        else:
            self.window.tabs.setCurrentIndex(0)
            if notice.order_ids:
                self.window.open_order(notice.order_ids[0])

    def test_notification(self) -> None:
        self.notify(Notice("new", "🚨 알림 테스트", "알림음과 팝업이 정상입니다.\n이 알림은 테스트입니다.", []))

    # ---------- 트레이 ----------
    def _build_tray(self) -> None:
        self.tray = QSystemTrayIcon(self.icon, self)
        menu = QMenu()
        open_action = QAction("발주 알림센터 열기", menu)
        open_action.triggered.connect(self.show_window)
        menu.addAction(open_action)
        self.tray_sound = QAction("알림음 켜기", menu)
        self.tray_sound.setCheckable(True)
        self.tray_sound.toggled.connect(self.set_sound)
        menu.addAction(self.tray_sound)
        menu.addSeparator()
        quit_action = QAction("프로그램 종료", menu)
        quit_action.triggered.connect(self.quit_with_confirm)
        menu.addAction(quit_action)
        self.tray.setContextMenu(menu)
        self._tray_menu = menu
        self.tray.activated.connect(self._tray_activated)
        self.tray.setToolTip(APP_NAME)
        self._sync_tray_menu()
        if QSystemTrayIcon.isSystemTrayAvailable():
            self.tray.show()

    def _sync_tray_menu(self) -> None:
        self.tray_sound.blockSignals(True)
        self.tray_sound.setChecked(self.settings.sound_enabled)
        self.tray_sound.blockSignals(False)

    def _tray_activated(self, reason) -> None:
        if reason in (QSystemTrayIcon.ActivationReason.Trigger, QSystemTrayIcon.ActivationReason.DoubleClick):
            self.show_window()

    def _update_tray(self, alert: bool = False) -> None:
        new_count = sum(1 for o in self.open_orders if state_of(o) == "new" and not o.get("cancelled"))
        attention = sum(1 for o in self.open_orders if o.get("cancelled"))
        self.tray.setIcon(badge_icon(self.icon, new_count, attention > 0))
        tip = f"{APP_NAME}\n신규 {new_count}건 · 처리할 발주 {len(self.open_orders)}건"
        self.tray.setToolTip(tip)
        self.window.setWindowTitle(f"({new_count}) {APP_NAME}" if new_count else APP_NAME)

    def show_window(self) -> None:
        self.window.showNormal() if self.window.isMinimized() else self.window.show()
        self.window.raise_()
        self.window.activateWindow()

    def on_window_hidden(self) -> None:
        if not self.settings.first_close_notice_shown:
            self.settings.first_close_notice_shown = True
            self.save_settings()
            self.toasts.show(Notice("summary", "발주 알림센터는 계속 실행 중입니다",
                                    "창을 닫아도 오른쪽 아래 트레이에서 발주 알림을 받습니다.\n완전히 끄려면 [설정 ▾ → 프로그램 종료]를 누르세요.", [],
                                    sound=False))

    # ---------- 처리상태 변경 ----------
    def api(self) -> DeskApi:
        return DeskApi(self.settings.server_url, self.token)

    def _find_entry(self, entry_id: str) -> dict[str, Any]:
        for source in (self.window.entries, self.open_orders):
            found = next((o for o in source if o.get("id") == entry_id), None)
            if found is not None:
                return found
        if self.window.detail.current_id() == entry_id and self.window.detail.order:
            return self.window.detail.order
        if self.window.history_detail.current_id() == entry_id and self.window.history_detail.order:
            return self.window.history_detail.order
        return {}

    def change_state(self, action: str, order_id: str, force: bool) -> None:
        if self._busy:
            return
        order = self._find_entry(order_id)
        desk = order.get("desk") or {}
        if action == "delete":
            self._delete_order(order_id, order)
            return
        if order.get("isBundle"):
            self._change_bundle(action, order, force)
            return
        if force:
            who = desk.get("enteringBy") or "다른 직원"
            verb = {"start": "이어받아 입력", "done": "입력완료로 처리", "release": "입력 중 해제"}.get(action, "처리")
            answer = QMessageBox.question(self.window, APP_NAME,
                                          f"{who}님이 입력 중인 주문입니다.\n중복 입력이 아닌지 확인한 뒤 진행하세요.\n\n{verb}할까요?")
            if answer != QMessageBox.StandardButton.Yes:
                return
        if action == "reopen":
            answer = QMessageBox.question(self.window, APP_NAME, "입력완료를 취소하고 다시 '신규'로 돌릴까요?\n(처리할 발주 목록으로 돌아갑니다)")
            if answer != QMessageBox.StandardButton.Yes:
                return
        self._busy = True
        self.window.set_busy(True)
        api = self.api()

        def done(result, error) -> None:
            self._busy = False
            self.window.set_busy(False)
            if isinstance(error, ConflictError):
                latest = error.payload.get("order")
                if isinstance(latest, dict):
                    self.window.after_action(latest, "conflict")
                QMessageBox.information(self.window, APP_NAME, str(error))
                self.request_refresh()
                return
            if isinstance(error, AuthError):
                self.require_login(str(error))
                return
            if isinstance(error, NetworkError):
                QMessageBox.warning(self.window, APP_NAME, f"서버에 연결하지 못해 처리하지 못했습니다.\n인터넷 연결을 확인한 뒤 다시 눌러 주세요.\n\n({error})")
                return
            if error is not None:
                QMessageBox.warning(self.window, APP_NAME, f"처리하지 못했습니다.\n{error}")
                return
            latest = result.get("order") or {}
            self.window.after_action(latest, action)
            name = latest.get("customerName", "")
            if action == "done":
                text = f"{name} 입력완료 처리했습니다." if not result.get("alreadyDone") else f"{name}: 이미 입력완료된 주문입니다."
                self.window.show_message(text, undo=None if result.get("alreadyDone") else (lambda: self._undo_done(order_id)))
            elif action == "start":
                self.window.show_message(f"{name} 입력 시작 ({kst_time((latest.get('desk') or {}).get('enteringAt', ''))}). 다른 PC에도 '입력 중'으로 표시됩니다.")
            elif action == "release":
                self.window.show_message(f"{name} 입력 중 표시를 해제했습니다.")
            elif action == "reopen":
                self.window.show_message(f"{name} 입력완료를 취소했습니다. 처리할 발주 목록에 다시 표시됩니다.")
                if self.window.tabs.currentIndex() == 1:
                    self.window.search_history()
            self.request_refresh()

        self.background.run(lambda: api.change_state(order_id, action, force), done)

    def _change_bundle(self, action: str, entry: dict[str, Any], force: bool) -> None:
        """합친 발주: 안에 든 주문 전체에 같은 작업을 한 번에 적용."""
        ids = list(entry.get("memberIds") or [])
        count = len(ids)
        if force:
            who = (entry.get("desk") or {}).get("enteringBy") or "다른 직원"
            answer = QMessageBox.question(self.window, APP_NAME, f"{who}님이 입력 중인 발주입니다.\n중복 입력이 아닌지 확인한 뒤 진행할까요?")
            if answer != QMessageBox.StandardButton.Yes:
                return
        self._busy = True
        self.window.set_busy(True)
        api = self.api()

        def done(results, error) -> None:
            self._busy = False
            self.window.set_busy(False)
            if isinstance(error, AuthError):
                self.require_login(str(error))
                return
            if error is not None:
                QMessageBox.warning(self.window, APP_NAME, f"처리하지 못했습니다.\n인터넷 연결을 확인한 뒤 다시 눌러 주세요.\n\n({error})")
                self.request_refresh()
                return
            updated = [r.get("order") for r in results if isinstance(r.get("order"), dict)]
            failed = [r for r in results if not r.get("ok")]
            self.window.after_actions(updated, action)
            name = entry.get("customerName", "")
            if failed:
                QMessageBox.information(self.window, APP_NAME,
                                        f"{count}건 중 {count - len(failed)}건만 처리했습니다.\n\n" + "\n".join(f"· {r.get('error')}" for r in failed))
            elif action == "done":
                self.window.show_message(f"{name} 합친 발주 {count}건을 입력완료 처리했습니다.", undo=lambda: self._undo_many(ids))
            elif action == "start":
                self.window.show_message(f"{name} 합친 발주 {count}건 입력 시작. 다른 PC에도 '입력 중'으로 표시됩니다.")
            elif action == "release":
                self.window.show_message(f"{name} 입력 중 표시를 해제했습니다.")
            self.request_refresh()

        self.background.run(lambda: api.change_many(ids, action, force), done)

    def _undo_many(self, ids: list[str]) -> None:
        api = self.api()

        def done(results, error) -> None:
            if error is not None:
                QMessageBox.warning(self.window, APP_NAME, f"되돌리지 못했습니다.\n{error}")
                return
            self.window.after_actions([r.get("order") for r in results if isinstance(r.get("order"), dict)], "reopen")
            if ids:
                self.window.open_order(ids[0])
            self.window.show_message("입력완료를 되돌렸습니다.")
            self.request_refresh()

        self.background.run(lambda: api.change_many(ids, "reopen"), done)

    def _delete_order(self, order_id: str, order: dict[str, Any]) -> None:
        from PySide6.QtWidgets import QInputDialog, QLineEdit

        desk = order.get("desk") or {}
        ids = list(order.get("memberIds") or [order_id])
        who = f"{order.get('customerCode', '')} {order.get('customerName', '')}".strip()
        if len(ids) > 1:
            who += f" (합친 발주 {len(ids)}건 모두)"
        warn = ""
        if desk.get("state") == "entering" and desk.get("enteringById") != (self.staff.id if self.staff else ""):
            warn = f"\n⚠ {desk.get('enteringBy') or '다른 직원'}님이 입력 중인 주문입니다."
        reason, ok = QInputDialog.getText(
            self.window, "발주 삭제",
            f"{who} 발주를 삭제할까요?{warn}\n\n· 모든 PC 목록에서 빠지고 처리내역에 '삭제됨'으로 남습니다.\n· 거래처 주문내역에서도 취소로 바뀝니다.\n· 얼마에요에 이미 입력했다면 그쪽도 정리해 주세요.\n\n삭제 사유 (선택):",
            QLineEdit.EchoMode.Normal, "")
        if not ok:
            return
        self._busy = True
        self.window.set_busy(True)
        api = self.api()

        def done(result, error) -> None:
            self._busy = False
            self.window.set_busy(False)
            if isinstance(error, AuthError):
                self.require_login(str(error))
                return
            if error is not None:
                QMessageBox.warning(self.window, APP_NAME, f"삭제하지 못했습니다.\n{error}")
                self.request_refresh()
                return
            updated = [r.get("order") for r in result if isinstance(r.get("order"), dict)]
            failed = [r for r in result if not r.get("ok")]
            self.window.after_actions(updated, "done")
            if failed:
                QMessageBox.information(self.window, APP_NAME, "일부 발주를 삭제하지 못했습니다.\n\n" + "\n".join(f"· {r.get('error')}" for r in failed))
            else:
                self.window.show_message(f"{order.get('customerName', '')} 발주 {len(ids)}건을 삭제했습니다." if len(ids) > 1 else f"{order.get('customerName', '')} 발주를 삭제했습니다.")
            if self.window.tabs.currentIndex() == 1:
                self.window.search_history()
            self.request_refresh()

        self.background.run(lambda: api.change_many(ids, "delete", False, reason.strip()), done)

    def _refresh_one(self, order_id: str) -> None:
        """알림을 눌렀을 때 그 주문의 최신 상태(다른 PC에서 '입력 중'인지)를 바로 받아 표시."""
        api = self.api()

        def done(result, error) -> None:
            current = self.window.detail.order or {}
            if error is None and result and (current.get("id") == order_id or order_id in (current.get("memberIds") or [])):
                self.window.after_action(result, "refresh")

        self.background.run(lambda: api.order(order_id), done)

    def _undo_done(self, order_id: str) -> None:
        api = self.api()

        def done(result, error) -> None:
            if error is not None:
                QMessageBox.warning(self.window, APP_NAME, f"되돌리지 못했습니다.\n{error}")
                return
            self.window.after_action(result.get("order") or {}, "reopen")
            self.window.open_order(order_id)
            self.window.show_message("입력완료를 되돌렸습니다.")
            self.request_refresh()

        self.background.run(lambda: api.change_state(order_id, "reopen"), done)

    def copy_order(self, order: dict[str, Any]) -> None:
        QGuiApplication.clipboard().setText(order_as_text(order))
        self.window.show_message("주문 내용을 복사했습니다. (메모장 등에 붙여넣어 보면서 입력하세요)")

    def load_history(self, params: dict[str, Any]) -> None:
        api = self.api()

        def done(result, error) -> None:
            if isinstance(error, AuthError):
                self.require_login(str(error))
                return
            self.window.set_history(result if error is None else None, str(error or ""))

        self.background.run(lambda: api.history(**params), done)

    def fetch_single(self, order_id: str) -> None:
        api = self.api()

        def done(result, error) -> None:
            if error is not None or not result:
                # 목록 갱신 후 다시 시도할 수 있도록 그대로 둠
                return
            if state_of(result) == "done":
                self.window.show_single(result)

        self.background.run(lambda: api.order(order_id), done)

    # ---------- 자동 업데이트 ----------
    def check_update(self, manual: bool = False) -> None:
        if self._update_checking or self.quitting:
            return
        if not updater_supported():
            if manual:
                QMessageBox.information(self.window, APP_NAME, "설치된 프로그램(Windows)에서만 자동 업데이트를 사용할 수 있습니다.")
            return
        if self._update_file:
            if manual:
                self._install_update(confirm=True)
            return
        self._update_checking = True
        target_dir = self.directory / "updates"

        def task():
            info = updater.check_latest()
            if info is None:
                return None
            return info.version, str(updater.download(info, target_dir))

        def done(result, error) -> None:
            self._update_checking = False
            if error is not None:
                log.warning("업데이트 확인 실패: %s", error)
                if manual:
                    QMessageBox.warning(self.window, APP_NAME, f"업데이트를 확인하지 못했습니다.\n인터넷 연결을 확인해 주세요.\n\n({error})")
                return
            if result is None:
                if manual:
                    QMessageBox.information(self.window, APP_NAME, f"최신 버전(v{__version__})을 사용 중입니다.")
                return
            self._update_version, self._update_file = result
            log.info("업데이트 준비됨: v%s", self._update_version)
            self.window.show_update_ready(self._update_version)
            if manual:
                self._install_update(confirm=True)
            else:
                self._try_install_update()

        self.background.run(task, done)

    def _safe_to_install(self) -> bool:
        """업무 방해가 없을 때만 자동 설치: 창이 숨겨졌거나(트레이) 다른 프로그램 사용 중이고, 내가 입력 중인 주문이 없을 때."""
        if self._busy or self._login_open or QApplication.activeModalWidget() is not None:
            return False
        my_id = self.staff.id if self.staff else ""
        entering_mine = any((o.get("desk") or {}).get("state") == "entering" and (o.get("desk") or {}).get("enteringById") == my_id
                            for o in self.open_orders)
        if entering_mine:
            return False
        window_idle = (not self.window.isVisible()) or self.window.isMinimized() or QApplication.activeWindow() is None
        return window_idle

    def _try_install_update(self) -> None:
        if self._update_file and self._safe_to_install():
            self._install_update(confirm=False)

    def _install_update(self, confirm: bool) -> None:
        if not self._update_file:
            return
        if confirm:
            answer = QMessageBox.question(self.window, APP_NAME,
                                          f"새 버전 v{self._update_version} 을 설치할까요?\n약 10초 뒤 프로그램이 자동으로 다시 켜집니다.\n(그 사이 들어온 발주도 다시 켜지면 모두 표시됩니다)")
            if answer != QMessageBox.StandardButton.Yes:
                return
        try:
            import subprocess

            self.settings.reopen_after_update = self.window.isVisible() and not self.window.isMinimized()
            self.save_settings()
            subprocess.Popen([self._update_file, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS"],
                             close_fds=True, creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
            log.info("업데이트 설치 시작: v%s", self._update_version)
        except OSError:
            log.exception("업데이트 설치 실행 실패")
            self._update_file = ""
            return
        self.quit()

    # ---------- 기타 ----------
    def open_data_folder(self) -> None:
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(self.directory)))

    def show_about(self) -> None:
        QMessageBox.information(self.window, APP_NAME,
                                f"{APP_NAME} v{__version__}\n\n서버: {self.settings.server_url}\n"
                                f"데이터 폴더: {self.directory}\n\n"
                                "발주 내역은 서버에 보관되며, 이 PC가 꺼져 있어도 다시 켜면 미처리 발주가 모두 표시됩니다.")

    def quit_with_confirm(self) -> None:
        answer = QMessageBox.question(self.window, APP_NAME,
                                      "프로그램을 종료하면 이 PC에서는 발주 알림을 받을 수 없습니다.\n종료할까요?")
        if answer == QMessageBox.StandardButton.Yes:
            self.quit()

    def quit(self) -> None:
        self.quitting = True
        self.toasts.clear()
        self._stop_sync()
        if self._sync_thread is not None:
            self._sync_thread.quit()
            self._sync_thread.wait(3000)
        self.background.shutdown()
        self.tray.hide()
        self.window.close()
        self.app.quit()


def _single_instance(app: QApplication) -> QLocalServer | None:
    """이미 실행 중이면 기존 창을 띄우고 None 반환."""
    socket = QLocalSocket()
    socket.connectToServer(SINGLE_INSTANCE_KEY)
    if socket.waitForConnected(500):
        socket.write(b"show")
        socket.flush()
        socket.waitForBytesWritten(500)
        socket.disconnectFromServer()
        return None
    QLocalServer.removeServer(SINGLE_INSTANCE_KEY)
    server = QLocalServer(app)
    server.listen(SINGLE_INSTANCE_KEY)
    return server


def run(argv: list[str]) -> int:
    start_minimized = "--minimized" in argv
    app = QApplication(argv)
    app.setApplicationName(APP_NAME)
    app.setOrganizationName("부자유통")
    app.setQuitOnLastWindowClosed(False)
    app.setStyleSheet(STYLESHEET)
    server = _single_instance(app)
    if server is None:
        return 0
    controller = DeskController(app, start_minimized=start_minimized)

    def on_connection() -> None:
        connection = server.nextPendingConnection()
        if connection is not None:
            connection.readyRead.connect(lambda: (connection.readAll(), controller.show_window()))

    server.newConnection.connect(on_connection)
    # Windows 종료/로그오프 시에는 창 닫기(트레이로 숨김)를 막지 않고 바로 종료되도록
    app.commitDataRequest.connect(lambda _manager: setattr(controller, "quitting", True))
    controller.start()
    return app.exec()
