// Controlled nonproduction import of the two-question Pangu video with its publisher soundtrack.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = resolve('G:/英语资产');
const sourceDir = join(assetRoot, 'library/derived/cip-50055-traditions/v1');
const outputDir = join(assetRoot, 'library/derived/cip-50055-traditions/video-211/v6');
const require = createRequire(join(backend, 'package.json'));
const { build } = require('esbuild');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async file => readFile(file);
const sourceVideo = await read(join(sourceDir, 'media/video/211.mp4'));
const video = await read(join(outputDir, 'pangu-subtitle-reading-2q-voiced-v6.mp4'));
const rightsBytes = await read(join(outputDir, 'source-use-decision-v6.json'));
const reviewBytes = await read(join(outputDir, 'codex-content-review-v6.json'));
const lessonBytes = await read(join(outputDir, 'lesson-content-v6.json'));
const audioReceiptBytes = await read(join(outputDir, 'audio-preservation-v6.json'));
const sourceTechBytes = await read(join(sourceDir, 'review/technical-receipt-v1.json'));
const outputTechBytes = await read(join(outputDir, 'technical-output-v6.json'));
const crawlBytes = await read(join(sourceDir, 'source/crawl-receipt-v1.json'));
const rights = JSON.parse(rightsBytes);
const review = JSON.parse(reviewBytes);
const lesson = JSON.parse(lessonBytes);
const audioReceipt = JSON.parse(audioReceiptBytes);
const sourceTech = JSON.parse(sourceTechBytes);
const outputTech = JSON.parse(outputTechBytes);
const crawl = JSON.parse(crawlBytes);
if (review.decision !== 'approved_source_soundtrack_preserved_for_nonproduction_validation'
  || review.productionReady !== false || review.reviewerId !== 'Codex'
  || review.outputVideoSha256.toLowerCase() !== hash(video)
  || review.sourceVideoSha256.toLowerCase() !== hash(sourceVideo)
  || review.sourceUseDecisionSha256.toLowerCase() !== hash(rightsBytes)
  || review.lessonContentSha256.toLowerCase() !== hash(lessonBytes)
  || review.audioPreservationReceiptSha256.toLowerCase() !== hash(audioReceiptBytes)
  || review.outputTechnicalReceiptSha256.toLowerCase() !== hash(outputTechBytes)
  || rights.decision !== 'project_lead_directed_nonproduction_use'
  || rights.productionUseDecision !== 'pending_resource_specific_rights_confirmation'
  || rights.sourceVideoSha256.toLowerCase() !== hash(sourceVideo)
  || crawl.bookInfo.isbn !== '978-7-122-50055-7'
  || sourceTech.infectedFiles !== 0 || sourceTech.mediaCount !== 60
  || outputTech.infectedFiles !== 0 || outputTech.durationMs !== 50489
  || outputTech.outputVideoSha256.toLowerCase() !== hash(video)
  || outputTech.sourceVideoSha256.toLowerCase() !== hash(sourceVideo)
  || outputTech.sourceTechnicalReceiptSha256.toLowerCase() !== hash(sourceTechBytes)
  || outputTech.audioPreservationReceiptSha256.toLowerCase() !== hash(audioReceiptBytes)
  || outputTech.companionBookAudio?.publisherResourceId !== 111
  || outputTech.companionBookAudio?.durationMs !== 108384
  || audioReceipt.fullSoundtrackCorrelation < 0.99
  || audioReceipt.outputVideoSha256.toLowerCase() !== hash(video)
  || lesson.questions.length !== 2
  || lesson.outputVideoSha256.toLowerCase() !== hash(video)) {
  throw new Error('SOURCE_CONTENT_TECHNICAL_REVIEW_GATE');
}

