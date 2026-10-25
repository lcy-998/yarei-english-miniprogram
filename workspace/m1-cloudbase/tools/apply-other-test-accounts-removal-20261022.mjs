// Exact nonproduction account purge: 539 virtual business users, retaining the named three.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'resume', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const folder = 'C:/Users/18167/AppData/Local/Yarei/three-demo-cleanup-backup-2026-10-22T05-41-58-168Z';
const plan = JSON.parse(readFileSync(join(folder, 'other-test-accounts-removal-plan.json'), 'utf8'));
const snapshot = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
const envId = 'cloud1-d8ggzrwwedb786e41';
if (plan.environmentId !== envId || snapshot.environmentId !== envId
  || plan.removedUserIds.length !== 539 || plan.retained.length !== 3
  || Object.values(plan.counts).reduce((sum, n) => sum + n, 0) !== 1206) {
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
  if (parsed.error) throw new Error(`CLI_FAILED:${args[0]}`);
  return parsed.data;
}
const envs = cliJson(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_GATE');
const quota = cliJson(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 180000) throw new Error('WRITE_QUOTA_GATE');
const secrets = cliJson(['secrets', 'get', '--json']);
if (secrets?.envId !== envId || secrets.isTemporary !== true
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');
const require = createRequire(join(root, 'package.json'));
const db = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: secrets.secretId, secretKey: secrets.secretKey,
  sessionToken: secrets.token }).database();
const auditId = 'audit_other_virtual_accounts_removed_20261022';
const order = ['business_sessions', 'business_session_slots', 'idempotency_records',
  'native_admin_grants', 'parent_student_links', 'org_content_guards',
  'class_memberships', 'teacher_class_grants', 'role_assignments',
  'auth_identities', 'users'];
if (Object.keys(plan.selected).some(name => !order.includes(name))) throw new Error('TABLE_ORDER_GATE');
function batches(ids) {
  const result = [];
  for (let offset = 0; offset < ids.length; offset += 20) result.push(ids.slice(offset, offset + 20));
  return result;
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function fetch(name, ids) {
  const response = await db.collection(name).where({ _id: db.command.in(ids) }).limit(20).get();
  if (!Array.isArray(response.data)) throw new Error(`CLOUD_READ_FAILED:${name}`);
  return response.data;
}
if (mode === 'apply' || mode === 'inspect' || mode === 'resume') {
  const usersCount = await db.collection('users').count();
  if (mode !== 'resume' && usersCount.total !== 542) throw new Error('USER_COLLECTION_CHANGED');
  let present = 0;
  for (const [name, ids] of Object.entries(plan.selected)) {
    for (const batch of batches(ids)) {
      const current = await fetch(name, batch);
      if (mode !== 'resume' && current.length !== batch.length) throw new Error(`SCOPE_CHANGED:${name}`);
      for (const row of current) {
        if (stable(row) !== stable(prior.get(name)?.get(row._id))) {
          throw new Error(`ROW_CHANGED:${name}:${row._id}`);
        }
      }
      present += current.length;
    }
  }
  if (mode !== 'resume' && present !== 1206) throw new Error('PREFLIGHT_INCOMPLETE');
  process.stdout.write(JSON.stringify({ stage: 'preflight', businessUsersToRemove: 539,
    recordsPresent: present, retainedUsers: plan.retained.length,
    cloudbaseAdministratorPreserved: true, quotaWrites: quota.Value }) + '\n');
}
if (mode === 'inspect') process.exit(0);
if (mode === 'apply' || mode === 'resume') {
  for (const name of order) {
    const ids = plan.selected[name] ?? [];
    let removed = 0;
    for (const batch of batches(ids)) {
      const current = await fetch(name, batch);
      if (current.length === 0) continue;
      const result = await db.collection(name).where({ _id: db.command.in(current.map(row => row._id)) }).remove();
      if (Number(result.deleted) !== current.length) throw new Error(`DELETE_COUNT_MISMATCH:${name}`);
      removed += current.length;
    }
    if (ids.length > 0) process.stdout.write(JSON.stringify({ stage: 'removed', table: name,
      planned: ids.length, removedNow: removed }) + '\n');
  }
  const currentAudit = await db.collection('operation_logs').doc(auditId).get();
  if (currentAudit.data?.length === 0) {
    await db.collection('operation_logs').add({ _id: auditId, id: auditId,
      organizationId: 'org_qihang_demo', requestId: 'other-virtual-accounts-removal-20261022',
      actorUserId: null, actorRole: null, action: 'system.otherVirtualAccountsPurged',
      targetType: 'virtual_account_batch', targetId: 'other_virtual_users_20261022',
      result: 'succeeded', errorCode: null, occurredAt: new Date().toISOString(),
      schemaVersion: 1, version: 1, deletedAt: null,
      metadata: { retainedUserIds: plan.retained, removedUserCount: 539,
        deletedDocumentCounts: plan.counts, snapshotAt: plan.snapshotAt,
        cloudbaseAdministratorAuthPreserved: true,
        publicContentPreserved: true } });
  }
}
let remaining = 0;
for (const [name, ids] of Object.entries(plan.selected)) for (const batch of batches(ids)) {
  remaining += (await fetch(name, batch)).length;
}
const allUsers = await db.collection('users').limit(20).get();
const retainedIds = new Set(plan.retained);
const accountsOkay = Array.isArray(allUsers.data) && allUsers.data.length === 3
  && allUsers.data.every(row => retainedIds.has(row._id) && row.status === 'active');
const roleCount = await db.collection('role_assignments').count();
const membershipCount = await db.collection('class_memberships').count();
const linkCount = await db.collection('parent_student_links').count();
const authIdentityCount = await db.collection('auth_identities').count();
const audit = await db.collection('operation_logs').doc(auditId).get();
if (remaining !== 0 || !accountsOkay || roleCount.total !== 3
  || membershipCount.total !== 1 || linkCount.total !== 1
  || authIdentityCount.total !== 3
  || audit.data?.[0]?.action !== 'system.otherVirtualAccountsPurged') {
  throw new Error(`FINAL_VERIFY_FAILED:${remaining}:${accountsOkay}`);
}
const auth = cliJson(['user', 'list', '-e', envId, '--offset', '0', '--limit', '100', '--json']);
const aliases = new Set(auth.map(row => row.Name));
if (auth.length !== 4 || plan.expectedAuthAliases.some(alias => !aliases.has(alias))) {
  throw new Error('PLATFORM_AUTH_ACCOUNTS_CHANGED');
}
process.stdout.write(JSON.stringify({ status: 'verified', removedBusinessUsers: 539,
  removedRelatedDocuments: 1206, retainedBusinessUsers: 3,
  retainedRoles: roleCount.total, retainedClassMemberships: membershipCount.total,
  retainedParentLinks: linkCount.total, retainedAuthIdentities: authIdentityCount.total,
  platformAdministratorPreserved: true }) + '\n');
