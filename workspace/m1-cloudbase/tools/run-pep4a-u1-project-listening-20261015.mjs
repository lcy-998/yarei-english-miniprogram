// Controlled nonproduction publication of the reviewed PEP 4A Unit 1 listening exercise.
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
const pack = join(root, 'library/derived/pep4a-u1-project-listening-2026-10-15/v1');
const require = createRequire(join(backend, 'package.json'));
const { build } = require('esbuild');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const [activityBytes, previewBytes, rightsBytes, techBytes, asrBytes, reviewBytes,
  audioBytes, pdfBytes, imageBytes, scanZip, scanReport] = await Promise.all([
  readFile(join(pack, 'activity.json')), readFile(join(pack, 'student-preview.json')),
  readFile(join(pack, 'rights.json')), readFile(join(pack, 'technical-receipt.json')),
  readFile(join(pack, 'asr-crosscheck.json')), readFile(join(pack, 'review.json')),
  readFile(join(root, 'inbox/pep-4a-unit1-official/pep4s10Unit1CProject.mp3')),
  readFile(join(root, '人教版英语·电子课本·四上.pdf')),
  readFile(join(root, 'reports/pep4a-unit1-listening-page14-candidate-2026-10-15.png')),
  readFile(join(pack, 'source-audio-scan.zip')),
  readFile(join(pack, 'source-audio-scan-report.txt')),
]);
const activity = JSON.parse(activityBytes);
const preview = JSON.parse(previewBytes);
const rights = JSON.parse(rightsBytes);
const technical = JSON.parse(techBytes);
const asr = JSON.parse(asrBytes);
const review = JSON.parse(reviewBytes);
if (review.decision !== 'approved_for_verified_nonproduction' || review.reviewerId !== 'Codex'
  || review.activitySha256 !== sha256(activityBytes)
  || review.studentPreviewSha256 !== sha256(previewBytes)
  || review.rightsSha256 !== sha256(rightsBytes)
  || review.technicalReceiptSha256 !== sha256(techBytes)
  || review.asrCrosscheckSha256 !== sha256(asrBytes)
  || review.sourceAudioSha256 !== sha256(audioBytes)
  || review.sourcePdfSha256 !== sha256(pdfBytes)
  || review.sourcePageImageSha256 !== sha256(imageBytes)
  || technical.scanContainerSha256 !== sha256(scanZip)
  || technical.scanReportSha256 !== sha256(scanReport)
  || !scanReport.toString('utf8').includes('Infected files: 0')
  || !scanReport.toString('utf8').includes('Data scanned: 674.76 KiB')
  || rights.sourceAudioSha256 !== sha256(audioBytes)
  || !rights.useScope.includes('非生产 CloudBase')
  || asr.models.length !== 2 || activity.questions.length !== 2
  || preview.questions.length !== 2 || review.questions.length !== 2
  || JSON.stringify(preview).includes('correctAnswer')
  || JSON.stringify(preview).includes('explanation')) throw new Error('CONTENT_GATE');
for (let i = 0; i < 2; i++) {
  const question = activity.questions[i];
  if (question.id !== preview.questions[i].id || question.stem !== preview.questions[i].stem
    || JSON.stringify(question.options) !== JSON.stringify(preview.questions[i].options)
    || !question.options.includes(question.correctAnswer)
    || question.mainSegment.startMs < 0
    || question.mainSegment.endMs > activity.mainAudio.durationMs
    || question.mainSegment.startMs >= question.mainSegment.endMs
    || !activity.audioTranscript.includes(question.answerAudioText)
    || review.questions[i].id !== question.id
    || review.questions[i].correctAnswer !== question.correctAnswer) throw new Error(`QUESTION_GATE_${i}`);
}
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
const config = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
const envLine = (await readFile(join(backend, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice(11).trim();
const envs = call(['env', 'list', '--json']);
if (!envId || config.envId !== envId || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no'
  || envs[0].EnableOverrun !== false) throw new Error('NONPRODUCTION_ENV_COST_GATE');
const writeQuota = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
const storageQuota = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'StorageSizepkg' }), '--json']);
if (!Number.isFinite(writeQuota.Value) || writeQuota.Value > 190000
  || !Number.isFinite(storageQuota.Value)
  || storageQuota.Value + audioBytes.length + rightsBytes.length > 4_000_000_000) {
  throw new Error('QUOTA_GATE');
}
const acl = execFileSync(process.execPath,
  ['D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb', 'storage', 'get-acl', '--json'],
  { cwd: backend, encoding: 'utf8', windowsHide: true, timeout: 30000 });
