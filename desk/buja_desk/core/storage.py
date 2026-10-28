"""로컬 저장소: 설정, 알림 기록, 로그인 토큰.

- 로그인 토큰은 Windows DPAPI(현재 Windows 사용자 계정으로만 풀 수 있는 암호화)로 저장합니다.
  EXE 안에는 어떤 인증정보도 들어 있지 않습니다.
- 파일은 임시 파일에 쓴 뒤 교체(atomic replace)해서, 쓰는 도중 PC가 꺼져도 깨지지 않게 합니다.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_SERVER = "https://order.bujafood.kr"


def _atomic_write(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "wb") as handle:
        handle.write(data)
        handle.flush()
        try:
            os.fsync(handle.fileno())
        except OSError:
            pass
    os.replace(tmp, path)


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except (OSError, ValueError):
        # 손상된 파일은 옆에 보관하고 기본값으로 시작
        try:
            os.replace(path, path.with_suffix(path.suffix + f".broken-{int(time.time())}"))
        except OSError:
            pass
        return default


@dataclass
class Settings:
    server_url: str = DEFAULT_SERVER
    sound_enabled: bool = True
    popup_enabled: bool = True
    popup_seconds: int = 15
    poll_seconds: int = 7
    reminder_enabled: bool = True
    reminder_minutes: int = 10
    device_name: str = ""
    last_username: str = ""
    window_geometry: str = ""
    group_by_customer: bool = False
    first_close_notice_shown: bool = False

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Settings":
        known = {k: v for k, v in raw.items() if k in cls.__dataclass_fields__}
        settings = cls(**known)
        settings.poll_seconds = max(5, min(30, int(settings.poll_seconds or 7)))
        settings.popup_seconds = max(5, min(120, int(settings.popup_seconds or 15)))
        settings.reminder_minutes = max(3, min(120, int(settings.reminder_minutes or 10)))
        env_server = os.environ.get("BUJA_DESK_SERVER")
        if env_server:
            settings.server_url = env_server
        settings.server_url = normalize_server_url(settings.server_url)
        return settings


def normalize_server_url(value: str) -> str:
    url = (value or DEFAULT_SERVER).strip().rstrip("/")
    lowered = url.lower()
    local = lowered.startswith("http://localhost") or lowered.startswith("http://127.0.0.1")
    if not (lowered.startswith("https://") or local):
        # 주문정보가 오가므로 https 만 허용 (개발용 localhost 제외)
        return DEFAULT_SERVER
    return url


class SettingsStore:
    def __init__(self, directory: Path):
        self.path = directory / "settings.json"
        self._lock = threading.Lock()
        self.settings = Settings.from_dict(_read_json(self.path, {}))

    def save(self) -> None:
        with self._lock:
            data = asdict(self.settings)
            if os.environ.get("BUJA_DESK_SERVER"):
                data.pop("server_url", None)
            _atomic_write(self.path, json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))


@dataclass
class NotifiedEntry:
    version: str
    at: float
    kind: str = "new"


class NotificationLog:
    """이미 알림을 띄운 주문 기록. 프로그램을 껐다 켜도 같은 주문으로 다시 알림이 뜨지 않게 합니다."""

    KEEP_DAYS = 45

    def __init__(self, directory: Path):
        self.path = directory / "notified.json"
        self._lock = threading.Lock()
        raw = _read_json(self.path, {})
        entries = raw.get("orders", {}) if isinstance(raw, dict) else {}
        self.entries: dict[str, NotifiedEntry] = {}
        for order_id, value in entries.items():
            try:
                self.entries[str(order_id)] = NotifiedEntry(str(value["version"]), float(value["at"]), str(value.get("kind", "new")))
            except (KeyError, TypeError, ValueError):
                continue
        self.initialized = bool(raw.get("initialized")) if isinstance(raw, dict) else False

    def get(self, order_id: str) -> NotifiedEntry | None:
        return self.entries.get(order_id)

    def mark(self, order_id: str, version: str, kind: str) -> None:
        self.entries[order_id] = NotifiedEntry(version, time.time(), kind)

    def mark_initialized(self) -> None:
        self.initialized = True

    def prune(self, keep_ids: set[str]) -> None:
        limit = time.time() - self.KEEP_DAYS * 86400
        for order_id in list(self.entries):
            if order_id not in keep_ids and self.entries[order_id].at < limit:
                del self.entries[order_id]

    def save(self) -> None:
        with self._lock:
            data = {
                "initialized": self.initialized,
                "orders": {k: {"version": v.version, "at": v.at, "kind": v.kind} for k, v in self.entries.items()},
            }
            _atomic_write(self.path, json.dumps(data, ensure_ascii=False).encode("utf-8"))


# ---------- 토큰 저장 ----------


def _dpapi(data: bytes, protect: bool) -> bytes:  # pragma: no cover - Windows 전용
    import ctypes
    from ctypes import wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    buffer = ctypes.create_string_buffer(data, len(data))
    blob_in = DATA_BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    entropy_bytes = b"BujaOrderAlert-v1"
    entropy_buffer = ctypes.create_string_buffer(entropy_bytes, len(entropy_bytes))
    entropy = DATA_BLOB(len(entropy_bytes), ctypes.cast(entropy_buffer, ctypes.POINTER(ctypes.c_char)))
    blob_out = DATA_BLOB()
    CRYPTPROTECT_UI_FORBIDDEN = 0x01
    if protect:
        ok = crypt32.CryptProtectData(ctypes.byref(blob_in), "BujaOrderAlert", ctypes.byref(entropy), None, None,
                                      CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(blob_out))
    else:
        ok = crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, ctypes.byref(entropy), None, None,
                                        CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(blob_out))
    if not ok:
        raise OSError("DPAPI 처리에 실패했습니다.")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(blob_out.pbData, ctypes.c_void_p))


class TokenStore:
    """로그인 토큰 저장. Windows 에서는 DPAPI 로 암호화, 그 외(테스트)는 파일 권한 600."""

    def __init__(self, directory: Path):
        self.path = directory / "session.bin"

    def load(self) -> str:
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            return ""
        except OSError:
            return ""
        try:
            if sys.platform == "win32":
                token = _dpapi(raw, protect=False).decode("ascii")
            else:
                token = base64.b64decode(raw).decode("ascii")
        except Exception:  # noqa: BLE001 - 다른 PC/사용자에서 복사된 파일 등은 무시
            return ""
        return token if len(token) == 64 and all(c in "0123456789abcdef" for c in token) else ""

    def save(self, token: str) -> None:
        data = token.encode("ascii")
        blob = _dpapi(data, protect=True) if sys.platform == "win32" else base64.b64encode(data)
        _atomic_write(self.path, blob)
        if sys.platform != "win32":
            os.chmod(self.path, 0o600)

    def clear(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass
