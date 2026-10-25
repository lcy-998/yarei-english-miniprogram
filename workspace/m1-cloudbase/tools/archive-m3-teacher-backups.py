"""Create deterministic local archives of four read-only code backups; no cloud calls."""

from hashlib import sha256
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path("D:/app-m3-cache/teacher/cloud-backups/2026-10-03")
OUTPUT = ROOT / "archives"
NAMES = ("task-query", "task-command", "activity-query", "activity-command")
OUTPUT.mkdir(parents=True, exist_ok=True)

for name in NAMES:
    source = ROOT / name
    if not source.is_dir() or not (source / "index.js").is_file():
        raise RuntimeError(f"Missing exact backup tree for {name}")
    destination = OUTPUT / f"{name}.zip"
    files = sorted(path for path in source.rglob("*") if path.is_file())
    with ZipFile(destination, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
        for path in files:
            archive.write(path, path.relative_to(source).as_posix())
    digest = sha256(destination.read_bytes()).hexdigest()
    print(name, len(files), destination.stat().st_size, digest)
