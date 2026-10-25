"""Private Vosk worker for experimental reading scores.

The CloudBase client security rule must deny direct calls. The HMAC check below is
an independent guard for server-to-server invocation; its secret lives only in
the two function environments and never in a deployment archive or event log.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import tempfile
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

import miniaudio
from vosk import KaldiRecognizer, Model, SetLogLevel

MODEL_VERSION = "vosk-model-small-en-us-0.15"
MAX_BYTES = 20 * 1024 * 1024
MIN_MS = 1000
MAX_MS = 300000
_model = None


class VoiceStageError(Exception):
    def __init__(self, phase: str, reason: str):
        self.phase = phase
        self.reason = reason
        super().__init__(phase)


def _canonical(job: dict) -> bytes:
    if job.get("action") == "modelCheck":
        if set(job) != {"action", "operationId"} or not isinstance(job["operationId"], str):
            raise ValueError("FORBIDDEN")
        return json.dumps(job, separators=(",", ":"), sort_keys=True).encode()
    fields = ("operationId", "recordingId", "fileUrl", "sha256", "sizeBytes", "durationMs")
    if set(job) != set(fields):
        raise ValueError("FORBIDDEN")
    return json.dumps({name: job.get(name) for name in fields}, separators=(",", ":"), sort_keys=True).encode()


def _authenticate(event: dict, now: int) -> dict:
    secret = os.environ.get("VOICE_INTERNAL_SECRET", "")
    if len(secret) < 32 or not isinstance(event, dict):
        raise ValueError("FORBIDDEN")
    job = event.get("job")
    timestamp = event.get("timestamp")
    signature = event.get("signature")
    if not isinstance(job, dict) or not isinstance(timestamp, int) or not isinstance(signature, str):
        raise ValueError("FORBIDDEN")
    if abs(now - timestamp) > 60:
        raise ValueError("FORBIDDEN")
    message = str(timestamp).encode() + b"\n" + _canonical(job)
    expected = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise ValueError("FORBIDDEN")
    return job


def _download(job: dict, destination: Path) -> None:
    url = job.get("fileUrl")
    allowed_host = os.environ.get("VOICE_ALLOWED_MEDIA_HOST", "")
    parsed = urllib.parse.urlparse(url) if isinstance(url, str) else None
    if not parsed or parsed.scheme != "https" or parsed.hostname != allowed_host or not allowed_host:
        raise ValueError("MEDIA_INVALID")
    if not isinstance(job.get("sha256"), str) or len(job["sha256"]) != 64:
        raise ValueError("MEDIA_INVALID")
    if not isinstance(job.get("sizeBytes"), int) or not 0 < job["sizeBytes"] <= MAX_BYTES:
        raise ValueError("MEDIA_INVALID")
    try:
        download_timeout = int(os.environ.get("VOICE_MEDIA_DOWNLOAD_TIMEOUT_SEC", "0"))
    except ValueError:
        raise RuntimeError("DOWNLOAD_TIMEOUT_UNCONFIGURED")
    if not 1 <= download_timeout <= 900:
        raise RuntimeError("DOWNLOAD_TIMEOUT_UNCONFIGURED")
    digest = hashlib.sha256()
    total = 0
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            raise ValueError("MEDIA_INVALID")

    opener = urllib.request.build_opener(NoRedirect)
    with opener.open(url, timeout=download_timeout) as response, destination.open("wb") as output:
        while chunk := response.read(65536):
            total += len(chunk)
            if total > MAX_BYTES or total > job["sizeBytes"]:
                raise ValueError("MEDIA_INVALID")
            digest.update(chunk)
            output.write(chunk)
    if total != job["sizeBytes"] or digest.hexdigest() != job["sha256"]:
        raise ValueError("MEDIA_INVALID")


def _load_model():
    global _model
    if _model is None:
        bundled_model = Path(__file__).resolve().parent / "model" / MODEL_VERSION
        model_path = Path(os.environ.get("VOICE_MODEL_PATH", str(bundled_model)))
        if not model_path.is_dir():
            raise VoiceStageError("model", "directory_missing")
        SetLogLevel(-1)
        try:
            _model = Model(str(model_path))
        except Exception:
            raise VoiceStageError("model", "load_failed")
    return _model


def recognize_mp3(path: Path, timings: dict | None = None) -> dict:
    decode_started = time.monotonic()
    try:
        info = miniaudio.get_file_info(str(path))
    except Exception:
        raise VoiceStageError("decode", "metadata_failed")
    if info.file_format != miniaudio.FileFormat.MP3:
        raise ValueError("MEDIA_INVALID")
    duration_ms = round(info.duration * 1000)
    if duration_ms < MIN_MS or duration_ms > MAX_MS:
        raise ValueError("MEDIA_INVALID")
    try:
        decoded = miniaudio.decode_file(str(path), output_format=miniaudio.SampleFormat.SIGNED16,
                                        nchannels=1, sample_rate=16000)
    except Exception:
        raise VoiceStageError("decode", "pcm_failed")
    if timings is not None:
        timings["decodeMs"] = round((time.monotonic() - decode_started) * 1000)
    model_started = time.monotonic()
    model_cache_hit = _model is not None
    model = _load_model()
    if timings is not None:
        timings["modelLoadMs"] = round((time.monotonic() - model_started) * 1000)
        timings["modelCacheHit"] = model_cache_hit
    recognize_started = time.monotonic()
    try:
        recognizer = KaldiRecognizer(model, 16000)
        recognizer.SetWords(True)
        samples = decoded.samples.tobytes()
        words = []
        for index in range(0, len(samples), 32000):
            if recognizer.AcceptWaveform(samples[index:index + 32000]):
                words.extend(json.loads(recognizer.Result()).get("result", []))
        words.extend(json.loads(recognizer.FinalResult()).get("result", []))
    except Exception:
        raise VoiceStageError("recognize", "runtime_failed")
    if timings is not None:
        timings["recognizeMs"] = round((time.monotonic() - recognize_started) * 1000)
    return {"modelVersion": MODEL_VERSION, "durationMs": duration_ms,
            "words": [{"word": word.get("word"), "start": word.get("start"),
                       "end": word.get("end"), "confidence": word.get("conf")}
                      for word in words]}


def main(event, context):
    started = time.monotonic()
    phase = "auth"
    try:
        job = _authenticate(event, int(time.time()))
        if job.get("action") == "modelCheck":
            if os.environ.get("VOICE_BENCHMARK_LOG") != "1":
                return {"ok": False, "code": "FORBIDDEN"}
            phase = "model"
            _load_model()
            summary = {"event": "voice_model_check", "modelVersion": MODEL_VERSION,
                       "elapsedMs": round((time.monotonic() - started) * 1000)}
            print(json.dumps(summary))
            return {"ok": True, "benchmark": summary}
        with tempfile.TemporaryDirectory(prefix="voice-") as folder:
            path = Path(folder) / "recording.mp3"
            phase = "download"
            benchmark_mode = os.environ.get("VOICE_BENCHMARK_LOG") == "1"
            timings = {} if benchmark_mode else None
            download_started = time.monotonic()
            _download(job, path)
            if timings is not None:
                timings["downloadMs"] = round((time.monotonic() - download_started) * 1000)
            phase = "decode"
            result = recognize_mp3(path, timings) if timings is not None else recognize_mp3(path)
        if abs(result["durationMs"] - job.get("durationMs", -1)) > 1000:
            return {"ok": False, "code": "MEDIA_INVALID"}
        elapsed_ms = round((time.monotonic() - started) * 1000)
        if benchmark_mode:
            summary = {"event": "voice_benchmark", "elapsedMs": elapsed_ms,
                       "audioDurationMs": result["durationMs"],
                       "recognizedWordCount": len(result["words"]),
                       "modelVersion": result["modelVersion"], **timings}
            print(json.dumps(summary))
            return {"ok": True, "benchmark": summary}
        return {"ok": True, "result": result, "elapsedMs": elapsed_ms}
    except ValueError as error:
        code = str(error)
        return {"ok": False, "code": code if code in ("FORBIDDEN", "MEDIA_INVALID") else "MEDIA_INVALID"}
    except VoiceStageError as error:
        return _unavailable(error.phase, error.reason)
    except urllib.error.HTTPError as error:
        return _unavailable("download", "http_" + str(error.code))
    except Exception:
        return _unavailable(phase, "runtime_failed")


def _unavailable(phase: str, reason: str) -> dict:
    result = {"ok": False, "code": "SERVICE_UNAVAILABLE"}
    if os.environ.get("VOICE_BENCHMARK_LOG") == "1":
        result.update({"phase": phase, "reason": reason})
        print(json.dumps({"event": "voice_benchmark_failure", "phase": phase, "reason": reason}))
    return result
