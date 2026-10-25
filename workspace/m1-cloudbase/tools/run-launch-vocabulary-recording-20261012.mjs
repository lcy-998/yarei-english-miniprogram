// Controlled nonproduction replacement sources for family vocabulary and recording prompt.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve('G:/英语资产');
const require = createRequire(join(backend, 'package.json'));
const { build } = require('esbuild');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const local = {
  vocabCandidate: 'library/derived/m3-pep3a-unit2-vocabulary/v4/word-pack-source-v4.json',
  vocabReview: 'library/derived/m3-pep3a-unit2-vocabulary/v4/review/codex-content-v1.json',
  recordingCandidate: 'library/derived/m3-sbc0008-recording-prompt/v1/recording-prompt-source-v1.json',
  recordingReview: 'library/derived/m3-sbc0008-recording-prompt/v1/review/codex-content-v1.json',
};
const bytes = Object.fromEntries(await Promise.all(Object.entries(local).map(async ([key, path]) =>
  [key, await readFile(join(root, path))])));
const vocabCandidate = JSON.parse(bytes.vocabCandidate);
const vocabReview = JSON.parse(bytes.vocabReview);
const recordingCandidate = JSON.parse(bytes.recordingCandidate);
const recordingReview = JSON.parse(bytes.recordingReview);
if (vocabReview.decision !== 'approved_content_for_nonproduction_validation'
  || recordingReview.decision !== 'approved_content_for_nonproduction_validation'
  || vocabReview.reviewerId !== 'Codex' || recordingReview.reviewerId !== 'Codex'
  || vocabReview.contentSha256 !== hash(bytes.vocabCandidate)
  || recordingReview.contentSha256 !== hash(bytes.recordingCandidate)
  || vocabReview.productionReady !== false || recordingReview.productionReady !== false
  || vocabCandidate.words.length !== 3 || recordingCandidate.promptText !== 'I am singing.'
  || recordingReview.rubric.total !== 100) throw new Error('CONTENT_REVIEW_GATE');
