"""Build an immutable, five-question Hello! listening content package."""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path('G:/英语资产')
OUT = ROOT / 'library/derived/sss-hello-listening-20261017/v2'
SHARE = ROOT / 'inbox/sss-hello-quark-public-share-2026-10-17'
MIRROR = ROOT / 'inbox/sss-hello-mp3pm-candidate-2026-10-17/hello.mp3'
OFFICIAL_PRINTABLES = ROOT / 'inbox/sss-hello-official-printables-2026-10-17'
AUDIO = SHARE / 'hello-quark.mp3'
VIDEO = SHARE / 'hello-quark.mp4'
ID = 'res_listening_sss_hello_20261017_v2'
CLAM = Path('D:/app-cache/m3-media-tools/clamav-1.5.4-win-x64/clamav-1.5.4.win.x64/clamscan.exe')
DB = Path('D:/app-cache/sss-hello-clamdb')
EICAR = Path('D:/app/workspace/m3-acceptance/2026-10-03/media-scan-feasibility/eicar-scan-container.zip')
ATTRIBUTION = ('Super Simple Songs《Hello!》，Skyship Entertainment。'
               '歌曲音频经用户确认许可用于本项目教学；课堂题目由 Codex 自编。')
QUESTIONS = [
    ('greeting', '歌曲中反复向别人问候的英文问句是哪一句？',
     ['How are you?', 'What is your name?', 'Where are you?'], 'How are you?',
     '歌曲开头和结尾都在问候 How are you?。', 10000, 15500, 'How are you?'),
    ('good', '歌曲第一组回答中，最先唱出的积极感受是哪一句？',
     ["I'm good.", "I'm hungry.", "I'm tired."], "I'm good.",
     '第一组回答依次表达 good、great、wonderful，先唱 good。', 15000, 17600, "I'm good."),
    ('great', '在第一组回答里，good 后面紧接着唱的是哪个词？',
     ['great', 'hungry', 'tired'], 'great',
     '第一组回答依次为 good、great、wonderful。', 17200, 19800, "I'm great."),
    ('hungry', '后半段表示“饿了”的英语词是哪个？',
     ['hungry', 'wonderful', 'great'], 'hungry',
     '后半段唱出 hungry，表示饿了。', 43500, 51500, "I'm hungry."),
    ('not-so-good', '后半段哪一句表示“我不太好”？',
     ["I'm not so good.", "I'm wonderful.", "I'm great."], "I'm not so good.",
     '后半段唱出 not so good，表示状态不太好。', 52500, 56200, "I'm not so good."),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_new(path: Path, value: object) -> None:
    payload = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != payload:
            raise RuntimeError(f'immutable output differs: {path}')
    else:
        path.write_bytes(payload)


def zip_new(path: Path, files: list[Path]) -> None:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_STORED) as archive:
            for file in files:
                archive.write(file, file.name)
    with zipfile.ZipFile(path) as archive:
        if sorted(archive.namelist()) != sorted(file.name for file in files):
            raise RuntimeError('scan archive changed')
        for file in files:
            if hashlib.sha256(archive.read(file.name)).hexdigest() != sha(file):
                raise RuntimeError('scan archive bytes changed')


def scan(path: Path, expected_exit: int, marker: str) -> dict:
    result = subprocess.run([str(CLAM), f'--database={DB}', str(path)],
                            capture_output=True, text=True, encoding='utf-8',
                            errors='replace', timeout=180)
    report = result.stdout
    if result.returncode != expected_exit or marker not in report or 'Data scanned: 0 B' in report:
        raise RuntimeError(f'scan failed: {path.name}')
    if 'Data scanned:' not in report:
        raise RuntimeError('scan byte count missing')
    return {'archiveSha256': sha(path), 'report': report,
            'reportSha256': hashlib.sha256(report.encode()).hexdigest(),
            'scannedAt': datetime.now().astimezone().isoformat(timespec='seconds')}


