// Controlled nonproduction import of the reviewed one-audio/four-question activity.
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
const pack = join(root, 'library/derived/sbc0008-reading-listening-pair-2026-10-11/v2');
const require = createRequire(join(backend, 'package.json'));
const { build } = require('esbuild');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [contentBytes, previewBytes, rightsBytes, manifestBytes, reviewBytes, receiptBytes, audioBytes] = await Promise.all([
  readFile(join(pack, 'listening-activity-v2.json')),
  readFile(join(pack, 'student-preview-v2.json')),
  readFile(join(pack, 'source-rights-v2.json')),
  readFile(join(pack, 'manifest-v2.json')),
  readFile(join(pack, 'review/codex-listening-content-v1.json')),
  readFile(join(pack, 'audio-processing-receipt-v2.json')),
  readFile(join(pack, 'narration-normalized-v2.mp3')),
]);
const content = JSON.parse(contentBytes);
const preview = JSON.parse(previewBytes);
const rights = JSON.parse(rightsBytes);
const manifest = JSON.parse(manifestBytes);
const review = JSON.parse(reviewBytes);
const receipt = JSON.parse(receiptBytes);
const sourceId = 'res_launch_sbc0008_listening_v1_20261012';
const storagePath = `launch-content/2026-10-12/sbc0008-listening/narration-${content.mainAudio.sha256.slice(0, 16)}.mp3`;
const rightsPath = `launch-content/2026-10-12/sbc0008-listening/source-rights-${hash(rightsBytes).slice(0, 16)}.json`;
if (review.decision !== 'approved_content_for_nonproduction_validation'
  || review.reviewerId !== 'Codex' || review.productionReady !== false
  || review.listeningSha256 !== hash(contentBytes)
  || review.studentPreviewSha256 !== hash(previewBytes)
  || review.sourceRightsSha256 !== hash(rightsBytes)
  || review.audioProcessingReceiptSha256 !== hash(receiptBytes)
  || content.mainAudio.sha256 !== hash(audioBytes)
  || content.mainAudio.durationMs !== 25011
  || manifest.readyForProductionUpload !== false
  || content.questionCount !== 4 || content.questions.length !== 4
  || preview.listening.questions.length !== 4
  || receipt.sourceScan.infectedFiles !== 0 || receipt.outputScan.infectedFiles !== 0
  || receipt.sourceScan.audioSha256 !== rights.originalAudioSha256
  || receipt.outputScan.audioSha256 !== content.mainAudio.sha256) throw new Error('REVIEW_EVIDENCE_GATE');
