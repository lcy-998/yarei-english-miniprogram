// Controlled nonproduction import of credited Storybooks Canada video and dubbing.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve('G:/英语资产');
const pack = join(root, 'library/derived/m3-source-only-review/v4/media');
const require = createRequire(join(backend, 'package.json'));
const { build } = require('esbuild');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = {
  video: 'sbc-en-0008-human-narration-credited-v4.mp4',
  rights: 'source-rights-video-v4.json',
  subtitle: '../../v3/media/sbc-en-0008-subtitles-source-bound-v3.vtt',
  review: 'codex-media-review-v4.json',
  scan: 'technical-receipt-video-v4.json',
  edit: 'credit-edit-receipt-v4.json',
  packets: 'audio-packet-preservation-v4.json',
  videoMapping: 'video-task-mapping-v4.json',
  dubbingMapping: 'dubbing-task-mapping-v4.json',
};
const bytes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, name]) =>
  [key, await readFile(resolve(pack, name))])));
const parsed = Object.fromEntries(['rights', 'review', 'scan', 'edit', 'packets', 'videoMapping', 'dubbingMapping']
  .map(key => [key, JSON.parse(bytes[key])]));
if (parsed.review.decision !== 'approved_content_for_nonproduction_validation'
  || parsed.review.reviewerId !== 'Codex' || parsed.review.productionReady !== false
  || parsed.review.creditedVideoSha256 !== hash(bytes.video)
  || parsed.review.sourceRightsSha256 !== hash(bytes.rights)
  || parsed.review.technicalReceiptSha256 !== hash(bytes.scan)
  || parsed.review.subtitleSha256 !== hash(bytes.subtitle)
  || parsed.edit.creditedVideoSha256 !== hash(bytes.video)
  || parsed.scan.outputVideoSha256 !== hash(bytes.video)
  || parsed.scan.infectedFiles !== 0 || parsed.scan.durationMs !== 28032
  || parsed.packets.creditedVideoSha256 !== hash(bytes.video)
  || parsed.packets.preservedPrefixPackets !== parsed.packets.sourceAudioPackets
  || parsed.rights.license !== 'CC BY 3.0'
  || parsed.rights.licenseUrl !== 'https://creativecommons.org/licenses/by/3.0/'
  || parsed.videoMapping.videoSha256 !== hash(bytes.video)
  || parsed.dubbingMapping.videoSha256 !== hash(bytes.video)
  || parsed.videoMapping.durationMs !== 28032
  || parsed.dubbingMapping.durationMs !== 28032) throw new Error('MEDIA_REVIEW_GATE');
