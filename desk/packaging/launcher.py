"""PyInstaller 진입 스크립트."""
import sys

from buja_desk.__main__ import safe_main as main

if __name__ == "__main__":
    sys.exit(main())