function call(args) {
  let raw;
  try {
    raw = execFileSync(process.execPath,
      ['D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb', ...args],
      { cwd: backend, encoding: 'utf8', windowsHide: true, timeout: 30000,
        maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { throw new Error('CLOUD_CLI_FAILED'); }
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const result = JSON.parse(raw.slice(at));
  if (result.error) throw new Error('CLOUD_API_ERROR');
  return result.data;
}

const config = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
const envId = (await readFile(join(backend, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
const envs = call(['env', 'list', '--json']);
if (envId !== 'cloud1-d8ggzrwwedb786e41' || config.envId !== envId
  || envs.length !== 1 || envs[0].EnvId !== envId || envs[0].Status !== 'NORMAL'
  || envs[0].PackageName !== '个人版' || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no' || envs[0].EnableOverrun !== false) {
  throw new Error('NONPRODUCTION_COST_GATE');
}
const writeQuota = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
const storageQuota = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'StorageSizepkg' }), '--json']);
if (!Number.isFinite(writeQuota.Value) || writeQuota.Value > 190000
  || !Number.isFinite(storageQuota.Value) || storageQuota.Value > 4_000_000_000) {
  throw new Error('QUOTA_GATE');
}
const acl = execFileSync(process.execPath,
  ['D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb', 'storage', 'get-acl', '--json'],
  { cwd: backend, encoding: 'utf8', windowsHide: true, timeout: 30000 });
if (!acl.includes('Only creator and admin can read and write')) throw new Error('STORAGE_NOT_PRIVATE');
const credentials = call(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const sdk = require('@cloudbase/node-sdk');
const app = sdk.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const entry = join(backend, '.runtime/cip-50055-pangu-voiced-v6-20261013/entry.cjs');
await mkdir(dirname(entry), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-public-media-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(entry);
const database = api.createCloudBaseDocumentDatabase(app.database());
const organizationIds = (await database.find('organizations', { status: 'active', deletedAt: null }))
  .map(row => row._id).sort();
if (JSON.stringify(organizationIds) !== JSON.stringify(['org_isolation_secondary', 'org_qihang_demo'])) {
  throw new Error('ORGANIZATION_SCOPE_CHANGED');
}
const priorStage = JSON.parse(await readFile(join(assetRoot,
  'reports/sbc0008-listening-v2-nonproduction-stage.json'), 'utf8'));
const prefix = priorStage.fileID.slice(0, priorStage.fileID.indexOf(priorStage.cloudPath));
if (!prefix.startsWith('cloud://')) throw new Error('CLOUD_PREFIX_GATE');
const pathPrefix = 'launch-content/2026-10-13/cip50055-pangu-2q-voiced-v6/';
const objects = [
  { key: 'video', path: `${pathPrefix}video-${hash(video).slice(0, 16)}.mp4`, bytes: video },
  { key: 'rights', path: `${pathPrefix}use-decision-${hash(rightsBytes).slice(0, 16)}.json`, bytes: rightsBytes },
  { key: 'review', path: `${pathPrefix}review-${hash(reviewBytes).slice(0, 16)}.json`, bytes: reviewBytes },
  { key: 'lesson', path: `${pathPrefix}lesson-${hash(lessonBytes).slice(0, 16)}.json`, bytes: lessonBytes },
  { key: 'audio', path: `${pathPrefix}audio-preservation-${hash(audioReceiptBytes).slice(0, 16)}.json`, bytes: audioReceiptBytes },
  { key: 'technical', path: `${pathPrefix}technical-${hash(outputTechBytes).slice(0, 16)}.json`, bytes: outputTechBytes },
].map(object => ({ ...object, fileID: `${prefix}${object.path}` }));
const resourceId = 'res_cip50055_pangu_video_2q_voiced_v6_20261013';
const projectionId = `public_media_${hash(Buffer.from(JSON.stringify([
  resourceId, 'org_isolation_secondary',
]))).slice(0, 40)}`;
const [sourceSlot, projectionSlot] = await Promise.all([
  database.get('learning_resources', resourceId), database.get('learning_resources', projectionId),
]);
const existingStorage = [];
for (const object of objects) {
  let existing = null;
  try { existing = await app.downloadFile({ fileID: object.fileID }); } catch { /* Target absent. */ }
  if (existing) {
    const bytes = Buffer.isBuffer(existing.fileContent)
      ? existing.fileContent : Buffer.from(existing.fileContent ?? '');
    if (hash(bytes) !== hash(object.bytes)) throw new Error(`STORAGE_CONFLICT_${object.key}`);
  }
  existingStorage.push(!!existing);
}
const byKey = Object.fromEntries(objects.map(object => [object.key, object.fileID]));
const transcodedAt = (await stat(join(outputDir,
  'pangu-subtitle-reading-2q-voiced-v6.mp4'))).mtime.toISOString();
if (Date.parse(sourceTech.auditedAt) > Date.parse(transcodedAt)
  || Date.parse(transcodedAt) > Date.parse(outputTech.auditedAt)) throw new Error('PROCESSING_ORDER_GATE');
const candidate = {
  id: resourceId, organizationId: 'org_qihang_demo',
  title: '盘古开天｜有声字幕阅读与两题理解（出版社原声）', kind: 'video', version: 1,
  status: 'published', reviewVersion: 1, reviewedBy: 'Codex', reviewedAt: review.reviewedAt,
  copyrightStatus: 'verified', copyrightEvidenceKey: byKey.rights,
  scanStatus: 'clean', transcodeStatus: 'ready',
  sourceScanEvidence: { engine: 'clamav', signatureVersion: sourceTech.scanner,
    scannedAt: sourceTech.auditedAt, scannedSha256: hash(sourceVideo),
    reportId: sourceTech.scanContainerSha256 },
  scanEvidence: { engine: 'clamav', signatureVersion: outputTech.scanner,
    scannedAt: outputTech.auditedAt, scannedSha256: hash(video),
    reportId: outputTech.scanContainerSha256 },
  transcodeEvidence: { engine: 'ffmpeg', engineVersion: 'FFmpeg 9.0.2',
    transcodedAt, sourceSha256: hash(sourceVideo), outputSha256: hash(video),
    outputAssetKey: byKey.video },
  mediaAssetKey: byKey.video, mediaSha256: hash(video), durationMs: 50489,
  allowedClassIds: ['cls_grade3_2', 'cls_grade4_1'],
  questionIds: lesson.questions.map(question => question.id),
  questions: lesson.questions.map(question => ({ questionId: question.id,
    questionType: question.type, stem: question.stem, options: question.options })),
  answerKeys: lesson.questions.map(question => ({ questionId: question.id,
    correctAnswer: question.correctAnswer, explanation: question.explanation })),
  clips: [],
  continuousPlaybackEnforced: true,
};
const input = { resourceId, organizationId: 'org_qihang_demo', contentVersion: 1,
  manifestSha256: hash(reviewBytes), reviewId: `review_${hash(reviewBytes).slice(0, 32)}`,
  importedBy: 'codex_cip50055_nonproduction_20261013', grade: '四年级',
  textbook: '漫画用英语介绍中国传统', unit: 'Part1 神话传说，精彩开场！',
  sourceSha256: hash(sourceVideo), verifiedAt: review.reviewedAt,
  releaseMode: 'user_acceptance', processedMedia: candidate };
api.buildVerifiedCentralMediaResource(input);
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    sourceSlotEmpty: !sourceSlot, projectionSlotEmpty: !projectionSlot,
    existingStorageObjects: existingStorage.filter(Boolean).length,
    outputSha256: hash(video), outputBytes: video.length, mediaDurationMs: 50489,
    soundtrackCorrelation: audioReceipt.fullSoundtrackCorrelation,
    questionCount: lesson.questions.length,
    teacherStatus: 'pending_user_acceptance', cloudWrites: 0 }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  if (sourceSlot || projectionSlot) throw new Error('TARGET_RECORD_NOT_EMPTY');
  for (let index = 0; index < objects.length; index++) {
    if (existingStorage[index]) continue;
    const object = objects[index];
    const uploaded = await app.uploadFile({ cloudPath: object.path, fileContent: object.bytes });
    if (uploaded?.fileID !== object.fileID) throw new Error(`UPLOAD_ID_MISMATCH_${object.key}`);
  }
}
for (const object of objects) {
  const downloaded = await app.downloadFile({ fileID: object.fileID });
  const bytes = Buffer.isBuffer(downloaded.fileContent)
    ? downloaded.fileContent : Buffer.from(downloaded.fileContent ?? '');
  if (hash(bytes) !== hash(object.bytes)) throw new Error(`STORAGE_READBACK_${object.key}`);
}
if (mode === 'apply') {
  const service = new api.PublicMediaDistributionService(database,
    { nowIso: () => new Date().toISOString() });
  await service.importVerified(input);
}
const [source, projection, sourceAudit, projectionAudit] = await Promise.all([
  database.get('learning_resources', resourceId),
  database.get('learning_resources', projectionId),
  database.get('operation_logs', `public_media_import_${resourceId}`),
  database.get('operation_logs', `public_media_projection_${projectionId}`),
]);
if (!source || !projection || !sourceAudit || !projectionAudit
  || source.status !== 'published' || projection.status !== 'published'
  || source.testOnly !== true || source.acceptanceStatus !== 'pending_user_acceptance'
  || source.payload?.teacherMedia?.mediaSha256 !== hash(video)
  || projection.payload?.assetLibrary?.sourcePublicId !== resourceId) {
  throw new Error('PUBLISHED_RESOURCE_READBACK_FAILED');
}
const contentEntry = join(backend, '.runtime/cip-50055-pangu-voiced-v6-20261013/content.cjs');
await build({ entryPoints: [join(backend, 'src/seed/m3-real-sample-entry.ts')],
  outfile: contentEntry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const contentApi = require(contentEntry);
const catalog = new contentApi.TeacherAssetCatalogService(database,
  contentApi.createOrgContentDocumentRepository(database), undefined,
  { nowIso: () => new Date().toISOString() });
const teacher = { requestId: 'cip50055_pangu_v6_catalog_20261013', sessionId: 'cip50055-pangu-v6-review',
  actorUserId: 'usr_teacher_demo_01', actorRole: 'teacher', organizationId: 'org_qihang_demo',
  platformSubjectDigest: 'cip50055-pangu-v6-review', permissions: ['content.read', 'task.publish'],
  scopeIds: ['cls_grade3_2'], authzVersion: 1 };
const listed = await catalog.list(teacher, { kind: 'video', keyword: '盘古开天' }, { limit: 50, offset: 0 });
const item = listed.items.find(row => row.id === resourceId);
if (!item || item.durationMs !== 50489 || item.questionCount !== 2
  || item.grade !== '四年级' || item.textbook !== '漫画用英语介绍中国传统'
  || item.unit !== 'Part1 神话传说，精彩开场！'
  || item.acceptanceStatus !== 'pending_user_acceptance') throw new Error('TEACHER_CATALOG_READBACK_FAILED');
process.stdout.write(JSON.stringify({ mode, status: 'verified_nonproduction', resourceId,
  outputSha256: hash(video), mediaDurationMs: 50489, questionCount: item.questionCount,
  soundtrackCorrelation: audioReceipt.fullSoundtrackCorrelation,
  catalogAcceptanceStatus: item.acceptanceStatus,
  organizationProjectionCount: 1, storageReadbackCount: objects.length,
  productionPublished: false }) + '\n');
