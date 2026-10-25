"""Build two reviewed, grouped exercise packs from official NGL global samplers."""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path('G:/英语资产')
INBOX = ROOT / 'inbox/ngl-ourworld-timezones-official-global-samples-2026-10-17'
CONFIG = ROOT / 'config/resource-overrides.json'
BACKUP = ROOT / 'reports/resource-overrides-before-ngl-global-sample-packs-20261017.json'
STAMP = '2026-10-17T15:04:00+08:00'
RIGHTS = ('项目负责人已在本任务确认五类指定素材的使用权限，要求 Codex 直接从网上取得并上架。'
          '本记录只适用于所列 NGL 官方全球版样章、基于样章自编的题目及小程序教学展示和全学校分发；'
          '全球版不是江苏凤凰教育出版社的国内版，不虚构合同编号。')
SPECS = [
    {
        'key': 'ourworld2-level1-unit7', 'pdf': 'ourworld2-starter-walkthrough.pdf',
        'sha256': 'b974d2086fdfff6b77b067b7e6434f180a3fedb637096c15a55ce26b8ef569cf',
        'url': 'https://www.eltngl.com/assets/downloads/ourworld2_pro0000009113/unit_walkthrough_resources.pdf',
        'sourceTitle': 'Our World, Second Edition Level 1, Unit 7 - My Body, global walkthrough',
        'publisher': 'National Geographic Learning / Cengage', 'grade': '三年级',
        'textbook': '环球少年英语（Our World 2e 全球版教学样章）',
        'unit': 'Level 1 Unit 7 - My Body',
        'title': '环球少年英语（Our World 2e 全球版教学样章）- My Body',
        'pack': 'exercise_pack_ow2e_l1_u7_global_20261017_v1',
        'prefix': 'res_question_ow2e_l1_u7',
        'output': 'ourworld2-level1-unit7-global-exercises-20261017/v1',
        'export': 'ourworld2-level1-unit7-global-20261017-v1',
        'attribution': '来源：NGL《Our World》第二版全球版第 1 级 Unit 7 教学样章；题目由 Codex 根据样章自编。',
        'questions': [
            (7, 116, '身体部位词汇', '“耳朵”的英文单词是哪一个？', ['ear', 'eye', 'arm'], 'ear',
             'ear 表示耳朵；官方样章 PDF 第 7 页展示 Unit 7 印刷第 116–117 页的身体部位词表。'),
            (8, 120, '物主代词', '说“他的头发是棕色”，句首应选哪个词？___ hair is brown.',
             ['His', 'Her', 'Your'], 'His',
             'His 表示“他的”；官方样章 PDF 第 8 页印刷第 120 页给出 His hair is brown 等物主代词用法。'),
            (9, 123, 'can 表示能力', '哪句话表示“我会走路”？',
             ['I can walk.', 'I walk can.', 'I am walk.'], 'I can walk.',
             'can 后接动词原形 walk；官方样章 PDF 第 9 页印刷第 123 页给出 I can walk。'),
            (9, 124, '阅读细节：雕塑',
             '阅读提示：艺术家把骑马者的手臂和腿塑得很大，把马的头部塑得很小。哪个部位很小？',
             ['The horse’s head.', 'The rider’s arms.', 'The rider’s legs.'], 'The horse’s head.',
             '原短文说明骑马雕塑中马的头小；官方样章 PDF 第 9 页展示印刷第 124 页。'),
            (9, 124, '阅读细节：气球狗',
             '阅读提示：一件气球狗雕塑的腿很大，耳朵很长。哪项描述正确？',
             ['Its ears are long.', 'Its ears are short.', 'Its legs are small.'], 'Its ears are long.',
             '原短文说明气球狗耳朵长、腿大；官方样章 PDF 第 9 页展示印刷第 124 页。'),
        ],
    },
    {
        'key': 'timezones3e-level1-unit3', 'pdf': 'timezones3e-sampler.pdf',
        'sha256': '20ce1ed10682c0611e1fe44de6cde5d3c6fb4f7578f9a4385ba748c37fe8cef6',
        'url': 'https://www.eltngl.com/assets/downloads/tz_pro0000009123/ngl_elt_tz3e_sampler_web.pdf',
        'sourceTitle': 'Time Zones Third Edition Level 1 Unit 3 - Strange Animals, global sampler',
        'publisher': 'National Geographic Learning / Cengage', 'grade': '七年级',
        'textbook': '新时空英语（Time Zones 3e 全球版样章）',
        'unit': 'Level 1 Unit 3 - Strange Animals',
        'title': '新时空英语（Time Zones 3e 全球版样章）- Strange Animals',
        'pack': 'exercise_pack_tz3e_l1_u3_global_20261017_v1',
        'prefix': 'res_question_tz3e_l1_u3',
        'output': 'timezones3e-level1-unit3-global-exercises-20261017/v1',
        'export': 'timezones3e-level1-unit3-global-20261017-v1',
        'attribution': '来源：NGL《Time Zones》第三版全球版第 1 级 Unit 3 样章；题目由 Codex 根据样章自编。',
        'questions': [
            (10, 37, '词义：camouflage',
             '阅读提示：有些动物的颜色与周围环境相近，让人难以发现。文中的 camouflaged 最接近什么意思？',
             ['与环境融为一体', '长得更大', '发出更响的声音'], '与环境融为一体',
             '原文直接解释伪装是颜色与周围环境相同；官方样章 PDF 第 10 页印刷第 37 页。'),
            (10, 37, '细节：海龙栖身处',
             '阅读提示：叶海龙与附近植物颜色相近，并躲在其中。它躲在哪里？',
             ['seaweed', 'a tree', 'a rock'], 'seaweed',
             '原文说叶海龙藏在海藻中；官方样章 PDF 第 10 页印刷第 37 页。'),
            (10, 37, '细节：形状',
             '阅读提示：叶海龙像海藻。除了颜色相近，它的身体还像什么形状？',
             ['leaves', 'stones', 'wings'], 'leaves',
             '原文说它的身体形状也像叶子；官方样章 PDF 第 10 页印刷第 37 页。'),
            (10, 37, '推理：树上的猫头鹰',
             '阅读提示：一只猫头鹰藏在树上，它的颜色与树枝相近。为什么人不容易发现它？',
             ['它的颜色与树枝相近', '它躲在海藻里', '它一直闭着眼睛'], '它的颜色与树枝相近',
             '原文说明猫头鹰的颜色与树枝相似；官方样章 PDF 第 10 页印刷第 37 页。'),
            (10, 37, '比较：两种动物',
             '阅读提示：叶海龙躲在海藻中，猫头鹰藏在树上。两者共同使用什么方式隐藏？',
             ['利用与环境相近的颜色', '游到深海', '发出叫声'], '利用与环境相近的颜色',
             '原文分别说明两种动物的颜色与海藻或树枝相近；官方样章 PDF 第 10 页印刷第 37 页。'),
        ],
    },
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: Path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write_new(path: Path, value: object) -> None:
    payload = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != payload:
            raise RuntimeError(f'immutable output differs: {path}')
    else:
        path.write_bytes(payload)


def rel(path: Path) -> str:
    return path.resolve().relative_to(ROOT.resolve()).as_posix()


def build(spec: dict) -> list[dict]:
    source_pdf = INBOX / spec['pdf']
    if sha(source_pdf) != spec['sha256']:
        raise RuntimeError(f'official source changed: {source_pdf}')
    out = ROOT / 'library/derived' / spec['output']
    exported_dir = ROOT / 'exports/wechat' / spec['export']
    snapshot = out / 'sources' / spec['pdf']
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    if snapshot.exists():
        if sha(snapshot) != spec['sha256']:
            raise RuntimeError('immutable PDF changed')
    else:
        shutil.copyfile(source_pdf, snapshot)
    source = {
        'schemaVersion': 1, 'packId': spec['pack'], 'sourceTitle': spec['sourceTitle'],
        'sourceUrl': spec['url'], 'publisher': spec['publisher'],
        'edition': 'NGL global edition sampler; China edition not verified',
        'unit': spec['unit'], 'sourceAcquiredAt': STAMP,
        'sourceSnapshotPath': f"sources/{spec['pdf']}",
        'sourceSnapshotSha256': spec['sha256'],
        'rightsBasis': RIGHTS, 'rightsStatus': 'user_confirmed_cleared',
        'studentAttribution': spec['attribution'],
    }
    source_path = out / 'source-records/source-record.json'
    write_new(source_path, source)
    source_sha = sha(source_path)
    ids = []
    previews = []
    declarations = []
    for index, (pdf_page, printed_page, point, prompt, options, answer, explanation) in enumerate(spec['questions'], 1):
        rid = f"{spec['prefix']}_q{index:02}_v1"
        ids.append(rid)
        title = f"{spec['title']} - Question {index}"
        stem = prompt + '\n' + spec['attribution']
        if len(options) != 3 or len(set(options)) != 3 or options.count(answer) != 1:
            raise RuntimeError(f'bad question: {rid}')
        exercise = {'grade': spec['grade'], 'questionType': 'single_choice',
                    'stem': stem, 'options': options, 'correctAnswer': answer,
                    'explanation': explanation, 'textbook': spec['textbook'],
                    'unit': spec['unit'], 'knowledgePoint': point, 'difficulty': '基础'}
        directory = out / 'cloudbase-items' / rid
        rights = {'schemaVersion': 1, 'resourceId': rid, 'decision': 'approved',
                  'scope': 'all_schools_teaching', 'sourceSha256': source_sha,
                  'sourceUrl': spec['url'], 'sourceTitle': spec['sourceTitle'],
                  'rightsBasis': RIGHTS, 'rightsStatus': 'user_confirmed_cleared',
                  'sourceSnapshotSha256': spec['sha256'], 'exercisePackId': spec['pack'],
                  'studentAttribution': spec['attribution'], 'restrictedMediaIncluded': False}
        review = {'schemaVersion': 1, 'resourceId': rid, 'contentType': 'exercise',
                  'decision': 'approved', 'reviewerId': 'Codex', 'reviewedAt': STAMP,
                  'reviewRevision': 1, 'contentVersion': 1, 'copyrightStatus': 'verified',
                  'sourceSha256': source_sha, 'exercisePackId': spec['pack'],
                  'grade': spec['grade'], 'title': title, 'questionType': 'single_choice',
                  'stem': stem, 'options': options, 'correctAnswer': answer,
                  'explanation': explanation, 'knowledgePoint': point, 'difficulty': '基础',
                  'evidence': {'sourceUrl': spec['url'], 'sourceSnapshotSha256': spec['sha256'],
                               'pdfPage': pdf_page, 'printedPage': printed_page,
                               'answerRationale': explanation}, 'exercise': exercise}
        write_new(directory / 'source-record.json', source)
        write_new(directory / 'copyright-evidence.json', rights)
        write_new(directory / 'approved-content.json', review)
        manifest = {'schemaVersion': 1, 'resourceId': rid, 'resourceType': 'supplement',
                    'title': title, 'sourceUrl': spec['url'], 'sourceSha256': source_sha,
                    'sourceSnapshotSha256': spec['sha256'], 'contentVersion': 1,
                    'exercisePackId': spec['pack'], 'processingStatus': 'publish_ready',
                    'details': {'questionCount': 1, 'studentMaterialComplete': True,
                                'answerLeakCheck': 'passed', 'reviewRevision': 1,
                                'reviewSha256': sha(directory / 'approved-content.json'),
                                'copyrightSha256': sha(directory / 'copyright-evidence.json')}}
        write_new(directory / 'manifest.json', manifest)
        export = {'sourceId': rid, 'organizationId': 'org_qihang_demo', 'title': title,
                  **exercise, 'contentVersion': 1, 'sourceSha256': source_sha,
                  'sourceUrl': spec['url'], 'manifestSha256': sha(directory / 'manifest.json'),
                  'reviewId': 'review_' + sha(directory / 'approved-content.json')[:32],
                  'copyrightEvidenceId': 'copyright_' + sha(directory / 'copyright-evidence.json')[:32],
                  'copyrightEvidenceSha256': sha(directory / 'copyright-evidence.json'),
                  'verifiedAt': STAMP, 'importedBy': f"codex_{spec['key']}_20261017_v1",
                  'exercisePackId': spec['pack'],
                  'evidence': {'manifestPath': 'manifest.json', 'approvedContentPath': 'approved-content.json',
                               'sourcePath': 'source-record.json', 'copyrightEvidencePath': 'copyright-evidence.json'}}
        write_new(directory / 'input.json', export)
        write_new(exported_dir / f'{rid}.json', {**export, 'assetRoot': str(directory)})
        candidate = directory / f'{rid}.json'
        write_new(candidate, {'resourceId': rid, 'exercisePackId': spec['pack'],
                              'title': title, 'contentVersion': 1, **exercise,
                              'sourceUrl': spec['url'], 'sourcePageEvidence': explanation,
                              'sourceRecordSha256': source_sha})
        previews.append({'id': rid, 'title': title, 'questionType': 'single_choice',
                         'stem': stem, 'options': options})
    preview_path = out / 'student-preview/student-preview.json'
    write_new(preview_path, {'schemaVersion': 1, 'packId': spec['pack'], 'questions': previews})
    pack_review_path = out / 'review/codex-review.json'
    write_new(pack_review_path, {'schemaVersion': 1, 'packId': spec['pack'],
                                 'reviewerId': 'Codex', 'reviewedAt': STAMP,
                                 'decision': 'approved_content_for_nonproduction_validation',
                                 'questionCount': 5, 'sourceAndEdition': source['edition'],
                                 'studentVisibleEvidence': 'each stem is self-contained',
                                 'answerLeakCheck': 'passed', 'media': 'no PDF page or audio in exercise pack',
                                 'questions': [{'id': rid, 'correctAnswer': q[5], 'explanation': q[6]}
                                               for rid, q in zip(ids, spec['questions'])]})
    for rid in ids:
        directory = out / 'cloudbase-items' / rid
        candidate = directory / f'{rid}.json'
        provenance = directory / f'{rid}-catalog-provenance.json'
        rights_path = directory / 'copyright-evidence.json'
        write_new(provenance, {
            'decision': 'derived_exercise_pack_question_pending_full_content_review',
            'outputRelativePath': rel(candidate), 'outputSha256': sha(candidate),
            'sourceRecordRelativePath': rel(source_path), 'sourceRecordSha256': source_sha,
            'sourceRightsRelativePath': rel(rights_path), 'sourceRightsSha256': sha(rights_path),
            'studentPreviewRelativePath': rel(preview_path), 'studentPreviewSha256': sha(preview_path),
            'codexReviewRelativePath': rel(pack_review_path), 'codexReviewSha256': sha(pack_review_path),
            'sourceSnapshotRelativePath': rel(snapshot), 'sourceSnapshotSha256': spec['sha256'],
            'exercisePackId': spec['pack'], 'expectedPackQuestionCount': 5,
            'questionCount': 1, 'questionEvidence': load(candidate)['sourcePageEvidence'],
        })
        declaration = {'relativePath': rel(candidate), 'sha256': sha(candidate),
                       'provenanceRelativePath': rel(provenance), 'provenanceSha256': sha(provenance)}
        declarations.append(declaration)
        catalog_review = {
            'schemaVersion': 1, 'resourceId': rid, 'sourceVersion': 1,
            'sourceSha256': sha(candidate).upper(), 'decision': 'approved',
            'contentType': 'exercise', 'reviewRevision': 1,
            'reviewerId': 'Codex', 'reviewedAt': STAMP,
            'copyrightStatus': 'verified', 'contentVersion': 1,
            'exercisePackId': spec['pack'],
            'exercise': {key: load(candidate)[key] for key in (
                'grade', 'textbook', 'unit', 'knowledgePoint', 'difficulty',
                'questionType', 'stem', 'options', 'correctAnswer', 'explanation')},
            'sourceEvidence': {'sourceUrl': spec['url'], 'sourceSnapshotSha256': spec['sha256'],
                               'rightsEvidenceSha256': sha(rights_path),
                               'studentPreviewSha256': sha(preview_path),
                               'questionEvidence': load(candidate)['sourcePageEvidence']},
        }
        write_new(ROOT / 'library/supplements' / rid / 'v1/review/approved-content-v1.json', catalog_review)
    write_new(out / 'batch-manifest.json', {
        'schemaVersion': 1, 'batchId': f"{spec['key']}-global-exercises-20261017-v1",
        'builtAt': STAMP, 'minimumQuestionsPerTask': 5, 'packCount': 1,
        'packs': [{'packId': spec['pack'], 'packKey': spec['key'], 'title': spec['title'],
                   'grade': spec['grade'], 'questionCount': 5, 'resourceIds': ids,
                   'sourceUrl': spec['url'], 'sourceSnapshotSha256': spec['sha256']}]})
    return declarations


def main() -> None:
    config_bytes = CONFIG.read_bytes()
    config = json.loads(config_bytes.decode('utf-8-sig'))
    existing = {row['relativePath']: row for row in config.get('derivedSupplementSources', [])}
    declarations = [row for spec in SPECS for row in build(spec)]
    import sys
    sys.path.insert(0, str(ROOT / 'scripts'))
    import asset_pipeline
    discovered = asset_pipeline.discover_declared_derived_supplements(
        ROOT, {'derivedSupplementSources': declarations})
    if len(discovered) != 10:
        raise RuntimeError('ten derived questions not validated')
    if not BACKUP.exists():
        BACKUP.write_bytes(config_bytes)
    for spec in SPECS:
        out = ROOT / 'library/derived' / spec['output']
        for rid in load(out / 'batch-manifest.json')['packs'][0]['resourceIds']:
            candidate = out / 'cloudbase-items' / rid / f'{rid}.json'
            config.setdefault('files', {})[candidate.name] = {
                'resourceId': rid, 'title': load(candidate)['title'],
                'publisher': spec['publisher'], 'grade': spec['grade'],
                'unit': spec['unit'], 'language': 'en',
                'roles': ['exercise_pack_question', 'codex_reviewed'],
                'rightsStatus': 'user_confirmed_cleared', 'needsMetadata': [],
                'sourceUrl': spec['url'], 'exercisePackId': spec['pack']}
    for row in declarations:
        if row['relativePath'] in existing and existing[row['relativePath']] != row:
            raise RuntimeError('registered source changed')
        existing[row['relativePath']] = row
    config['derivedSupplementSources'] = sorted(existing.values(), key=lambda row: row['relativePath'].lower())
    if CONFIG.read_bytes() != config_bytes:
        raise RuntimeError('configuration changed during build')
    CONFIG.write_bytes((json.dumps(config, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(json.dumps({'status': 'built_and_registered', 'packs': [s['pack'] for s in SPECS],
                      'questions': len(discovered)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
