"""자동 업데이트: GitHub Releases 의 최신 설치파일을 확인·다운로드 (Qt 와 무관).

- 최신 릴리스: https://api.github.com/repos/taezil/bujayoutong/releases/latest (태그 desk-vX.Y.Z)
- 설치파일 이름: BujaOrderAlert-Setup-X.Y.Z.exe
- GitHub 가 제공하는 SHA-256 값이 있으면 다운로드한 파일과 비교해서 다르면 버림
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

import requests

from .. import __version__

LATEST_URL = "https://api.github.com/repos/taezil/bujayoutong/releases/latest"
ALLOWED_PREFIX = "https://github.com/taezil/bujayoutong/releases/download/"
ASSET_PATTERN = re.compile(r"^BujaOrderAlert-Setup-(\d+\.\d+\.\d+)\.exe$")


@dataclass
class UpdateInfo:
    version: str
    url: str
    sha256: str
    size: int


def version_tuple(value: str) -> tuple[int, ...]:
    parts = re.findall(r"\d+", value or "")
    return tuple(int(p) for p in parts[:3]) + (0,) * (3 - len(parts[:3]))


def is_newer(candidate: str, current: str = __version__) -> bool:
    return version_tuple(candidate) > version_tuple(current)


def check_latest(session: requests.Session | None = None, current: str = __version__) -> UpdateInfo | None:
    """새 버전이 있으면 UpdateInfo, 없으면 None. 네트워크 오류는 예외."""
    http = session or requests.Session()
    response = http.get(LATEST_URL, timeout=(6, 20), headers={"Accept": "application/vnd.github+json"})
    response.raise_for_status()
    release = response.json()
    tag = str(release.get("tag_name") or "")
    if not tag.startswith("desk-v") or release.get("draft") or release.get("prerelease"):
        return None
    version = tag[len("desk-v"):]
    if not is_newer(version, current):
        return None
    for asset in release.get("assets") or []:
        name = str(asset.get("name") or "")
        match = ASSET_PATTERN.match(name)
        url = str(asset.get("browser_download_url") or "")
        if match and match.group(1) == version and url.startswith(ALLOWED_PREFIX):
            digest = str(asset.get("digest") or "")
            sha = digest.split(":", 1)[1].lower() if digest.lower().startswith("sha256:") else ""
            return UpdateInfo(version=version, url=url, sha256=sha, size=int(asset.get("size") or 0))
    return None


def download(info: UpdateInfo, directory: Path, session: requests.Session | None = None) -> Path:
    """설치파일을 내려받아 경로 반환. 크기·SHA-256 이 맞지 않으면 예외."""
    http = session or requests.Session()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"BujaOrderAlert-Setup-{info.version}.exe"
    if target.exists() and _matches(target, info):
        return target
    partial = target.with_suffix(".part")
    digest = hashlib.sha256()
    size = 0
    with http.get(info.url, stream=True, timeout=(10, 60)) as response:
        response.raise_for_status()
        with open(partial, "wb") as handle:
            for chunk in response.iter_content(chunk_size=256 * 1024):
                if chunk:
                    handle.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
    if info.size and size != info.size:
        partial.unlink(missing_ok=True)
        raise OSError("업데이트 파일 크기가 맞지 않습니다.")
    if info.sha256 and digest.hexdigest() != info.sha256:
        partial.unlink(missing_ok=True)
        raise OSError("업데이트 파일 검증(SHA-256)에 실패했습니다.")
    partial.replace(target)
    # 예전 설치파일 정리
    for old in directory.glob("BujaOrderAlert-Setup-*.exe"):
        if old != target:
            old.unlink(missing_ok=True)
    return target


def _matches(path: Path, info: UpdateInfo) -> bool:
    if info.size and path.stat().st_size != info.size:
        return False
    if not info.sha256:
        return True
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest() == info.sha256
