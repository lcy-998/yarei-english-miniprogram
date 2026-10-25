"""Build a reproducible offline CloudBase Python3.11 archive from pinned artifacts."""

import argparse
import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOCK = json.loads((ROOT / "dependencies.lock.json").read_text(encoding="utf-8"))
NOT_IMPORTED_BY_WORKER = {"websockets-17.1-cp311-cp311-manylinux1_x86_64.manylinux_2_28_x86_64.manylinux_2_5_x86_64.whl"}


def verify(path: Path, expected: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected:
        raise ValueError(f"Hash mismatch: {path.name}")


def extract(archive: Path, target: Path) -> None:
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            path = (target / member.filename).resolve()
            if not path.is_relative_to(target.resolve()):
                raise ValueError(f"Unsafe archive member: {member.filename}")
        source.extractall(target)


def build(cache: Path, output: Path) -> None:
    cache = cache.resolve()
    output = output.resolve()
    if not cache.is_dir() or not output.is_relative_to(cache):
        raise ValueError("Build output must remain inside the explicit voice cache")
    model_zip = cache / LOCK["model"]["file"]
    verify(model_zip, LOCK["model"]["sha256"])
    wheels = cache / "linux-wheelhouse"
    for name, digest in LOCK["wheels"].items():
        verify(wheels / name, digest)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="voice-build-", dir=cache) as folder:
        stage = Path(folder)
        for name in sorted(LOCK["wheels"]):
            if name in NOT_IMPORTED_BY_WORKER:
                continue
            extract(wheels / name, stage)
        model_dir = stage / "model"
        model_dir.mkdir()
        extract(model_zip, model_dir)
        shutil.copy2(ROOT / "inference.py", stage / "inference.py")
        shutil.copy2(ROOT / "main.py", stage / "main.py")
        shutil.copy2(ROOT / "dependencies.lock.json", stage / "dependencies.lock.json")
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path in sorted(stage.rglob("*")):
                if path.is_file() and "__pycache__" not in path.parts:
                    archive.write(path, path.relative_to(stage).as_posix())
        uncompressed = sum(path.stat().st_size for path in stage.rglob("*") if path.is_file())
    print(json.dumps({"archive": str(output), "bytes": output.stat().st_size,
                      "uncompressedBytes": uncompressed,
                      "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.cache, args.output)
