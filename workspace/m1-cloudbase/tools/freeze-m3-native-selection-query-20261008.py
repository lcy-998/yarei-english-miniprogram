"""Freeze the single-function local candidate for selectable admin lists."""
from hashlib import sha256
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / "dist" / "m3-native-selection-review-20261008"
SOURCE = REVIEW / "local-native" / "native-admin-query"
OUTPUT = REVIEW / "native-admin-query.zip"
FILES = (SOURCE / "index.js", SOURCE / "package.json")
if not all(path.is_file() and path.stat().st_size > 0 for path in FILES):
    raise SystemExit("Native admin query build is missing")
with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED, compresslevel=9) as zipped:
    for path in FILES:
        info = ZipInfo(path.name, date_time=(2020, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        zipped.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
summary = {"function": "native-admin-query",
    "codeBytes": FILES[0].stat().st_size,
    "codeSha256": sha256(FILES[0].read_bytes()).hexdigest().upper(),
    "zipBytes": OUTPUT.stat().st_size,
    "zipSha256": sha256(OUTPUT.read_bytes()).hexdigest().upper()}
(REVIEW / "manifest.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary))
