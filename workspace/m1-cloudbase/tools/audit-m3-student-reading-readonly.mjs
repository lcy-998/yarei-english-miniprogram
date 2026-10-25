import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, stop } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const resourceId = 'res_m3_sbc0008_review_draft_20261002';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envLine = readFileSync(resolve(root, '.env.local'), 'utf8')
  .split(/\r?\n/u).find((line) => line.startsWith('TCB_ENV_ID='));
const expectedEnvId = envLine?.slice('TCB_ENV_ID='.length).trim();
if (!expectedEnvId || config.envId !== expectedEnvId) throw new Error('NONPRODUCTION_ENV_MISMATCH');

function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  return JSON.parse(raw.slice(start)).data;
}

const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== expectedEnvId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_COST_PREFLIGHT_FAILED');
}
const credentials = cliData(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== expectedEnvId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID');
}
const require = createRequire(resolve(root, 'package.json'));
const sdk = require('@cloudbase/js-sdk');
const app = sdk.init({ env: expectedEnvId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const nodeSdk = require('@cloudbase/node-sdk');
const storage = nodeSdk.init({ env: expectedEnvId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const result = await app.database().collection('learning_resources').doc(resourceId).get();
const rows = Array.isArray(result?.data) ? result.data : result?.data?.list ?? [result?.data];
const resource = rows.find((row) => row?._id === resourceId);
if (!resource) throw new Error('READING_RESOURCE_NOT_FOUND');
const payload = resource.payload ?? resource;
const chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
const pageCount = chapters.reduce((total, chapter) => total + (Array.isArray(chapter.pages) ? chapter.pages.length : 0), 0);
const entry = resolve(root, '.runtime/m3-student-reading-audit/entry.cjs');
mkdirSync(dirname(entry), { recursive: true });
await build({ entryPoints: [resolve(root, 'src/seed/m3-real-sample-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(entry);
const database = api.createCloudBaseDocumentDatabase(app.database());
const service = new api.ContentQueryService(api.createOrgContentDocumentRepository(database));
const chapterId = chapters[0]?.id;
if (!chapterId) throw new Error('READING_CHAPTER_MISSING');
const actor = (userId, classId) => ({ requestId: 'm3_student_reading_audit',
  sessionId: 'server-m3-student-reading-audit', actorUserId: userId, actorRole: 'student',
  organizationId: 'org_qihang_demo', platformSubjectDigest: 'server-m3-student-reading-audit',
  permissions: ['content.read'], scopeIds: [classId], authzVersion: 1 });
const media = await Promise.all([
  service.getReadingAudioMap(actor('usr_student_g3_01', 'cls_grade3_2'), resourceId, chapterId),
  service.getReadingAudioMap(actor('usr_student_g4_01', 'cls_grade4_1'), resourceId, chapterId),
]);
if (media[0].segments.length !== media[1].segments.length) throw new Error('CROSS_CLASS_AUDIO_MISMATCH');
const catalog = await service.listStudentCatalog(actor('usr_student_g3_01', 'cls_grade3_2'),
  { type: 'reading', category: 'picture_book' }, { limit: 50, offset: 0 });
const currentItem = catalog.items.find(item => item.id === resourceId);
const oldItem = catalog.items.find(item => item.id === 'res_m3_real_sbc0008_reading_20260930');
if (currentItem?.audioPointreadReady !== true || oldItem?.audioPointreadReady !== false) {
  throw new Error('READING_CATALOG_CAPABILITY_MISMATCH');
}
let signedAudioCount = 0;
let fetchedAudioHashes = 0;
if (media[0].segments.length) {
  const evidence = JSON.parse(readFileSync('D:/app-m3-cache/student/reading-audio-candidate-2026-10-03.json', 'utf8'));
  const files = [{ key: 'full_audio', id: media[0].audioAssetKey },
    ...media[0].segments.map(segment => ({ key: `page_audio_${String(segment.pageNumber).padStart(2, '0')}`,
      id: segment.clipAudioAssetKey }))];
  if (files.length !== 9 || files.some(file => typeof file.id !== 'string' || !file.id.startsWith('cloud://'))) {
    throw new Error('AUDIO_SOURCE_ID_MISSING');
  }
  const signed = await storage.getTempFileURL({ fileList: files.map(file => ({ fileID: file.id, maxAge: 60 })) });
  const urls = new Map(signed.fileList?.map(item => [item.fileID, item]));
  for (const file of files) {
    const item = urls.get(file.id);
    if (!item?.tempFileURL?.startsWith('https://') || (item.code !== undefined && item.code !== 'SUCCESS')) {
      throw new Error('SIGNED_AUDIO_UNAVAILABLE');
    }
    signedAudioCount += 1;
  }
  for (const file of [files[0], files[1]]) {
    const response = await fetch(urls.get(file.id).tempFileURL, { redirect: 'error' });
    if (!response.ok) throw new Error('SIGNED_AUDIO_FETCH_FAILED');
    const buffer = Buffer.from(await response.arrayBuffer());
    const reference = evidence.mediaEvidence.find(item => item.key === file.key);
    if (!reference || buffer.length !== reference.bytes
      || createHash('sha256').update(buffer).digest('hex') !== reference.sha256) {
      throw new Error('SIGNED_AUDIO_HASH_MISMATCH');
    }
    fetchedAudioHashes += 1;
  }
}
process.stdout.write(JSON.stringify({
  resourceId, type: resource.type, status: resource.status,
  version: resource.version, contentVersion: resource.contentVersion,
  copyrightStatus: resource.copyrightStatus,
  classCount: resource.visibility?.classIds?.length ?? null,
  allowedStudentCount: resource.visibility?.studentIds?.length ?? resource.allowedStudentIds?.length ?? null,
  chapterCount: chapters.length, pageCount,
  chapters: chapters.map((chapter) => ({ id: chapter.id,
    pages: Array.isArray(chapter.pages) ? chapter.pages.map((page) => ({ id: page.id, number: page.pageNumber })) : [] })),
  readingAudioReviewStatus: payload.readingAudio?.reviewStatus ?? null,
  readingAudioChapterCount: payload.readingAudio?.chapters?.length ?? 0,
  pronunciationReviewStatus: payload.pronunciation?.reviewStatus ?? null,
  pronunciationSegmentCount: payload.pronunciation?.segments?.length ?? 0,
  authorizedAudioSegments: media.map(item => item.segments.length),
  catalogAudioCapability: { approvedBook: currentItem.audioPointreadReady,
    oldPageOnlyBook: oldItem.audioPointreadReady },
  signedAudioCount, fetchedAudioHashes,
}) + '\n');
stop();
await new Promise(resolve => setTimeout(resolve, 1000));
process.exit(0);
