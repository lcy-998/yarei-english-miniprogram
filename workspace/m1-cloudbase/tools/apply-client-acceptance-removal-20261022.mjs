// Remove only the eight named acceptance tasks and the named seven-day activity.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const folder = 'C:/Users/18167/AppData/Local/Yarei/three-demo-cleanup-backup-2026-10-22T05-20-27-321Z';
const plan = JSON.parse(readFileSync(join(folder, 'acceptance-removal-plan.json'), 'utf8'));
const snapshot = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
const envId = 'cloud1-d8ggzrwwedb786e41';
if (plan.environmentId !== envId || snapshot.environmentId !== envId
  || plan.taskIds.length !== 8 || plan.mediaKeys.length !== 0
  || Object.values(plan.counts).reduce((sum, n) => sum + n, 0) !== 58) {
  throw new Error('PLAN_GATE');
}
const prior = new Map();
for (const [name, entry] of Object.entries(snapshot.collections)) {
  const bytes = readFileSync(join(folder, 'database', `${name}.json`));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error(`BACKUP_HASH_MISMATCH:${name}`);
  }
  prior.set(name, new Map(JSON.parse(bytes.toString('utf8')).map(row => [row._id, row])));
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
  if (parsed.error) throw new Error('CLI_FAILED');
  return parsed.data;
}
const envs = cliJson(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].EnableOverrun !== false
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_GATE');
const quota = cliJson(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 180000) throw new Error('QUOTA_GATE');
const secrets = cliJson(['secrets', 'get', '--json']);
if (secrets?.envId !== envId || secrets.isTemporary !== true
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');
const require = createRequire(join(root, 'package.json'));
const db = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: secrets.secretId, secretKey: secrets.secretKey,
  sessionToken: secrets.token }).database();
const auditId = 'audit_client_acceptance_fixtures_removed_20261022';
const order = ['task_media_operations', 'task_media_sessions', 'review_feedback',
  'submissions', 'task_assignments', 'checkin_activity_operations',
  'checkin_activities', 'idempotency_records', 'operation_logs', 'tasks'];
if (Object.keys(plan.selected).some(name => !order.includes(name))) throw new Error('TABLE_ORDER_GATE');
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function fetch(name, ids) {
  const result = await db.collection(name).where({ _id: db.command.in(ids) }).limit(20).get();
  if (!Array.isArray(result.data)) throw new Error(`CLOUD_READ_FAILED:${name}`);
  return result.data;
}
if (mode !== 'verify') {
  for (const [name, ids] of Object.entries(plan.selected)) {
    const current = await fetch(name, ids);
    if (current.length !== ids.length || current.some(row =>
      stable(row) !== stable(prior.get(name)?.get(row._id)))) {
      throw new Error(`SCOPE_CHANGED:${name}`);
    }
  }
  process.stdout.write(JSON.stringify({ stage: 'preflight', tasks: plan.taskIds.length,
    activity: plan.activityId, relatedRecords: 58, mediaObjects: 0, quotaWrites: quota.Value }) + '\n');
}
if (mode === 'inspect') process.exit(0);
if (mode === 'apply') {
  for (const name of order) {
    const ids = plan.selected[name] ?? [];
    if (ids.length === 0) continue;
    const result = await db.collection(name).where({ _id: db.command.in(ids) }).remove();
    if (Number(result.deleted) !== ids.length) throw new Error(`DELETE_COUNT_MISMATCH:${name}`);
    process.stdout.write(JSON.stringify({ stage: 'deleted', table: name, count: ids.length }) + '\n');
  }
  const now = new Date().toISOString();
  await db.collection('operation_logs').add({ _id: auditId, id: auditId,
    organizationId: 'org_qihang_demo', requestId: 'client-acceptance-fixtures-removal-20261022',
    actorUserId: null, actorRole: null, action: 'system.acceptanceFixturesPurged',
    targetType: 'acceptance_fixture_batch', targetId: 'client_accept_20261022',
    result: 'succeeded', errorCode: null, occurredAt: now, schemaVersion: 1,
    version: 1, deletedAt: null,
    metadata: { taskIds: plan.taskIds, activityId: plan.activityId,
      deletedDocumentCounts: plan.counts, mediaObjectsDeleted: 0,
      snapshotAt: plan.snapshotAt } });
}
let remaining = 0;
for (const [name, ids] of Object.entries(plan.selected)) remaining += (await fetch(name, ids)).length;
const users = await Promise.all(['usr_student_g3_01', 'usr_teacher_demo_01', 'usr_parent_demo_01']
  .map(id => db.collection('users').doc(id).get()));
const firstCleanup = await db.collection('operation_logs')
  .doc('audit_three_demo_history_cleanup_20261022').get();
const audit = await db.collection('operation_logs').doc(auditId).get();
if (remaining !== 0 || users.some(row => row.data?.[0]?.status !== 'active')
  || firstCleanup.data?.[0]?.action !== 'system.virtualAccountHistoryPurged'
  || audit.data?.[0]?.action !== 'system.acceptanceFixturesPurged') {
  throw new Error(`FINAL_VERIFY_FAILED:${remaining}`);
}
process.stdout.write(JSON.stringify({ status: 'verified', removedTasks: 8,
  removedActivity: 1, removedRelatedDocuments: 58,
  retainedDemoAccounts: 3, retainedPriorCleanupAudit: true }) + '\n');
