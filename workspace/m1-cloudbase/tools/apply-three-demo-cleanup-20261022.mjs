// Exact, resumable nonproduction purge authorized for the three virtual accounts.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mode = process.argv[2];
const folder = resolve(process.argv[3] ?? '');
if (!['inspect', 'apply', 'resume', 'verify'].includes(mode)
  || !folder.includes('three-demo-cleanup-backup-2026-10-22T')) throw new Error('ARGUMENT_INVALID');
const plan = JSON.parse(readFileSync(join(folder, 'cleanup-plan.json'), 'utf8'));
const backup = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
const mediaBackup = JSON.parse(readFileSync(join(folder, 'media-manifest.json'), 'utf8'));
const envId = 'cloud1-d8ggzrwwedb786e41';
if (plan.environmentId !== envId || backup.environmentId !== envId
  || mediaBackup.environmentId !== envId || plan.storageKeys.length !== 69
  || mediaBackup.objects.length !== plan.storageKeys.length
  || Object.values(plan.expectedCounts).reduce((sum, count) => sum + count, 0) !== 6428) {
  throw new Error('PLAN_OR_BACKUP_GATE');
}
const backupRows = new Map();
for (const [name, expected] of Object.entries(backup.collections)) {
  const bytes = readFileSync(join(folder, 'database', `${name}.json`));
  if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
    throw new Error(`BACKUP_HASH_MISMATCH:${name}`);
  }
  backupRows.set(name, new Map(JSON.parse(bytes.toString('utf8')).map(row => [row._id, row])));
}
const mediaKeys = new Set(mediaBackup.objects.map(row => row.key));
if (mediaKeys.size !== plan.storageKeys.length || plan.storageKeys.some(key => !mediaKeys.has(key))) {
  throw new Error('MEDIA_BACKUP_KEY_MISMATCH');
}
for (const row of mediaBackup.objects) {
  const bytes = readFileSync(join(folder, 'media', row.file));
  if (bytes.length !== row.bytes
    || createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
    throw new Error('MEDIA_BACKUP_HASH_MISMATCH');
  }
}
const root = resolve(import.meta.dirname, '..');
const cfg = JSON.parse(readFileSync(join(root, 'cloudbaserc.json'), 'utf8'));
const localEnv = readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (cfg.envId !== envId || localEnv !== envId) throw new Error('ENVIRONMENT_MISMATCH');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
function cliJson(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error(`CLOUD_CLI_FAILED:${args[0]}`);
  return parsed.data;
}
const envs = cliJson(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_OR_COST_GATE');
const quota = cliJson(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 180000) throw new Error('WRITE_QUOTA_GATE');
const secrets = cliJson(['secrets', 'get', '--json']);
if (secrets?.envId !== envId || secrets.isTemporary !== true
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');
const require = createRequire(join(root, 'package.json'));
const app = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: secrets.secretId, secretKey: secrets.secretKey, sessionToken: secrets.token });
const db = app.database();
const command = db.command;
const auditId = 'audit_three_demo_history_cleanup_20261022';
const order = [
  'business_sessions', 'business_session_slots', 'binding_codes', 'notification_read_states',
  'phonics_answer_operations', 'phonics_answers', 'vocabulary_attempt_operations',
  'vocabulary_attempts', 'vocabulary_progress', 'reading_page_events', 'reading_progress',
  'pronunciation_operations', 'pronunciation_recordings', 'review_voice_operations',
  'review_voice_drafts', 'student_work_operations', 'student_works',
  'task_dubbing_work_operations', 'task_dubbing_works', 'task_recording_operations',
  'task_recordings', 'task_media_operations', 'task_media_sessions',
  'teacher_ai_suggestions', 'review_feedback', 'submissions', 'task_assignments',
  'checkin_activity_operations', 'checkin_overrides', 'checkin_final_boards',
  'checkin_activities', 'class_textbook_operations', 'admin_task_activity_operations',
  'native_admin_account_operations', 'native_admin_content_operations',
  'native_admin_management_operations', 'native_admin_operations',
  'teacher_private_videos', 'learning_resources', 'tasks',
  'media_retention_jobs', 'notification_events', 'idempotency_records', 'operation_logs',
];
if (Object.keys(plan.selected).some(name => !order.includes(name))) throw new Error('UNORDERED_TABLE');
function batches(ids, size = 20) {
  const out = [];
  for (let offset = 0; offset < ids.length; offset += size) out.push(ids.slice(offset, offset + size));
  return out;
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function existingRows(name, ids) {
  const result = await db.collection(name).where({ _id: command.in(ids) }).limit(20).get();
  if (!Array.isArray(result.data)) throw new Error(`QUERY_FAILED:${name}`);
  return result.data;
}
async function verifySelectedRows({ permitMissing }) {
  let present = 0;
  for (const [name, ids] of Object.entries(plan.selected)) {
    for (const batch of batches(ids)) {
      const found = await existingRows(name, batch);
      if (!permitMissing && found.length !== batch.length) throw new Error(`SELECTED_ROWS_CHANGED:${name}`);
      for (const row of found) {
        const prior = backupRows.get(name)?.get(row._id);
        if (!prior || stable(row) !== stable(prior)) throw new Error(`SELECTED_ROW_MODIFIED:${name}`);
      }
      present += found.length;
    }
  }
  return present;
}
if (mode === 'inspect' || mode === 'apply') {
  if (await db.collection('operation_logs').doc(auditId).get().then(r => r.data?.length > 0)) {
    throw new Error('CLEANUP_AUDIT_ALREADY_EXISTS');
  }
  const present = await verifySelectedRows({ permitMissing: false });
  if (present !== 6428) throw new Error('PREFLIGHT_INCOMPLETE');
  process.stdout.write(JSON.stringify({ stage: 'preflight', documents: present,
    storageObjects: plan.storageKeys.length, quotaWrites: quota.Value }) + '\n');
  if (mode === 'inspect') process.exit(0);
} else if (mode === 'resume') {
  const present = await verifySelectedRows({ permitMissing: true });
  process.stdout.write(JSON.stringify({ stage: 'resume', documentsRemaining: present }) + '\n');
}
if (mode === 'apply' || mode === 'resume') {
  for (const name of order) {
    const ids = plan.selected[name] ?? [];
    let removed = 0;
    for (const batch of batches(ids)) {
      const found = await existingRows(name, batch);
      if (found.length === 0) continue;
      if (found.some(row => !backupRows.get(name)?.has(row._id))) {
        throw new Error(`UNPLANNED_ROW:${name}`);
      }
      const result = await db.collection(name).where({ _id: command.in(found.map(row => row._id)) }).remove();
      if (Number(result.deleted) !== found.length) throw new Error(`DELETE_COUNT_MISMATCH:${name}`);
      removed += found.length;
    }
    if (ids.length > 0) process.stdout.write(JSON.stringify({ stage: 'database', table: name,
      planned: ids.length, removedNow: removed }) + '\n');
  }
  const bucket = `${envId}.636c-${envId}-1486593797`;
  const listed = cliJson(['storage', 'list', '--json']);
  const presentKeys = new Set(listed.map(row => row.key));
  const remainingKeys = plan.storageKeys.filter(key => presentKeys.has(key));
  for (const batch of batches(remainingKeys, 10)) {
    const fileList = batch.map(key => `cloud://${bucket}/${key}`);
    const result = await app.deleteFile({ fileList });
    if (!Array.isArray(result.fileList) || result.fileList.length !== batch.length
      || result.fileList.some(row => row.code !== 'SUCCESS')) throw new Error('STORAGE_DELETE_FAILED');
    process.stdout.write(JSON.stringify({ stage: 'storage', removedNow: batch.length }) + '\n');
  }
  const existingAudit = await db.collection('operation_logs').doc(auditId).get();
  if (existingAudit.data?.length === 0) {
    const now = new Date().toISOString();
    const audit = { _id: auditId, id: auditId, organizationId: 'org_qihang_demo',
      requestId: 'three-demo-history-cleanup-20261022', actorUserId: null, actorRole: null,
      action: 'system.virtualAccountHistoryPurged', targetType: 'virtual_test_accounts',
      targetId: 'three_demo_accounts_20261022', result: 'succeeded', errorCode: null,
      occurredAt: now, schemaVersion: 1, version: 1, deletedAt: null,
      metadata: { accountIds: plan.accountIds, snapshotAt: plan.snapshotAt,
        deletedDocumentCounts: plan.expectedCounts, storageObjects: plan.storageKeys.length,
        storageBytes: plan.storageBytes, preserved: plan.protectedTables,
        localBackupManifestSha256: createHash('sha256').update(readFileSync(join(folder, 'manifest.json')))
          .digest('hex') } };
    const created = await db.collection('operation_logs').add(audit);
    if (!created.id) throw new Error('CLEANUP_AUDIT_CREATE_FAILED');
  }
}
// Final readback, also valid as a standalone verify run.
let remaining = 0;
for (const [name, ids] of Object.entries(plan.selected)) {
  for (const batch of batches(ids)) remaining += (await existingRows(name, batch)).length;
}
const storageAfter = cliJson(['storage', 'list', '--json']);
const cloudKeys = new Set(storageAfter.map(row => row.key));
const remainingMedia = plan.storageKeys.filter(key => cloudKeys.has(key));
const users = await Promise.all(plan.accountIds.map(id => db.collection('users').doc(id).get()));
const auditResult = await db.collection('operation_logs').doc(auditId).get();
const protectedAccounts = users.every(result => result.data?.[0]?.status === 'active');
if (remaining !== 0 || remainingMedia.length !== 0 || !protectedAccounts
  || auditResult.data?.[0]?.action !== 'system.virtualAccountHistoryPurged') {
  throw new Error(`FINAL_VERIFY_FAILED:${remaining}:${remainingMedia.length}:${protectedAccounts}`);
}
process.stdout.write(JSON.stringify({ status: 'verified', deletedDocuments: 6428,
  deletedStorageObjects: plan.storageKeys.length, retainedAccounts: plan.accountIds.length,
  cleanupAudit: auditId }) + '\n');
