"""Create deterministic local review ZIPs for five native management functions."""

from hashlib import sha256
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / "dist" / "m3-native-six-page-review-20261008"
SOURCE = REVIEW / "local-native"
OUTPUT = REVIEW / "zips"
NAMES = (
    "native-admin-query",
    "native-admin-command",
    "native-admin-management-command",
    "native-admin-operations-command",
    "native-admin-media-command",
)

if not SOURCE.is_dir():
    raise SystemExit("Local native management build is missing")
OUTPUT.mkdir(parents=True, exist_ok=True)
summary = []
for name in NAMES:
    folder = SOURCE / name
    files = (folder / "index.js", folder / "package.json")
    if not all(path.is_file() and path.stat().st_size > 0 for path in files):
        raise SystemExit(f"Incomplete function package: {name}")
    archive = OUTPUT / f"{name}.zip"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=9) as zipped:
        for path in files:
            info = ZipInfo(path.name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zipped.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
    code = files[0].read_bytes()
    payload = archive.read_bytes()
    summary.append({
        "name": name,
        "codeBytes": len(code),
        "codeSha256": sha256(code).hexdigest().upper(),
        "zipBytes": len(payload),
        "zipSha256": sha256(payload).hexdigest().upper(),
    })

(REVIEW / "local-native-review-manifest.json").write_text(
    json.dumps({"functions": summary}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(summary, ensure_ascii=False))
