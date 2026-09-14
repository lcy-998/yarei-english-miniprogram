#!/usr/bin/env python3
"""Incremental asset ingestion for the Yarei English content library."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from pypdf import PdfReader
from PIL import Image

try:
    import pdfplumber
except ImportError:
    pdfplumber = None


SUPPORTED_EXTENSIONS = {
    ".pdf", ".mp3", ".aac", ".m4a", ".wav", ".mp4",
    ".vtt", ".srt", ".txt", ".json", ".csv", ".xlsx", ".docx",
}
EXCLUDED_DIRECTORIES = {
    "library", "reports", "exports", "scripts", "docs", "config", ".git", "__pycache__",
}
UNIT_PATTERN = re.compile(r"(?:^|\n)\s*(?:unit|module|starter\s+unit)\s*[0-9a-z]+", re.I)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def safe_relative(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def discover_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        relative_parts = path.relative_to(root).parts[:-1]
        if any(part.lower() in EXCLUDED_DIRECTORIES for part in relative_parts):
            continue
        files.append(path)
    return sorted(files, key=lambda item: item.as_posix().lower())


def infer_roles(path: Path) -> list[str]:
    name = path.stem.lower()
    suffix = path.suffix.lower()
    roles: list[str] = []
    if suffix == ".pdf":
        roles.append("textbook")
    elif suffix in {".mp3", ".aac", ".m4a", ".wav"}:
        if "单词" in name or "word" in name or "vocab" in name:
            roles.append("word_audio")
        elif "听力" in name or "listen" in name:
            roles.append("listening_audio")
        elif "课文" in name or "章节" in name or "chapter" in name:
            roles.append("chapter_audio")
        else:
            roles.append("unclassified_audio")
    elif suffix == ".mp4":
        roles.append("video_dubbing" if "配音" in name or "dubbing" in name else "unclassified_video")
    elif suffix in {".vtt", ".srt"}:
        roles.append("subtitle")
    else:
        if "答案" in name or "answer" in name:
            roles.append("structured_questions")
        elif "原文" in name or "transcript" in name:
            roles.append("listening_transcript")
        elif "单词" in name or "vocab" in name:
            roles.append("structured_vocabulary")
        else:
            roles.append("supplement")
    return roles


def resource_kind(path: Path, override: dict[str, Any]) -> str:
    if override.get("resourceType"):
        return str(override["resourceType"])
    if path.suffix.lower() == ".pdf":
        return "textbook"
    if path.suffix.lower() in {".mp3", ".aac", ".m4a", ".wav"}:
        return "audio"
    if path.suffix.lower() == ".mp4":
        return "video"
    return "supplement"


def resource_prefix(kind: str) -> str:
    return {"textbook": "book", "audio": "audio", "video": "video"}.get(kind, "supplement")


def make_resource_id(kind: str, digest: str, override: dict[str, Any]) -> str:
    if override.get("resourceId"):
        return str(override["resourceId"])
    return f"{resource_prefix(kind)}-{digest[:12].lower()}"


def read_config(script_root: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    overrides = json.loads((script_root / "config" / "resource-overrides.json").read_text(encoding="utf-8"))
    expected = json.loads((script_root / "config" / "expected-resources.json").read_text(encoding="utf-8"))
    return overrides, expected["items"]


def ocr_page(
    image_path: Path,
    tesseract: str,
    tessdata_dir: str | None,
) -> dict[str, Any]:
    command = [tesseract, str(image_path), "stdout", "-l", "eng+chi_sim", "--oem", "1", "--psm", "3"]
    if tessdata_dir:
        command.extend(["--tessdata-dir", tessdata_dir])
    command.append("tsv")
    completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip()[-800:] or f"tesseract_exit_{completed.returncode}")

    with Image.open(image_path) as image:
        image_width, image_height = image.size

    words: list[dict[str, Any]] = []
    line_text: dict[tuple[str, str, str, str], list[str]] = {}
    confidence_values: list[float] = []
    reader = csv.DictReader(io.StringIO(completed.stdout), delimiter="\t")
    for row in reader:
        if row.get("level") != "5":
            continue
        text = (row.get("text") or "").strip()
        if not text:
            continue
        try:
            confidence = float(row.get("conf") or -1)
            left = int(row.get("left") or 0)
            top = int(row.get("top") or 0)
            width = int(row.get("width") or 0)
            height = int(row.get("height") or 0)
        except ValueError:
            continue
        if confidence >= 0:
            confidence_values.append(confidence)
        line_key = (
            row.get("block_num", "0"), row.get("par_num", "0"),
            row.get("line_num", "0"), row.get("page_num", "1"),
        )
        line_text.setdefault(line_key, []).append(text)
        words.append({
            "text": text,
            "confidence": round(confidence, 2),
            "bbox": {
                "x": round(left / image_width, 6),
                "y": round(top / image_height, 6),
                "width": round(width / image_width, 6),
                "height": round(height / image_height, 6),
            },
        })

    text = "\n".join(" ".join(parts) for parts in line_text.values()).strip()
    average_confidence = round(sum(confidence_values) / len(confidence_values), 2) if confidence_values else None
    return {
        "text": text,
        "words": words,
        "averageConfidence": average_confidence,
        "imageWidth": image_width,
        "imageHeight": image_height,
    }


def extract_pdf(
    source: Path,
    target: Path,
    coordinates_mode: str,
    render_mode: str,
    pdftoppm: str | None,
    pilot_pages: Iterable[int],
    ocr_mode: str,
    tesseract: str | None,
    tessdata_dir: str | None,
) -> dict[str, Any]:
    reader = PdfReader(str(source), strict=False)
    page_rows: list[dict[str, Any]] = []
    unit_candidates: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    text_path = target / "text" / "pages.jsonl"
    text_path.parent.mkdir(parents=True, exist_ok=True)

    with text_path.open("w", encoding="utf-8") as output:
        for page_index, page in enumerate(reader.pages, start=1):
            try:
                text = (page.extract_text() or "").strip()
            except Exception as exc:
                text = ""
                errors.append({"pageNumber": page_index, "stage": "text", "error": type(exc).__name__})
            row = {
                "pageNumber": page_index,
                "characterCount": len(text),
                "text": text,
            }
            page_rows.append(row)
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
            if text and UNIT_PATTERN.search(text) and len(unit_candidates) < 30:
                unit_candidates.append({
                    "pageNumber": page_index,
                    "preview": " ".join(text.split())[:240],
                })

    page_count = len(page_rows)
    pages_with_text = sum(1 for row in page_rows if row["characterCount"] >= 20)
    coverage = pages_with_text / page_count if page_count else 0.0
    classification = "embedded_text" if coverage >= 0.8 else "mixed" if coverage >= 0.2 else "needs_ocr"

    coordinate_pages: list[int] = []
    if coordinates_mode == "all":
        coordinate_pages = [row["pageNumber"] for row in page_rows if row["characterCount"] > 0]
    elif coordinates_mode == "sample":
        coordinate_pages = [row["pageNumber"] for row in page_rows if row["characterCount"] >= 100][:3]
    coordinate_errors: list[dict[str, Any]] = []
    if coordinate_pages and pdfplumber is None:
        coordinate_errors.append({"stage": "coordinates", "error": "pdfplumber_not_installed"})
    elif coordinate_pages:
        with pdfplumber.open(source) as pdf:
            for page_number in coordinate_pages:
                try:
                    page = pdf.pages[page_number - 1]
                    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
                    payload = {
                        "pageNumber": page_number,
                        "pageWidth": round(page.width, 6),
                        "pageHeight": round(page.height, 6),
                        "coordinateSystem": "normalized_top_left_0_to_1",
                        "reviewStatus": "auto_extracted_needs_review",
                        "words": [
                            {
                                "text": word["text"],
                                "bbox": {
                                    "x": round(word["x0"] / page.width, 6),
                                    "y": round(word["top"] / page.height, 6),
                                    "width": round((word["x1"] - word["x0"]) / page.width, 6),
                                    "height": round((word["bottom"] - word["top"]) / page.height, 6),
                                },
                            }
                            for word in words
                        ],
                    }
                    write_json(target / "coordinates" / f"page-{page_number:04d}.json", payload)
                except Exception as exc:
                    coordinate_errors.append({"pageNumber": page_number, "stage": "coordinates", "error": type(exc).__name__})

    requested_render_pages: list[int] = []
    if render_mode == "all":
        requested_render_pages = list(range(1, page_count + 1))
    elif render_mode == "sample":
        requested_render_pages = sorted({1, *[page for page in pilot_pages if 1 <= page <= page_count]})
        if len(requested_render_pages) == 1:
            first_content = next((row["pageNumber"] for row in page_rows if row["characterCount"] >= 100), None)
            if first_content:
                requested_render_pages.append(first_content)
    if classification == "needs_ocr" and ocr_mode == "all":
        requested_render_pages = list(range(1, page_count + 1))

    render_errors: list[dict[str, Any]] = []
    rendered_pages: list[int] = []
    if requested_render_pages and not pdftoppm:
        render_errors.append({"stage": "render", "error": "pdftoppm_not_found"})
    elif requested_render_pages:
        pages_dir = target / "pages"
        pages_dir.mkdir(parents=True, exist_ok=True)
        for page_number in requested_render_pages:
            prefix = pages_dir / f"page-{page_number:04d}"
            command = [
                str(pdftoppm), "-f", str(page_number), "-l", str(page_number),
                "-jpeg", "-jpegopt", "quality=86", "-scale-to-x", "1600",
                "-scale-to-y", "-1", "-singlefile", str(source), str(prefix),
            ]
            completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
            if completed.returncode == 0 and prefix.with_suffix(".jpg").exists():
                rendered_pages.append(page_number)
            else:
                render_errors.append({
                    "pageNumber": page_number,
                    "stage": "render",
                    "error": completed.stderr.strip()[-500:] or f"exit_{completed.returncode}",
                })

    ocr_errors: list[dict[str, Any]] = []
    ocr_pages: list[int] = []
    if classification == "needs_ocr" and ocr_mode != "none":
        if not tesseract:
            ocr_errors.append({"stage": "ocr", "error": "tesseract_not_found"})
        else:
            candidate_pages = rendered_pages if ocr_mode == "all" else rendered_pages[:3]
            for page_number in candidate_pages:
                image_path = target / "pages" / f"page-{page_number:04d}.jpg"
                try:
                    ocr_result = ocr_page(image_path, tesseract, tessdata_dir)
                    page_rows[page_number - 1] = {
                        "pageNumber": page_number,
                        "characterCount": len(ocr_result["text"]),
                        "text": ocr_result["text"],
                        "source": "tesseract_ocr_eng_chi_sim",
                        "averageConfidence": ocr_result["averageConfidence"],
                    }
                    write_json(target / "coordinates" / f"page-{page_number:04d}.json", {
                        "pageNumber": page_number,
                        "pageWidth": ocr_result["imageWidth"],
                        "pageHeight": ocr_result["imageHeight"],
                        "coordinateSystem": "normalized_top_left_0_to_1",
                        "source": "tesseract_ocr_eng_chi_sim",
                        "reviewStatus": "auto_extracted_needs_review",
                        "averageConfidence": ocr_result["averageConfidence"],
                        "words": ocr_result["words"],
                    })
                    ocr_pages.append(page_number)
                except Exception as exc:
                    ocr_errors.append({
                        "pageNumber": page_number,
                        "stage": "ocr",
                        "error": f"{type(exc).__name__}: {exc}",
                    })

            with text_path.open("w", encoding="utf-8") as output:
                for row in page_rows:
                    output.write(json.dumps(row, ensure_ascii=False) + "\n")

            if ocr_mode == "all":
                pages_with_text = sum(1 for row in page_rows if row["characterCount"] >= 20)
                coverage = pages_with_text / page_count if page_count else 0.0
                if coverage >= 0.8 and not ocr_errors:
                    classification = "ocr_text"
                    coordinate_pages = ocr_pages
                    unit_candidates = []
                    for row in page_rows:
                        if row["text"] and UNIT_PATTERN.search(row["text"]) and len(unit_candidates) < 30:
                            unit_candidates.append({
                                "pageNumber": row["pageNumber"],
                                "preview": " ".join(row["text"].split())[:240],
                            })

    all_errors = errors + coordinate_errors + render_errors + ocr_errors
    missing = ["chapter_structure", "chapter_audio", "sentence_timeline", "follow_read_text", "structured_vocabulary", "structured_questions"]
    if classification == "needs_ocr":
        missing.insert(0, "ocr_text")
    return {
        "pageCount": page_count,
        "pagesWithText": pages_with_text,
        "textCoverageRatio": round(coverage, 4),
        "pdfClassification": classification,
        "unitCandidates": unit_candidates,
        "coordinatePages": coordinate_pages,
        "renderedPages": rendered_pages,
        "ocrPages": ocr_pages,
        "ocrMode": ocr_mode,
        "ocrLanguages": ["eng", "chi_sim"] if ocr_pages else [],
        "processingErrors": all_errors,
        "missingComponents": missing,
        "processingStatus": "needs_ocr" if classification == "needs_ocr" else "needs_review",
    }


def probe_media(source: Path, ffprobe: str | None) -> dict[str, Any]:
    details: dict[str, Any] = {
        "format": source.suffix.lower().lstrip("."),
        "durationMs": None,
        "codec": None,
        "processingStatus": "needs_review",
        "processingErrors": [],
    }
    if source.suffix.lower() == ".wav":
        try:
            with wave.open(str(source), "rb") as audio:
                details["durationMs"] = round(audio.getnframes() * 1000 / audio.getframerate())
                details["sampleRate"] = audio.getframerate()
                details["channels"] = audio.getnchannels()
                details["codec"] = "pcm"
                details["missingComponents"] = ["web_delivery_mp3_or_aac", "content_role_confirmation"]
                return details
        except Exception as exc:
            details["processingErrors"].append({"stage": "probe", "error": type(exc).__name__})
            return details
    if ffprobe:
        command = [ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(source)]
        completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if completed.returncode == 0:
            payload = json.loads(completed.stdout)
            media_format = payload.get("format", {})
            streams = payload.get("streams", [])
            details["durationMs"] = round(float(media_format["duration"]) * 1000) if media_format.get("duration") else None
            details["codec"] = streams[0].get("codec_name") if streams else None
        else:
            details["processingErrors"].append({"stage": "probe", "error": completed.stderr.strip()[-500:]})
    else:
        details["processingErrors"].append({"stage": "probe", "error": "ffprobe_not_found"})
    details["missingComponents"] = ["content_role_confirmation"]
    return details


def process_supplement(source: Path) -> dict[str, Any]:
    return {
        "processingStatus": "needs_review",
        "processingErrors": [],
        "missingComponents": ["content_role_confirmation", "target_resource_mapping"],
    }


def markdown_table(rows: list[list[str]]) -> str:
    if not rows:
        return "暂无。"
    header = rows[0]
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    lines.extend("| " + " | ".join(str(cell).replace("|", "\\|") for cell in row) + " |" for row in rows[1:])
    return "\n".join(lines)


def generate_human_reports(output_root: Path, resources: list[dict[str, Any]], expected: list[dict[str, Any]], run: dict[str, Any]) -> None:
    existing_rows = [["资源 ID", "类型", "标题", "源文件", "版本", "处理状态", "页面图", "缩略图", "坐标页", "文字覆盖", "待补齐"]]
    all_roles: set[str] = set()
    review_rows: list[str] = []
    for item in resources:
        all_roles.update(item.get("roles", []))
        details = item.get("details", {})
        version_root = None
        if item.get("manifestRelativePath"):
            version_root = (output_root / item["manifestRelativePath"]).parent
        if item["resourceType"] == "textbook" and version_root and (version_root / "pages").exists():
            thumbnail_root = version_root / "thumbnails"
            thumbnail_root.mkdir(parents=True, exist_ok=True)
            for page_path in sorted((version_root / "pages").glob("*.jpg")):
                thumbnail_path = thumbnail_root / page_path.name
                if thumbnail_path.exists() and thumbnail_path.stat().st_mtime >= page_path.stat().st_mtime:
                    continue
                with Image.open(page_path) as page_image:
                    page_image.thumbnail((320, 480), Image.Resampling.LANCZOS)
                    page_image.convert("RGB").save(thumbnail_path, "JPEG", quality=80, optimize=True)
        page_image_count = len(list((version_root / "pages").glob("*.jpg"))) if version_root and (version_root / "pages").exists() else 0
        thumbnail_count = len(list((version_root / "thumbnails").glob("*.jpg"))) if version_root and (version_root / "thumbnails").exists() else 0
        coordinate_count = len(list((version_root / "coordinates").glob("*.json"))) if version_root and (version_root / "coordinates").exists() else 0
        coverage = details.get("textCoverageRatio")
        coverage_text = f"{coverage:.1%}" if isinstance(coverage, float) else "—"
        missing = ", ".join(details.get("missingComponents", [])) or "—"
        existing_rows.append([
            item["resourceId"], item["resourceType"], item["title"], item["sourceRelativePath"],
            f"v{item['version']}", item["processingStatus"], str(page_image_count), str(thumbnail_count), str(coordinate_count), coverage_text, missing,
        ])
        if item["processingStatus"] not in {"approved", "publish_ready", "published"}:
            review_rows.append(f"- `{item['resourceId']}`：状态 `{item['processingStatus']}`；{missing}")
        for field in item.get("needsMetadata", []):
            review_rows.append(f"- `{item['resourceId']}`：需要确认元数据 `{field}`。")
        if "unclassified_audio" in item.get("roles", []):
            review_rows.append(f"- `{item['resourceId']}`：需要确认音频对应教材、单元和用途。")
        if details.get("pdfClassification") == "ocr_text" and version_root:
            low_confidence_pages: list[str] = []
            for coordinate_path in sorted((version_root / "coordinates").glob("*.json")):
                coordinate = json.loads(coordinate_path.read_text(encoding="utf-8"))
                confidence = coordinate.get("averageConfidence")
                if isinstance(confidence, (int, float)) and confidence < 75:
                    low_confidence_pages.append(f"{coordinate['pageNumber']}({confidence:.1f}%)")
            if low_confidence_pages:
                review_rows.append(
                    f"- `{item['resourceId']}`：OCR 平均置信度低于 75% 的页面：{', '.join(low_confidence_pages)}。"
                )

    gap_rows = [["所需资源", "角色代码", "当前状态", "说明"]]
    for expected_item in expected:
        role = expected_item["role"]
        present = role in all_roles
        gap_rows.append([
            expected_item["label"], role, "已发现" if present else "未加入",
            "仍需完成内容复核" if present else "放入源文件后由流水线登记",
        ])

    catalog = f"""# 英语资产资源表

