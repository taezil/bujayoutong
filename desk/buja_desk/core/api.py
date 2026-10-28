"""부자유통 서버(/api/desk/*) 통신."""
from __future__ import annotations

import platform
from dataclasses import dataclass
from typing import Any

import requests

from .. import __version__

TIMEOUT = (6, 20)  # (연결, 응답) 초


class ApiError(Exception):
    def __init__(self, message: str, status: int = 0, payload: dict[str, Any] | None = None):
        super().__init__(message)
        self.status = status
        self.payload = payload or {}


class AuthError(ApiError):
    """로그인 필요 / 토큰 만료 (401)."""


class NetworkError(ApiError):
    """서버에 연결하지 못함 (인터넷 끊김, 시간 초과 등)."""


class ConflictError(ApiError):
    """다른 직원이 먼저 처리상태를 바꿈 (409). payload['order'] 에 최신 주문."""


@dataclass
class StaffInfo:
    id: str
    username: str
    display_name: str
    role: str
    device_name: str

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "StaffInfo":
        return cls(
            id=str(raw.get("id", "")),
            username=str(raw.get("username", "")),
            display_name=str(raw.get("displayName", "")),
            role=str(raw.get("role", "")),
            device_name=str(raw.get("deviceName", "")),
        )


class DeskApi:
    def __init__(self, server_url: str, token: str = "", session: requests.Session | None = None):
        self.server_url = server_url.rstrip("/")
        self.token = token
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = f"BujaOrderAlert/{__version__} ({platform.system()} {platform.release()})"
        self.session.headers["Accept"] = "application/json"

    # ---- 내부 ----
    def _request(self, method: str, path: str, *, params: dict[str, Any] | None = None,
                 json: dict[str, Any] | None = None, auth: bool = True) -> dict[str, Any]:
        headers = {}
        if auth:
            if not self.token:
                raise AuthError("로그인이 필요합니다.", 401)
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            response = self.session.request(method, self.server_url + path, params=params, json=json,
                                            headers=headers, timeout=TIMEOUT, allow_redirects=False)
        except requests.RequestException as error:
            raise NetworkError("서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.") from error
        try:
            payload = response.json()
            if not isinstance(payload, dict):
                payload = {}
        except ValueError:
            payload = {}
        message = str(payload.get("error") or "")
        if response.status_code == 401:
            raise AuthError(message or "로그인이 필요합니다.", 401, payload)
        if response.status_code == 409:
            raise ConflictError(message or "다른 직원이 먼저 처리했습니다.", 409, payload)
        if response.status_code >= 500 or response.status_code in (502, 503, 504):
            raise NetworkError(message or f"서버 오류({response.status_code})입니다. 잠시 후 다시 시도합니다.", response.status_code, payload)
        if not response.ok or payload.get("ok") is not True:
            raise ApiError(message or f"요청이 실패했습니다. ({response.status_code})", response.status_code, payload)
        return payload

    # ---- 공개 API ----
    def login(self, username: str, pin: str, device_name: str) -> tuple[str, StaffInfo]:
        payload = self._request("POST", "/api/desk/login",
                                json={"username": username, "pin": pin, "deviceName": device_name}, auth=False)
        token = str(payload.get("token", ""))
        if len(token) != 64:
            raise ApiError("서버 응답이 올바르지 않습니다.")
        self.token = token
        return token, StaffInfo.from_json(payload.get("staff") or {})

    def logout(self) -> None:
        if not self.token:
            return
        try:
            self._request("POST", "/api/desk/logout", json={})
        finally:
            self.token = ""

    def pulse(self) -> dict[str, Any]:
        return self._request("GET", "/api/desk/pulse")

    def open_orders(self) -> dict[str, Any]:
        return self._request("GET", "/api/desk/orders", params={"scope": "open"})

    def history(self, *, date_from: str = "", date_to: str = "", query: str = "", date_field: str = "created",
                state: str = "done", limit: int = 300) -> list[dict[str, Any]]:
        payload = self._request("GET", "/api/desk/orders", params={
            "scope": "history", "from": date_from, "to": date_to, "q": query, "dateField": date_field,
            "state": state, "limit": limit,
        })
        return list(payload.get("orders") or [])

    def order(self, order_id: str) -> dict[str, Any]:
        return dict(self._request("GET", "/api/desk/orders", params={"id": order_id}).get("order") or {})

    def change_state(self, order_id: str, action: str, force: bool = False) -> dict[str, Any]:
        return self._request("POST", "/api/desk/orders", json={"action": action, "orderId": order_id, "force": force})
