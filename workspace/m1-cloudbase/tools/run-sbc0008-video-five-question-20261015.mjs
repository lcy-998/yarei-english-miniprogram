// Controlled nonproduction import of a five-question version of the existing credited story video.
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
const pack = join(root, 'library/derived/sbc0008-video-five-question-2026-10-15/v1');
const sourcePack = join(root, 'library/derived/m3-source-only-review/v4/media');
const require = createRequire(join(backend, 'package.json'));
const { build } = require('esbuild');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const [lessonBytes, previewBytes, reviewBytes, mapBytes, rightsBytes, videoBytes, subtitleBytes, techBytes] = await Promise.all([
  readFile(join(pack, 'lesson.json')), readFile(join(pack, 'student-preview.json')),
  readFile(join(pack, 'review.json')), readFile(join(sourcePack, 'video-task-mapping-v4.json')),
  readFile(join(sourcePack, 'source-rights-video-v4.json')),
  readFile(join(sourcePack, 'sbc-en-0008-human-narration-credited-v4.mp4')),
  readFile(join(root, 'library/derived/m3-source-only-review/v3/media/sbc-en-0008-subtitles-source-bound-v3.vtt')),
  readFile(join(sourcePack, 'technical-receipt-video-v4.json')),
]);
const lesson = JSON.parse(lessonBytes);
const preview = JSON.parse(previewBytes);
const review = JSON.parse(reviewBytes);
const mapping = JSON.parse(mapBytes);
const rights = JSON.parse(rightsBytes);
const technical = JSON.parse(techBytes);
if (review.decision !== 'approved_for_verified_nonproduction' || review.reviewerId !== 'Codex'
  || review.lessonSha256 !== sha256(lessonBytes) || review.studentPreviewSha256 !== sha256(previewBytes)
  || review.sourceMappingSha256 !== sha256(mapBytes) || review.sourceRightsSha256 !== sha256(rightsBytes)
  || review.videoSha256 !== sha256(videoBytes) || review.subtitleSha256 !== sha256(subtitleBytes)
  || review.technicalReceiptSha256 !== sha256(techBytes)
  || rights.outputVideoSha256 !== review.videoSha256 || technical.outputVideoSha256 !== review.videoSha256
  || mapping.videoSha256 !== review.videoSha256 || mapping.subtitleSha256 !== review.subtitleSha256
  || rights.license !== 'CC BY 3.0' || lesson.questions.length !== 5
  || preview.questions.length !== 5 || review.questions.length !== 5
  || JSON.stringify(preview).includes('correctAnswer') || JSON.stringify(preview).includes('explanation')) {
  throw new Error('CONTENT_REVIEW_GATE');
}
for (let index = 0; index < 5; index++) {
  const question = lesson.questions[index];
  const student = preview.questions[index];
  const cue = mapping.cues[question.evidenceCue - 1];
  if (!cue || cue.text !== question.evidenceText || question.id !== student.id
    || question.stem !== student.stem || JSON.stringify(question.options) !== JSON.stringify(student.options)
    || !question.options.includes(question.correctAnswer)
    || review.questions[index].questionId !== question.id
    || review.questions[index].answer !== question.correctAnswer) throw new Error(`QUESTION_GATE_${index}`);
}
function call(args) {
  const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: backend, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const result = JSON.parse(raw.slice(at));
  if (result.error) throw new Error('CLOUD_API_ERROR');
  return result.data;
}
const configured = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
const envLine = (await readFile(join(backend, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice(11).trim();
const envs = call(['env', 'list', '--json']);
if (!envId || envId !== configured.envId || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no'
  || envs[0].EnableOverrun !== false) throw new Error('NONPRODUCTION_ENV_COST_GATE');
const quota = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('QUOTA_GATE');
const token = call(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const sdk = require('@cloudbase/node-sdk');
const app = sdk.init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token });
const output = join(backend, '.runtime/sbc0008-video-five-question-20261015/entry.cjs');
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
const oldId = 'res_launch_sbc0008_video_credited_v1_20261012';
const old = await database.get('learning_resources', oldId);
const oldMedia = old?.payload?.teacherMedia;
if (!old || old.status !== (mode === 'verify' ? 'offline' : 'published')
  || old.type !== 'video' || old.testOnly !== false
  || oldMedia?.mediaSha256 !== review.videoSha256
  || oldMedia?.subtitleCues?.length !== mapping.cues.length
  || oldMedia?.durationMs !== lesson.durationMs) throw new Error('EXISTING_SOURCE_GATE');
for (const [fileID, expected] of [
  [oldMedia.mediaAssetKey, review.videoSha256],
  [oldMedia.subtitleAssetKey, review.subtitleSha256],
  [oldMedia.copyrightEvidenceKey, review.sourceRightsSha256],
]) {
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) throw new Error('STORAGE_REFERENCE_GATE');
  const downloaded = await app.downloadFile({ fileID });
  const bytes = Buffer.isBuffer(downloaded.fileContent)
    ? downloaded.fileContent : Buffer.from(downloaded.fileContent ?? '');
  if (sha256(bytes) !== expected) throw new Error('STORAGE_READBACK_GATE');
}
const sourceId = lesson.resourceId;
const projectionId = `public_media_${sha256(Buffer.from(JSON.stringify([sourceId, 'org_isolation_secondary']))).slice(0, 40)}`;
const [existing, existingProjection] = await Promise.all([
  database.get('learning_resources', sourceId), database.get('learning_resources', projectionId),
]);
if (mode === 'inspect' && (existing || existingProjection)) throw new Error('TARGET_SLOT_OCCUPIED');
const candidate = {
  ...oldMedia, id: sourceId, organizationId: 'org_qihang_demo',
  title: lesson.title, kind: 'video', version: 1, status: 'published',
  reviewVersion: 1, reviewedBy: 'Codex', reviewedAt: review.reviewedAt,
  questionIds: lesson.questions.map(question => question.id),
  questions: lesson.questions.map(question => ({ questionId: question.id,
    questionType: question.type, stem: question.stem, options: question.options })),
  answerKeys: lesson.questions.map(question => ({ questionId: question.id,
    correctAnswer: question.correctAnswer, explanation: question.explanation })),
};
const input = { resourceId: sourceId, organizationId: 'org_qihang_demo', contentVersion: 1,
  manifestSha256: sha256(lessonBytes), reviewId: `review_${sha256(reviewBytes).slice(0, 32)}`,
  importedBy: 'codex_sbc0008_video_5q_20261015', grade: lesson.grade,
  sourceSha256: rights.sourceVideoSha256, verifiedAt: review.reviewedAt,
  releaseMode: 'formal_reusable', processedMedia: candidate };
api.buildVerifiedCentralMediaResource(input);
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environmentId: envId, targetEmpty: true,
    mediaReuseSha256: review.videoSha256, questionCount: 5, storageReadback: 3,
    cloudWrites: 0, productionPublished: false }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  const service = new api.PublicMediaDistributionService(database,
    { nowIso: () => new Date().toISOString() });
  await service.importVerified(input);
}
const [source, projection, sourceAudit, projectionAudit] = await Promise.all([
  database.get('learning_resources', sourceId), database.get('learning_resources', projectionId),
  database.get('operation_logs', `public_media_import_${sourceId}`),
  database.get('operation_logs', `public_media_projection_${projectionId}`),
]);
if (!source || !projection || !sourceAudit || !projectionAudit
  || source.status !== 'published' || projection.status !== 'published'
  || source.testOnly !== false || source.payload?.teacherMedia?.questionIds?.length !== 5
  || source.payload?.teacherMedia?.mediaSha256 !== review.videoSha256
  || projection.payload?.assetLibrary?.sourcePublicId !== sourceId) throw new Error('PUBLISHED_READBACK_GATE');
