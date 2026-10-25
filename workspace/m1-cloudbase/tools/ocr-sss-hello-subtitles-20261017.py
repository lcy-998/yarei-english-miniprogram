"""Extract displayed lyrics from regular samples of the public-share video."""
from __future__ import annotations

from pathlib import Path
import subprocess

from PIL import Image

ROOT = Path('G:/英语资产/library/derived/sss-hello-quark-media-review-20261017')
FRAMES = ROOT / 'ocr-frames'
CROPS = ROOT / 'ocr-crops'
TESSERACT = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
CROPS.mkdir(parents=True, exist_ok=True)

for index, frame in enumerate(sorted(FRAMES.glob('frame-*.png'))):
    with Image.open(frame) as image:
        width, height = image.size
        cropped = image.crop((int(width * 0.12), int(height * 0.82),
                              int(width * 0.88), height))
        target = CROPS / f'crop-{index + 1:03}.png'
        cropped.save(target)
    result = subprocess.run([TESSERACT, str(target), 'stdout', '-l', 'eng',
                             '--psm', '6'], capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=20)
    if result.returncode != 0:
        raise RuntimeError(f'OCR failed at {index * 2}s')
    lyric = ' '.join(result.stdout.split())
    print(f'{index * 2:02d}s {lyric}')
