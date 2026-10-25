/** Read-only cloud/source audit. Writes a local candidate, never updates CloudBase. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(root, '..', '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const resourceId = 'res_m3_sbc0008_review_draft_20261002';
const approvedPath = 'F:/英语资产/library/books/book-sbc-en-0008/v1/review/approved-content-v1.json';
const manifestPath = resolve(appRoot, 'workspace/m3-real-samples/2026-10-02-minimum-asset-package/manifest.json');
const outputPath = 'D:/app-m3-cache/student/reading-audio-candidate-2026-10-03.json';
if (existsSync(outputPath)) throw new Error('READING_CANDIDATE_ALREADY_EXISTS');
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envLine = readFileSync(resolve(root, '.env.local'), 'utf8')
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice('TCB_ENV_ID='.length).trim();
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
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
if (!Array.isArray(environments) || environments.length !== 1 || environments[0].EnvId !== envId
  || environments[0].Status !== 'NORMAL' || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('ENVIRONMENT_OR_COST_PREFLIGHT_FAILED');
const credentials = cliData(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const require = createRequire(resolve(root, 'package.json'));
const jsSdk = require('@cloudbase/js-sdk');
const nodeSdk = require('@cloudbase/node-sdk');
const { parseBuffer } = await import('music-metadata');
const app = jsSdk.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const storage = nodeSdk.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const found = await app.database().collection('learning_resources').doc(resourceId).get();
const rows = Array.isArray(found?.data) ? found.data : found?.data?.list ?? [found?.data];
const resource = rows.find(row => row?._id === resourceId);
const payload = resource?.payload;
if (!resource || resource.type !== 'reading' || resource.status !== 'published'
  || resource.copyrightStatus !== 'verified' || resource.version !== 4
  || resource.contentVersion !== 1 || !payload || payload.readingAudio !== undefined
  || !Array.isArray(payload.chapters) || payload.chapters.length !== 1) {
  throw new Error('READING_RESOURCE_DRIFT');
}
const approvedBytes = readFileSync(approvedPath);
const approved = JSON.parse(approvedBytes.toString('utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sourceChecks = {
  approved: approved.decision === 'approved', resource: approved.resourceId === 'book-sbc-en-0008',
  version: approved.sourceVersion === 1 && approved.reviewRevision === 1,
  copyright: approved.copyrightStatus === 'verified',
  chapter: approved.reading.chapters.length === 1
    && approved.reading.chapters[0].id === payload.chapters[0].id,
  cloudSource: approved.sourceSha256.toLowerCase() === String(payload.sourceSha256).toLowerCase(),
  manifestResource: manifest.bookResourceId === approved.resourceId,
  manifestSource: manifest.sourceSha256.toLowerCase() === approved.sourceSha256.toLowerCase(),
};
const failedSourceChecks = Object.entries(sourceChecks).filter(([, passed]) => !passed).map(([name]) => name);
if (failedSourceChecks.length) throw new Error(`APPROVED_SOURCE_MISMATCH:${failedSourceChecks.join(',')}`);
const manifestFiles = new Map(manifest.files.map(file => [file.key, file]));
const mediaEvidence = [];
async function verifiedDuration(fileID, key) {
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) throw new Error('CLOUD_AUDIO_ID_MISSING');
  const file = manifestFiles.get(key);
  if (!file || !/^[a-f0-9]{64}$/i.test(file.sha256)) throw new Error('AUDIO_MANIFEST_MISSING');
  const downloaded = await storage.downloadFile({ fileID });
  const content = downloaded.fileContent;
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content ?? '');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  if (buffer.length !== file.bytes || sha256 !== file.sha256.toLowerCase()) throw new Error('CLOUD_AUDIO_HASH_MISMATCH');
  const metadata = await parseBuffer(buffer, { mimeType: 'audio/mpeg', size: buffer.length },
    { duration: true, skipCovers: true });
  const durationMs = Math.floor((metadata.format.duration ?? 0) * 1000);
  if (metadata.format.container !== 'MPEG' || !Number.isSafeInteger(durationMs) || durationMs < 1000) {
    throw new Error('CLOUD_AUDIO_DURATION_INVALID');
  }
  mediaEvidence.push({ key, sha256, bytes: buffer.length, durationMs });
  return durationMs;
}
const chapter = payload.chapters[0];
const durationMs = await verifiedDuration(payload.chapterAudioFileId, 'full_audio');
const pages = new Map(chapter.pages.map(page => [page.id, page]));
const segments = [];
for (const approvedPage of approved.reading.pages) {
  const page = pages.get(approvedPage.id);
  if (!page || page.pageNumber !== approvedPage.pageNumber) throw new Error('PAGE_VERSION_MISMATCH');
  if (approvedPage.role !== 'content') continue;
  const key = `page_audio_${String(approvedPage.pageNumber).padStart(2, '0')}`;
  const clipDurationMs = await verifiedDuration(page.audioFileId, key);
  if (!Array.isArray(approvedPage.sentenceMappings)
    || approvedPage.sentenceMappings.length !== 1 || approvedPage.sentenceMappings[0].hitAreas.length !== 1
    || !Array.isArray(page.sentenceMappings) || page.sentenceMappings.length !== 1) {
    throw new Error('REVIEWED_SENTENCE_SHAPE_UNSUPPORTED');
  }
  const source = approvedPage.sentenceMappings[0];
  const cloud = page.sentenceMappings[0];
  if (cloud.text !== source.text || cloud.startMs !== source.startMs || cloud.endMs !== source.endMs
    || JSON.stringify(cloud.hitAreas) !== JSON.stringify(source.hitAreas)
    || cloud.audioFileId !== page.audioFileId || source.endMs > clipDurationMs) {
    throw new Error('REVIEWED_SENTENCE_MISMATCH');
  }
  segments.push({ id: `sentence_${String(approvedPage.pageNumber).padStart(2, '0')}_01`,
    pageId: page.id, pageNumber: page.pageNumber, text: source.text,
    rect: source.hitAreas[0], startMs: source.startMs, endMs: source.endMs,
    clipAudioAssetKey: page.audioFileId, clipDurationMs });
}
if (segments.length !== 8) throw new Error('REVIEWED_SENTENCE_COUNT_MISMATCH');
const candidate = { resourceId, expectedVersion: resource.version,
  approvedSourceSha256: createHash('sha256').update(approvedBytes).digest('hex'),
  sourceSha256: approved.sourceSha256.toLowerCase(),
  readingAudio: { reviewStatus: 'approved', sourceVersion: String(resource.contentVersion),
    approvedAt: approved.reviewedAt, approvedBy: approved.reviewerId,
    chapters: [{ chapterId: chapter.id, audioAssetKey: payload.chapterAudioFileId,
      durationMs, segments }] }, mediaEvidence };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ resourceId, expectedVersion: resource.version,
  chapterCount: 1, segments: segments.length, mediaFiles: mediaEvidence.length,
  audioBytes: mediaEvidence.reduce((sum, file) => sum + file.bytes, 0),
  candidateSha256: createHash('sha256').update(readFileSync(outputPath)).digest('hex') }) + '\n');
process.exit(0);
