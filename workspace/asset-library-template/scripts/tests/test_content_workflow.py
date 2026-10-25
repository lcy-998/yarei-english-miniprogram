"""Contract tests for a reviewed reading book and its CloudBase draft package."""

from __future__ import annotations

import json
import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asset_pipeline import generate_human_reports, write_json  # noqa: E402
from cloudbase_publish_bundle import (  # noqa: E402
    database_template, make_upload_rows, select, validate,
)
from content_review import reconcile_review, validate_review  # noqa: E402


class ContentWorkflowTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        book_root = self.root / "library/books/book_fixture/v1"
        for directory in ("pages", "thumbnails", "review"):
            (book_root / directory).mkdir(parents=True)
        for number in (1, 2):
            for folder, dimensions in (("pages", (1600, 900)), ("thumbnails", (320, 180))):
                Image.new("RGB", dimensions, "white").save(book_root / folder / f"page-{number:04d}.jpg")
        (self.root / "inbox").mkdir()
        (self.root / "inbox/book.pdf").write_bytes(b"fixture-source")
        (self.root / "inbox/line.mp3").write_bytes(b"ID3fixture-audio")
        book_hash = hashlib.sha256(b"fixture-source").hexdigest().upper()
        audio_hash = hashlib.sha256(b"ID3fixture-audio").hexdigest().upper()
        def image_hash(folder: str, number: int) -> str:
            return hashlib.sha256((book_root / folder / f"page-{number:04d}.jpg").read_bytes()).hexdigest().upper()
        self.book = {
            "resourceId": "book_fixture", "resourceType": "textbook", "title": "Fixture book",
            "sourceRelativePath": "inbox/book.pdf", "sourceSha256": book_hash,
            "version": 1, "processingStatus": "needs_review", "roles": ["picture_book"],
            "manifestRelativePath": "library/books/book_fixture/v1/manifest.json",
            "details": {"pageCount": 2, "processingErrors": [], "missingComponents": ["content_review"]},
        }
        self.audio = {
            "resourceId": "audio_fixture", "resourceType": "audio", "title": "Fixture voice",
            "sourceRelativePath": "inbox/line.mp3", "sourceSha256": audio_hash,
            "version": 1, "processingStatus": "needs_review", "roles": ["chapter_audio"],
            "manifestRelativePath": "library/media/audio_fixture/v1/manifest.json",
            "details": {"durationMs": 2000, "processingErrors": [], "missingComponents": ["content_role_confirmation"]},
        }
        self.review = {
            "schemaVersion": 1, "decision": "approved", "resourceId": "book_fixture",
            "sourceVersion": 1, "sourceSha256": book_hash, "reviewRevision": 1,
            "reviewerId": "fixture-editor", "reviewedAt": "2026-09-30T00:00:00Z",
            "copyrightStatus": "verified",
            "reading": {
                "category": "picture_book", "grade": "三年级", "difficulty": "基础",
                "chapters": [{"id": "chapter_fixture", "title": "Fixture book", "order": 1,
                              "pageNumbers": [1, 2], "audioSourceRelativePath": "inbox/line.mp3"}],
                "pages": [
                    {"id": "page_cover", "pageNumber": 1, "role": "cover", "ocrText": "Fixture book",
                     "imageSha256": image_hash("pages", 1), "thumbnailSha256": image_hash("thumbnails", 1)},
                    {"id": "page_story", "pageNumber": 2, "role": "content", "ocrText": "Hello.",
                     "imageSha256": image_hash("pages", 2), "thumbnailSha256": image_hash("thumbnails", 2),
                     "followReadText": "Hello.", "audioSourceRelativePath": "inbox/line.mp3",
                     "sentenceMappings": [{"text": "Hello.", "hitAreas": [{"x": 0.2, "y": 0.2,
                                                                  "width": 0.3, "height": 0.1}],
                                           "startMs": 0, "endMs": 1500}]},
                ],
            },
        }
        self.review_path = book_root / "review/approved-content-v1.json"
        write_json(self.review_path, self.review)

    def _ready_book(self) -> dict:
        return reconcile_review(self.root, self.book, [self.book, self.audio])

    def test_discovered_source_is_processed_when_later_selected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "inbox").mkdir()
            (root / "inbox/sample.txt").write_text("phonics sample", encoding="utf-8")
            script = Path(__file__).resolve().parents[1] / "asset_pipeline.py"
            command = [sys.executable, str(script), "run", "--root", str(root),
                       "--output-root", str(root),
                       "--coordinates", "none", "--render", "none"]
            first = subprocess.run([*command, "--only", "missing.pdf"],
                                   capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            discovered = json.loads((root / "library/catalog.json").read_text(encoding="utf-8"))["resources"][0]
            self.assertEqual((discovered["version"], discovered["processingStatus"]), (0, "discovered"))
            second = subprocess.run([*command, "--only", "sample.txt"],
                                    capture_output=True, text=True)
            self.assertEqual(second.returncode, 0, second.stderr)
            result = json.loads((root / "library/catalog.json").read_text(encoding="utf-8"))["resources"][0]
            self.assertEqual(result["version"], 1)
            self.assertNotEqual(result["processingStatus"], "discovered")
            run = json.loads((root / "reports/last-run.json").read_text(encoding="utf-8"))
            self.assertEqual(len(run["processed"]), 1)

    def test_reviewed_book_without_vocabulary_or_questions_can_make_valid_draft(self) -> None:
        caption = self.root / "library/books/book_fixture/v1/timelines/captions.vtt"
        caption.parent.mkdir()
        caption.write_text("WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello.\n", encoding="utf-8")
        self.review["reading"]["attachments"] = [{"kind": "subtitle",
            "sourceRelativePath": "library/books/book_fixture/v1/timelines/captions.vtt",
            "sha256": hashlib.sha256(caption.read_bytes()).hexdigest().upper()}]
        write_json(self.review_path, self.review)
        ready = self._ready_book()
        self.assertEqual(ready["processingStatus"], "publish_ready")
        self.assertEqual(ready["details"]["missingComponents"], [])
        write_json(self.root / ready["manifestRelativePath"], ready)
        write_json(self.root / self.audio["manifestRelativePath"], self.audio)
        resources = [ready, self.audio]
        write_json(self.root / "library/catalog.json", {"resources": resources})
        generate_human_reports(self.root, resources, [], {"sourceRoot": str(self.root),
            "processed": [], "skipped": [], "failed": [], "startedAt": "2026-09-30T00:00:00Z"})
        item, manifest, assets = select(self.root, "book_fixture")
        self.assertEqual({row["kind"] for row in assets},
                         {"textbook_page", "textbook_page_thumbnail", "audio"})
        problems, review, selected = validate(self.root, item, manifest, assets, resources)
        self.assertEqual(problems, [])
        self.assertIsNotNone(review)
        rows = make_upload_rows(self.root, selected)
        template = database_template(self.root, manifest, review, "org_fixture", rows,
                                     "content_fixture", "2026-09-30T00:00:00Z")
        document = template["document"]
        self.assertEqual(document["status"], "draft")
        self.assertEqual(document["category"], "picture_book")
        self.assertEqual(document["visibility"], {"type": "classes", "classIds": []})
        self.assertEqual(document["allowedStudentIds"], [])
        self.assertEqual(document["pages"][1], {"id": "page_story", "chapterId": "chapter_fixture", "pageNumber": 2})
        story = document["payload"]["chapters"][0]["pages"][1]
        self.assertEqual((story["width"], story["height"]), (1600, 900))
        self.assertEqual(story["ocrText"], "Hello.")
        self.assertEqual(story["sentenceMappings"][0]["endMs"], 1500)
        self.assertIn("$assetKey", story["imageAssetKey"])
        self.assertIn("$assetKey", story["audioFileId"])
        self.assertIn("$assetKey", document["payload"]["attachments"][0]["fileId"])
        self.assertEqual(len(rows), 6)
        script = Path(__file__).resolve().parents[1] / "cloudbase_publish_bundle.py"
        common = [sys.executable, str(script), "--root", str(self.root),
                  "--resource-id", "book_fixture", "--organization-id", "org_fixture"]
        plan = subprocess.run([*common[:2], "plan", *common[2:]], capture_output=True, text=True)
        self.assertEqual(plan.returncode, 0, plan.stderr)
        self.assertTrue(json.loads(plan.stdout)["allowed"])
        output = self.root / "exports/reviewed-fixture"
        bundle = subprocess.run([*common[:2], "bundle", *common[2:], "--output", str(output)],
                                capture_output=True, text=True)
        self.assertEqual(bundle.returncode, 0, bundle.stderr)
        self.assertTrue((output / "storage-upload.jsonl").is_file())
        self.assertEqual(json.loads((output / "database-template.json").read_text(encoding="utf-8"))
                         ["document"]["category"], "picture_book")

    def test_invalid_hit_area_and_audio_range_block_approval(self) -> None:
        mapping = self.review["reading"]["pages"][1]["sentenceMappings"][0]
        mapping["hitAreas"][0]["x"] = 0.95
        mapping["endMs"] = 2500
        write_json(self.review_path, self.review)
        _, _, issues = validate_review(self.root, self.book, [self.book, self.audio])
        self.assertIn("PAGE_2_HIT_AREA_INVALID", issues)
        self.assertIn("PAGE_2_SENTENCE_AUDIO_RANGE_INVALID", issues)
        self.assertEqual(self._ready_book()["processingStatus"], "needs_review")

    def test_changed_review_needs_new_revision(self) -> None:
        ready = self._ready_book()
        self.review["reading"]["pages"][1]["ocrText"] = "Hello again."
        write_json(self.review_path, self.review)
        changed = reconcile_review(self.root, ready, [ready, self.audio])
        self.assertEqual(changed["processingStatus"], "needs_review")
        self.assertIn("REVIEW_CHANGED_WITHOUT_REVISION", changed["details"]["reviewIssues"])

    def test_new_review_revision_preserves_prior_signature(self) -> None:
        ready = self._ready_book()
        self.review["reviewRevision"] = 2
        self.review["reading"]["pages"][1]["ocrText"] = "Hello again."
        write_json(self.review_path.with_name("approved-content-v2.json"), self.review)
        updated = reconcile_review(self.root, ready, [ready, self.audio])
        self.assertEqual(updated["processingStatus"], "publish_ready")
        self.assertEqual(updated["details"]["reviewRevision"], 2)
        self.assertNotEqual(updated["details"]["reviewSha256"], ready["details"]["reviewSha256"])
        self.assertTrue(self.review_path.is_file())

    def test_malformed_latest_review_fails_closed(self) -> None:
        self.review_path.with_name("approved-content-v2.json").write_text("{broken", encoding="utf-8")
        result = self._ready_book()
        self.assertEqual(result["processingStatus"], "needs_review")
        self.assertEqual(result["details"]["reviewIssues"], ["INVALID_REVIEW_JSON"])

    def test_modified_media_or_page_image_cannot_use_old_review(self) -> None:
        (self.root / "inbox/line.mp3").write_bytes(b"ID3changed-audio")
        image = self.root / "library/books/book_fixture/v1/pages/page-0002.jpg"
        Image.new("RGB", (1600, 900), "black").save(image)
        _, _, issues = validate_review(self.root, self.book, [self.book, self.audio])
        self.assertIn("CHAPTER_AUDIO_SOURCE_HASH_MISMATCH", issues)
        self.assertIn("PAGE_2_REVIEWED_IMAGE_HASH_MISMATCH", issues)

    def _supplement(self, resource_id: str, name: str, data: bytes) -> dict:
        path = self.root / "inbox" / name
        path.write_bytes(data)
        target = self.root / "library/supplements" / resource_id / "v1/review"
        target.mkdir(parents=True)
        return {"resourceId": resource_id, "resourceType": "supplement", "title": resource_id,
                "sourceRelativePath": f"inbox/{name}",
                "sourceSha256": hashlib.sha256(data).hexdigest().upper(),
                "version": 1, "processingStatus": "needs_review", "roles": ["supplement"],
                "manifestRelativePath": f"library/supplements/{resource_id}/v1/manifest.json",
                "details": {"processingErrors": [], "missingComponents": ["target_resource_mapping"]}}

    def _supplement_review(self, resource: dict, content_type: str, payload: dict) -> dict:
        review = {"schemaVersion": 1, "decision": "approved", "resourceId": resource["resourceId"],
                  "sourceVersion": 1, "sourceSha256": resource["sourceSha256"],
                  "reviewRevision": 1, "reviewerId": "fixture-editor",
                  "reviewedAt": "2026-09-30T00:00:00Z", "copyrightStatus": "verified",
                  "contentType": content_type, content_type: payload}
        write_json((self.root / resource["manifestRelativePath"]).parent / "review/approved-content-v1.json", review)
        return review

    def test_vocabulary_review_requires_word_audio_and_syllables(self) -> None:
        resource = self._supplement("vocab_fixture", "words.csv", b"cat,animal")
        self._supplement_review(resource, "vocabulary", {"grade": "三年级", "unit": "Unit 1",
            "words": [{"id": "word_cat", "word": "cat", "meaning": "猫", "example": "A cat runs.",
                       "syllables": ["cat"], "audioSourceRelativePath": "inbox/line.mp3",
                       "startMs": 0, "endMs": 1000}]})
        ready = reconcile_review(self.root, resource, [resource, self.audio])
        self.assertEqual(ready["processingStatus"], "publish_ready")
        write_json(self.root / ready["manifestRelativePath"], ready)
        resources = [ready, self.audio]
        write_json(self.root / "library/catalog.json", {"resources": resources})
        generate_human_reports(self.root, resources, [], {"sourceRoot": str(self.root),
            "processed": [], "skipped": [], "failed": [], "startedAt": "2026-09-30T00:00:00Z"})
        item, manifest, assets = select(self.root, "vocab_fixture")
        problems, review, selected = validate(self.root, item, manifest, assets, resources)
        self.assertEqual(problems, [])
        rows = make_upload_rows(self.root, selected)
        document = database_template(self.root, manifest, review, "org_fixture", rows,
                                     "content_fixture", "2026-09-30T00:00:00Z")["document"]
        self.assertEqual(document["wordIds"], ["word_cat"])
        self.assertEqual(document["payload"]["words"][0]["syllables"], ["cat"])
        self.assertIn("$assetKey", document["payload"]["words"][0]["audioFileId"])

    def test_exercise_review_stages_one_structured_question_without_media(self) -> None:
        resource = self._supplement("question_fixture", "question.csv", b"What animal?,Cat")
        review = self._supplement_review(resource, "exercise", {"grade": "三年级", "unit": "Unit 1",
            "questionType": "single_choice", "stem": "Which animal says meow?",
            "options": ["Cat", "Dog"], "correctAnswer": "Cat", "explanation": "A cat meows."})
        review["contentVersion"] = 1
        write_json((self.root / resource["manifestRelativePath"]).parent / "review/approved-content-v1.json", review)
        ready = reconcile_review(self.root, resource, [resource])
        self.assertEqual(ready["processingStatus"], "publish_ready")
        write_json(self.root / ready["manifestRelativePath"], ready)
        resources = [ready]
        write_json(self.root / "library/catalog.json", {"resources": resources})
        generate_human_reports(self.root, resources, [], {"sourceRoot": str(self.root),
            "processed": [], "skipped": [], "failed": [], "startedAt": "2026-09-30T00:00:00Z"})
        item, manifest, assets = select(self.root, "question_fixture")
        self.assertEqual(item["deliveryStatus"], "ready_for_database_staging")
        problems, approved, selected = validate(self.root, item, manifest, assets, resources)
        self.assertEqual(problems, [])
        self.assertEqual(selected, [])
        document = database_template(self.root, manifest, approved, "org_fixture", [],
                                     "content_fixture", "2026-09-30T00:00:00Z")["document"]
        self.assertEqual(document["contentVersion"], 1)
        self.assertEqual(document["payload"]["questionIds"], ["question_fixture"])
        self.assertEqual(document["payload"]["correctAnswer"], "Cat")
        review["exercise"]["correctAnswer"] = "Bird"
        write_json((self.root / resource["manifestRelativePath"]).parent / "review/approved-content-v1.json", review)
        _, _, issues = validate_review(self.root, resource, [resource])
        self.assertIn("EXERCISE_SINGLE_CHOICE_ANSWER_INVALID", issues)

    def test_video_cannot_be_ready_from_review_claim_without_codec_probe(self) -> None:
        data = b"not-an-mp4"
        (self.root / "inbox/demo.mp4").write_bytes(data)
        item = {"resourceId": "video_fixture", "resourceType": "video", "title": "Fixture video",
                "sourceRelativePath": "inbox/demo.mp4", "sourceSha256": hashlib.sha256(data).hexdigest().upper(),
                "sourceSizeBytes": len(data), "version": 1, "processingStatus": "needs_review",
                "manifestRelativePath": "library/media/video_fixture/v1/manifest.json",
                "details": {"durationMs": None, "processingErrors": []}}
        folder = (self.root / item["manifestRelativePath"]).parent / "review"
        folder.mkdir(parents=True)
        write_json(folder / "approved-content-v1.json", {
            "schemaVersion": 1, "decision": "approved", "resourceId": "video_fixture",
            "sourceVersion": 1, "sourceSha256": item["sourceSha256"], "reviewRevision": 1,
            "reviewerId": "fixture-editor", "reviewedAt": "2026-09-30T00:00:00Z",
            "copyrightStatus": "verified",
            "technicalReview": {"videoCodec": "h264", "audioCodec": "aac", "scanStatus": "passed"},
        })
        self.assertIn("VIDEO_TECHNICAL_PROBE_REQUIRED",
                      reconcile_review(self.root, item, [item])["details"]["reviewIssues"])


if __name__ == "__main__":
    unittest.main()
