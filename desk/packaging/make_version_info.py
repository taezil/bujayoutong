"""Windows 파일 속성(버전/회사명)용 version_info.txt 생성."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
version = re.search(r'__version__ = "([^"]+)"', (ROOT / "buja_desk" / "__init__.py").read_text(encoding="utf-8")).group(1)
parts = [int(p) for p in (version.split(".") + ["0", "0", "0"])[:4]]
text = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers=({parts[0]}, {parts[1]}, {parts[2]}, {parts[3]}), prodvers=({parts[0]}, {parts[1]}, {parts[2]}, {parts[3]}),
    mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('041204b0', [
      StringStruct('CompanyName', '부자유통'),
      StringStruct('FileDescription', '부자유통 발주 알림센터'),
      StringStruct('FileVersion', '{version}'),
      StringStruct('InternalName', 'BujaOrderAlert'),
      StringStruct('OriginalFilename', 'BujaOrderAlert.exe'),
      StringStruct('ProductName', '부자유통 발주 알림센터'),
      StringStruct('ProductVersion', '{version}')])]),
    VarFileInfo([VarStruct('Translation', [0x0412, 1200])])
  ]
)
"""
(ROOT / "packaging" / "version_info.txt").write_text(text, encoding="utf-8")
print(version)
