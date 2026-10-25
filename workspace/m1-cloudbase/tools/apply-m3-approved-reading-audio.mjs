/** Narrow nonproduction operator. `apply` requires the reviewed M3 authorization. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, stop } from 'esbuild';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify', 'rollback'].includes(mode)) {
  throw new Error('Use inspect, apply, verify, or rollback');
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const resourceId = 'res_m3_sbc0008_review_draft_20261002';
const auditId = 'audit_m3_sbc0008_reading_audio_20261003';
const rollbackAuditId = 'audit_m3_sbc0008_reading_audio_rollback_20261003';
const candidatePath = 'D:/app-m3-cache/student/reading-audio-candidate-2026-10-03.json';
const backupPath = 'D:/app-m3-cache/student/reading-audio-before-2026-10-03.json';
const expectedCandidateSha256 = '6b20f702a721f82705a431d4b8fff663485c469066a70248f80d898750d85c93';
const candidateBytes = readFileSync(candidatePath);
if (createHash('sha256').update(candidateBytes).digest('hex') !== expectedCandidateSha256) {
  throw new Error('CANDIDATE_HASH_CHANGED');
}
const candidate = JSON.parse(candidateBytes.toString('utf8'));
if (candidate.resourceId !== resourceId || candidate.expectedVersion !== 4
  || candidate.readingAudio?.reviewStatus !== 'approved'
  || candidate.readingAudio.chapters?.length !== 1
  || candidate.readingAudio.chapters[0].segments?.length !== 8
  || candidate.mediaEvidence?.length !== 9) throw new Error('CANDIDATE_SHAPE_INVALID');

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
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  return JSON.parse(raw.slice(first)).data;
}
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1 || environments[0].EnvId !== envId
  || environments[0].Status !== 'NORMAL' || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('ENVIRONMENT_OR_COST_PREFLIGHT_FAILED');
const usage = {};
for (const metric of ['StorageSizepkg', 'FunctionInvocation', 'StorageWritepkg', 'DbWritepkg']) {
  const result = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
    '--body', JSON.stringify({ EnvId: envId, MetricName: metric }), '--json']);
  if (!Number.isFinite(result?.Value)) throw new Error('QUOTA_USAGE_UNVERIFIED');
  usage[metric] = result.Value;
}
if (usage.StorageSizepkg > 2900 || usage.FunctionInvocation > 190_000
  || usage.StorageWritepkg > 190_000 || usage.DbWritepkg > 190_000) {
  throw new Error('QUOTA_MARGIN_INSUFFICIENT');
}
const details = cliData(['fn', 'detail', 'content-query', '--json']);
if (details?.Status !== 'Active' || details.Runtime !== 'Nodejs20.19'
  || details.FunctionVersion !== '$LATEST' || details.Handler !== 'index.main'
  || (details.Triggers?.length ?? 0) !== 0) throw new Error('CONTENT_QUERY_FUNCTION_DRIFT');
const credentials = cliData(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const require = createRequire(resolve(root, 'package.json'));
const sdk = require('@cloudbase/js-sdk');
const app = sdk.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const entry = resolve(root, '.runtime/m3-approved-reading-audio/entry.cjs');
mkdirSync(dirname(entry), { recursive: true });
await build({ entryPoints: [resolve(root, 'src/seed/m3-real-sample-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const { createCloudBaseDocumentDatabase } = require(entry);
const database = createCloudBaseDocumentDatabase(app.database());
const current = await database.get('learning_resources', resourceId);
const audit = await database.get('operation_logs', auditId);
const rollbackAudit = await database.get('operation_logs', rollbackAuditId);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const before = current?.version === candidate.expectedVersion && current.status === 'published'
  && current.copyrightStatus === 'verified' && current.contentVersion === 1
  && current.payload?.readingAudio === undefined && audit === null;
const after = current?.version === candidate.expectedVersion + 1
  && same(current.payload?.readingAudio, candidate.readingAudio)
  && audit?.metadata?.candidateSha256 === expectedCandidateSha256;
if (mode === 'inspect') {
  if (!before || rollbackAudit !== null) throw new Error('READING_PRECONDITION_CHANGED');
  process.stdout.write(JSON.stringify({ mode, resourceId, version: current.version,
    audioSegments: candidate.readingAudio.chapters[0].segments.length,
    cloudMediaVerified: candidate.mediaEvidence.length, functionStatus: details.Status,
    quotaUsage: usage }) + '\n');
  stop();
  await new Promise(resolve => setTimeout(resolve, 1000));
  process.exit(0);
}
if (mode === 'verify') {
  if (!after || rollbackAudit !== null) throw new Error('READING_AUDIO_VERIFY_FAILED');
  process.stdout.write(JSON.stringify({ mode, resourceId, version: current.version,
    audioSegments: current.payload.readingAudio.chapters[0].segments.length,
    audit: true }) + '\n');
  stop();
  await new Promise(resolve => setTimeout(resolve, 1000));
  process.exit(0);
}
if (mode === 'apply') {
  if (!before || rollbackAudit !== null || existsSync(backupPath)) throw new Error('READING_PRECONDITION_CHANGED');
  mkdirSync(dirname(backupPath), { recursive: true });
  writeFileSync(backupPath, JSON.stringify(current, null, 2) + '\n', { flag: 'wx' });
  const now = new Date().toISOString();
  const next = { ...current, version: current.version + 1, updatedAt: now,
    payload: { ...current.payload, readingAudio: candidate.readingAudio } };
  const log = { _id: auditId, id: auditId, organizationId: current.organizationId,
    schemaVersion: 1, version: 1, deletedAt: null, requestId: auditId,
    actorUserId: null, actorRole: null, action: 'content.testReadingAudioEnabled',
    targetType: 'learning_resources', targetId: resourceId, result: 'succeeded',
    errorCode: null, occurredAt: now,
    metadata: { candidateSha256: expectedCandidateSha256, priorVersion: current.version,
      audioSegments: candidate.readingAudio.chapters[0].segments.length } };
  await database.runTransaction(async transaction => {
    const latest = await transaction.get('learning_resources', resourceId);
    if (!latest || latest.version !== current.version || latest.payload?.readingAudio !== undefined
      || await transaction.get('operation_logs', auditId)) throw new Error('READING_VERSION_CHANGED');
    if (!await transaction.replace('learning_resources', resourceId, current.version, next)
      || !await transaction.create('operation_logs', log)) throw new Error('READING_AUDIO_TRANSACTION_FAILED');
  });
  process.stdout.write(JSON.stringify({ mode, resourceId, priorVersion: current.version,
    nextVersion: next.version, audit: true }) + '\n');
  stop();
  await new Promise(resolve => setTimeout(resolve, 1000));
  process.exit(0);
}
if (!after || rollbackAudit !== null || !existsSync(backupPath)) throw new Error('ROLLBACK_PRECONDITION_CHANGED');
const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
if (backup._id !== resourceId || backup.version !== candidate.expectedVersion
  || backup.payload?.readingAudio !== undefined) throw new Error('ROLLBACK_BACKUP_INVALID');
const now = new Date().toISOString();
const restored = { ...current, version: current.version + 1, updatedAt: now,
  payload: backup.payload };
const rollbackLog = { _id: rollbackAuditId, id: rollbackAuditId,
  organizationId: current.organizationId, schemaVersion: 1, version: 1,
  deletedAt: null, requestId: rollbackAuditId, actorUserId: null, actorRole: null,
  action: 'content.testReadingAudioRolledBack', targetType: 'learning_resources',
  targetId: resourceId, result: 'succeeded', errorCode: null, occurredAt: now,
  metadata: { candidateSha256: expectedCandidateSha256, priorVersion: current.version } };
await database.runTransaction(async transaction => {
  const latest = await transaction.get('learning_resources', resourceId);
  if (!latest || latest.version !== current.version
    || !same(latest.payload?.readingAudio, candidate.readingAudio)
    || await transaction.get('operation_logs', rollbackAuditId)) throw new Error('ROLLBACK_VERSION_CHANGED');
  if (!await transaction.replace('learning_resources', resourceId, current.version, restored)
    || !await transaction.create('operation_logs', rollbackLog)) throw new Error('ROLLBACK_TRANSACTION_FAILED');
});
process.stdout.write(JSON.stringify({ mode, resourceId, priorVersion: current.version,
  restoredVersion: restored.version, audit: true }) + '\n');
stop();
await new Promise(resolve => setTimeout(resolve, 1000));
process.exit(0);
