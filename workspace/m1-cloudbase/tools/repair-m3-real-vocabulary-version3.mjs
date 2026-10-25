import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(root, '..', '..');
const assetRoot = 'F:/英语资产';
const outputRoot = resolve(projectRoot, 'workspace/m3-real-samples/2026-10-05-vocabulary');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('Use inspect, apply, or verify.');

const ORG = 'org_qihang_demo';
const CLASS = 'cls_grade3_2';
const RESOURCE = 'res_m3_pep3a_u2_real_vocabulary_20261005';
const AUDIT_V2 = 'audit_m3_pep3a_u2_real_vocabulary_audio_v2_20261005';
const AUDIT_V3 = 'audit_m3_pep3a_u2_real_vocabulary_audio_v3_20261005';
const SOURCES = [
  { key: 'candidateV4', relativePath: 'library/derived/m3-pep3a-unit2-vocabulary/v4/word-pack-source-v4.json',
    sha256: 'c515c0291f5a51a05309e8eab194b5eab8934ed5a8b8adcfae2502e60d11e6a9' },
  { key: 'provenanceV4', relativePath: 'library/derived/m3-pep3a-unit2-vocabulary/v4/source-provenance-v4.json',
    sha256: 'c2f9bd90f7f23d24f10b056b5434b5628456b8455243c895dc5634c59b268d5a' },
  { key: 'audio_mum', relativePath: 'library/derived/m3-pep3a-unit2-vocabulary/v4/audio/word-mum-v4.mp3',
    sha256: '864aedf0dd67f22efc57daca58734fd667cf2befa5de8820b001542c6aec052b' },
  { key: 'audio_grandma', relativePath: 'library/derived/m3-pep3a-unit2-vocabulary/v4/audio/word-grandma-v4.mp3',
    sha256: '58f2d4a43ca325d3c09c3f93677eb91d1bad64bd3970427911142a274dd0ec05' },
  { key: 'audio_grandpa', relativePath: 'library/derived/m3-pep3a-unit2-vocabulary/v4/audio/word-grandpa-v4.mp3',
    sha256: '06f8aa189dc07284e6aee232be92c62266f62cf853187b403307ea36a6163ffb' },
];
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envText = await readFile(resolve(root, '.env.local'), 'utf8');
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const localFiles = new Map();
for (const file of SOURCES) {
  const bytes = await readFile(resolve(assetRoot, ...file.relativePath.split('/')));
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`SOURCE_HASH_MISMATCH_${file.key}`);
  localFiles.set(file.key, bytes);
}
const candidate = JSON.parse(localFiles.get('candidateV4').toString('utf8'));
if (candidate.words.map(word => word.word).join('|') !== 'mum|grandma|grandpa'
  || candidate.words.some(word => typeof word.exampleFromBook !== 'string' || !word.exampleFromBook)) {
  throw new Error('CORRECTED_VOCABULARY_CANDIDATE_INVALID');
}

