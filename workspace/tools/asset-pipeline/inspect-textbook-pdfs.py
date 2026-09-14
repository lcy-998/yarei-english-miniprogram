#!/usr/bin/env python3
"""Inspect textbook PDFs and report whether they contain usable text layers.

The script is intentionally read-only for source PDFs. It writes a JSON report to
the requested location so the result can be reviewed before any content is added
to the mini-program.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pypdf import PdfReader


UNIT_PATTERN = re.compile(r"(?:^|\n)\s*(?:unit|module|starter\s+unit)\s*[0-9a-z]+", re.I)


def clean_preview(text: str, limit: int = 220) -> str:
    compact = " ".join(text.replace("\x00", " ").split())
    return compact[:limit]


def inspect_pdf(pdf_path: Path) -> dict[str, Any]:
    reader = PdfReader(str(pdf_path), strict=False)
    page_metrics: list[dict[str, Any]] = []
    extraction_errors: list[dict[str, Any]] = []
    unit_candidates: list[dict[str, Any]] = []

    for page_index, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception as exc:  # pypdf may encounter malformed page streams.
            text = ""
            extraction_errors.append(
                {"pageNumber": page_index + 1, "error": type(exc).__name__}
            )

        stripped = text.strip()
        metric = {
            "pageNumber": page_index + 1,
            "characterCount": len(stripped),
            "lineCount": len([line for line in stripped.splitlines() if line.strip()]),
            "preview": clean_preview(stripped),
        }
        page_metrics.append(metric)

        if stripped and UNIT_PATTERN.search(stripped) and len(unit_candidates) < 12:
            unit_candidates.append(metric)

    pages_with_text = sum(1 for item in page_metrics if item["characterCount"] >= 20)
    substantial_pages = sum(1 for item in page_metrics if item["characterCount"] >= 100)
    total_pages = len(page_metrics)
    text_coverage = pages_with_text / total_pages if total_pages else 0

    if text_coverage >= 0.8:
        classification = "embedded_text"
    elif text_coverage >= 0.2:
        classification = "mixed"
    else:
        classification = "image_only_or_unusable_text"

    metadata = reader.metadata or {}
    return {
        "fileName": pdf_path.name,
        "sourcePath": str(pdf_path),
        "fileSizeBytes": pdf_path.stat().st_size,
        "pageCount": total_pages,
        "encrypted": reader.is_encrypted,
        "classification": classification,
        "pagesWithText": pages_with_text,
        "substantialTextPages": substantial_pages,
        "textCoverageRatio": round(text_coverage, 4),
        "metadata": {
            "title": metadata.get("/Title"),
            "author": metadata.get("/Author"),
            "creator": metadata.get("/Creator"),
            "producer": metadata.get("/Producer"),
        },
        "unitCandidates": unit_candidates,
        "extractionErrors": extraction_errors,
        "pageMetrics": page_metrics,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_directory", type=Path)
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()

    pdf_paths = sorted(args.source_directory.glob("*.pdf"), key=lambda path: path.name)
    if not pdf_paths:
        raise SystemExit(f"No PDF files found in {args.source_directory}")

    report = {
        "schemaVersion": "1.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceDirectory": str(args.source_directory),
        "sourceFilesAreReadOnly": True,
        "books": [inspect_pdf(path) for path in pdf_paths],
    }

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
