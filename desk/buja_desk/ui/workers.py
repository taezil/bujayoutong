"""백그라운드 작업. 화면이 멈추지 않도록 서버 통신은 모두 별도 스레드에서 실행합니다."""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from PySide6.QtCore import QObject, QTimer, Signal, Slot

from ..core.api import DeskApi
from ..core.storage import NotificationLog
from ..core.sync import SyncEngine, SyncResult

log = logging.getLogger(__name__)


class SyncWorker(QObject):
    """동기화 루프. QThread 안에서 실행됨."""

    resultReady = Signal(object)  # SyncResult

    def __init__(self, server_url: str, token: str, log_store: NotificationLog,
                 poll_seconds: Callable[[], int], reminder_minutes: Callable[[], int | None]):
        super().__init__()
        self._server_url = server_url
        self._token = token
        self._log_store = log_store
        self._poll_seconds = poll_seconds
        self._reminder_minutes = reminder_minutes
        self._engine: SyncEngine | None = None
        self._timer: QTimer | None = None
        self._paused = False

    @Slot()
    def start(self) -> None:
        self._engine = SyncEngine(DeskApi(self._server_url, self._token), self._log_store,
                                  reminder_minutes=self._reminder_minutes)
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self.tick)
        self.tick()

    @Slot()
    def tick(self) -> None:
        if self._engine is None or self._paused:
            return
        try:
            result = self._engine.poll()
        except Exception as error:  # noqa: BLE001 - 어떤 오류가 나도 루프는 계속
            log.exception("동기화 중 오류")
            self._engine.failures += 1
            result = SyncResult(connected=False, error=f"동기화 오류: {error}")
        if result.error:
            log.warning("동기화 실패: %s", result.error)
        self.resultReady.emit(result)
        if result.auth_required:
            self._paused = True  # 다시 로그인할 때까지 중지
            return
        if self._timer is not None:
            self._timer.start(int(self._engine.next_delay(self._poll_seconds()) * 1000))

    @Slot()
    def refresh_now(self) -> None:
        if self._engine is None:
            return
        self._engine.request_full_refresh()
        if self._timer is not None:
            self._timer.stop()
        self.tick()

    @Slot(str)
    def set_token(self, token: str) -> None:
        self._token = token
        if self._engine is not None:
            self._engine.api.token = token
            self._engine.connected = False
        self._paused = False
        self.refresh_now()

    @Slot()
    def stop(self) -> None:
        self._paused = True
        if self._timer is not None:
            self._timer.stop()


class Background(QObject):
    """짧은 서버 요청(입력 시작/완료, 처리내역 조회 등)을 스레드에서 실행하고 결과를 화면 스레드로 돌려줌."""

    _deliver = Signal(object)

    def __init__(self, parent: QObject | None = None):
        super().__init__(parent)
        self._pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="desk-bg")
        self._deliver.connect(self._run_callback)

    def run(self, task: Callable[[], Any], on_done: Callable[[Any, Exception | None], None]) -> None:
        def job() -> None:
            try:
                value = task()
                error: Exception | None = None
            except Exception as exc:  # noqa: BLE001
                value, error = None, exc
            self._deliver.emit(lambda: on_done(value, error))

        self._pool.submit(job)

    @Slot(object)
    def _run_callback(self, callback: Callable[[], None]) -> None:
        try:
            callback()
        except Exception:  # noqa: BLE001
            log.exception("작업 결과 처리 중 오류")

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
