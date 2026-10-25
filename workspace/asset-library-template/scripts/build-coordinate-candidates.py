#!/usr/bin/env python3
"""Create OCR coordinate alternatives for flagged pages without replacing source data."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from asset_pipeline import ocr_page, write_json
from content_review import _hit_area, sha256


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--resource-id", default="")
    parser.add_argument("--limit", type=int, default=30)
    args = parser.parse_args()
    root = args.root.resolve()
    candidates = [Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
                  Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe")]
    tesseract = next((str(path) for path in candidates if path.is_file()), None) or shutil.which("tesseract")
    if tesseract is None:
        raise RuntimeError("Tesseract is required for coordinate candidates")
    tessdata = root / "runtime/tessdata"
    catalog = json.loads((root / "library/catalog.json").read_text(encoding="utf-8"))
    written = []
    skipped = []
    for book in catalog["resources"]:
        if book.get("resourceType") != "textbook" or args.resource_id and book.get("resourceId") != args.resource_id:
            continue
        audit = book.get("details", {}).get("coordinateAudit", {})
        flagged = sorted(set(audit.get("missingPages", [])) |
                         {item["pageNumber"] for item in audit.get("invalidPages", [])})
        version_root = (root / book["manifestRelativePath"]).parent
        for number in flagged:
            if len(written) >= args.limit:
                raise RuntimeError("Candidate limit reached; rerun with a larger explicit limit")
            target = version_root / "review/coordinate-candidates" / f"page-{number:04d}.json"
            if target.exists():
                skipped.append(f"{book['resourceId']}:{number}")
                continue
            image = version_root / "pages" / f"page-{number:04d}.jpg"
            if not image.is_file():
                skipped.append(f"{book['resourceId']}:{number}:no-image")
                continue
            result = ocr_page(image, tesseract, str(tessdata) if tessdata.is_dir() else None)
            invalid = sum(not _hit_area(word.get("bbox")) for word in result["words"])
            write_json(target, {
                "resourceId": book["resourceId"], "sourceVersion": book["version"],
                "pageNumber": number, "pageImageSha256": sha256(image),
                "reviewStatus": "auto_ocr_candidate_needs_review",
                "averageConfidence": result["averageConfidence"],
                "text": result["text"], "words": result["words"],
                "invalidWordBoxes": invalid,
            })
            written.append({"resourceId": book["resourceId"], "pageNumber": number,
                            "confidence": result["averageConfidence"], "invalidWordBoxes": invalid})
    report = root / "reports/coordinate-candidates-latest.json"
    write_json(report, {"written": written, "skipped": skipped,
                        "note": "OCR candidates do not replace original coordinates or approve point-reading."})
    print(json.dumps({"written": len(written), "skipped": len(skipped),
                      "remainingInvalidCandidateBoxes": sum(item["invalidWordBoxes"] for item in written)}))


if __name__ == "__main__":
    main()
