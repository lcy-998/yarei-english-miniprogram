import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(backend, 'package.json'));
const envId = 'cloud1-d8ggzrwwedb786e41';
const root = 'G:/英语资产';
const manifestPath = join(root, 'library/derived/pep-current-chapter-narration-2026-10-15/v2/narration-manifest.json');
const receiptPath = join(root, 'reports/pep-chapter-audio-private-staging-2026-10-15.json');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: backend, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error(`CLOUD_API_ERROR_${args[0]}`);
  return parsed.data;
}
const config = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
if (config.envId !== envId) throw new Error('ENVIRONMENT_CHANGED');
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('COST_GATE');
const acl = cliData(['storage', 'rules', 'get', '--json']);
if (acl?.acl !== 'PRIVATE') throw new Error('STORAGE_NOT_PRIVATE');
const quota = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'StorageSizepkg' }), '--json']);
if (!Number.isFinite(quota?.Value)) throw new Error('STORAGE_QUOTA_UNKNOWN');
const temporary = cliData(['secrets', 'get', '--json']);
if (temporary?.isTemporary !== true || temporary.envId !== envId
  || Date.parse(temporary.expiredAt) < Date.now() + 60000) throw new Error('TEMPORARY_CREDENTIAL_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: temporary.secretId,
  secretKey: temporary.secretKey, sessionToken: temporary.token });
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.chapters?.length !== 39 || manifest.status !== 'publisher_speech_candidate_pending_content_and_page_review') {
  throw new Error('SOURCE_MANIFEST_GATE');
}
const files = [];
let totalBytes = 0;
for (const chapter of manifest.chapters) {
  const path = join(root, chapter.audioPath);
  const bytes = await readFile(path);
  if (sha(bytes) !== chapter.audioSha256 || bytes.length !== chapter.audioBytes) {
    throw new Error(`LOCAL_HASH_GATE_${chapter.chapterId}`);
  }
  const cloudPath = `yarei-assets/staging/pep-chapter-narration-20261015/${chapter.bookId}/${chapter.chapterId}.mp3`;
  files.push({ chapter, cloudPath, bytes });
  totalBytes += bytes.length;
}
if (totalBytes > 80 * 1024 * 1024) throw new Error('MEDIA_BUDGET_GATE');
if (mode === 'inspect') {
  const existing = cliData(['storage', 'list', 'yarei-assets/staging/pep-chapter-narration-20261015/', '--json']);
  if (Array.isArray(existing) && existing.length) throw new Error('STAGING_PREFIX_NOT_EMPTY');
  process.stdout.write(JSON.stringify({ environment: envId, mode, files: files.length,
    totalBytes, storageUsage: quota.Value, privateStorage: true, overrunBilling: false }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  const existing = cliData(['storage', 'list', 'yarei-assets/staging/pep-chapter-narration-20261015/', '--json']);
  if (Array.isArray(existing) && existing.length) throw new Error('STAGING_PREFIX_NOT_EMPTY');
  const uploaded = [];
  for (const file of files) {
    const result = await app.uploadFile({ cloudPath: file.cloudPath, fileContent: file.bytes });
    if (!result?.fileID?.startsWith('cloud://')) throw new Error(`UPLOAD_FAILED_${file.chapter.chapterId}`);
    uploaded.push({ bookId: file.chapter.bookId, chapterId: file.chapter.chapterId,
      fileID: result.fileID, cloudPath: file.cloudPath, sha256: file.chapter.audioSha256,
      bytes: file.bytes.length, durationMs: file.chapter.durationMs });
  }
  for (const file of uploaded) {
    const output = await app.downloadFile({ fileID: file.fileID });
    const bytes = Buffer.from(output.fileContent);
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) {
      throw new Error(`CLOUD_READBACK_FAILED_${file.chapterId}`);
    }
  }
  await writeFile(receiptPath, JSON.stringify({ environment: envId, nonproduction: true,
    status: 'private_staging_only_not_published', manifestSha256: sha(manifestBytes),
    uploadedAt: new Date().toISOString(), fileCount: uploaded.length,
    totalBytes, files: uploaded }, null, 2) + '\n', { flag: 'wx' });
}
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
if (receipt.manifestSha256 !== sha(manifestBytes) || receipt.fileCount !== files.length) {
  throw new Error('RECEIPT_GATE');
}
for (const row of receipt.files) {
  const output = await app.downloadFile({ fileID: row.fileID });
  const bytes = Buffer.from(output.fileContent);
  if (bytes.length !== row.bytes || sha(bytes) !== row.sha256) throw new Error(`VERIFY_HASH_${row.chapterId}`);
}
process.stdout.write(JSON.stringify({ environment: envId, mode, files: receipt.fileCount,
  totalBytes: receipt.totalBytes, hashesReadBack: receipt.files.length,
  status: receipt.status }) + '\n');
