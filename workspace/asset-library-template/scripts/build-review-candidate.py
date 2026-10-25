#!/usr/bin/env python3
"""Scaffold a pending reading review from aligned Storybooks candidates.

The output is deliberately not named approved-content-vN.json and never grants a
publish-ready state. Multi-sentence pages remain unmapped for human editing.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from content_review import sha256


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--resource-id", required=True)
    parser.add_argument("--output-name", default="content-candidate.json")
    args = parser.parse_args()
    if not re.fullmatch(r"content-candidate(?:-v[1-9][0-9]*)?\.json", args.output_name):
        raise ValueError("output-name must be a versioned content-candidate JSON filename")
    root = args.root.resolve()
    catalog = json.loads((root / "library/catalog.json").read_text(encoding="utf-8"))
    by_id = {item["resourceId"]: item for item in catalog["resources"]}
    book = by_id[args.resource_id]
    if book["resourceType"] != "textbook" or "picture_book" not in book.get("roles", []):
        raise ValueError("Only a versioned picture-book source is supported")
    book_root = (root / book["manifestRelativePath"]).parent
    candidate = json.loads((book_root / "review/page-audio-candidate.json").read_text(encoding="utf-8"))
    if candidate["resourceId"] != args.resource_id:
        raise ValueError("Candidate/resource mismatch")
    full_audio = by_id[candidate["fullNarrationResourceId"]]["sourceRelativePath"]
    pages = []
    unmapped = []
    for item in candidate["pages"]:
        number = item["pageNumber"]
        role = "content" if item["role"] == "story" else item["role"]
        page = {
            "id": f"page_{args.resource_id}_{number:04d}",
            "pageNumber": number,
            "role": role,
            "ocrText": item.get("text", ""),
            "imageSha256": sha256(book_root / "pages" / f"page-{number:04d}.jpg"),
            "thumbnailSha256": sha256(book_root / "thumbnails" / f"page-{number:04d}.jpg"),
        }
        if item.get("audioResourceId"):
            page["audioSourceRelativePath"] = by_id[item["audioResourceId"]]["sourceRelativePath"]
        if role == "content":
            text = item["text"]
            page["followReadText"] = text
            single_sentence = len(re.findall(r"[.!?](?:\s|$)", text)) == 1
            area = item.get("textHitArea")
            if single_sentence and isinstance(area, dict):
                catalog_duration = by_id[item["audioResourceId"]]["details"].get("durationMs")
                if not isinstance(catalog_duration, int) or catalog_duration <= 0:
                    raise ValueError(f"Missing probed duration for page {number}")
                page["sentenceMappings"] = [{
                    "text": text, "hitAreas": [area],
                    "startMs": 0, "endMs": min(item["audioDurationMs"], catalog_duration),
                }]
            else:
                page["sentenceMappings"] = []
                unmapped.append(number)
        pages.append(page)
    review = {
        "schemaVersion": 1, "decision": "pending",
        "resourceId": args.resource_id, "sourceVersion": book["version"],
        "sourceSha256": book["sourceSha256"], "reviewRevision": 1,
        "reviewerId": None, "reviewedAt": None, "copyrightStatus": None,
        "reading": {
            "category": "picture_book", "grade": None, "difficulty": None,
            "chapters": [{
                "id": f"chapter_{args.resource_id}_001", "title": book["title"],
                "order": 1, "pageNumbers": [item["pageNumber"] for item in pages],
                "audioSourceRelativePath": full_audio,
            }],
            "pages": pages,
        },
        "reviewNotes": {
            "manualChecks": ["grade_and_difficulty", "read_aloud_audio", "page_hot_areas",
                             "chapter_boundaries", "text_reading_order"],
            "multiSentencePagesWithoutSentenceTiming": unmapped,
        },
    }
    target = book_root / "review" / args.output_name
    if target.exists():
        raise FileExistsError(f"Refusing overwrite: {target}")
    target.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"resourceId": args.resource_id, "pages": len(pages),
                      "unmappedSentencePages": unmapped,
                      "relativePath": target.relative_to(root).as_posix()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
