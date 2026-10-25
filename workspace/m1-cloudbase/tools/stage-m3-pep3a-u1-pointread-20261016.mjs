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
const base = join(root, 'library/derived/pep3a-u1-pointread-pilot-2026-10-16/v2');
const manifestPath = join(base, 'pilot-manifest.json');
const reviewPath = join(base, 'review/approved-pointread-v1.json');
const receiptPath = join(root, 'reports/pep3a-u1-pointread-private-staging-2026-10-16.json');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: backend,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error(`CLI_API_ERROR_${args[0]}`);
  return parsed.data;
}
const config = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
if (config.envId !== envId) throw new Error('ENVIRONMENT_CHANGED');
const envs = cliData(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].EnableOverrun !== false
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') throw new Error('COST_GATE');
const acl = cliData(['storage', 'rules', 'get', '--json']);
if (acl?.acl !== 'PRIVATE') throw new Error('STORAGE_GATE');
const manifestBytes = await readFile(manifestPath);
const reviewBytes = await readFile(reviewPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const review = JSON.parse(reviewBytes.toString('utf8'));
if (manifest.segments?.length !== 6 || review.evidence.pilotManifestSha256 !== sha(manifestBytes)
  || review.decision !== 'approved_for_page4_sentence_pointread_and_follow_reading_nonproduction') {
  throw new Error('REVIEW_GATE');
}
const files = [];
for (const segment of manifest.segments) {
  const bytes = await readFile(join(root, segment.clipRelativePath));
  if (sha(bytes) !== segment.clipSha256 || bytes.length !== segment.clipBytes) {
    throw new Error(`CLIP_HASH_GATE_${segment.id}`);
  }
  files.push({ segment, bytes,
    cloudPath: `yarei-assets/pep-pointread/book-unknown-3a/v2/page-0004/${segment.id}.mp3` });
}
if (mode === 'inspect') {
  const existing = cliData(['storage', 'list', 'yarei-assets/pep-pointread/book-unknown-3a/v2/page-0004/', '--json']);
  if (Array.isArray(existing) && existing.length) throw new Error('CLOUD_PREFIX_NOT_EMPTY');
  process.stdout.write(JSON.stringify({ environment: envId, files: files.length,
    bytes: files.reduce((n, file) => n + file.bytes.length, 0), privateStorage: true }) + '\n');
  process.exit(0);
}
const token = cliData(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) < Date.now() + 60000) throw new Error('CREDENTIAL_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token });
if (mode === 'apply') {
  const existing = cliData(['storage', 'list', 'yarei-assets/pep-pointread/book-unknown-3a/v2/page-0004/', '--json']);
  if (Array.isArray(existing) && existing.length) throw new Error('CLOUD_PREFIX_NOT_EMPTY');
  const uploaded = [];
  for (const file of files) {
    const result = await app.uploadFile({ cloudPath: file.cloudPath, fileContent: file.bytes });
    if (!result?.fileID?.startsWith('cloud://')) throw new Error(`UPLOAD_GATE_${file.segment.id}`);
    uploaded.push({ id: file.segment.id, fileID: result.fileID,
      cloudPath: file.cloudPath, bytes: file.bytes.length,
      sha256: file.segment.clipSha256, durationMs: file.segment.clipDurationMs });
  }
  for (const file of uploaded) {
    const output = await app.downloadFile({ fileID: file.fileID });
    if (sha(Buffer.from(output.fileContent)) !== file.sha256) throw new Error(`READBACK_${file.id}`);
  }
  await writeFile(receiptPath, JSON.stringify({ environment: envId,
    status: 'private_staging_not_published', manifestSha256: sha(manifestBytes),
    reviewSha256: sha(reviewBytes), files: uploaded }, null, 2) + '\n', { flag: 'wx' });
}
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
if (receipt.environment !== envId || receipt.files?.length !== 6
  || receipt.manifestSha256 !== sha(manifestBytes) || receipt.reviewSha256 !== sha(reviewBytes)) {
  throw new Error('RECEIPT_GATE');
}
for (const file of receipt.files) {
  const output = await app.downloadFile({ fileID: file.fileID });
  const bytes = Buffer.from(output.fileContent);
  if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error(`VERIFY_${file.id}`);
}
process.stdout.write(JSON.stringify({ environment: envId, mode, clips: receipt.files.length,
  hashesReadBack: receipt.files.length, status: receipt.status }) + '\n');
