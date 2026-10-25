"""Local-only benchmark; prints timings and recognition counts, never transcripts."""

import json
import os
import sys
import time
import threading
from pathlib import Path

import psutil
from inference import recognize_mp3

path = Path(sys.argv[1])
os.environ["VOICE_MODEL_PATH"] = sys.argv[2]
for run in range(2):
    process = psutil.Process()
    peak_rss = [process.memory_info().rss]
    done = threading.Event()

    def monitor():
        while not done.wait(0.02):
            peak_rss[0] = max(peak_rss[0], process.memory_info().rss)

    watcher = threading.Thread(target=monitor, daemon=True)
    watcher.start()
    started = time.perf_counter()
    try:
        result = recognize_mp3(path)
    finally:
        done.set()
        watcher.join()
    print(json.dumps({"run": run + 1, "durationMs": result["durationMs"],
                      "elapsedMs": round((time.perf_counter() - started) * 1000),
                      "recognizedWordCount": len(result["words"]),
                      "peakRssMiB": round(peak_rss[0] / 1024 / 1024, 1)}, ensure_ascii=False))
