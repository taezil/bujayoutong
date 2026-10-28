"""아이콘/알림음 파일 생성. (한 번 만들어 저장소에 넣어 두었고, 다시 만들 때만 실행)

  python desk/packaging/make_assets.py
"""
from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "desk" / "buja_desk" / "assets"


def make_icons() -> None:
    from PIL import ImageChops, ImageDraw

    source = Image.open(ROOT / "public" / "buja-mark.png").convert("RGB")
    # 흰 여백을 잘라 로고를 크게 (트레이 아이콘은 16~32px 로 작게 보임)
    diff = ImageChops.difference(source, Image.new("RGB", source.size, (255, 255, 255)))
    box = diff.point(lambda v: 255 if v > 24 else 0).getbbox() or (0, 0, *source.size)
    logo = source.crop(box)
    side = int(max(logo.size) * 1.12)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, side - 1, side - 1), radius=side // 6, fill=255)
    canvas.paste(Image.new("RGBA", (side, side), (255, 255, 255, 255)), (0, 0), mask)
    canvas.paste(logo, ((side - logo.width) // 2, (side - logo.height) // 2))
    canvas.resize((256, 256), Image.LANCZOS).save(ASSETS / "icon.png")
    canvas.save(ASSETS / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


def tone(frequencies: list[tuple[float, float]], path: Path, volume: float = 0.45) -> None:
    rate = 22050
    frames = bytearray()
    for freq, seconds in frequencies:
        count = int(rate * seconds)
        for i in range(count):
            t = i / rate
            envelope = min(1.0, i / (rate * 0.01)) * math.exp(-3.2 * t / seconds)
            sample = volume * envelope * (math.sin(2 * math.pi * freq * t) + 0.35 * math.sin(4 * math.pi * freq * t))
            frames += struct.pack("<h", int(max(-1, min(1, sample)) * 32000))
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(bytes(frames))


if __name__ == "__main__":
    ASSETS.mkdir(parents=True, exist_ok=True)
    make_icons()
    # 새 발주: 밝은 3음 차임 (두 번), 재알림: 낮은 2음
    tone([(880, 0.18), (1108.7, 0.18), (1318.5, 0.42), (880, 0.18), (1108.7, 0.18), (1318.5, 0.5)], ASSETS / "alert.wav")
    tone([(659.3, 0.25), (523.3, 0.5)], ASSETS / "reminder.wav")
    print("assets written to", ASSETS)