for (let i = 0; i < 4; i++) {
  const q = content.questions[i];
  const student = preview.listening.questions[i];
  const segment = q.mainSegment;
  if (review.questions[i].questionId !== q.id || review.questions[i].decision !== 'approved'
    || q.id !== student.id || q.stem !== student.stem
    || JSON.stringify(q.options) !== JSON.stringify(student.options)
    || 'correctAnswer' in student || 'explanation' in student
    || segment.sourceAudioRelativePath !== content.mainAudio.relativePath
    || segment.startMs < 0 || segment.endMs > content.mainAudio.durationMs
    || segment.startMs >= segment.endMs) throw new Error('QUESTION_GATE');
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
const acl = execFileSync(process.execPath,
  ['D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb', 'storage', 'get-acl', '--json'],
  { cwd: backend, encoding: 'utf8', windowsHide: true, timeout: 30000 });
if (!acl.includes('Only creator and admin can read and write')) throw new Error('STORAGE_NOT_PRIVATE');
const token = call(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const sdk = require('@cloudbase/node-sdk');
const app = sdk.init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token });
const out = join(backend, '.runtime/launch-storybook-listening-20261012/entry.cjs');
await mkdir(dirname(out), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-public-media-entry.ts')],
  outfile: out, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(out);
const database = api.createCloudBaseDocumentDatabase(app.database());
const organizations = (await database.find('organizations', { status: 'active', deletedAt: null }))
  .map(row => row._id).sort();
if (JSON.stringify(organizations) !== JSON.stringify(['org_isolation_secondary', 'org_qihang_demo'])) {
  throw new Error('ORGANIZATION_SCOPE_GATE');
}
const oldVideo = await database.get('learning_resources', 'res_m3_sbc0008_video_auto_20261005');
const oldRightsKey = oldVideo?.payload?.teacherMedia?.copyrightEvidenceKey;
if (oldVideo?.status !== 'published' || oldVideo.copyrightStatus !== 'verified'
  || typeof oldRightsKey !== 'string' || !oldRightsKey.startsWith('cloud://')) {
  throw new Error('SOURCE_RIGHTS_GATE');
}
const rightsFile = await app.downloadFile({ fileID: oldRightsKey });
const rightsCloud = Buffer.isBuffer(rightsFile.fileContent)
  ? rightsFile.fileContent : Buffer.from(rightsFile.fileContent ?? '');
const oldRights = JSON.parse(rightsCloud.toString('utf8'));
if (oldRights.sourceBookId !== 'book-sbc-en-0008'
  || oldRights.rightsStatus !== 'user_confirmed_cleared'
  || rights.license !== 'CC BY 3.0'
  || rights.licenseUrl !== 'https://creativecommons.org/licenses/by/3.0/') {
  throw new Error('SOURCE_RIGHTS_CONTENT_GATE');
}
const oldStage = JSON.parse(await readFile(join(root, 'reports/sbc0008-listening-v2-nonproduction-stage.json'), 'utf8'));
if (oldStage.mediaSha256 !== hash(audioBytes) || oldStage.cloudPath !==
    'isolated-content/2026-10-11/sbc0008-listening-v2/narration-b954320376ebf953.mp3') {
  throw new Error('ISOLATED_STAGE_GATE');
}
const stageRead = await app.downloadFile({ fileID: oldStage.fileID });
const stageBytes = Buffer.isBuffer(stageRead.fileContent)
  ? stageRead.fileContent : Buffer.from(stageRead.fileContent ?? '');
if (hash(stageBytes) !== hash(audioBytes)) throw new Error('STAGED_MEDIA_HASH_GATE');
const prefix = oldStage.fileID.slice(0, oldStage.fileID.indexOf(oldStage.cloudPath));
const targetFileID = `${prefix}${storagePath}`;
const rightsFileID = `${prefix}${rightsPath}`;
const existing = await database.get('learning_resources', sourceId);
const projectionId = `public_media_${hash(Buffer.from(JSON.stringify([sourceId, 'org_isolation_secondary']))).slice(0, 40)}`;
const projection = await database.get('learning_resources', projectionId);
let currentFile = null;
try { currentFile = await app.downloadFile({ fileID: targetFileID }); } catch { /* target absent */ }
if (currentFile) {
  const bytes = Buffer.isBuffer(currentFile.fileContent)
    ? currentFile.fileContent : Buffer.from(currentFile.fileContent ?? '');
  if (hash(bytes) !== hash(audioBytes)) throw new Error('TARGET_FILE_HASH_CONFLICT');
}
let currentRights = null;
try { currentRights = await app.downloadFile({ fileID: rightsFileID }); } catch { /* target absent */ }
if (currentRights) {
  const bytes = Buffer.isBuffer(currentRights.fileContent)
    ? currentRights.fileContent : Buffer.from(currentRights.fileContent ?? '');
  if (hash(bytes) !== hash(rightsBytes)) throw new Error('TARGET_RIGHTS_HASH_CONFLICT');
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    sourceSlotEmpty: !existing, projectionSlotEmpty: !projection,
    targetMediaPresent: !!currentFile, targetRightsPresent: !!currentRights,
    mediaBytes: audioBytes.length, rightsBytes: rightsBytes.length,
    questions: content.questions.length, reviewSha256: hash(reviewBytes), cloudWrites: 0 }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  if (existing || projection) throw new Error('TARGET_RECORD_NOT_EMPTY');
  if (!currentFile) {
    const uploaded = await app.uploadFile({ cloudPath: storagePath, fileContent: audioBytes });
    if (uploaded?.fileID !== targetFileID) throw new Error('TARGET_UPLOAD_ID_MISMATCH');
  }
  if (!currentRights) {
    const uploaded = await app.uploadFile({ cloudPath: rightsPath, fileContent: rightsBytes });
    if (uploaded?.fileID !== rightsFileID) throw new Error('RIGHTS_UPLOAD_ID_MISMATCH');
  }
}
const mediaRead = await app.downloadFile({ fileID: targetFileID });
const finalBytes = Buffer.isBuffer(mediaRead.fileContent)
  ? mediaRead.fileContent : Buffer.from(mediaRead.fileContent ?? '');
if (hash(finalBytes) !== hash(audioBytes)) throw new Error('TARGET_MEDIA_READBACK_FAILED');
const rightsRead = await app.downloadFile({ fileID: rightsFileID });
const finalRights = Buffer.isBuffer(rightsRead.fileContent)
  ? rightsRead.fileContent : Buffer.from(rightsRead.fileContent ?? '');
if (hash(finalRights) !== hash(rightsBytes)) throw new Error('TARGET_RIGHTS_READBACK_FAILED');
const questions = content.questions.map(q => ({ questionId: q.id,
  questionType: q.questionType, stem: q.stem, options: q.options }));