> 自动生成时间：{utc_now()}  
> 机器目录：`library/catalog.json`  
> 版权策略：用户已确认本目录资料无版权问题

## 现有资源

{markdown_table(existing_rows)}

## 未加入或未识别资源

{markdown_table(gap_rows)}

## 维护规则

- 加入新文件后运行 `scripts\\run-pipeline.ps1 run`。
- 本表由脚本生成；需要修正名称、年级或角色时编辑 `config/resource-overrides.json` 后重新运行。
- “已发现”不等于“可发布”；只有状态达到 `publish_ready` 才能进入产品发布流程。
"""
    (output_root / "RESOURCE-CATALOG.md").write_text(catalog, encoding="utf-8")

    review = "# 待人工复核\n\n> 由流水线自动汇总。完成后更新配置或版本复核记录，再重新运行。\n\n"
    review += "\n".join(review_rows) if review_rows else "当前没有待复核事项。"
    review += "\n"
    (output_root / "NEEDS-REVIEW.md").write_text(review, encoding="utf-8")
    write_json(output_root / "reports" / "last-run.json", run)

    wechat_items = []
    upload_assets = []
    for item in resources:
        version_root = None
        if item.get("manifestRelativePath"):
            version_root = (output_root / item["manifestRelativePath"]).parent
        page_assets = []
        thumbnail_assets = []
        if item["resourceType"] == "textbook" and version_root:
            for page_path in sorted((version_root / "pages").glob("*.jpg")):
                asset_key = f"books/{item['resourceId']}/v{item['version']}/pages/{page_path.name}"
                asset = {
                    "resourceId": item["resourceId"],
                    "version": item["version"],
                    "kind": "textbook_page",
                    "assetKey": asset_key,
                    "localRelativePath": safe_relative(page_path, output_root),
                    "deliveryStatus": "awaiting_cloud_upload",
                    "deliveryUrl": None,
                    "cloudFileId": None,
                }
                page_assets.append(asset_key)
                upload_assets.append(asset)
            for thumbnail_path in sorted((version_root / "thumbnails").glob("*.jpg")):
                asset_key = f"books/{item['resourceId']}/v{item['version']}/thumbnails/{thumbnail_path.name}"
                asset = {
                    "resourceId": item["resourceId"],
                    "version": item["version"],
                    "kind": "textbook_page_thumbnail",
                    "assetKey": asset_key,
                    "localRelativePath": safe_relative(thumbnail_path, output_root),
                    "deliveryStatus": "awaiting_cloud_upload",
                    "deliveryUrl": None,
                    "cloudFileId": None,
                }
                thumbnail_assets.append(asset_key)
                upload_assets.append(asset)
        wechat_items.append({
            "resourceId": item["resourceId"],
            "version": item["version"],
            "resourceType": item["resourceType"],
            "assetKey": f"{item['resourceId']}/v{item['version']}",
            "localManifestRelativePath": item.get("manifestRelativePath"),
            "deliveryStatus": "awaiting_cloud_upload" if item["version"] > 0 else "awaiting_processing",
            "deliveryUrl": None,
            "cloudFileId": None,
            "pageAssetCount": len(page_assets),
            "coverAssetKey": page_assets[0] if page_assets else None,
            "thumbnailAssetCount": len(thumbnail_assets),
            "coverThumbnailAssetKey": thumbnail_assets[0] if thumbnail_assets else None,
        })
    write_json(output_root / "exports" / "wechat" / "asset-index.json", {
        "schemaVersion": "1.0",
        "generatedAt": utc_now(),
        "target": "wechat_miniprogram_cloudbase",
        "items": wechat_items,
        "uploadAssets": upload_assets,
    })


def run_pipeline(args: argparse.Namespace) -> int:
    source_root = args.root.resolve()
    script_root = Path(__file__).resolve().parents[1]
    output_root = (args.output_root or script_root).resolve()
    overrides_config, expected = read_config(script_root)
    defaults = overrides_config.get("defaults", {})
    file_overrides = overrides_config.get("files", {})
    catalog_path = output_root / "library" / "catalog.json"
    previous_catalog = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.exists() else {"resources": []}
    previous_by_path = {item["sourceRelativePath"]: item for item in previous_catalog.get("resources", [])}

    sources = discover_files(source_root)
    resources: list[dict[str, Any]] = []
    run: dict[str, Any] = {"startedAt": utc_now(), "sourceRoot": str(source_root), "processed": [], "skipped": [], "failed": []}
    pdftoppm = args.pdftoppm or shutil.which("pdftoppm")
    tesseract = args.tesseract or shutil.which("tesseract")
    local_tessdata = output_root / "runtime" / "tessdata"
    tessdata_dir = args.tessdata_dir or (str(local_tessdata) if local_tessdata.exists() else None)
    ffprobe = shutil.which("ffprobe")

    for source in sources:
        relative = safe_relative(source, source_root)
        override = {**defaults, **file_overrides.get(source.name, {})}
        digest = sha256_file(source)
        kind = resource_kind(source, override)
        resource_id = make_resource_id(kind, digest, override)
        roles = list(dict.fromkeys(override.get("roles", infer_roles(source))))
        previous = previous_by_path.get(relative)
        selected = not args.only or source.name == args.only or relative == args.only

        if previous and previous.get("sourceSha256") == digest and not args.refresh:
            reused = dict(previous)
            reused.update({
                "title": override.get("title", previous.get("title", source.stem)),
                "publisher": override.get("publisher"),
                "series": override.get("series"),
                "grade": override.get("grade"),
                "term": override.get("term"),
                "language": override.get("language"),
                "roles": roles,
                "rightsStatus": override.get("rightsStatus", "user_confirmed_cleared"),
                "visibility": override.get("visibility", "unassigned"),
                "needsMetadata": override.get("needsMetadata", []),
            })
            if reused.get("manifestRelativePath"):
                write_json(output_root / reused["manifestRelativePath"], reused)
            resources.append(reused)
            run["skipped"].append({"source": relative, "reason": "unchanged_sha256"})
            continue

        if not selected:
            if previous:
                resources.append(previous)
            else:
                resources.append({
                    "resourceId": resource_id,
                    "resourceType": kind,
                    "title": override.get("title", source.stem),
                    "sourceRelativePath": relative,
                    "sourceSha256": digest,
                    "sourceSizeBytes": source.stat().st_size,
                    "version": 0,
                    "processingStatus": "discovered",
                    "roles": roles,
                    "rightsStatus": override.get("rightsStatus", "user_confirmed_cleared"),
                    "needsMetadata": override.get("needsMetadata", []),
                    "details": {"missingComponents": ["technical_extraction"]},
                })
            continue

        same_source_version = previous and previous.get("sourceSha256") == digest
        version = previous.get("version", 1) if same_source_version else (previous.get("version", 0) + 1) if previous else 1
        target_kind = "books" if kind == "textbook" else "media" if kind in {"audio", "video"} else "supplements"
        target = output_root / "library" / target_kind / resource_id / f"v{version}"
        try:
            if kind == "textbook":
                details = extract_pdf(
                    source, target, args.coordinates, args.render, pdftoppm,
                    override.get("pilotPages", []),
                    args.ocr, tesseract, tessdata_dir,
                )
            elif kind in {"audio", "video"}:
                details = probe_media(source, ffprobe)
            else:
                details = process_supplement(source)
            entry = {
                "resourceId": resource_id,
                "resourceType": kind,
                "title": override.get("title", source.stem),
                "publisher": override.get("publisher"),
                "series": override.get("series"),
                "grade": override.get("grade"),
                "term": override.get("term"),
                "language": override.get("language"),
                "roles": roles,
                "sourceRelativePath": relative,
                "sourceSha256": digest,
                "sourceSizeBytes": source.stat().st_size,
                "sourceModifiedAt": datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat(),
                "version": version,
                "processingStatus": details["processingStatus"],
                "rightsStatus": override.get("rightsStatus", "user_confirmed_cleared"),
                "visibility": override.get("visibility", "unassigned"),
                "needsMetadata": override.get("needsMetadata", []),
                "manifestRelativePath": safe_relative(target / "manifest.json", output_root),
                "processedAt": utc_now(),
                "details": details,
            }
            write_json(target / "manifest.json", entry)
            resources.append(entry)
            run["processed"].append({"source": relative, "resourceId": resource_id, "version": version})
        except Exception as exc:
            run["failed"].append({"source": relative, "error": f"{type(exc).__name__}: {exc}"})
            if previous:
                resources.append(previous)
            else:
                resources.append({
                    "resourceId": resource_id, "resourceType": kind, "title": override.get("title", source.stem),
                    "sourceRelativePath": relative, "sourceSha256": digest, "sourceSizeBytes": source.stat().st_size,
                    "version": 0, "processingStatus": "blocked_error", "roles": roles,
                    "rightsStatus": override.get("rightsStatus", "user_confirmed_cleared"),
                    "needsMetadata": override.get("needsMetadata", []),
                    "details": {"missingComponents": ["technical_extraction"], "processingErrors": [str(exc)]},
                })

    resources.sort(key=lambda item: (item["resourceType"], item["title"]))
    catalog = {"schemaVersion": "1.0", "generatedAt": utc_now(), "sourceRoot": str(source_root), "resources": resources}
    write_json(catalog_path, catalog)
    run["finishedAt"] = utc_now()
    run["summary"] = {key: len(run[key]) for key in ("processed", "skipped", "failed")}
    generate_human_reports(output_root, resources, expected, run)
    print(json.dumps(run["summary"], ensure_ascii=False))
    return 1 if run["failed"] else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    run = subparsers.add_parser("run")
    run.add_argument("--root", type=Path, required=True)
    run.add_argument("--output-root", type=Path)
    run.add_argument("--only", default="")
    run.add_argument("--coordinates", choices=("none", "sample", "all"), default="sample")
    run.add_argument("--render", choices=("none", "sample", "all"), default="sample")
    run.add_argument("--ocr", choices=("none", "sample", "all"), default="none")
    run.add_argument("--pdftoppm")
    run.add_argument("--tesseract")
    run.add_argument("--tessdata-dir")
    run.add_argument("--refresh", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    sys.exit(run_pipeline(arguments))
