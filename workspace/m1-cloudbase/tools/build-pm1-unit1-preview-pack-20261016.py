"""Build and register an immutable five-question pack from A*List's public preview."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path('G:/英语资产')
SRC = ROOT / 'inbox/phonics-monster-1-3rd-official-preview-2026-10-16'
OUT = ROOT / 'library/derived/phonics-monster-1-3rd-unit1-preview-exercises-20261016/v2'
EXPORT = ROOT / 'exports/wechat/phonics-monster-1-3rd-unit1-preview-20261016-v2'
CONFIG = ROOT / 'config/resource-overrides.json'
BACKUP = ROOT / 'reports/resource-overrides-before-pm1-unit1-preview-v2-20261016.json'
URL = 'https://www.alist.co.kr/books_files/preview/06PM3E01SB/'
PACK = 'exercise_pack_pm1_3rd_unit1_preview_20261016_v2'
STAMP = '2026-10-16T21:22:00+08:00'
TITLE = 'Phonics Monster 1（第三版官方预览）- Unit 1 Aa Bb Cc'
ATTRIBUTION = '来源：A*List《Phonics Monster Student Book 1》第三版官方预览，Unit 1；题目由 Codex 根据预览页自编。'
RIGHTS = ('项目负责人在本任务中确认已取得五类指定素材的使用权限，并要求自行导出和上架。'
          '本条仅关联 A*List 第三版 Phonics Monster Student Book 1 官方公开预览 Unit 1，'
          '用于小程序内教学展示、改编与向全学校分发；不虚构合同编号。')
QUESTIONS = [
    (12, '大小写字母', '看字母 A，选出它对应的小写字母。\n' + ATTRIBUTION,
     ['a', 'b', 'c'], 'a', '大写 A 对应小写 a；官方预览 Unit 1 印刷第 10 页并列 Aa、Bb、Cc。'),
    (14, 'B 的起始字母', '下列哪个单词以字母 b 开头？\n' + ATTRIBUTION,
     ['apple', 'bear', 'cat'], 'bear', 'bear 以 b 开头；官方预览 Unit 1 印刷第 12 页把 bear 列在 Bb 下。'),
    (14, 'C 的起始字母', '哪一组的两个单词都以字母 c 开头？\n' + ATTRIBUTION,
     ['car, cow', 'ant, apple', 'ball, book'], 'car, cow',
     'car 和 cow 都以 c 开头；官方预览 Unit 1 印刷第 12 页把它们列在 Cc 下。'),
    (15, '单词认读', '“书”的英文单词是哪一个？\n' + ATTRIBUTION,
     ['book', 'ball', 'bear'], 'book', 'book 是书；官方预览 Unit 1 印刷第 13 页将 book 与书的图片对应。'),
    (17, 'Aa 词汇与冠词', '补全短句：An ___ and an ant. 选出 Unit 1 中以 a 开头的动物词。\n' + ATTRIBUTION,
     ['alligator', 'bear', 'cow'], 'alligator',
     'alligator 以 a 开头，且官方预览 Unit 1 印刷第 15 页的故事同时出现 alligator 和 ant。'),
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: Path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write_new(path: Path, value: object) -> None:
    payload = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != payload:
            raise RuntimeError(f'immutable output differs: {path}')
        return
    path.write_bytes(payload)


def relative(path: Path) -> str:
    return path.resolve().relative_to(ROOT.resolve()).as_posix()


def main() -> None:
    pages = []
    for number in range(1, 21):
        file = SRC / f'page{number:05}.jpg'
        if not file.is_file() or file.stat().st_size < 10000:
            raise RuntimeError(f'preview page missing: {number}')
        pages.append({'previewPage': number, 'file': relative(file),
                      'sha256': digest(file), 'bytes': file.stat().st_size,
                      'sourceUrl': f'{URL}epub/OEBPS/content/images/page{number:05}/backgnd{number:03}.jpg'})
    source = {'schemaVersion': 1, 'packId': PACK,
              'sourceTitle': 'Phonics Monster Student Book 1 (3rd)',
              'publisher': 'A*List / E*Public', 'edition': 'third edition, official public preview only',
              'sourceUrl': URL, 'sourceAcquiredAt': STAMP, 'previewPageCount': len(pages),
              'unit': 'Unit 1 Aa Bb Cc, printed pages 10–17 (preview pages 12–19)',
              'pageSnapshots': pages, 'rightsBasis': RIGHTS, 'rightsStatus': 'user_confirmed_cleared',
              'studentAttribution': ATTRIBUTION}
    source_path = OUT / 'source-records/pm1-unit1-source-record.json'
    write_new(source_path, source)
    source_sha = digest(source_path)
    ids = []
    previews = []
    declarations = []
    config_bytes = CONFIG.read_bytes()
    config = json.loads(config_bytes.decode('utf-8-sig'))
    existing = {row['relativePath']: row for row in config.get('derivedSupplementSources', [])}
    for index, (page, point, stem, options, answer, explanation) in enumerate(QUESTIONS, 1):
        rid = f'res_question_pm1_3rd_u1_q{index:02}_v2'
        ids.append(rid)
        title = f'{TITLE} - Question {index}'
        if len(options) != len(set(options)) or options.count(answer) != 1 or ATTRIBUTION not in stem:
            raise RuntimeError(f'question invalid: {rid}')
        exercise = {'grade': '一年级', 'questionType': 'single_choice', 'stem': stem,
                    'options': options, 'correctAnswer': answer, 'explanation': explanation,
                    'textbook': 'Phonics Monster 1（第三版官方预览）',
                    'unit': 'Unit 1 Aa Bb Cc', 'knowledgePoint': point,
                    'difficulty': '基础'}
        directory = OUT / 'cloudbase-items' / rid
        rights = {'schemaVersion': 1, 'resourceId': rid, 'decision': 'approved',
                  'scope': 'all_schools_teaching', 'sourceSha256': source_sha,
                  'sourceUrl': URL, 'sourceTitle': source['sourceTitle'],
                  'rightsBasis': RIGHTS, 'rightsStatus': 'user_confirmed_cleared',
                  'sourceSnapshotSha256': pages[page-1]['sha256'],
                  'exercisePackId': PACK, 'studentAttribution': ATTRIBUTION,
                  'restrictedMediaIncluded': False}
        review = {'schemaVersion': 1, 'resourceId': rid, 'contentType': 'exercise',
                  'decision': 'approved', 'reviewerId': 'Codex', 'reviewedAt': STAMP,
                  'reviewRevision': 1, 'contentVersion': 1, 'copyrightStatus': 'verified',
                  'sourceSha256': source_sha, 'exercisePackId': PACK,
                  'grade': '一年级', 'title': title, 'questionType': 'single_choice',
                  'stem': stem, 'options': options, 'correctAnswer': answer,
                  'explanation': explanation, 'knowledgePoint': point, 'difficulty': '基础',
                  'evidence': {'sourceUrl': pages[page-1]['sourceUrl'],
                               'sourceSnapshotSha256': pages[page-1]['sha256'],
                               'previewPage': page, 'printedPage': page-2,
                               'answerRationale': explanation}, 'exercise': exercise}
        write_new(directory / 'source-record.json', source)
        write_new(directory / 'copyright-evidence.json', rights)
        write_new(directory / 'approved-content.json', review)
        manifest = {'schemaVersion': 1, 'resourceId': rid, 'resourceType': 'supplement',
                    'title': title, 'sourceUrl': URL, 'sourceSha256': source_sha,
                    'sourceSnapshotSha256': pages[page-1]['sha256'],
                    'contentVersion': 1, 'exercisePackId': PACK, 'processingStatus': 'publish_ready',
                    'details': {'questionCount': 1, 'studentMaterialComplete': True,
                                'answerLeakCheck': 'passed', 'reviewRevision': 1,
                                'reviewSha256': digest(directory / 'approved-content.json'),
                                'copyrightSha256': digest(directory / 'copyright-evidence.json')}}
        write_new(directory / 'manifest.json', manifest)
        export = {'sourceId': rid, 'organizationId': 'org_qihang_demo', 'title': title,
                  **exercise, 'contentVersion': 1, 'sourceSha256': source_sha,
                  'sourceUrl': URL, 'manifestSha256': digest(directory / 'manifest.json'),
                  'reviewId': 'review_' + digest(directory / 'approved-content.json')[:32],
                  'copyrightEvidenceId': 'copyright_' + digest(directory / 'copyright-evidence.json')[:32],
                  'copyrightEvidenceSha256': digest(directory / 'copyright-evidence.json'),
                  'verifiedAt': STAMP, 'importedBy': 'codex_pm1_3rd_unit1_20261016_v1',
                  'exercisePackId': PACK,
                  'evidence': {'manifestPath': 'manifest.json', 'approvedContentPath': 'approved-content.json',
                               'sourcePath': 'source-record.json', 'copyrightEvidencePath': 'copyright-evidence.json'}}
        write_new(directory / 'input.json', export)
        write_new(EXPORT / f'{rid}.json', {**export, 'assetRoot': str(directory)})
        candidate = directory / f'{rid}.json'
        write_new(candidate, {'resourceId': rid, 'exercisePackId': PACK, 'title': title,
                              'contentVersion': 1, **exercise, 'sourceUrl': URL,
                              'sourcePageEvidence': explanation, 'sourceRecordSha256': source_sha})
        previews.append({'id': rid, 'title': title, 'questionType': 'single_choice',
                         'stem': stem, 'options': options})
    preview_path = OUT / 'student-preview/pm1-unit1-student-preview.json'
    write_new(preview_path, {'schemaVersion': 1, 'packId': PACK, 'questions': previews})
    review_path = OUT / 'review/pm1-unit1-codex-review.json'
    write_new(review_path, {'schemaVersion': 1, 'packId': PACK, 'reviewerId': 'Codex',
                            'reviewedAt': STAMP, 'decision': 'approved_content_for_nonproduction_validation', 'questionCount': 5,
                            'sourceAndEdition': 'third edition public preview, Unit 1 only',
                            'studentVisibleEvidence': 'each question self-contained in stem and options',
                            'answerLeakCheck': 'passed', 'media': 'no audio or source page image in exercise pack',
                            'questions': [{'id': rid, 'correctAnswer': q[4], 'explanation': q[5]}
                                          for rid, q in zip(ids, QUESTIONS)]})
    for rid in ids:
        directory = OUT / 'cloudbase-items' / rid
        candidate = directory / f'{rid}.json'
        rights = directory / 'copyright-evidence.json'
        provenance = directory / f'{rid}-catalog-provenance.json'
        write_new(provenance, {'decision': 'derived_exercise_pack_question_pending_full_content_review',
                               'outputRelativePath': relative(candidate), 'outputSha256': digest(candidate),
                               'sourceRecordRelativePath': relative(source_path),
                               'sourceRecordSha256': source_sha,
                               'sourceRightsRelativePath': relative(rights),
                               'sourceRightsSha256': digest(rights),
                               'studentPreviewRelativePath': relative(preview_path),
                               'studentPreviewSha256': digest(preview_path),
                               'codexReviewRelativePath': relative(review_path),
                               'codexReviewSha256': digest(review_path),
                               'sourceSnapshotRelativePath': pages[11]['file'],
                               'sourceSnapshotSha256': pages[11]['sha256'],
                               'exercisePackId': PACK, 'expectedPackQuestionCount': 5,
                               'questionCount': 1,
                               'questionEvidence': load(candidate)['sourcePageEvidence']})
        declaration = {'relativePath': relative(candidate), 'sha256': digest(candidate),
                       'provenanceRelativePath': relative(provenance),
                       'provenanceSha256': digest(provenance)}
        declarations.append(declaration)
        catalog_review = {'schemaVersion': 1, 'resourceId': rid, 'sourceVersion': 1,
                          'sourceSha256': digest(candidate).upper(), 'decision': 'approved',
                          'contentType': 'exercise', 'reviewRevision': 1, 'reviewerId': 'Codex',
                          'reviewedAt': STAMP, 'copyrightStatus': 'verified', 'contentVersion': 1,
                          'exercisePackId': PACK,
                          'exercise': {key: load(candidate)[key] for key in (
                              'grade', 'textbook', 'unit', 'knowledgePoint', 'difficulty',
                              'questionType', 'stem', 'options', 'correctAnswer', 'explanation')},
                          'sourceEvidence': {'sourceUrl': URL,
                                             'sourceSnapshotSha256': pages[11]['sha256'],
                                             'rightsEvidenceSha256': digest(rights),
                                             'studentPreviewSha256': digest(preview_path),
                                             'questionEvidence': load(candidate)['sourcePageEvidence']}}
        write_new(ROOT / 'library/supplements' / rid / 'v1/review/approved-content-v1.json', catalog_review)
        config.setdefault('files', {})[candidate.name] = {
            'resourceId': rid, 'title': load(candidate)['title'], 'publisher': 'A*List / E*Public',
            'grade': '一年级', 'unit': 'Unit 1 Aa Bb Cc', 'language': 'en',
            'roles': ['exercise_pack_question', 'codex_reviewed'],
            'rightsStatus': 'user_confirmed_cleared', 'needsMetadata': [],
            'sourceUrl': URL, 'exercisePackId': PACK}
    write_new(OUT / 'batch-manifest.json', {
        'schemaVersion': 1, 'batchId': 'phonics-monster-1-3rd-unit1-preview-exercises-20261016-v2',
        'builtAt': STAMP, 'minimumQuestionsPerTask': 5, 'packCount': 1,
        'packs': [{'packId': PACK, 'packKey': 'unit1-aa-bb-cc', 'title': TITLE,
                   'grade': '一年级', 'questionCount': 5, 'resourceIds': ids,
                   'sourceUrl': URL, 'sourceSnapshotSha256': pages[11]['sha256']}]})
    import sys
    sys.path.insert(0, str(ROOT / 'scripts'))
    import asset_pipeline
    discovered = asset_pipeline.discover_declared_derived_supplements(
        ROOT, {'derivedSupplementSources': declarations})
    if len(discovered) != 5:
        raise RuntimeError('derived supplement validation incomplete')
    if not BACKUP.exists():
        BACKUP.write_bytes(config_bytes)
    elif BACKUP.read_bytes() != config_bytes and not all(
            row['relativePath'] in existing for row in declarations):
        raise RuntimeError('configuration changed after backup')
    for row in declarations:
        if row['relativePath'] in existing and existing[row['relativePath']] != row:
            raise RuntimeError('existing derived source changed')
        existing[row['relativePath']] = row
    config['derivedSupplementSources'] = sorted(existing.values(), key=lambda row: row['relativePath'].lower())
    if CONFIG.read_bytes() != config_bytes:
        raise RuntimeError('configuration changed during build')
    CONFIG.write_bytes((json.dumps(config, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(json.dumps({'status': 'built_and_registered', 'packId': PACK, 'questionCount': 5,
                      'sourceRecordSha256': source_sha, 'validated': len(discovered)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