const candidate = {
  id: sourceId, organizationId: 'org_qihang_demo', title: 'What are you doing?｜动作听力四题',
  kind: 'listening', version: 1, status: 'published', reviewVersion: 1,
  reviewedBy: 'Codex', reviewedAt: review.reviewedAt, copyrightStatus: 'verified',
  copyrightEvidenceKey: rightsFileID, scanStatus: 'clean', transcodeStatus: 'ready',
  sourceScanEvidence: { engine: 'clamav', signatureVersion: receipt.scanner,
    scannedAt: receipt.sourceScan.scannedAt, scannedSha256: receipt.sourceScan.audioSha256,
    reportId: receipt.sourceScan.containerSha256 },
  scanEvidence: { engine: 'clamav', signatureVersion: receipt.scanner,
    scannedAt: receipt.outputScan.scannedAt, scannedSha256: receipt.outputScan.audioSha256,
    reportId: receipt.outputScan.containerSha256 },
  transcodeEvidence: { engine: 'ffmpeg', engineVersion: receipt.transcode.engineVersion,
    transcodedAt: receipt.transcode.transcodedAt, sourceSha256: receipt.transcode.sourceSha256,
    outputSha256: receipt.transcode.outputSha256, outputAssetKey: targetFileID },
  mediaAssetKey: targetFileID, mediaSha256: hash(audioBytes),
  durationMs: content.mainAudio.durationMs, allowedClassIds: ['cls_grade3_2', 'cls_grade4_1'],
  questionIds: content.questions.map(q => q.id), questions,
  answerKeys: content.questions.map(q => ({ questionId: q.id,
    correctAnswer: q.correctAnswer, explanation: q.explanation })),
  clips: content.questions.map(q => ({ questionId: q.id, segmentId: `${q.id}_segment`,
    startMs: q.mainSegment.startMs, endMs: q.mainSegment.endMs })),
  continuousPlaybackEnforced: true,
};
const input = { resourceId: sourceId, organizationId: 'org_qihang_demo',
  contentVersion: 1, manifestSha256: hash(manifestBytes),
  reviewId: `review_${hash(reviewBytes).slice(0, 32)}`,
  importedBy: 'codex_launch_review_20261012', grade: '三年级',
  sourceSha256: rights.originalAudioSha256, verifiedAt: review.reviewedAt,
  releaseMode: 'formal_reusable', processedMedia: candidate };
api.buildVerifiedCentralMediaResource(input);
if (mode === 'apply') {
  const service = new api.PublicMediaDistributionService(database,
    { nowIso: () => new Date().toISOString() });
  await service.importVerified(input);
}
const [source, projected, audit] = await Promise.all([
  database.get('learning_resources', sourceId),
  database.get('learning_resources', projectionId),
  database.get('operation_logs', `public_media_import_${sourceId}`),
]);
if (!source || !projected || !audit || source.status !== 'published'
  || projected.status !== 'published' || source.testOnly !== false
  || source.payload?.teacherMedia?.mediaSha256 !== hash(audioBytes)
  || source.payload?.assetLibrary?.reviewId !== input.reviewId
  || projected.payload?.assetLibrary?.sourcePublicId !== sourceId) {
  throw new Error('MEDIA_RESOURCE_READBACK_FAILED');
}
const contentOut = join(backend, '.runtime/launch-storybook-listening-20261012/content.cjs');
await build({ entryPoints: [join(backend, 'src/seed/m3-real-sample-entry.ts')],
  outfile: contentOut, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const contentApi = require(contentOut);
const catalog = new contentApi.TeacherAssetCatalogService(database,
  contentApi.createOrgContentDocumentRepository(database), undefined,
  { nowIso: () => new Date().toISOString() });
const teacher = { requestId: 'launch_storybook_listening_teacher_20261012',
  sessionId: 'launch-storybook-listening-verify', actorUserId: 'usr_teacher_demo_01',
  actorRole: 'teacher', organizationId: 'org_qihang_demo',
  platformSubjectDigest: 'launch-storybook-listening-verify',
  permissions: ['content.read', 'task.publish'], scopeIds: ['cls_grade3_2'], authzVersion: 1 };
const listed = await catalog.list(teacher,
  { kind: 'listening', targetClassIds: ['cls_grade3_2'], keyword: '动作听力四题' },
  { limit: 50, offset: 0 });
const item = listed.items.find(row => row.id === sourceId);
if (!item || item.questionCount !== 4 || item.durationMs !== 25011) {
  throw new Error('TEACHER_CATALOG_READBACK_FAILED');
}
process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
  mediaSha256: hash(audioBytes), questionCount: content.questions.length,
  source: sourceId, projectedOrganizations: organizations.length,
  audit: audit.result, teacherCatalog: 'visible',
  cloudWrites: mode === 'apply' ? 6 : 0 }) + '\n');
await new Promise(resolve => setTimeout(resolve, 300));
process.exit(0);