def main() -> None:
    expected = {
        AUDIO: 'd02287bdedb56794a54b4c2687b45e3e14ce1a4e7727f522eff26a6748d3249d',
        VIDEO: '2ce7a47f683bc0e7884b1537947b4d5d881ccff30ba6ad2e2bbb4d6577156c20',
        MIRROR: '2078143f4c7fa2f19485072b17a4ee31a1b41fbb4ff2b6f621306de46437d161',
    }
    for path, digest in expected.items():
        if sha(path) != digest:
            raise RuntimeError(f'source hash changed: {path.name}')
    final_audio = OUT / 'audio/hello-reviewed-v2.mp3'
    final_audio.parent.mkdir(parents=True, exist_ok=True)
    if not final_audio.exists():
        shutil.copyfile(AUDIO, final_audio)
    if sha(final_audio) != sha(AUDIO):
        raise RuntimeError('passthrough changed source audio')
    source_zip = OUT / 'scan/source-media-v2.zip'
    output_zip = OUT / 'scan/output-audio-v2.zip'
    zip_new(source_zip, [AUDIO, VIDEO])
    zip_new(output_zip, [final_audio])
    source_scan = scan(source_zip, 0, 'Infected files: 0')
    passthrough_at = datetime.now().astimezone().isoformat(timespec='seconds')
    output_scan = scan(output_zip, 0, 'Infected files: 0')
    negative_scan = scan(EICAR, 1, 'Eicar-Test-Signature FOUND')
    if 'Infected files: 1' not in negative_scan['report']:
        raise RuntimeError('negative control failed')
    for name, row in [('source', source_scan), ('output', output_scan), ('negative', negative_scan)]:
        write_new(OUT / f'scan/{name}-receipt-v2.json', row)
    source = {
        'schemaVersion': 1, 'resourceId': ID,
        'officialSongUrl': 'https://supersimple.com/song/hello/',
        'quarkShareUrl': 'https://pan.quark.cn/s/8b268e99766e',
        'quarkAudioFid': '9df8fa7ede7b435194f3e3be20c3629d',
        'quarkVideoFid': 'd98edb262ed14216aa52734bf56a769f',
        'mirrorPageUrl': 'https://248980-hello.mp3.pm/song/204690982-super-simple-songs/',
        'audioSha256': sha(AUDIO), 'videoSha256': sha(VIDEO),
        'mirrorAudioSha256': sha(MIRROR),
        'audioBytes': AUDIO.stat().st_size, 'videoBytes': VIDEO.stat().st_size,
        'officialSheetMusicSha256': sha(OFFICIAL_PRINTABLES / 'hello-sheet-music.pdf'),
        'officialFlashcardsSha256': sha(OFFICIAL_PRINTABLES / 'hello-flashcards.pdf'),
        'quarkAdvertisedMd5Mismatch': True,
        'quarkRepeatDownloadSha256Matches': True,
        'decodedAudioEnvelopeCorrelationVideoVsQuarkMp3': 0.9999,
        'decodedAudioEnvelopeCorrelationVideoVsMirrorMp3': 0.9997,
        'videoFrameSubtitleChecksSeconds': [12, 14, 16, 18, 20, 25, 40, 44, 50, 54, 70],
        'videoMediaIsEvidenceOnly': True,
        'distributedMedia': 'clean audio MP3 only; third-party-marked video excluded',
        'rightsBasis': ('用户在本任务确认已取得 SSS 素材许可并允许使用网盘等渠道取得资源；'
                        '本包限于小程序内教学播放、改编配题和全学校分发。'),
        'rightsStatus': 'user_confirmed_cleared',
    }
    write_new(OUT / 'source-record-v2.json', source)
    technical = {
        'schemaVersion': 1, 'resourceId': ID, 'audioSha256': sha(final_audio),
        'audioBytes': final_audio.stat().st_size, 'durationMs': 78089,
        'codec': 'mp3', 'sampleRate': 44100, 'channels': 2,
        'videoDurationMs': 78089, 'videoCodec': 'h264', 'videoAudioCodec': 'aac',
        'scanEngine': 'ClamAV 1.5.4', 'databaseUpdatedAt': '2026-10-17T15:53:49+08:00',
        'sourceScanSha256': source_scan['reportSha256'],
        'outputScanSha256': output_scan['reportSha256'],
        'negativeControlSha256': negative_scan['reportSha256'],
        'sourceScanContainerSha256': source_scan['archiveSha256'],
        'outputScanContainerSha256': output_scan['archiveSha256'],
        'sourceScannedAt': source_scan['scannedAt'],
        'passthroughAt': passthrough_at,
        'outputScannedAt': output_scan['scannedAt'],
        'negativeControlScannedAt': negative_scan['scannedAt'],
        'continuousDecoding': 'ffmpeg decoded entire 78.09 s MP3 and MP4 without errors',
        'contentCrosscheck': ('Quark MP3 and independent mirror match the video audio amplitude envelopes '
                              'at the same timeline (0.9999 and 0.9997); selected video subtitle frames '
                              'match Skyship official Hello! lyrics. Offline OS dictation was low-confidence '
                              'and was not used as proof of individual words.'),
    }
    write_new(OUT / 'technical-receipt-v2.json', technical)
    questions = []
    student_questions = []
    for index, (point, stem, options, answer, explanation, start, end, cue) in enumerate(QUESTIONS, 1):
        qid = f'sss-hello-listening-q{index:02}-v2'
        if not 0 <= start < end <= technical['durationMs'] or options.count(answer) != 1:
            raise RuntimeError(f'question invalid: {qid}')
        q = {'id': qid, 'questionType': 'single_choice', 'stem': stem,
             'options': options, 'correctAnswer': answer,
             'explanation': explanation, 'required': True,
             'knowledgePoint': point, 'answerAudioText': cue,
             'mainSegment': {'startMs': start, 'endMs': end,
                             'sourceAudioRelativePath': 'audio/hello-reviewed-v2.mp3',
                             'alignmentStatus': 'reviewed_against_video_subtitle_and_audio_correlation'}}
        questions.append(q)
        student_questions.append({key: q[key] for key in ('id', 'questionType', 'stem', 'options')})
    activity = {
        'schemaVersion': 1, 'packageId': 'sss-hello-one-audio-five-questions-20261017-v2',
        'resourceId': ID, 'resourceType': 'listening',
        'title': 'SSS儿歌《Hello!》｜听歌识情绪（五题）',
        'grade': '一年级', 'difficulty': '基础', 'textbook': 'Super Simple Songs',
        'unit': 'Hello! / 问候与情绪', 'attribution': ATTRIBUTION,
        'mainAudio': {'relativePath': 'audio/hello-reviewed-v2.mp3',
                      'sha256': sha(final_audio), 'durationMs': technical['durationMs'],
                      'sizeBytes': final_audio.stat().st_size, 'codec': 'mp3',
                      'sampleRate': 44100, 'channels': 2},
        'audioTranscript': ["Hello, hello, hello, how are you?",
                            "I'm good.", "I'm great.", "I'm wonderful.",
                            "I'm tired.", "I'm hungry.", "I'm not so good."],
        'studentTranscriptDefault': 'hidden',
        'completionRule': {'fullAudioContinuousPlayback': True,
                           'allRequiredQuestionsAnswered': True},
        'questionCount': 5, 'questions': questions,
    }
    write_new(OUT / 'activity-v2.json', activity)
    preview = {'schemaVersion': 1, 'resourceId': ID,
               'title': activity['title'], 'grade': activity['grade'],
               'mainAudioDurationMs': technical['durationMs'],
               'attribution': ATTRIBUTION,
               'questions': student_questions}
    write_new(OUT / 'student-preview-v2.json', preview)
    rights = {'schemaVersion': 1, 'resourceId': ID, 'decision': 'approved',
              'scope': 'all_schools_teaching', 'rightsStatus': 'user_confirmed_cleared',
              'rightsBasis': source['rightsBasis'], 'officialSongUrl': source['officialSongUrl'],
              'sourceRecordSha256': sha(OUT / 'source-record-v2.json'),
              'originalAudioSha256': sha(AUDIO),
              'distributedAudioSha256': sha(final_audio),
              'attribution': ATTRIBUTION}
    write_new(OUT / 'rights-v2.json', rights)
    review = {'schemaVersion': 1, 'resourceId': ID, 'reviewerId': 'Codex',
              'reviewedAt': negative_scan['scannedAt'],
              'decision': 'approved_for_content_publication',
              'contentVersion': 1, 'sourceRecordSha256': sha(OUT / 'source-record-v2.json'),
              'activitySha256': sha(OUT / 'activity-v2.json'),
              'studentPreviewSha256': sha(OUT / 'student-preview-v2.json'),
              'rightsSha256': sha(OUT / 'rights-v2.json'),
              'technicalReceiptSha256': sha(OUT / 'technical-receipt-v2.json'),
              'audioSha256': sha(final_audio), 'questionCount': 5,
              'studentAnswerLeak': False, 'questionSegmentsChecked': True,
              'sourceLimitations': ['Quark metadata MD5 differs from delivered bytes; repeat download SHA-256 stable.',
                                    'No human audio listening. Video subtitles and two independent audio copies '
                                    'were cross-checked; OS dictation was low-confidence.'],
              'questions': [{'id': q['id'], 'correctAnswer': q['correctAnswer'],
                             'explanation': q['explanation'],
                             'segment': q['mainSegment']} for q in questions]}
    write_new(OUT / 'review-v2.json', review)
    write_new(OUT / 'manifest-v2.json', {'schemaVersion': 1, 'resourceId': ID,
        'contentVersion': 1, 'resourceType': 'listening', 'processingStatus': 'publish_ready',
        'sourceRecordSha256': sha(OUT / 'source-record-v2.json'),
        'activitySha256': sha(OUT / 'activity-v2.json'),
        'studentPreviewSha256': sha(OUT / 'student-preview-v2.json'),
        'rightsSha256': sha(OUT / 'rights-v2.json'),
        'technicalReceiptSha256': sha(OUT / 'technical-receipt-v2.json'),
        'reviewSha256': sha(OUT / 'review-v2.json'),
        'audioSha256': sha(final_audio), 'questionCount': 5})
    print(json.dumps({'status': 'built', 'resourceId': ID, 'audioSha256': sha(final_audio),
                      'questionCount': 5, 'sourceScan': 'clean', 'outputScan': 'clean',
                      'negativeControl': 'detected'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