function call(args) {
  const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: backend,
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const result = JSON.parse(raw.slice(at));
  if (result.error) throw new Error('CLOUD_API_ERROR');
  return result.data;
}
const cfg = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
const line = (await readFile(join(backend, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(item => item.startsWith('TCB_ENV_ID='));
const envId = line?.slice(11).trim();
const envs = call(['env', 'list', '--json']);
if (!envId || envId !== cfg.envId || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no'
  || envs[0].EnableOverrun !== false) throw new Error('NONPRODUCTION_COST_GATE');
const quota = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('QUOTA_GATE');
const token = call(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const sdk = require('@cloudbase/node-sdk');
const app = sdk.init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token });
const entry = join(backend, '.runtime/launch-vocabulary-recording-20261012/entry.cjs');
await mkdir(dirname(entry), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-global-asset-audit-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(entry);
const db = api.createCloudBaseDocumentDatabase(app.database());
const organizations = (await db.find('organizations', { status: 'active', deletedAt: null }))
  .map(row => row._id).sort();
if (JSON.stringify(organizations) !== JSON.stringify(['org_isolation_secondary', 'org_qihang_demo'])) {
  throw new Error('ORGANIZATION_SCOPE_GATE');
}
const oldVocabulary = await db.get('learning_resources', 'res_m3_pep3a_u2_real_vocabulary_20261005');
const oldRecording = await db.get('learning_resources', 'res_m3_sbc0008_real_recording_20261005');
if (oldVocabulary?.status !== (mode === 'verify' ? 'offline' : 'published')
  || oldVocabulary.version !== (mode === 'verify' ? 7 : 6)
  || oldVocabulary.type !== 'vocabulary' || oldVocabulary.words?.length !== 3
  || oldVocabulary.copyrightStatus !== 'verified'
  || oldRecording?.status !== (mode === 'verify' ? 'offline' : 'published')
  || oldRecording.version !== (mode === 'verify' ? 5 : 4)
  || oldRecording.type !== 'recording' || oldRecording.copyrightStatus !== 'verified'
  || oldRecording.payload?.promptText !== recordingCandidate.promptText) {
  throw new Error('OLD_SOURCE_VERSION_GATE');
}
for (const word of oldVocabulary.words) {
  const reference = vocabCandidate.words.find(item => item.word === word.word);
  if (!reference || !word.audioAssetKey?.startsWith('cloud://')) throw new Error('WORD_REFERENCE_GATE');
  const downloaded = await app.downloadFile({ fileID: word.audioAssetKey });
  const content = Buffer.isBuffer(downloaded.fileContent)
    ? downloaded.fileContent : Buffer.from(downloaded.fileContent ?? '');
  if (hash(content) !== reference.audioSha256) throw new Error(`WORD_AUDIO_HASH_${word.word}`);
}
const demoId = oldRecording.payload.demonstrationAudioFileId;
if (typeof demoId !== 'string' || !demoId.startsWith('cloud://')) throw new Error('DEMO_AUDIO_ID_GATE');
const demo = await app.downloadFile({ fileID: demoId });
const demoBytes = Buffer.isBuffer(demo.fileContent)
  ? demo.fileContent : Buffer.from(demo.fileContent ?? '');
if (hash(demoBytes) !== recordingCandidate.demonstrationAudioSha256) {
  throw new Error('DEMO_AUDIO_HASH_GATE');
}
const now = new Date().toISOString();
const vocabularyId = 'res_launch_pep3a_u2_vocabulary_v1_20261012';
const recordingId = 'res_launch_sbc0008_recording_v1_20261012';
const textbook = '人民教育出版社《英语》三年级上册（封面标示2024年审核通过）';
const vocabulary = { _id: vocabularyId, id: vocabularyId,
  organizationId: 'org_qihang_demo', schemaVersion: 1, version: 1,
  deletedAt: null, type: 'vocabulary', status: 'published',
  title: '三年级上册 Unit 2｜家庭成员三词', contentVersion: 1,
  grade: '三年级', term: '上册', textbook, unit: 'Unit 2',
  copyrightStatus: 'verified', testOnly: false,
  words: structuredClone(oldVocabulary.words),
  payload: { grade: '三年级', term: '上册', textbook, unit: 'Unit 2',
    words: structuredClone(oldVocabulary.words), reviewStatus: 'approved',
    reviewerId: 'Codex', reviewedAt: vocabReview.reviewedAt,
    reviewSha256: hash(bytes.vocabReview), sourceSha256: vocabReview.sourceBookSha256 },
  sourceBookEdition: vocabReview.textbookIdentification,
  sourceEvidence: structuredClone(oldVocabulary.sourceEvidence),
  sourceRightsStatus: oldVocabulary.sourceRightsStatus,
  visibility: { type: 'organization' }, allowedClassIds: [],
  createdAt: now, updatedAt: now };
const recording = { _id: recordingId, id: recordingId,
  organizationId: 'org_qihang_demo', schemaVersion: 1, version: 1,
  deletedAt: null, type: 'recording', status: 'published',
  title: 'I am singing.｜绘本原句录音', contentVersion: 1,
  grade: '三年级', unit: oldRecording.unit ?? '绘本活动',
  copyrightStatus: 'verified', testOnly: false,
  payload: { ...structuredClone(oldRecording.payload), reviewStatus: 'approved',
    reviewerId: 'Codex', reviewedAt: recordingReview.reviewedAt,
    reviewSha256: hash(bytes.recordingReview),
    scoringRubric: recordingReview.rubric,
    unverifiedFields: [], acceptanceStatus: 'codex_reviewed_nonproduction' },
  visibility: { type: 'organization' }, allowedClassIds: [],
  createdAt: now, updatedAt: now };
for (const item of [vocabulary, recording]) api.makeLegacyGlobalSource(item);
const definitions = [
  { id: vocabularyId, resource: vocabulary, reviewHash: hash(bytes.vocabReview) },
  { id: recordingId, resource: recording, reviewHash: hash(bytes.recordingReview) },
];
const slots = await Promise.all(definitions.map(async item => ({
  id: item.id, source: await db.get('learning_resources', item.id),
  projection: await db.get('learning_resources',
    `global_asset_${hash(Buffer.from(JSON.stringify([item.id, 'org_isolation_secondary']))).slice(0, 40)}`),
})));
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    emptySourceSlots: slots.filter(item => !item.source).length,
    emptyProjectionSlots: slots.filter(item => !item.projection).length,
    vocabularyWords: vocabulary.words.length, recordingPrompt: recording.payload.promptText,
    mediaHashesMatched: 4, cloudWrites: 0 }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  if (slots.some(item => item.source || item.projection)) throw new Error('TARGET_NOT_EMPTY');
  for (const item of definitions) {
    const auditId = `launch_content_source_${item.id}`;
    await db.runTransaction(async tx => {
      if (await tx.get('learning_resources', item.id) || await tx.get('operation_logs', auditId)) {
        throw new Error('TARGET_CONFLICT');
      }
      if (!await tx.create('learning_resources', item.resource)
        || !await tx.append('operation_logs', { _id: auditId,
          organizationId: item.resource.organizationId, schemaVersion: 1, version: 1,
          deletedAt: null, requestId: auditId, actorUserId: 'codex_launch_review_20261012',
          actorRole: 'system', action: 'asset_library.launch_content_reviewed_import',
          targetType: 'learning_resource', targetId: item.id, result: 'succeeded',
          occurredAt: now, metadata: { reviewSha256: item.reviewHash } })) {
        throw new Error('SOURCE_CREATE_FAILED');
      }
    });
  }
}
const service = new api.LegacyGlobalDistributionService(db, { nowIso: () => new Date().toISOString() });
if (mode === 'apply') {
  for (const item of definitions) await service.migrate(item.id, organizations);
}
const readback = await Promise.all(definitions.map(async item => {
  const source = await db.get('learning_resources', item.id);
  const projectedId = `global_asset_${hash(Buffer.from(JSON.stringify([item.id, 'org_isolation_secondary']))).slice(0, 40)}`;
  const projection = await db.get('learning_resources', projectedId);
  const audit = await db.get('operation_logs', `launch_content_source_${item.id}`);
  if (!source || !projection || !audit || source.status !== 'published'
    || source.globalCatalogSource !== true || source.testOnly !== false
    || projection.globalCatalogProjection !== true
    || projection.globalSourceVersion !== source.version
    || projection.globalSourceFingerprint !== source.globalCatalogFingerprint
    || audit.metadata?.reviewSha256 !== item.reviewHash) {
    throw new Error(`READBACK_FAILED_${item.id}`);
  }
  return item.id;
}));
const contentOut = join(backend, '.runtime/launch-vocabulary-recording-20261012/content.cjs');
await build({ entryPoints: [join(backend, 'src/seed/m3-real-sample-entry.ts')],
  outfile: contentOut, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const contentApi = require(contentOut);
const org = contentApi.createOrgContentDocumentRepository(db);
const query = new contentApi.ContentQueryService(org);
const teacher = { requestId: 'launch_vocabulary_recording_teacher_20261012',
  sessionId: 'launch-vocabulary-recording-verify', actorUserId: 'usr_teacher_demo_01',
  actorRole: 'teacher', organizationId: 'org_qihang_demo',
  platformSubjectDigest: 'launch-vocabulary-recording-verify',
  permissions: ['content.read', 'task.publish'], scopeIds: ['cls_grade3_2'], authzVersion: 1 };
const student = { ...teacher, requestId: 'launch_vocabulary_student_20261012',
  actorUserId: 'usr_student_g3_01', actorRole: 'student', permissions: ['content.read'] };
const teacherWords = await query.listTaskCatalogResources(teacher,
  { type: 'vocabulary', targetClassIds: ['cls_grade3_2'], keyword: '家庭成员三词' }, { limit: 50, offset: 0 });
const studentWords = await query.listStudentCatalog(student,
  { type: 'vocabulary', keyword: '家庭成员三词' }, { limit: 50, offset: 0 });
const pack = await query.getVocabularyPack(student, vocabularyId);
const recordingCatalog = new contentApi.TaskRecordingCatalogService(db,
  contentApi.createTaskQueryDocumentRepository(db));
const prompts = await recordingCatalog.list(teacher,
  { targetClassIds: ['cls_grade3_2'], keyword: 'I am singing.', limit: 50, offset: 0 });
if (!teacherWords.items.some(item => item.id === vocabularyId)
  || !studentWords.items.some(item => item.id === vocabularyId)
  || pack.words.length !== 3
  || !prompts.items.some(item => item.id === recordingId)) {
  throw new Error('AUTHORIZED_CATALOG_READBACK_FAILED');
}
process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
  sources: readback, projections: readback.length, mediaHashesMatched: 4,
  teacherVocabulary: 'visible', studentVocabulary: 'visible', teacherRecording: 'visible',
  cloudWrites: mode === 'apply' ? 12 : 0 }) + '\n');
await new Promise(resolve => setTimeout(resolve, 300));
process.exit(0);