for (const kind of ['video', 'dubbing']) {
  const map = parsed[`${kind}Mapping`];
  if (map.sourceRightsSha256 !== hash(bytes.rights)
    || map.technicalReceiptSha256 !== hash(bytes.scan)
    || map.subtitleSha256 !== hash(bytes.subtitle)
    || map.cues.length !== 9 || map.cues[0].startMs !== 0
    || map.cues[8].endMs !== 25011 || map.productionReady !== false) {
    throw new Error(`MAPPING_GATE_${kind}`);
  }
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
const line = (await readFile(join(backend, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(item => item.startsWith('TCB_ENV_ID='));
const envId = line?.slice(11).trim();
const envs = call(['env', 'list', '--json']);
if (!envId || envId !== config.envId || envs.length !== 1 || envs[0].EnvId !== envId
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
const out = join(backend, '.runtime/launch-storybook-credited-media-20261012/entry.cjs');
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
const source = await database.get('learning_resources', 'res_m3_sbc0008_video_auto_20261005');
const oldMedia = source?.payload?.teacherMedia;
if (!source || source.status !== (mode === 'verify' ? 'offline' : 'published')
  || source.copyrightStatus !== 'verified'
  || oldMedia?.mediaSha256 !== parsed.edit.sourceVideoSha256
  || oldMedia.scanEvidence?.scannedSha256 !== parsed.edit.sourceVideoSha256
  || oldMedia.scanEvidence?.engine !== 'clamav') throw new Error('SOURCE_VIDEO_GATE');
const oldStage = JSON.parse(await readFile(join(root, 'reports/sbc0008-listening-v2-nonproduction-stage.json'), 'utf8'));
const prefix = oldStage.fileID.slice(0, oldStage.fileID.indexOf(oldStage.cloudPath));
if (!prefix.startsWith('cloud://')) throw new Error('CLOUD_PREFIX_GATE');
const basePath = 'launch-content/2026-10-12/sbc0008-credited-video-v4/';
const objects = [
  { key: 'video', path: `${basePath}video-${hash(bytes.video).slice(0, 16)}.mp4` },
  { key: 'rights', path: `${basePath}source-rights-${hash(bytes.rights).slice(0, 16)}.json` },
  { key: 'subtitle', path: `${basePath}subtitles-${hash(bytes.subtitle).slice(0, 16)}.vtt` },
].map(item => ({ ...item, fileID: `${prefix}${item.path}`, bytes: bytes[item.key] }));
const existingObjects = [];
for (const object of objects) {
  let found = null;
  try { found = await app.downloadFile({ fileID: object.fileID }); } catch { /* target absent */ }
  if (found) {
    const fileContent = Buffer.isBuffer(found.fileContent)
      ? found.fileContent : Buffer.from(found.fileContent ?? '');
    if (hash(fileContent) !== hash(object.bytes)) throw new Error(`STORAGE_HASH_CONFLICT_${object.key}`);
  }
  existingObjects.push(!!found);
}
const sources = [
  { kind: 'video', id: 'res_launch_sbc0008_video_credited_v1_20261012', title: 'What are you doing?｜真人朗读视频' },
  { kind: 'dubbing', id: 'res_launch_sbc0008_dubbing_credited_v1_20261012', title: 'What are you doing?｜视频配音示范' },
];
const projections = sources.map(item => `public_media_${hash(Buffer.from(JSON.stringify([item.id, 'org_isolation_secondary']))).slice(0, 40)}`);
const slots = await Promise.all(sources.map(async (item, index) => ({
  source: await database.get('learning_resources', item.id),
  projection: await database.get('learning_resources', projections[index]),
})));
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    videoSha256: hash(bytes.video), videoBytes: bytes.video.length,
    emptySourceSlots: slots.filter(row => !row.source).length,
    emptyProjectionSlots: slots.filter(row => !row.projection).length,
    existingStorageObjects: existingObjects.filter(Boolean).length,
    mediaTypes: sources.map(item => item.kind), cloudWrites: 0 }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  if (slots.some(row => row.source || row.projection)) throw new Error('TARGET_RECORD_NOT_EMPTY');
  for (let i = 0; i < objects.length; i++) {
    if (existingObjects[i]) continue;
    const uploaded = await app.uploadFile({ cloudPath: objects[i].path, fileContent: objects[i].bytes });
    if (uploaded?.fileID !== objects[i].fileID) throw new Error(`UPLOAD_ID_MISMATCH_${objects[i].key}`);
  }
}
for (const object of objects) {
  const downloaded = await app.downloadFile({ fileID: object.fileID });
  const content = Buffer.isBuffer(downloaded.fileContent)
    ? downloaded.fileContent : Buffer.from(downloaded.fileContent ?? '');
  if (hash(content) !== hash(object.bytes)) throw new Error(`STORAGE_READBACK_${object.key}`);
}
const byKey = Object.fromEntries(objects.map(item => [item.key, item.fileID]));
const videoStat = await stat(join(pack, files.video));
const processedAt = videoStat.mtime.toISOString();
if (Date.parse(oldMedia.scanEvidence.scannedAt) > Date.parse(processedAt)
  || Date.parse(processedAt) > Date.parse(parsed.scan.scannedAt)) {
  throw new Error('PROCESSING_TIME_GATE');
}
const inputs = sources.map(item => {
  const mapping = parsed[`${item.kind}Mapping`];
  const candidate = {
    id: item.id, organizationId: 'org_qihang_demo', title: item.title,
    kind: item.kind, version: 1, status: 'published', reviewVersion: 1,
    reviewedBy: 'Codex', reviewedAt: parsed.review.reviewedAt,
    copyrightStatus: 'verified', copyrightEvidenceKey: byKey.rights,
    scanStatus: 'clean', transcodeStatus: 'ready',
    sourceScanEvidence: oldMedia.scanEvidence,
    scanEvidence: { engine: 'clamav', signatureVersion: parsed.scan.scanner,
      scannedAt: parsed.scan.scannedAt, scannedSha256: hash(bytes.video),
      reportId: parsed.scan.scanContainerSha256 },
    transcodeEvidence: { engine: 'ffmpeg', engineVersion: 'FFmpeg 9.0.2',
      transcodedAt: processedAt, sourceSha256: parsed.edit.sourceVideoSha256,
      outputSha256: hash(bytes.video), outputAssetKey: byKey.video },
    mediaAssetKey: byKey.video, mediaSha256: hash(bytes.video),
    durationMs: parsed.scan.durationMs, allowedClassIds: ['cls_grade3_2', 'cls_grade4_1'],
    questionIds: [], questions: [], answerKeys: [], clips: [],
    subtitleAssetKey: byKey.subtitle,
    subtitleCues: mapping.cues.map(cue => ({ startMs: cue.startMs,
      endMs: cue.endMs, text: cue.text })),
    continuousPlaybackEnforced: true,
  };
  return { resourceId: item.id, organizationId: 'org_qihang_demo', contentVersion: 1,
    manifestSha256: hash(bytes[`${item.kind}Mapping`]),
    reviewId: `review_${hash(bytes.review).slice(0, 32)}`,
    importedBy: 'codex_launch_review_20261012', grade: '三年级',
    sourceSha256: parsed.edit.sourceVideoSha256,
    verifiedAt: parsed.review.reviewedAt, releaseMode: 'formal_reusable',
    processedMedia: candidate };
});
for (const input of inputs) api.buildVerifiedCentralMediaResource(input);
if (mode === 'apply') {
  const service = new api.PublicMediaDistributionService(database,
    { nowIso: () => new Date().toISOString() });
  for (const input of inputs) await service.importVerified(input);
}
const results = await Promise.all(inputs.map(async (input, index) => {
  const [sourceRow, projection, audit] = await Promise.all([
    database.get('learning_resources', input.resourceId),
    database.get('learning_resources', projections[index]),
    database.get('operation_logs', `public_media_import_${input.resourceId}`),
  ]);
  if (!sourceRow || !projection || !audit || sourceRow.status !== 'published'
    || projection.status !== 'published' || sourceRow.testOnly !== false
    || sourceRow.payload?.teacherMedia?.mediaSha256 !== hash(bytes.video)
    || sourceRow.payload?.assetLibrary?.reviewId !== input.reviewId
    || projection.payload?.assetLibrary?.sourcePublicId !== input.resourceId) {
    throw new Error(`RESOURCE_READBACK_${input.resourceId}`);
  }
  return input.resourceId;
}));
const contentOut = join(backend, '.runtime/launch-storybook-credited-media-20261012/content.cjs');
await build({ entryPoints: [join(backend, 'src/seed/m3-real-sample-entry.ts')],
  outfile: contentOut, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const contentApi = require(contentOut);
const catalog = new contentApi.TeacherAssetCatalogService(database,
  contentApi.createOrgContentDocumentRepository(database), undefined,
  { nowIso: () => new Date().toISOString() });
const teacher = { requestId: 'launch_storybook_video_teacher_20261012',
  sessionId: 'launch-storybook-video-verify', actorUserId: 'usr_teacher_demo_01',
  actorRole: 'teacher', organizationId: 'org_qihang_demo',
  platformSubjectDigest: 'launch-storybook-video-verify',
  permissions: ['content.read', 'task.publish'], scopeIds: ['cls_grade3_2'], authzVersion: 1 };
for (const item of sources) {
  const listed = await catalog.list(teacher,
    { kind: item.kind, targetClassIds: ['cls_grade3_2'], keyword: 'What are you doing?' },
    { limit: 50, offset: 0 });
  const found = listed.items.find(row => row.id === item.id);
  if (!found || found.durationMs !== 28032 || found.questionCount !== 0) {
    throw new Error(`TEACHER_CATALOG_${item.kind}`);
  }
}
process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
  videoSha256: hash(bytes.video), sources: results, projections: results.length,
  teacherCatalog: 'visible', auditRecords: results.length,
  cloudWrites: mode === 'apply' ? 11 : 0 }) + '\n');
await new Promise(resolve => setTimeout(resolve, 300));
process.exit(0);
