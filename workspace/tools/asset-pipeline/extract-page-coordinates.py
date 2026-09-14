#!/usr/bin/env python3
"""Extract a PDF page's text and word bounding boxes for manual review."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pdfplumber


def rounded(value: float) -> float:
    return round(value, 6)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf_path", type=Path)
    parser.add_argument("page_number", type=int, help="One-based PDF page number")
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()

    with pdfplumber.open(args.pdf_path) as pdf:
        if not 1 <= args.page_number <= len(pdf.pages):
            raise SystemExit("Page number is outside the PDF")

        page = pdf.pages[args.page_number - 1]
        words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
        payload = {
            "schemaVersion": "1.0",
            "sourceFile": args.pdf_path.name,
            "pageNumber": args.page_number,
            "pageWidth": rounded(page.width),
            "pageHeight": rounded(page.height),
            "extractedText": page.extract_text() or "",
            "coordinateSystem": "top-left origin; normalized values are 0..1",
            "words": [
                {
                    "text": word["text"],
                    "bbox": {
                        "x": rounded(word["x0"] / page.width),
                        "y": rounded(word["top"] / page.height),
                        "width": rounded((word["x1"] - word["x0"]) / page.width),
                        "height": rounded((word["bottom"] - word["top"]) / page.height),
                    },
                }
                for word in words
            ],
        }

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
