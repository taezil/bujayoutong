"""실행 진입점.

  BujaOrderAlert.exe              일반 실행 (이미 실행 중이면 기존 창을 띄움)
  BujaOrderAlert.exe --minimized  트레이에서 조용히 시작 (Windows 자동 실행용)
  BujaOrderAlert.exe --self-test  화면 구성 점검 후 종료 (빌드 검증용, 서버 접속 없음)
"""
from __future__ import annotations

import logging
import sys
import traceback
from logging.handlers import RotatingFileHandler


def _setup_logging() -> None:
    from buja_desk.core.paths import data_dir

    handler = RotatingFileHandler(data_dir() / "desk.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    if sys.stderr is not None:
        root.addHandler(logging.StreamHandler())

    def hook(kind, value, tb):
        logging.getLogger("crash").error("처리되지 않은 오류\n%s", "".join(traceback.format_exception(kind, value, tb)))

    sys.excepthook = hook


def main() -> int:
    _setup_logging()
    from buja_desk import __version__

    logging.getLogger(__name__).info("부자유통 발주 알림센터 v%s 시작 %s", __version__, sys.argv[1:])
    if "--self-test" in sys.argv:
        from buja_desk.ui.selftest import run_self_test

        return run_self_test(sys.argv)
    from buja_desk.ui.app import run

    return run(sys.argv)


if __name__ == "__main__":
    sys.exit(main())
