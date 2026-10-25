"""Validate reviewed asset metadata before a resource can become publish-ready.

The automatic extractor only creates candidates. This module never approves a
resource without a versioned review file beside its generated manifest.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image


READING_CATEGORIES = {"original", "synchronized", "picture_book", "current_events", "chapter_book"}
QUESTION_TYPES = {"single_choice", "multiple_choice", "fill", "subjective"}
CONTENT_ROLES = {"cover", "content", "credits"}
AUDIO_FORMATS = {".mp3", ".aac"}
READING_GAPS = ["chapter_structure", "chapter_audio", "sentence_timeline", "follow_read_text", "content_review"]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for part in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest().upper()


def review_path(root: Path, manifest: dict[str, Any]) -> Path | None:
    relative = manifest.get("manifestRelativePath")
    if not isinstance(relative, str) or not relative:
        return None
    directory = (root / relative).parent / "review"
    versions: list[tuple[int, Path]] = []
    for path in directory.glob("approved-content-v*.json"):
        match = re.fullmatch(r"approved-content-v([1-9][0-9]*)\.json", path.name)
        if match:
            versions.append((int(match.group(1)), path))
    return max(versions)[1] if versions else None


def read_review(root: Path, manifest: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    path = review_path(root, manifest)
    if path is None or not path.is_file():
        return None, None
    data = path.read_bytes()
    try:
        review = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, "INVALID_REVIEW_JSON"
    if not isinstance(review, dict) or review.get("reviewRevision") != int(path.stem.rsplit("-v", 1)[1]):
        return None, "REVIEW_FILENAME_REVISION_MISMATCH"
    return review, hashlib.sha256(data).hexdigest().upper()


def safe_file(root: Path, relative: Any) -> Path | None:
    if not isinstance(relative, str) or not relative or "\\" in relative:
        return None
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts:
        return None
    target = (root / path).resolve()
    return target if target.is_relative_to(root.resolve()) and target.is_file() else None


def approved_metadata(review: dict[str, Any], manifest: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    if review.get("schemaVersion") != 1 or review.get("decision") != "approved":
        issues.append("REVIEW_NOT_APPROVED")
    if review.get("resourceId") != manifest.get("resourceId") or review.get("sourceVersion") != manifest.get("version"):
        issues.append("REVIEW_ID_OR_VERSION_MISMATCH")
    if review.get("sourceSha256") != manifest.get("sourceSha256"):
        issues.append("REVIEW_SOURCE_HASH_MISMATCH")
    if not isinstance(review.get("reviewRevision"), int) or isinstance(review.get("reviewRevision"), bool) or review["reviewRevision"] < 1:
        issues.append("REVIEW_REVISION_REQUIRED")
    if not isinstance(review.get("reviewerId"), str) or not review["reviewerId"].strip():
        issues.append("REVIEWER_REQUIRED")
    timestamp = review.get("reviewedAt")
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00")) if isinstance(timestamp, str) else None
    except ValueError:
        parsed = None
    if parsed is None or parsed.tzinfo is None:
        issues.append("REVIEW_TIME_WITH_ZONE_REQUIRED")
    if review.get("copyrightStatus") not in {"demo", "verified"}:
        issues.append("COPYRIGHT_STATUS_REQUIRED")
    return issues


def _media(root: Path, by_source: dict[str, dict[str, Any]], relative: Any) -> tuple[dict[str, Any] | None, str | None]:
    path = safe_file(root, relative)
    if path is None or path.suffix.lower() not in AUDIO_FORMATS:
        return None, "AUDIO_FILE_MISSING_OR_UNSUPPORTED"
    item = by_source.get(relative)
    if item is None or item.get("resourceType") != "audio":
        return None, "AUDIO_NOT_IN_CATALOG"
    if sha256(path) != item.get("sourceSha256"):
        return None, "AUDIO_SOURCE_HASH_MISMATCH"
    duration = item.get("details", {}).get("durationMs")
    if not isinstance(duration, int) or duration <= 0 or duration > 30 * 60 * 1000 or path.stat().st_size > 100 * 1024 * 1024:
        return None, "AUDIO_TECHNICAL_LIMIT"
    return item, None


def _hit_area(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    parts = [value.get(key) for key in ("x", "y", "width", "height")]
    if any(isinstance(part, bool) or not isinstance(part, (int, float)) for part in parts):
        return False
    x, y, width, height = parts
    return 0 <= x < 1 and 0 <= y < 1 and width > 0 and height > 0 and x + width <= 1 and y + height <= 1


def coordinate_audit(root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    book_root = (root / str(manifest["manifestRelativePath"])).parent
    coordinates = book_root / "coordinates"
    found: set[int] = set()
    invalid_pages: dict[int, int] = {}
    for path in coordinates.glob("page-*.json"):
        try:
            number = int(path.stem.removeprefix("page-"))
            payload = json.loads(path.read_text(encoding="utf-8"))
            words = payload["words"]
            if not isinstance(words, list):
                raise ValueError("words_not_list")
            bad = sum(not isinstance(word, dict) or not _hit_area(word.get("bbox")) for word in words)
        except (ValueError, KeyError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        found.add(number)
        if bad:
            invalid_pages[number] = bad
    page_count = manifest.get("details", {}).get("pageCount")
    expected = set(range(1, page_count + 1)) if isinstance(page_count, int) and page_count > 0 else set()
    return {"invalidWordBoxes": sum(invalid_pages.values()),
            "invalidPages": [{"pageNumber": page, "count": count} for page, count in sorted(invalid_pages.items())],
            "missingPages": sorted(expected - found)}


def validate_reading(root: Path, manifest: dict[str, Any], review: dict[str, Any],
                     by_source: dict[str, dict[str, Any]]) -> list[str]:
    issues: list[str] = []
    reading = review.get("reading")
    if not isinstance(reading, dict):
        return ["READING_REVIEW_REQUIRED"]
    if reading.get("category") not in READING_CATEGORIES:
        issues.append("INVALID_READING_CATEGORY")
    if "picture_book" in manifest.get("roles", []) and reading.get("category") != "picture_book":
        issues.append("ROLE_CATEGORY_MISMATCH")
    for field in ("grade", "difficulty"):
        if not isinstance(reading.get(field), str) or not reading[field].strip():
            issues.append(f"READING_{field.upper()}_REQUIRED")
    if reading.get("category") == "synchronized":
        for field in ("term", "textbook"):
            if not isinstance(reading.get(field), str) or not reading[field].strip():
                issues.append(f"READING_{field.upper()}_REQUIRED")
    attachments = reading.get("attachments", [])
    if not isinstance(attachments, list):
        issues.append("READING_ATTACHMENTS_INVALID")
    else:
        for index, attachment in enumerate(attachments, 1):
            if not isinstance(attachment, dict) or attachment.get("kind") not in {"subtitle", "timeline", "question_mapping"}:
                issues.append(f"ATTACHMENT_{index}_KIND_INVALID")
                continue
            path = safe_file(root, attachment.get("sourceRelativePath"))
            allowed = {"subtitle": {".vtt"}, "timeline": {".json"}, "question_mapping": {".json"}}
            if path is None or path.suffix.lower() not in allowed[attachment["kind"]]:
                issues.append(f"ATTACHMENT_{index}_FILE_INVALID")
            elif sha256(path) != attachment.get("sha256"):
                issues.append(f"ATTACHMENT_{index}_HASH_MISMATCH")
    chapter_rows = reading.get("chapters")
    page_rows = reading.get("pages")
    if not isinstance(chapter_rows, list) or not chapter_rows or not isinstance(page_rows, list):
        return issues + ["CHAPTERS_AND_PAGES_REQUIRED"]
    page_count = manifest.get("details", {}).get("pageCount")
    if not isinstance(page_count, int) or page_count < 1:
        return issues + ["SOURCE_PAGE_COUNT_INVALID"]
    by_page: dict[int, dict[str, Any]] = {}
    page_ids: set[str] = set()
    for page in page_rows:
        number = page.get("pageNumber") if isinstance(page, dict) else None
        if not isinstance(number, int) or isinstance(number, bool) or number in by_page:
            issues.append("PAGE_NUMBER_INVALID_OR_DUPLICATE")
            continue
        by_page[number] = page
        page_id = page.get("id")
        if not isinstance(page_id, str) or not page_id.strip() or page_id in page_ids:
            issues.append("PAGE_ID_INVALID_OR_DUPLICATE")
        else:
            page_ids.add(page_id)
    if sorted(by_page) != list(range(1, page_count + 1)):
        issues.append("PAGE_SET_INCOMPLETE")
    chapter_ids: set[str] = set()
    chapter_orders: set[int] = set()
    assigned: list[int] = []
    for chapter in chapter_rows:
        if not isinstance(chapter, dict) or not isinstance(chapter.get("id"), str) or not chapter["id"].strip() \
                or chapter["id"] in chapter_ids or not isinstance(chapter.get("title"), str) or not chapter["title"].strip() \
                or not isinstance(chapter.get("order"), int) or isinstance(chapter.get("order"), bool) or chapter["order"] < 1:
            issues.append("CHAPTER_INVALID")
            continue
        chapter_ids.add(chapter["id"])
        if chapter["order"] in chapter_orders:
            issues.append("CHAPTER_ORDER_DUPLICATE")
        chapter_orders.add(chapter["order"])
        numbers = chapter.get("pageNumbers")
        if not isinstance(numbers, list) or not numbers or any(not isinstance(n, int) or isinstance(n, bool) for n in numbers):
            issues.append("CHAPTER_PAGE_NUMBERS_INVALID")
        else:
            assigned.extend(numbers)
        _, error = _media(root, by_source, chapter.get("audioSourceRelativePath"))
        if error:
            issues.append("CHAPTER_" + error)
    if sorted(assigned) != list(range(1, page_count + 1)):
        issues.append("CHAPTER_PAGE_ASSIGNMENT_INCOMPLETE")
    book_root = (root / str(manifest["manifestRelativePath"])).parent
    for number, page in by_page.items():
        role = page.get("role")
        if role not in CONTENT_ROLES:
            issues.append(f"PAGE_{number}_ROLE_INVALID")
        image = book_root / "pages" / f"page-{number:04d}.jpg"
        thumb = book_root / "thumbnails" / f"page-{number:04d}.jpg"
        if not image.is_file() or not thumb.is_file():
            issues.append(f"PAGE_{number}_IMAGE_OR_THUMBNAIL_MISSING")
        else:
            if sha256(image) != page.get("imageSha256") or sha256(thumb) != page.get("thumbnailSha256"):
                issues.append(f"PAGE_{number}_REVIEWED_IMAGE_HASH_MISMATCH")
            try:
                with Image.open(image) as source_image, Image.open(thumb) as source_thumb:
                    if min(*source_image.size, *source_thumb.size) < 1:
                        issues.append(f"PAGE_{number}_IMAGE_INVALID")
            except OSError:
                issues.append(f"PAGE_{number}_IMAGE_INVALID")
        if role != "content":
            if page.get("audioSourceRelativePath") is not None:
                _, error = _media(root, by_source, page.get("audioSourceRelativePath"))
                if error:
                    issues.append(f"PAGE_{number}_{error}")
            continue
        for field in ("ocrText", "followReadText"):
            if not isinstance(page.get(field), str) or not page[field].strip():
                issues.append(f"PAGE_{number}_{field.upper()}_REQUIRED")
        audio, error = _media(root, by_source, page.get("audioSourceRelativePath"))
        if error:
            issues.append(f"PAGE_{number}_{error}")
        mappings = page.get("sentenceMappings")
        if not isinstance(mappings, list) or not mappings:
            issues.append(f"PAGE_{number}_SENTENCE_MAPPINGS_REQUIRED")
            continue
        for mapping in mappings:
            if not isinstance(mapping, dict) or not isinstance(mapping.get("text"), str) or not mapping["text"].strip():
                issues.append(f"PAGE_{number}_SENTENCE_TEXT_REQUIRED")
                continue
            if not isinstance(mapping.get("hitAreas"), list) or not mapping["hitAreas"] \
                    or not all(_hit_area(area) for area in mapping["hitAreas"]):
                issues.append(f"PAGE_{number}_HIT_AREA_INVALID")
            follow_text = page.get("followReadText")
            normalized_source = re.sub(r"\s+", " ", follow_text if isinstance(follow_text, str) else "").casefold()
            normalized_mapping = re.sub(r"\s+", " ", mapping["text"]).casefold()
            if normalized_mapping not in normalized_source:
                issues.append(f"PAGE_{number}_SENTENCE_TEXT_MISMATCH")
            start, end = mapping.get("startMs"), mapping.get("endMs")
            if not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int) or isinstance(end, bool) \
                    or start < 0 or end <= start or audio is None or end > audio["details"]["durationMs"]:
                issues.append(f"PAGE_{number}_SENTENCE_AUDIO_RANGE_INVALID")
    return sorted(set(issues))


def validate_vocabulary(root: Path, review: dict[str, Any],
                        by_source: dict[str, dict[str, Any]]) -> list[str]:
    pack = review.get("vocabulary")
    if not isinstance(pack, dict):
        return ["VOCABULARY_REVIEW_REQUIRED"]
    issues: list[str] = []
    for field in ("grade", "unit"):
        if not isinstance(pack.get(field), str) or not pack[field].strip():
            issues.append(f"VOCABULARY_{field.upper()}_REQUIRED")
    words = pack.get("words")
    if not isinstance(words, list) or not words:
        return issues + ["VOCABULARY_WORDS_REQUIRED"]
    ids: set[str] = set()
    for index, item in enumerate(words, 1):
        if not isinstance(item, dict):
            issues.append(f"WORD_{index}_INVALID")
            continue
        for field in ("id", "word", "meaning", "example"):
            if not isinstance(item.get(field), str) or not item[field].strip():
                issues.append(f"WORD_{index}_{field.upper()}_REQUIRED")
        word_id = item.get("id")
        if isinstance(word_id, str):
            if word_id in ids:
                issues.append("WORD_ID_DUPLICATE")
            ids.add(word_id)
        syllables = item.get("syllables")
        if not isinstance(syllables, list) or not syllables or any(not isinstance(part, str) or not part.strip() for part in syllables):
            issues.append(f"WORD_{index}_SYLLABLES_REQUIRED")
        elif isinstance(item.get("word"), str):
            normalize = lambda text: re.sub(r"[^a-z]", "", text.casefold())
            if normalize("".join(syllables)) != normalize(item["word"]):
                issues.append(f"WORD_{index}_SYLLABLES_DO_NOT_JOIN_TO_WORD")
        audio, error = _media(root, by_source, item.get("audioSourceRelativePath"))
        if error:
            issues.append(f"WORD_{index}_{error}")
        start, end = item.get("startMs"), item.get("endMs")
        if not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int) or isinstance(end, bool) \
                or start < 0 or end <= start or audio is None or end > audio["details"]["durationMs"]:
            issues.append(f"WORD_{index}_AUDIO_RANGE_INVALID")
    return sorted(set(issues))


def validate_exercise(root: Path, review: dict[str, Any],
                      by_source: dict[str, dict[str, Any]]) -> list[str]:
    question = review.get("exercise")
    if not isinstance(question, dict):
        return ["EXERCISE_REVIEW_REQUIRED"]
    issues: list[str] = []
    for field in ("grade", "stem", "explanation"):
        if not isinstance(question.get(field), str) or not question[field].strip():
            issues.append(f"EXERCISE_{field.upper()}_REQUIRED")
    kind = question.get("questionType")
    if kind not in QUESTION_TYPES:
        issues.append("EXERCISE_QUESTION_TYPE_INVALID")
    options = question.get("options")
    if not isinstance(options, list) or any(not isinstance(option, str) or not option.strip() for option in options) \
            or len(options) != len(set(options)):
        issues.append("EXERCISE_OPTIONS_INVALID")
        options = []
    answer = question.get("correctAnswer")
    if kind == "single_choice" and (len(options) < 2 or answer not in options):
        issues.append("EXERCISE_SINGLE_CHOICE_ANSWER_INVALID")
    elif kind == "multiple_choice" and (len(options) < 2 or not isinstance(answer, list)
                                           or not answer or any(value not in options for value in answer)):
        issues.append("EXERCISE_MULTIPLE_CHOICE_ANSWER_INVALID")
    elif kind in {"fill", "subjective"} and (not isinstance(answer, str) or not answer.strip()):
        issues.append("EXERCISE_TEXT_ANSWER_REQUIRED")
    content_version = review.get("contentVersion")
    if not isinstance(content_version, int) or isinstance(content_version, bool) or content_version < 1:
        issues.append("EXERCISE_CONTENT_VERSION_REQUIRED")
    listening = question.get("listening")
    if listening is not None:
        if not isinstance(listening, dict) or not isinstance(listening.get("transcript"), str) \
                or not listening["transcript"].strip():
            issues.append("LISTENING_TRANSCRIPT_REQUIRED")
        else:
            audio, error = _media(root, by_source, listening.get("audioSourceRelativePath"))
            if error:
                issues.append("LISTENING_" + error)
            start, end = listening.get("startMs"), listening.get("endMs")
            if not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int) or isinstance(end, bool) \
                    or start < 0 or end <= start or audio is None or end > audio["details"]["durationMs"]:
                issues.append("LISTENING_AUDIO_RANGE_INVALID")
    return sorted(set(issues))


def validate_review(root: Path, manifest: dict[str, Any], resources: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str | None, list[str]]:
    review, digest = read_review(root, manifest)
    if review is None:
        return None, digest, [digest or "REVIEW_REQUIRED"]
    issues = approved_metadata(review, manifest)
    source = safe_file(root, manifest.get("sourceRelativePath"))
    if source is None or sha256(source) != manifest.get("sourceSha256"):
        issues.append("RESOURCE_SOURCE_HASH_MISMATCH")
    if manifest.get("processingStatus") in {"needs_ocr", "blocked_error", "discovered"}:
        issues.append("TECHNICAL_EXTRACTION_INCOMPLETE")
    if manifest.get("details", {}).get("processingErrors"):
        issues.append("TECHNICAL_EXTRACTION_ERRORS")
    by_source = {item.get("sourceRelativePath"): item for item in resources}
    if manifest.get("resourceType") == "textbook":
        issues.extend(validate_reading(root, manifest, review, by_source))
    elif manifest.get("resourceType") == "audio":
        _, error = _media(root, by_source, manifest.get("sourceRelativePath"))
        if error:
            issues.append(error)
        if review.get("contentRole") not in {"chapter_audio", "page_audio", "sentence_audio", "word_audio", "listening_audio", "demonstration_audio"}:
            issues.append("AUDIO_ROLE_REQUIRED")
    elif manifest.get("resourceType") == "video":
        technical = review.get("technicalReview")
        details = manifest.get("details", {})
        if not isinstance(technical, dict) or technical.get("videoCodec") != "h264" or technical.get("audioCodec") != "aac" \
                or technical.get("scanStatus") != "passed":
            issues.append("VIDEO_TECHNICAL_REVIEW_REQUIRED")
        if details.get("videoCodec") != "h264" or details.get("audioCodec") != "aac" \
                or not isinstance(details.get("durationMs"), int) or details["durationMs"] <= 0 \
                or details["durationMs"] > 30 * 60 * 1000 or manifest.get("sourceSizeBytes", 0) > 500 * 1024 * 1024:
            issues.append("VIDEO_TECHNICAL_PROBE_REQUIRED")
    elif manifest.get("resourceType") == "supplement" and review.get("contentType") == "vocabulary":
        issues.extend(validate_vocabulary(root, review, by_source))
    elif manifest.get("resourceType") == "supplement" and review.get("contentType") == "exercise":
        issues.extend(validate_exercise(root, review, by_source))
    else:
        issues.append("UNSUPPORTED_REVIEW_TYPE")
    previous = manifest.get("details", {})
    if previous.get("reviewRevision") == review.get("reviewRevision") and previous.get("reviewSha256") not in {None, digest}:
        issues.append("REVIEW_CHANGED_WITHOUT_REVISION")
    return review, digest, sorted(set(issues))


def reconcile_review(root: Path, manifest: dict[str, Any], resources: list[dict[str, Any]]) -> dict[str, Any]:
    if manifest.get("version", 0) < 1 or not manifest.get("manifestRelativePath"):
        return manifest
    review, digest, issues = validate_review(root, manifest, resources)
    details = dict(manifest.get("details", {}))
    if manifest.get("resourceType") == "textbook":
        details["coordinateAudit"] = coordinate_audit(root, manifest)
    if review is None:
        if digest is not None:
            details["reviewIssues"] = [digest]
            details["missingComponents"] = [digest]
            return {**manifest, "details": details, "processingStatus": "needs_review"}
        if manifest.get("resourceType") == "textbook":
            details["missingComponents"] = READING_GAPS
        elif manifest.get("resourceType") == "audio":
            details["missingComponents"] = ["content_role_confirmation"]
        return {**manifest, "details": details, "processingStatus": "needs_review"}
    details["reviewIssues"] = issues
    if issues:
        details["missingComponents"] = issues
        return {**manifest, "details": details, "processingStatus": "needs_review"}
    details["missingComponents"] = []
    details["reviewRevision"] = review["reviewRevision"]
    details["reviewSha256"] = digest
    details["reviewedAt"] = review["reviewedAt"]
    return {**manifest, "details": details, "processingStatus": "publish_ready"}
