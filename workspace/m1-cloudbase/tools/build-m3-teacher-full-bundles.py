"""Prepare isolated, fully dependent M3 teacher code bundles without cloud writes."""

from hashlib import sha256
from json import loads
from pathlib import Path
from shutil import copy2, copytree
from zipfile import ZIP_DEFLATED, ZipFile


BACKUPS = Path("D:/app-m3-cache/teacher/cloud-backups/2026-10-03")
NEW = Path("D:/app/workspace/m1-cloudbase/dist/teacher-review-2026-10-03")
OUTPUT = Path("D:/app-m3-cache/teacher/full-bundles/2026-10-03")
NAMES = ("task-query", "task-command", "activity-query", "activity-command")
OUTPUT.mkdir(parents=True, exist_ok=True)

for name in NAMES:
    source = BACKUPS / name
    candidate = NEW / name
    target = OUTPUT / name
    if target.exists():
        raise RuntimeError(f"Refusing to overwrite existing complete bundle: {name}")
    package = loads((candidate / "package.json").read_text(encoding="utf-8"))
    sdk_version = loads((source / "node_modules/@cloudbase/node-sdk/package.json").read_text(encoding="utf-8"))["version"]
    if package["dependencies"].get("@cloudbase/node-sdk") != sdk_version:
        raise RuntimeError(f"Pinned SDK version mismatch: {name}")
    target.mkdir()
    copy2(candidate / "index.js", target / "index.js")
    copy2(candidate / "package.json", target / "package.json")
    copytree(source / "node_modules", target / "node_modules")
    archive_path = OUTPUT / f"{name}.zip"
    files = sorted(path for path in target.rglob("*") if path.is_file())
    with ZipFile(archive_path, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
        for path in files:
            archive.write(path, path.relative_to(target).as_posix())
    print(name, sdk_version, len(files), archive_path.stat().st_size,
          sha256((target / "index.js").read_bytes()).hexdigest(),
          sha256(archive_path.read_bytes()).hexdigest())