const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
const secretsResult = await execute(process.execPath, [cli, 'secrets', 'get', '--json'],
  { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const secretStart = secretsResult.stdout.indexOf('{');
if (secretStart < 0) throw new Error('TEMPORARY_CREDENTIALS_UNAVAILABLE');
const credentials = JSON.parse(secretsResult.stdout.slice(secretStart)).data;
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const database = app.database();
const now = new Date().toISOString();
const [resourceResult, auditV2Result, auditV3Result] = await Promise.all([
  database.collection('learning_resources').doc(RESOURCE).get().catch(() => null),
  database.collection('operation_logs').doc(AUDIT_V2).get().catch(() => null),
  database.collection('operation_logs').doc(AUDIT_V3).get().catch(() => null),
]);
const resource = dataOne(resourceResult);
const auditV2 = dataOne(auditV2Result);
const auditV3 = dataOne(auditV3Result);
const isInspectOrApply = mode !== 'verify';
if (!resource || resource.organizationId !== ORG || resource.status !== 'published'
  || resource.acceptanceStatus !== 'pending_user_acceptance' || resource.testOnly !== true
  || resource.visibility?.type !== 'classes' || resource.visibility.classIds?.join('|') !== CLASS
  || !auditV2 || auditV2.targetId !== RESOURCE
  || (isInspectOrApply && (resource.version !== 2 || auditV3))
  || (!isInspectOrApply && (resource.version !== 3 || auditV3?.targetId !== RESOURCE))) {
  throw new Error('CURRENT_RESOURCE_OR_AUDIT_SCOPE_MISMATCH');
}
if (mode === 'inspect') {
  const missingExamples = resource.words.filter(word => typeof word.example !== 'string' || !word.example).length;
  process.stdout.write(`PREFLIGHT=passed;currentVersion=${resource.version};missingExamples=${missingExamples};v3Audit=empty;privateFiles=${SOURCES.length};writes=one-version-and-one-audit\n`);
  process.exit(0);
}

if (mode === 'apply') {
  const words = candidate.words.map(sourceWord => {
    const existing = resource.words.find(word => word.id === sourceWord.id);
    if (!existing?.audioAssetKey?.startsWith('cloud://')) throw new Error(`AUDIO_REFERENCE_MISSING_${sourceWord.word}`);
    return { id: sourceWord.id, word: sourceWord.word, meaning: sourceWord.meaning,
      example: sourceWord.exampleFromBook, syllables: sourceWord.syllables, audioAssetKey: existing.audioAssetKey,
      audioDurationMs: sourceWord.audioDurationMs, sourceTrackStartMs: sourceWord.sourceTrackStartMs,
      sourceTrackEndMs: sourceWord.sourceTrackEndMs };
  });
  const priorVersion = { version: resource.version, contentVersion: resource.contentVersion, title: resource.title,
    words: resource.words, updatedAt: resource.updatedAt, archivedAt: now };
  const next = { ...resource, version: 3, contentVersion: 3, updatedAt: now, words,
    sourceHistory: [...(Array.isArray(resource.sourceHistory) ? resource.sourceHistory : []), priorVersion] };
  const audit = {
    requestId: AUDIT_V3, organizationId: ORG, actorId: 'system:m3-real-asset-import', actorType: 'system',
    action: 'content.realVocabularyExamplesRestored', targetType: 'learning_resources', targetId: RESOURCE,
    result: 'succeeded', createdAt: now, operationId: `op_${AUDIT_V3}`,
    metadata: { previousVersion: 2, version: 3, acceptanceStatus: 'pending_user_acceptance',
      wordIds: words.map(word => word.id), sourceCandidateSha256: SOURCES[0].sha256 },
  };
  await database.runTransaction(async transaction => {
    const current = dataOne(await transaction.collection('learning_resources').doc(RESOURCE).get().catch(() => null));
    if (!current || current.version !== 2
      || dataOne(await transaction.collection('operation_logs').doc(AUDIT_V3).get().catch(() => null))) {
      throw new Error('RESOURCE_VERSION_OR_AUDIT_CONFLICT');
    }
    const { _id: _resourceId, ...fields } = next;
    await transaction.collection('learning_resources').doc(RESOURCE).set(fields);
    await transaction.collection('operation_logs').doc(AUDIT_V3).set(audit);
  });
  process.stdout.write(`APPLY=versioned;resource=${RESOURCE};version=3;audit=${AUDIT_V3};examples=3/3;filesReused=${SOURCES.length}\n`);
  process.exit(0);
}

const cliBundle = resolve(root, '.runtime/m3-real-vocabulary-audio-v2/entry.cjs');
await mkdir(dirname(cliBundle), { recursive: true });
await build({ entryPoints: [resolve(root, 'src/seed/m3-real-sample-entry.ts')], outfile: cliBundle,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(cliBundle);
const rawDatabase = api.createCloudBaseDocumentDatabase(database);
const repository = api.createOrgContentDocumentRepository(rawDatabase);
const decoded = await repository.findLearningResource(ORG, RESOURCE);
if (!decoded || decoded.type !== 'vocabulary' || decoded.version !== undefined) {
  throw new Error('V3_RESOURCE_ADAPTER_DECODE_FAILED');
}
const content = new api.ContentQueryService(repository);
const studentActor = { requestId: 'm3_vocab_v3_student', sessionId: 'm3-vocab-v3-verify',
  actorUserId: 'usr_student_g3_01', actorRole: 'student', organizationId: ORG,
  platformSubjectDigest: 'm3-vocab-v3-verify', permissions: ['content.read'], scopeIds: [CLASS], authzVersion: 1 };
const teacherActor = { ...studentActor, requestId: 'm3_vocab_v3_teacher', actorUserId: 'usr_teacher_demo_01',
  actorRole: 'teacher', permissions: ['content.read', 'task.publish'] };
const studentPacks = await content.listVocabularyPacks(studentActor);
const studentPack = await content.getVocabularyPack(studentActor, RESOURCE);
const studentCatalog = await content.listStudentCatalog(studentActor,
  { type: 'vocabulary', grade: '三年级', unit: 'Unit 2' }, { limit: 20, offset: 0 });
const teacherCatalog = await content.listTaskCatalogResources(teacherActor,
  { type: 'vocabulary', targetClassIds: [CLASS], keyword: 'Unit 2' }, { limit: 20, offset: 0 });
if (!studentPacks.some(item => item.id === RESOURCE) || !studentCatalog.items.some(item => item.id === RESOURCE)
  || !teacherCatalog.items.some(item => item.id === RESOURCE) || studentPack.words.length !== 3
  || studentPack.words.some(word => !word.example || !word.audioAssetKey?.startsWith('cloud://'))) {
  throw new Error('AUTHORIZED_V3_CONTENT_SERVICE_VERIFY_FAILED');
}
const audioFiles = SOURCES.filter(file => file.key.startsWith('audio_'));
const audioIds = candidate.words.map(word => {
  const key = `audio_${word.word}`;
  const saved = resource.words.find(item => item.id === word.id)?.audioAssetKey;
  if (!saved?.startsWith('cloud://')) throw new Error(`AUDIO_REFERENCE_MISSING_${word.word}`);
  return { key, fileID: saved, expectedHash: audioFiles.find(file => file.key === key)?.sha256 };
});
const signed = await app.getTempFileURL({ fileList: audioIds.map(item => ({ fileID: item.fileID, maxAge: 60 })) });
if (signed.fileList?.length !== audioIds.length || signed.fileList.some(item =>
  !item.tempFileURL?.startsWith('https://') || (item.code !== undefined && item.code !== 'SUCCESS'))) {
  throw new Error('SIGNED_WORD_AUDIO_URLS_UNAVAILABLE');
}
for (const item of audioIds) {
  const signedItem = signed.fileList.find(value => value.fileID === item.fileID);
  const response = await fetch(signedItem.tempFileURL);
  if (!response.ok) throw new Error(`SIGNED_WORD_AUDIO_HTTP_${item.key}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== item.expectedHash) {
    throw new Error(`SIGNED_WORD_AUDIO_HASH_MISMATCH_${item.key}`);
  }
}
for (const file of SOURCES.slice(0, 2)) {
  const expected = resource.sourceEvidence[file.key]?.fileID;
  if (!expected) throw new Error(`SOURCE_EVIDENCE_REFERENCE_MISSING_${file.key}`);
  const downloaded = await app.downloadFile({ fileID: expected });
  const bytes = Buffer.isBuffer(downloaded.fileContent) ? downloaded.fileContent : Buffer.from(downloaded.fileContent ?? '');
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`SOURCE_EVIDENCE_HASH_MISMATCH_${file.key}`);
}
process.stdout.write(`VERIFY=passed;resourceVersion=3;auditV3=1;studentCatalog=visible;teacherTaskCatalog=visible;words=${studentPack.words.length};examples=3/3;audioReferences=3/3;signedUrls=3/3;httpsAudioHashes=3/3;scope=${CLASS}\n`);
await mkdir(outputRoot, { recursive: true });
await writeFile(resolve(outputRoot, 'cloud-audio-v3-manifest.json'), JSON.stringify({
  schemaVersion: 1, packId: 'm3-real-vocabulary-2026-10-05', organizationId: ORG,
  classIds: [CLASS], resourceId: RESOURCE, resourceVersion: 3, auditIds: [AUDIT_V2, AUDIT_V3],
  acceptanceStatus: 'pending_user_acceptance', words: studentPack.words.map(word => word.word),
  sourceEvidence: resource.sourceEvidence, sourceHistoryVersions: resource.sourceHistory.map(version => version.version),
  unresolvedFields: resource.unresolvedFields, verifiedAt: now,
}, null, 2) + '\n', 'utf8');

function dataOne(result) {
  const value = result?.data;
  if (Array.isArray(value)) return value[0] ?? null;
  if (Array.isArray(value?.list)) return value.list[0] ?? null;
  return value && typeof value === 'object' ? value : null;
}
