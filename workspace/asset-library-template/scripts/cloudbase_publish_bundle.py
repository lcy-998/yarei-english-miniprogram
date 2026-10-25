#!/usr/bin/env python3
"""Create a deterministic CloudBase content bundle without contacting CloudBase."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image

from content_review import safe_file, validate_review


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON 根对象必须是对象：{path}")
    return value


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as source:
        for part in iter(lambda: source.read(1024 * 1024), b""):
            result.update(part)
    return result.hexdigest()


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成 CloudBase 内容发布包（不执行云端写入）")
    parser.add_argument("command", choices=("plan", "bundle"))
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--resource-id", required=True)
    parser.add_argument("--organization-id", required=True)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def select(root: Path, resource_id: str) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    index = load(root / "exports" / "wechat" / "asset-index.json")
    items = index.get("items")
    assets = index.get("uploadAssets")
    if not isinstance(items, list) or not isinstance(assets, list):
        raise ValueError("asset-index.json 缺少 items 或 uploadAssets 数组")
    item = next((value for value in items if isinstance(value, dict) and value.get("resourceId") == resource_id), None)
    if item is None:
        raise ValueError(f"未找到资源：{resource_id}")
    manifest_path = root / str(item.get("localManifestRelativePath", ""))
    if not manifest_path.is_file():
        raise ValueError(f"资源 manifest 不存在：{manifest_path}")
    return item, load(manifest_path), [value for value in assets if isinstance(value, dict)]


def referenced_media(review: dict[str, Any]) -> set[str]:
    reading = review.get("reading")
    paths: set[Any] = set()
    if isinstance(reading, dict):
        paths.update(chapter.get("audioSourceRelativePath") for chapter in reading.get("chapters", [])
                     if isinstance(chapter, dict))
        paths.update(page.get("audioSourceRelativePath") for page in reading.get("pages", [])
                     if isinstance(page, dict))
    vocabulary = review.get("vocabulary")
    if isinstance(vocabulary, dict):
        paths.update(word.get("audioSourceRelativePath") for word in vocabulary.get("words", [])
                     if isinstance(word, dict))
    exercise = review.get("exercise")
    if isinstance(exercise, dict) and isinstance(exercise.get("listening"), dict):
        paths.add(exercise["listening"].get("audioSourceRelativePath"))
    return {path for path in paths if isinstance(path, str) and path}


def reviewed_attachments(review: dict[str, Any]) -> list[dict[str, Any]]:
    reading = review.get("reading")
    return reading.get("attachments", []) if isinstance(reading, dict) and isinstance(reading.get("attachments", []), list) else []


def validate(root: Path, item: dict[str, Any], manifest: dict[str, Any],
             assets: list[dict[str, Any]], resources: list[dict[str, Any]]) -> tuple[list[dict[str, str]], dict[str, Any] | None, list[dict[str, Any]]]:
    problems: list[dict[str, str]] = []
    if manifest.get("resourceId") != item.get("resourceId"):
        problems.append({"code": "RESOURCE_ID_MISMATCH", "message": "asset-index 与 manifest 的 resourceId 不一致。"})
    if manifest.get("version") != item.get("version"):
        problems.append({"code": "VERSION_MISMATCH", "message": "asset-index 与 manifest 的 version 不一致。"})
    if manifest.get("processingStatus") != "publish_ready":
        problems.append({"code": "NOT_PUBLISH_READY", "message": "资源尚未达到 publish_ready，禁止生成发布包。"})
    review, review_hash, review_issues = validate_review(root, manifest, resources)
    supported_content = manifest.get("resourceType") == "textbook" or (
        manifest.get("resourceType") == "supplement" and review is not None
        and review.get("contentType") in {"vocabulary", "exercise"})
    if not supported_content:
        problems.append({"code": "UNSUPPORTED_STANDALONE_RESOURCE", "message": "当前发布包只支持已复核阅读书、词包和题目；独立媒体进入 M3 审核链路。"})
    for issue in review_issues:
        problems.append({"code": issue, "message": "内容复核或资源引用未通过：" + issue})
    details = manifest.get("details") if isinstance(manifest.get("details"), dict) else {}
    if review is not None and (details.get("reviewSha256") != review_hash
                               or details.get("reviewRevision") != review.get("reviewRevision")):
        problems.append({"code": "REVIEW_MANIFEST_MISMATCH", "message": "清单与已复核内容版本不一致，请重新运行资产流水线。"})
    selected = [asset for asset in assets if asset.get("resourceId") == item.get("resourceId")]
    if review is not None:
        by_path = {asset.get("localRelativePath"): asset for asset in assets}
        for relative in referenced_media(review):
            media = by_path.get(relative)
            if media is None:
                problems.append({"code": "MEDIA_UPLOAD_ROW_MISSING", "message": "复核音频没有上传清单：" + relative})
            elif media not in selected:
                selected.append(media)
        for attachment in reviewed_attachments(review):
            if not isinstance(attachment, dict):
                problems.append({"code": "ATTACHMENT_INVALID", "message": "复核附件格式无效。"})
                continue
            relative = attachment.get("sourceRelativePath")
            hash_value = attachment.get("sha256")
            if not isinstance(relative, str) or safe_file(root, relative) is None \
                    or not isinstance(hash_value, str) or len(hash_value) != 64:
                problems.append({"code": "ATTACHMENT_FILE_MISSING", "message": "复核附件不存在：" + str(relative)})
                continue
            if relative in by_path:
                if by_path[relative] not in selected:
                    selected.append(by_path[relative])
            else:
                name = Path(relative).name
                selected.append({"resourceId": item["resourceId"], "version": item["version"],
                    "kind": attachment["kind"],
                    "assetKey": f"books/{item['resourceId']}/v{item['version']}-r{review['reviewRevision']}/attachments/{hash_value[:16]}-{name}",
                    "localRelativePath": relative})
    if not selected and manifest.get("resourceType") == "textbook":
        problems.append({"code": "NO_UPLOAD_ASSETS", "message": "没有待上传的页面或媒体资产。"})
    for asset in selected:
        if safe_file(root, asset.get("localRelativePath")) is None:
            problems.append({"code": "ASSET_FILE_MISSING", "message": f"上传文件不存在：{asset.get('localRelativePath')}"})
    return problems, review, selected


def make_upload_rows(root: Path, assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for asset in sorted(assets, key=lambda value: str(value.get("assetKey", ""))):
        path = root / str(asset["localRelativePath"])
        file_hash = digest(path)
        key = str(asset["assetKey"])
        cloud_path = f"yarei-assets/{key.rsplit('.', 1)[0]}-{file_hash[:16]}{path.suffix.lower()}"
        rows.append({"assetKey": key, "kind": asset.get("kind"), "localRelativePath": str(asset["localRelativePath"]), "sha256": file_hash, "bytes": path.stat().st_size, "cloudPath": cloud_path, "cloudFileId": None, "deliveryUrl": None})
    return rows


def base_draft(manifest: dict[str, Any], review: dict[str, Any], organization_id: str,
               release_id: str, created_at: str, content_type: str) -> dict[str, Any]:
    content_version: str | int = (review["contentVersion"] if content_type == "exercise"
                                   else f"{manifest['version']}.{review['reviewRevision']}")
    return {
        "_id": manifest["resourceId"], "id": manifest["resourceId"], "organizationId": organization_id,
        "schemaVersion": 1, "version": 1, "deletedAt": None,
        "createdAt": created_at, "updatedAt": created_at,
        "type": content_type, "title": manifest["title"], "contentVersion": content_version,
        "status": "draft", "copyrightStatus": review["copyrightStatus"],
        "visibility": {"type": "classes", "classIds": []},
        "reviewSha256": manifest["details"]["reviewSha256"], "assetRelease": release_id,
    }


def publish_preconditions() -> dict[str, Any]:
    return {
        "allUploadRowsMaterialized": True,
        "currentStatusAllowed": ["absent", "draft"],
        "existingDraftRequiresOptimisticVersion": True,
        "classScopeSelectedAndAuthorized": True,
        "allowedStudentIdsDerivedFromCurrentMembership": True,
        "reviewHashStillCurrent": True,
        "contentQueryAndLearningProgressReadable": True,
    }


def database_template(root: Path, manifest: dict[str, Any], review: dict[str, Any],
                      organization_id: str, rows: list[dict[str, Any]], release_id: str,
                      created_at: str) -> dict[str, Any]:
    """Build a draft template; $assetKey references must be materialized before writing."""
    by_path = {row["localRelativePath"]: row for row in rows}
    def reference(relative: str) -> dict[str, str]:
        return {"$assetKey": by_path[relative]["assetKey"]}

    if review.get("contentType") == "vocabulary":
        pack = review["vocabulary"]
        metadata = {name: pack[name] for name in ("grade", "term", "textbook", "unit") if pack.get(name)}
        words = [{"id": item["id"], "word": item["word"], "meaning": item["meaning"],
                  "example": item["example"], "syllables": item["syllables"],
                  "audioFileId": reference(item["audioSourceRelativePath"]),
                  "startMs": item["startMs"], "endMs": item["endMs"]} for item in pack["words"]]
        document = {**base_draft(manifest, review, organization_id, release_id, created_at, "vocabulary"),
                    **metadata, "allowedStudentIds": [], "pages": [],
                    "wordIds": [item["id"] for item in words], "payload": {**metadata, "words": words}}
        return {"collection": "learning_resources", "operation": "stage_reviewed_draft",
                "document": document, "publishPreconditions": publish_preconditions()}
    if review.get("contentType") == "exercise":
        question = review["exercise"]
        metadata = {name: question[name] for name in ("grade", "textbook", "unit", "knowledgePoint",
                                                      "difficulty") if question.get(name)}
        fields = {"questionType": question["questionType"], "stem": question["stem"],
                  "options": question["options"], "correctAnswer": question["correctAnswer"],
                  "explanation": question["explanation"]}
        payload = {**metadata, **fields, "questionIds": [manifest["resourceId"]]}
        if isinstance(question.get("listening"), dict):
            listening = question["listening"]
            payload["listening"] = {"transcript": listening["transcript"],
                                     "audioFileId": reference(listening["audioSourceRelativePath"]),
                                     "startMs": listening["startMs"], "endMs": listening["endMs"]}
        document = {**base_draft(manifest, review, organization_id, release_id, created_at, "exercise"),
                    **metadata, **fields, "payload": payload}
        return {"collection": "learning_resources", "operation": "stage_reviewed_draft",
                "document": document, "publishPreconditions": publish_preconditions()}

    reading = review["reading"]
    by_number = {page["pageNumber"]: page for page in reading["pages"]}
    book_root = Path(manifest["manifestRelativePath"]).parent
    content_version = f"{manifest['version']}.{review['reviewRevision']}"
    asset_version = f"v{manifest['version']}-r{review['reviewRevision']}"

    chapters: list[dict[str, Any]] = []
    progress_pages: list[dict[str, Any]] = []
    for chapter in sorted(reading["chapters"], key=lambda value: value["order"]):
        chapter_pages: list[dict[str, Any]] = []
        for order, number in enumerate(chapter["pageNumbers"], 1):
            source = by_number[number]
            image_relative = (book_root / "pages" / f"page-{number:04d}.jpg").as_posix()
            thumb_relative = (book_root / "thumbnails" / f"page-{number:04d}.jpg").as_posix()
            with Image.open(root / image_relative) as image:
                width, height = image.size
            page = {
                "id": source["id"], "pageNumber": number, "order": order,
                "thumbnailAssetKey": reference(thumb_relative),
                "imageAssetKey": reference(image_relative),
                "width": width, "height": height, "assetVersion": asset_version,
                "ocrText": source.get("ocrText", ""),
                "role": source["role"],
            }
            audio_path = source.get("audioSourceRelativePath")
            if isinstance(audio_path, str) and audio_path:
                page["audioFileId"] = reference(audio_path)
            if source["role"] == "content":
                page["followReadText"] = source["followReadText"]
                page["sentenceMappings"] = [
                    {"text": mapping["text"], "hitAreas": mapping["hitAreas"],
                     "audioFileId": reference(audio_path),
                     "startMs": mapping["startMs"], "endMs": mapping["endMs"]}
                    for mapping in source["sentenceMappings"]
                ]
            chapter_pages.append(page)
            progress_pages.append({"id": source["id"], "chapterId": chapter["id"], "pageNumber": number})
        chapters.append({"id": chapter["id"], "title": chapter["title"], "order": chapter["order"],
                         "chapterAudioFileId": reference(chapter["audioSourceRelativePath"]),
                         "pages": chapter_pages})
    metadata = {name: reading[name] for name in ("category", "grade", "difficulty", "term", "textbook",
                                                  "unit", "theme", "searchText") if reading.get(name)}
    payload = {**metadata, "chapters": chapters, "assetReferenceMode": "materialize_before_database_write"}
    if reviewed_attachments(review):
        payload["attachments"] = [{"kind": attachment["kind"],
                                   "fileId": reference(attachment["sourceRelativePath"]),
                                   "sha256": attachment["sha256"]}
                                  for attachment in reviewed_attachments(review)]
    document = {
        **base_draft(manifest, review, organization_id, release_id, created_at, "reading"),
        "allowedStudentIds": [], "pages": progress_pages, "wordIds": [],
        **metadata, "payload": payload,
    }
    return {"collection": "learning_resources", "operation": "stage_reviewed_draft",
            "document": document, "publishPreconditions": publish_preconditions()}


def write_bundle(output: Path, plan: dict[str, Any], rows: list[dict[str, Any]], database: dict[str, Any]) -> None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "release-plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (output / "storage-upload.jsonl").open("w", encoding="utf-8", newline="\n") as target:
        for row in rows:
            target.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    (output / "database-template.json").write_text(json.dumps(database, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "README.md").write_text(
        "# CloudBase 内容草稿包\n\n本包未访问云端，也不是可直接写入的数据库文档。"
        "上传器须先上传 `storage-upload.jsonl` 中的文件，递归把 `database-template.json` 的"
        " `{\"$assetKey\": \"...\"}` 占位符替换为真实私有 fileID，并逐条核对哈希。"
        "服务端再按当前班级关系生成可见范围和 `allowedStudentIds`，验证内容、进度与审核状态后"
        "才可另行发布；不得把空班级范围的草稿直接标为 published。\n",
        encoding="utf-8",
    )


def main() -> int:
    args = arguments()
    root = args.root.resolve()
    item, manifest, assets = select(root, args.resource_id)
    catalog = load(root / "library" / "catalog.json")
    resources = catalog.get("resources")
    if not isinstance(resources, list):
        raise ValueError("catalog.json 缺少 resources 数组")
    problems, review, selected_assets = validate(root, item, manifest, assets, resources)
    review_hash = manifest.get("details", {}).get("reviewSha256", "")
    seed = f"{args.organization_id}:{manifest.get('resourceId')}:{manifest.get('version')}:{manifest.get('sourceSha256', '')}:{review_hash}"
    release_id = "content-" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]
    created_at = now()
    plan: dict[str, Any] = {"schemaVersion": "2.0", "releaseId": release_id, "createdAt": created_at, "target": "cloudbase", "mode": args.command, "resourceId": args.resource_id, "organizationId": args.organization_id, "allowed": not problems, "problems": problems}
    if args.command == "plan":
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0 if not problems else 2
    if problems:
        print(json.dumps(plan, ensure_ascii=False, indent=2), file=sys.stderr)
        return 2
    assert review is not None
    rows = make_upload_rows(root, selected_assets)
    plan.update({"uploadCount": len(rows), "uploadBytes": sum(row["bytes"] for row in rows)})
    output = args.output.resolve() if args.output else root / "exports" / "cloudbase" / release_id
    if output.exists():
        raise FileExistsError(f"发布包目录已存在，拒绝覆盖：{output}")
    write_bundle(output, plan, rows, database_template(root, manifest, review, args.organization_id,
                                                       rows, release_id, created_at))
    print(json.dumps({"releaseId": release_id, "output": str(output), "uploadCount": len(rows)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
