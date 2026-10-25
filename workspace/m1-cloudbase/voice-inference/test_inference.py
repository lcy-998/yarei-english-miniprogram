import hashlib
import hmac
import io
import json
import os
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import miniaudio

from inference import _authenticate, _download, main, recognize_mp3


class PrivateWorkerTests(unittest.TestCase):
    def setUp(self):
        self.old_secret = os.environ.get("VOICE_INTERNAL_SECRET")
        os.environ["VOICE_INTERNAL_SECRET"] = "test-only-secret-" * 3

    def tearDown(self):
        if self.old_secret is None:
            os.environ.pop("VOICE_INTERNAL_SECRET", None)
        else:
            os.environ["VOICE_INTERNAL_SECRET"] = self.old_secret

    def test_direct_client_and_wrong_signature_rejected(self):
        self.assertEqual(main({}, None), {"ok": False, "code": "FORBIDDEN"})
        job = {"operationId": "op_virtual_01", "recordingId": "recording_virtual_01",
               "fileUrl": "https://media.example.test/private.mp3", "sha256": "a" * 64,
               "sizeBytes": 1000, "durationMs": 2000}
        now = int(time.time())
        self.assertRaises(ValueError, _authenticate,
                          {"job": job, "timestamp": now, "signature": "0" * 64}, now)
        message = str(now).encode() + b"\n" + json.dumps(job, sort_keys=True, separators=(",", ":")).encode()
        signature = hmac.new(os.environ["VOICE_INTERNAL_SECRET"].encode(), message, hashlib.sha256).hexdigest()
        self.assertEqual(_authenticate({"job": job, "timestamp": now, "signature": signature}, now), job)
        self.assertRaises(ValueError, _authenticate,
                          {"job": job, "timestamp": now - 61, "signature": signature}, now)

    def test_rejects_download_from_unapproved_host_before_network(self):
        old_host = os.environ.get("VOICE_ALLOWED_MEDIA_HOST")
        os.environ["VOICE_ALLOWED_MEDIA_HOST"] = "media.example.test"
        try:
            with self.assertRaises(ValueError):
                _download({"fileUrl": "https://other.example.test/file.mp3",
                           "sha256": "a" * 64, "sizeBytes": 10}, Path("unused.mp3"))
        finally:
            if old_host is None:
                os.environ.pop("VOICE_ALLOWED_MEDIA_HOST", None)
            else:
                os.environ["VOICE_ALLOWED_MEDIA_HOST"] = old_host

    def test_benchmark_log_omits_transcript_and_signed_url(self):
        job = {"operationId": "op_virtual_01", "recordingId": "recording_virtual_01",
               "fileUrl": "https://media.example.test/private?token=fictional-private-value",
               "sha256": "a" * 64, "sizeBytes": 1000, "durationMs": 2000}
        now = int(time.time())
        message = str(now).encode() + b"\n" + json.dumps(job, sort_keys=True, separators=(",", ":")).encode()
        signature = hmac.new(os.environ["VOICE_INTERNAL_SECRET"].encode(), message, hashlib.sha256).hexdigest()
        output = io.StringIO()
        def fake_recognize(_path, timings):
            timings.update({"decodeMs": 4, "modelLoadMs": 5,
                            "modelCacheHit": False, "recognizeMs": 6})
            return {"modelVersion": "vosk-model-small-en-us-0.15", "durationMs": 2000,
                    "words": [{"word": "privateword", "start": 0, "end": 1, "confidence": 0.9}]}

        with patch.dict(os.environ, {"VOICE_BENCHMARK_LOG": "1"}), \
             patch("inference._download"), \
             patch("inference.recognize_mp3", side_effect=fake_recognize), \
             redirect_stdout(output):
            result = main({"job": job, "timestamp": now, "signature": signature}, None)
        self.assertTrue(result["ok"])
        self.assertNotIn("result", result)
        self.assertEqual(result["benchmark"]["recognizedWordCount"], 1)
        for field in ("downloadMs", "decodeMs", "modelLoadMs", "recognizeMs"):
            self.assertGreaterEqual(result["benchmark"][field], 0)
        self.assertFalse(result["benchmark"]["modelCacheHit"])
        self.assertNotIn("privateword", json.dumps(result))
        self.assertNotIn("fictional-private-value", json.dumps(result))
        self.assertIn("recognizedWordCount", output.getvalue())
        self.assertNotIn("privateword", output.getvalue())
        self.assertNotIn("fictional-private-value", output.getvalue())

    def test_stage_timing_uses_mock_decoder_and_recognizer_only(self):
        recognizer = SimpleNamespace(AcceptWaveform=lambda _data: False,
                                     FinalResult=lambda: '{"result": []}',
                                     SetWords=lambda _enabled: None)
        file_info = SimpleNamespace(file_format=miniaudio.FileFormat.MP3, duration=2)
        decoded = SimpleNamespace(samples=SimpleNamespace(tobytes=lambda: b"\0" * 32000))
        timings = {}
        with patch("inference.miniaudio.get_file_info", return_value=file_info), \
             patch("inference.miniaudio.decode_file", return_value=decoded), \
             patch("inference._model", object()), \
             patch("inference._load_model", return_value=object()), \
             patch("inference.KaldiRecognizer", return_value=recognizer):
            result = recognize_mp3(Path("virtual.mp3"), timings)
        self.assertEqual(result["words"], [])
        self.assertEqual(result["durationMs"], 2000)
        self.assertTrue(timings["modelCacheHit"])
        for field in ("decodeMs", "modelLoadMs", "recognizeMs"):
            self.assertIsInstance(timings[field], int)
            self.assertGreaterEqual(timings[field], 0)

    def test_signed_model_check_is_benchmark_only_and_contains_no_model_path(self):
        job = {"action": "modelCheck", "operationId": "model_check_virtual_01"}
        now = int(time.time())
        message = str(now).encode() + b"\n" + json.dumps(job, sort_keys=True, separators=(",", ":")).encode()
        signature = hmac.new(os.environ["VOICE_INTERNAL_SECRET"].encode(), message, hashlib.sha256).hexdigest()
        event = {"job": job, "timestamp": now, "signature": signature}
        self.assertEqual(main(event, None), {"ok": False, "code": "FORBIDDEN"})
        output = io.StringIO()
        with patch.dict(os.environ, {"VOICE_BENCHMARK_LOG": "1"}), \
             patch("inference._load_model", return_value=object()), redirect_stdout(output):
            result = main(event, None)
        self.assertEqual(result["benchmark"]["event"], "voice_model_check")
        self.assertNotIn("VOICE_MODEL_PATH", json.dumps(result))
        self.assertNotIn("model/", output.getvalue())

    def test_download_failure_reports_only_safe_stage(self):
        job = {"operationId": "op_virtual_01", "recordingId": "recording_virtual_01",
               "fileUrl": "https://media.example.test/private?token=fictional-private-value",
               "sha256": "a" * 64, "sizeBytes": 1000, "durationMs": 2000}
        now = int(time.time())
        message = str(now).encode() + b"\n" + json.dumps(job, sort_keys=True, separators=(",", ":")).encode()
        signature = hmac.new(os.environ["VOICE_INTERNAL_SECRET"].encode(), message, hashlib.sha256).hexdigest()
        output = io.StringIO()
        with patch.dict(os.environ, {"VOICE_BENCHMARK_LOG": "1"}), \
             patch("inference._download", side_effect=RuntimeError("fictional-private-value")), \
             redirect_stdout(output):
            result = main({"job": job, "timestamp": now, "signature": signature}, None)
        self.assertEqual(result, {"ok": False, "code": "SERVICE_UNAVAILABLE",
                                  "phase": "download", "reason": "runtime_failed"})
        self.assertNotIn("fictional-private-value", output.getvalue())
        self.assertNotIn("fictional-private-value", json.dumps(result))

    def test_mp3_to_pcm_and_silence(self):
        fixture = os.environ.get("VOICE_LOCAL_FIXTURE")
        model = os.environ.get("VOICE_MODEL_PATH")
        if not fixture or not model:
            self.skipTest("local model/fixture paths not provided")
        result = recognize_mp3(Path(fixture))
        self.assertGreater(result["durationMs"], 1000)
        self.assertEqual(result["modelVersion"], "vosk-model-small-en-us-0.15")
        self.assertEqual(result["words"], [])


if __name__ == "__main__":
    unittest.main()