const contentOutput = join(backend, '.runtime/sbc0008-video-five-question-20261015/content.cjs');
await build({ entryPoints: [join(backend, 'src/seed/m3-real-sample-entry.ts')],
  outfile: contentOutput, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const contentApi = require(contentOutput);
const catalog = new contentApi.TeacherAssetCatalogService(database,
  contentApi.createOrgContentDocumentRepository(database), undefined,
  { nowIso: () => new Date().toISOString() });
const teacher = { requestId: 'sbc0008_video_5q_catalog_20261015', sessionId: 'sbc0008-video-5q-check',
  actorUserId: 'usr_teacher_demo_01', actorRole: 'teacher', organizationId: 'org_qihang_demo',
  platformSubjectDigest: 'sbc0008-video-5q-check', permissions: ['content.read', 'task.publish'],
  scopeIds: ['cls_grade3_2'], authzVersion: 1 };
const listed = await catalog.list(teacher, { kind: 'video', keyword: 'What are you doing?' },
  { limit: 50, offset: 0 });
const visible = listed.items.find(row => row.id === sourceId);
if (!visible || visible.questionCount !== 5 || visible.durationMs !== 28032) {
  throw new Error('TEACHER_CATALOG_GATE');
}
process.stdout.write(JSON.stringify({ mode, environmentId: envId, sourceId,
  questionCount: 5, videoSha256: review.videoSha256, projectionCount: 1,
  auditCount: 2, teacherCatalog: 'visible', cloudWrites: mode === 'apply' ? 4 : 0,
  productionPublished: false }) + '\n');