if (!acl.includes('Only creator and admin can read and write')) throw new Error('STORAGE_NOT_PRIVATE');
const token = call(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: token.secretId, secretKey: token.secretKey, sessionToken: token.token });
const output = join(backend, '.runtime/pep4a-u1-listening-20261015/entry.cjs');
await mkdir(dirname(output), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-public-media-entry.ts')],
  outfile: output, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(output);
const database = api.createCloudBaseDocumentDatabase(app.database());
const organizations = (await database.find('organizations', { status: 'active', deletedAt: null }))
  .map(row => row._id).sort();
if (JSON.stringify(organizations) !== JSON.stringify(['org_isolation_secondary', 'org_qihang_demo'])) {
  throw new Error('ORGANIZATION_SCOPE_GATE');
}
const stage = JSON.parse(await readFile(join(root, 'reports/sbc0008-listening-v2-nonproduction-stage.json'), 'utf8'));
const prefix = stage.fileID.slice(0, stage.fileID.indexOf(stage.cloudPath));
if (!prefix.startsWith('cloud://')) throw new Error('STORAGE_PREFIX_GATE');
const objects = [
  { key: 'audio', bytes: audioBytes,
    path: `english-assets/2026-10-15/pep4a-u1-project/audio-${sha256(audioBytes).slice(0, 16)}.mp3` },
  { key: 'rights', bytes: rightsBytes,
    path: `english-assets/2026-10-15/pep4a-u1-project/rights-${sha256(rightsBytes).slice(0, 16)}.json` },
].map(object => ({ ...object, fileID: `${prefix}${object.path}` }));
const existingObjects = [];
for (const object of objects) {
  let current = null;
  try { current = await app.downloadFile({ fileID: object.fileID }); } catch { /* exact target absent */ }
  if (current) {
    const bytes = Buffer.isBuffer(current.fileContent)
      ? current.fileContent : Buffer.from(current.fileContent ?? '');
    if (sha256(bytes) !== sha256(object.bytes)) throw new Error(`STORAGE_CONFLICT_${object.key}`);
  }
  existingObjects.push(Boolean(current));
}
const sourceId = activity.resourceId;
const projectionId = `public_media_${sha256(Buffer.from(JSON.stringify([sourceId, 'org_isolation_secondary']))).slice(0, 40)}`;
const [sourceSlot, projectionSlot] = await Promise.all([
  database.get('learning_resources', sourceId), database.get('learning_resources', projectionId),
]);
if (mode === 'inspect' && (sourceSlot || projectionSlot)) throw new Error('TARGET_SLOT_OCCUPIED');
const byKey = Object.fromEntries(objects.map(object => [object.key, object.fileID]));
const scanEvidence = { engine: 'clamav', signatureVersion: 'ClamAV 1.5.4',
  scannedAt: technical.scannedAt, scannedSha256: sha256(audioBytes),
  reportId: sha256(scanReport) };
const candidate = { id: sourceId, organizationId: 'org_qihang_demo', title: activity.title,
  kind: 'listening', version: 1, status: 'published', reviewVersion: 1,
  reviewedBy: 'Codex', reviewedAt: review.reviewedAt,
  copyrightStatus: 'verified', copyrightEvidenceKey: byKey.rights,
  scanStatus: 'clean', transcodeStatus: 'ready', sourceScanEvidence: scanEvidence,
  scanEvidence, transcodeEvidence: { engine: 'ci', engineVersion: 'FFprobe 9.0.2; MP3 passthrough',
    transcodedAt: technical.scannedAt, sourceSha256: sha256(audioBytes),
    outputSha256: sha256(audioBytes), outputAssetKey: byKey.audio },
  mediaAssetKey: byKey.audio, mediaSha256: sha256(audioBytes),
  durationMs: activity.mainAudio.durationMs, allowedClassIds: ['cls_grade3_2', 'cls_grade4_1'],
  questionIds: activity.questions.map(question => question.id),
  questions: activity.questions.map(question => ({ questionId: question.id,
    questionType: question.questionType, stem: question.stem, options: question.options })),
  answerKeys: activity.questions.map(question => ({ questionId: question.id,
    correctAnswer: question.correctAnswer, explanation: question.explanation })),
  clips: activity.questions.map((question, index) => ({ questionId: question.id,
    segmentId: `pep4a-u1-project-segment-${index + 1}-v1`,
    startMs: question.mainSegment.startMs, endMs: question.mainSegment.endMs })),
  continuousPlaybackEnforced: true };
const input = { resourceId: sourceId, organizationId: 'org_qihang_demo', contentVersion: 1,
  manifestSha256: sha256(activityBytes), reviewId: `review_${sha256(reviewBytes).slice(0, 32)}`,
  importedBy: 'codex_pep4a_u1_listening_20261015', grade: '四年级',
  textbook: activity.textbook, unit: activity.unit,
  sourceSha256: sha256(audioBytes), verifiedAt: review.reviewedAt,
  releaseMode: 'formal_reusable', processedMedia: candidate };
api.buildVerifiedCentralMediaResource(input);
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environmentId: envId, sourceSlotEmpty: true,
    projectionSlotEmpty: true, existingStorageObjects: existingObjects.filter(Boolean).length,
    mediaBytes: audioBytes.length, questionCount: 2, scanBytes: '674.76 KiB',
    cloudWrites: 0, productionPublished: false }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  if (sourceSlot || projectionSlot) throw new Error('TARGET_SLOT_OCCUPIED');
  for (let index = 0; index < objects.length; index++) {
    if (existingObjects[index]) continue;
    const object = objects[index];
    const uploaded = await app.uploadFile({ cloudPath: object.path, fileContent: object.bytes });
    if (uploaded?.fileID !== object.fileID) throw new Error(`UPLOAD_ID_MISMATCH_${object.key}`);
  }
}
for (const object of objects) {
  const downloaded = await app.downloadFile({ fileID: object.fileID });
  const bytes = Buffer.isBuffer(downloaded.fileContent)
    ? downloaded.fileContent : Buffer.from(downloaded.fileContent ?? '');
  if (sha256(bytes) !== sha256(object.bytes)) throw new Error(`STORAGE_READBACK_${object.key}`);
}
if (mode === 'apply') {
  const service = new api.PublicMediaDistributionService(database,
    { nowIso: () => new Date().toISOString() });
  await service.importVerified(input);
}
const [source, projection, audit, projectionAudit] = await Promise.all([
  database.get('learning_resources', sourceId), database.get('learning_resources', projectionId),
  database.get('operation_logs', `public_media_import_${sourceId}`),
  database.get('operation_logs', `public_media_projection_${projectionId}`),
]);
if (!source || !projection || !audit || !projectionAudit
  || source.status !== 'published' || projection.status !== 'published'
  || source.testOnly !== false || source.payload?.teacherMedia?.questionIds?.length !== 2
  || source.payload?.teacherMedia?.clips?.length !== 2
  || source.payload?.teacherMedia?.mediaSha256 !== sha256(audioBytes)
  || projection.payload?.assetLibrary?.sourcePublicId !== sourceId) throw new Error('PUBLISHED_READBACK_GATE');
