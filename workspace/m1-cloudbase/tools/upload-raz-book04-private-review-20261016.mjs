import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['plan', 'apply'].includes(mode)) throw new Error('USAGE: plan|apply');
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = 'G:/英语资产';
const resourceId = 'book-5b3e356188a8';
const envId = 'cloud1-d8ggzrwwedb786e41';
const cloudPrefix = `yarei-assets/internal/raz-review/20261016/${resourceId}/v1/`;
const receiptPath = join(assets,
  'library/derived/raz-decodable-book04-2026-10-16/v1/private-review-upload-v1.json');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const require = createRequire(join(backend, 'package.json'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();

function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: backend, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLI_JSON_MISSING');
  const payload = JSON.parse(raw.slice(start));
  if (payload.error) throw new Error('CLI_API_REJECTED');
  return payload.data;
}

const catalog = JSON.parse(await readFile(join(assets, 'library/catalog.json'), 'utf8'));
const book = catalog.resources.find(item => item.resourceId === resourceId);
if (book?.resourceType !== 'textbook'
  || !book.sourceRelativePath.startsWith('ZP0001-RAZ Phonics/RAZ Decodable Books/')
  || book.details?.pageCount !== 9 || book.processingStatus !== 'needs_review') {
  throw new Error('RAZ_BOOK_SCOPE_OR_STATE_INVALID');
}
const pairs = JSON.parse(await readFile(join(assets, 'reports/raz-source-audio-inventory-2026-10-15.json'), 'utf8'));
const pair = pairs.find(item => item.resourceId === resourceId);
if (pair?.audioStatus !== 'filename_pair_only' || pair.sourceSha256 !== book.sourceSha256) {
  throw new Error('AUDIO_PAIR_OR_SOURCE_INVALID');
}
const candidate = JSON.parse(await readFile(join(assets,
  'library/derived/raz-decodable-book04-2026-10-16/v1/mapping-candidate-v1.json'), 'utf8'));
if (candidate.resourceId !== resourceId || candidate.status !== 'candidate_not_listened_or_approved'
  || candidate.sourcePdfSha256 !== book.sourceSha256
  || candidate.sourceAudioSha256 !== pair.audioSha256 || candidate.pages?.length !== 6) {
  throw new Error('CANDIDATE_STATUS_OR_SOURCE_INVALID');
}

const sources = [
  { key: 'source-pdf', relativePath: pair.sourceRelativePath, cloudName: 'source/source.pdf', expectedSha: pair.sourceSha256 },
  { key: 'source-audio', relativePath: pair.audioRelativePath, cloudName: 'source/full-narration.mp3', expectedSha: pair.audioSha256 },
  { key: 'story-text', relativePath: `library/derived/raz-alignment-2026-10-15/${resourceId}/visually-checked-story-text-v1.json`, cloudName: 'review/story-text-candidate.json', expectedSha: candidate.reviewedTextSha256 },
  { key: 'mapping', relativePath: `library/derived/raz-decodable-book04-2026-10-16/v1/mapping-candidate-v1.json`, cloudName: 'review/mapping-candidate.json' },
];
for (let page = 1; page <= 9; page += 1) {
  const name = `page-${String(page).padStart(4, '0')}.jpg`;
  const reviewed = candidate.pages.find(item => item.pageNumber === page);
  sources.push({ key: `page-${page}`, relativePath: `library/books/${resourceId}/v1/pages/${name}`,
    cloudName: `pages/${name}`, expectedSha: reviewed?.imageSha256 });
  sources.push({ key: `thumbnail-${page}`, relativePath: `library/books/${resourceId}/v1/thumbnails/${name}`,
    cloudName: `thumbnails/${name}`, expectedSha: reviewed?.thumbnailSha256 });
}
for (const page of candidate.pages) {
  sources.push({ key: `page-audio-${page.pageNumber}`, relativePath: page.audioRelativePath,
    cloudName: `page-audio/page-${String(page.pageNumber).padStart(4, '0')}.mp3`, expectedSha: page.audioSha256 });
}
const files = [];
for (const source of sources) {
  const path = join(assets, ...source.relativePath.split('/'));
  const bytes = await readFile(path);
  if (!bytes.length || (source.expectedSha && sha(bytes) !== source.expectedSha.toUpperCase())) {
    throw new Error(`LOCAL_FILE_HASH_INVALID:${source.key}`);
  }
  files.push({ key: source.key, relativePath: source.relativePath, cloudPath: cloudPrefix + source.cloudName,
    bytes: bytes.length, sha256: sha(bytes) });
}
if (files.length !== 28 || new Set(files.map(file => file.cloudPath)).size !== files.length) {
  throw new Error('UPLOAD_MANIFEST_INVALID');
}

const config = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
if (config.envId !== envId) throw new Error('CONFIG_ENV_MISMATCH');
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no' || environments[0].EnableOverrun !== false
  || environments[0].UsageStatus !== 'normal') throw new Error('NONPRODUCTION_COST_GATE');
const acl = cliData(['storage', 'rules', 'get', '--json']);
if (acl?.acl !== 'PRIVATE') throw new Error('STORAGE_NOT_PRIVATE');
const existing = cliData(['storage', 'list', cloudPrefix, '--json']);
if (!Array.isArray(existing) || existing.length !== 0) throw new Error('TARGET_PREFIX_NOT_EMPTY');
const plan = { schemaVersion: 1, status: 'private_review_candidate_only', resourceId,
  environmentKind: 'existing_nonproduction_free', cloudPrefix,
  productionPublish: false, teacherDirectoryWrite: false, studentDirectoryWrite: false,
  fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
if (mode === 'plan') {
  process.stdout.write(JSON.stringify({ mode, ...plan, files: undefined }) + '\n');
  process.exit(0);
}

const temp = cliData(['secrets', 'get', '--json']);
if (temp?.isTemporary !== true || temp.envId !== envId
  || Date.parse(temp.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_CREDENTIALS_INVALID');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: temp.secretId,
  secretKey: temp.secretKey, sessionToken: temp.token });
const created = [];
try {
  for (const file of files) {
    const bytes = await readFile(join(assets, ...file.relativePath.split('/')));
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error(`LOCAL_CHANGED:${file.key}`);
    const uploaded = await app.uploadFile({ cloudPath: file.cloudPath, fileContent: bytes });
    const fileID = uploaded?.fileID;
    if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) throw new Error(`UPLOAD_FAILED:${file.key}`);
    created.push({ ...file, fileID });
    const downloaded = await app.downloadFile({ fileID });
    if (sha(Buffer.from(downloaded.fileContent)) !== file.sha256) throw new Error(`READBACK_HASH_INVALID:${file.key}`);
  }
  const receipt = { ...plan, status: 'private_review_candidate_uploaded_hash_verified',
    uploadedAt: new Date().toISOString(), files: created };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ mode, status: receipt.status, resourceId,
    fileCount: created.length, totalBytes: plan.totalBytes, hashReadback: `${created.length}/${created.length}`,
    receiptPath, teacherDirectoryWrite: false, studentDirectoryWrite: false }) + '\n');
} catch (error) {
  if (created.length) {
    const deleted = await app.deleteFile({ fileList: created.map(file => file.fileID) });
    const failures = deleted?.fileList?.filter(file => file.code !== 'SUCCESS') ?? [];
    if (failures.length) throw new Error(`ROLLBACK_INCOMPLETE:${failures.length}; ORIGINAL:${error.message}`);
  }
  throw error;
}
