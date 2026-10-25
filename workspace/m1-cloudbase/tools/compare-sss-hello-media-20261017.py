"""Check whether independently encoded Hello recordings carry the same audio."""
from __future__ import annotations

from pathlib import Path
import subprocess

import numpy as np

FFMPEG = r'D:\app-cache\m3-media-tools\ffmpeg-release-essentials\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe'
BASE = Path('G:/英语资产/inbox')
FILES = {
    'quark_video': BASE / 'sss-hello-quark-public-share-2026-10-17/hello-quark.mp4',
    'quark_mp3': BASE / 'sss-hello-quark-public-share-2026-10-17/hello-quark.mp3',
    'mp3pm_mp3': BASE / 'sss-hello-mp3pm-candidate-2026-10-17/hello.mp3',
}


def envelope(path: Path) -> np.ndarray:
    result = subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), '-vn',
                             '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=90, check=True)
    samples = np.frombuffer(result.stdout, dtype='<f4')
    samples = samples[: len(samples) // 80 * 80]
    values = np.sqrt(np.mean(samples.reshape(-1, 80) ** 2, axis=1))
    return (values - values.mean()) / (values.std() + 1e-8)


def similarity(a: np.ndarray, b: np.ndarray) -> tuple[float, int]:
    best = (-2.0, 0)
    for lag in range(-300, 301):
        aa = a[max(0, lag): len(a) + min(0, lag)]
        bb = b[max(0, -lag): len(b) + min(0, -lag)]
        length = min(len(aa), len(bb))
        if length < 6000:
            continue
        score = float(np.dot(aa[:length], bb[:length]) / length)
        if score > best[0]:
            best = (score, lag)
    return best


if __name__ == '__main__':
    data = {name: envelope(path) for name, path in FILES.items()}
    for name, values in data.items():
        print(f'{name}: {len(values) / 100:.2f} s')
    for name in ('quark_mp3', 'mp3pm_mp3'):
        score, lag = similarity(data['quark_video'], data[name])
        print(f'quark_video vs {name}: envelope_score={score:.4f} lag={lag / 100:.2f}s')