const contentOutput = join(backend, '.runtime/pep4a-u1-listening-20261015/content.cjs');
await build({ entryPoints: [join(backend, 'src/seed/m3-real-sample-entry.ts')],
  outfile: contentOutput, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const contentApi = require(contentOutput);
const catalog = new contentApi.TeacherAssetCatalogService(database,
  contentApi.createOrgContentDocumentRepository(database), undefined,
  { nowIso: () => new Date().toISOString() });
const teacher = { requestId: 'pep4a_u1_listening_catalog_20261015', sessionId: 'pep4a-u1-listening-check',
  actorUserId: 'usr_teacher_demo_01', actorRole: 'teacher', organizationId: 'org_qihang_demo',
  platformSubjectDigest: 'pep4a-u1-listening-check', permissions: ['content.read', 'task.publish'],
  scopeIds: ['cls_grade4_1'], authzVersion: 1 };
const listed = await catalog.list(teacher, { kind: 'listening', keyword: '陈杰父母' },
  { limit: 50, offset: 0 });
const visible = listed.items.find(row => row.id === sourceId);
if (!visible || visible.questionCount !== 2 || visible.durationMs !== activity.mainAudio.durationMs) {
  throw new Error('TEACHER_CATALOG_GATE');
}
process.stdout.write(JSON.stringify({ mode, environmentId: envId, sourceId,
  questionCount: 2, audioSha256: sha256(audioBytes), storageReadback: 2,
  projectionCount: 1, auditCount: 2, teacherCatalog: 'visible',
  cloudWrites: mode === 'apply' ? 4 : 0, productionPublished: false }) + '\n');
