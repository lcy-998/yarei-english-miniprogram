// Exact follow-up purge for pre-cleanup system audits targeting the virtual accounts.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const folder = 'C:/Users/18167/AppData/Local/Yarei/three-demo-cleanup-backup-2026-10-22T03-12-37-348Z';
const readRows = name => JSON.parse(readFileSync(join(folder, 'database', `${name}.json`), 'utf8'));
const ids = new Set(['usr_student_g3_01', 'usr_teacher_demo_01', 'usr_parent_demo_01']);
const cutoff = Date.parse('2026-10-22T02:42:12.511Z');
const oldLogs = readRows('operation_logs').filter(row => {
  const at = Date.parse(row.occurredAt ?? '');
  if (!Number.isFinite(at) || at >= cutoff) return false;
  const meta = row.metadata ?? {};
  return ids.has(row.actorUserId) || ids.has(row.targetId)
    || ['teacherId', 'studentId', 'parentId', 'userId'].some(key => ids.has(meta[key]));
});
const oldLinks = readRows('parent_student_links').filter(row =>
  row.parentId === 'usr_parent_demo_01' && row.status === 'revoked');
if (oldLogs.length !== 19 || oldLinks.length !== 4) throw new Error('SNAPSHOT_SCOPE_GATE');
const root = resolve(import.meta.dirname, '..');
const envId = 'cloud1-d8ggzrwwedb786e41';
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
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') throw new Error('ENV_OR_COST_GATE');
const secrets = cliJson(['secrets', 'get', '--json']);
if (secrets?.envId !== envId || secrets.isTemporary !== true
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');
const require = createRequire(join(root, 'package.json'));
const db = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: secrets.secretId, secretKey: secrets.secretKey,
  sessionToken: secrets.token }).database();
const auditId = 'audit_three_demo_residual_history_cleanup_20261022';
async function currentRows(name, rows) {
  const result = await db.collection(name).where({ _id: db.command.in(rows.map(row => row._id)) })
    .limit(20).get();
  if (!Array.isArray(result.data)) throw new Error('CLOUD_READ_FAILED');
  return result.data;
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
if (mode !== 'verify') {
  for (const [name, expected] of [['operation_logs', oldLogs], ['parent_student_links', oldLinks]]) {
    const actual = await currentRows(name, expected);
    if (actual.length !== expected.length || actual.some(row =>
      !same(row, expected.find(item => item._id === row._id)))) throw new Error(`CURRENT_SCOPE_CHANGED:${name}`);
  }
  process.stdout.write(JSON.stringify({ stage: 'preflight', oldSystemAudits: oldLogs.length,
    revokedParentLinks: oldLinks.length }) + '\n');
}
if (mode === 'inspect') process.exit(0);
if (mode === 'apply') {
  const deletedLogs = await db.collection('operation_logs').where({
    _id: db.command.in(oldLogs.map(row => row._id)),
  }).remove();
  const deletedLinks = await db.collection('parent_student_links').where({
    _id: db.command.in(oldLinks.map(row => row._id)),
  }).remove();
  if (Number(deletedLogs.deleted) !== 19 || Number(deletedLinks.deleted) !== 4) {
    throw new Error('DELETE_COUNT_MISMATCH');
  }
  const audit = { _id: auditId, id: auditId, organizationId: 'org_qihang_demo',
    requestId: 'three-demo-residual-history-cleanup-20261022',
    actorUserId: null, actorRole: null, action: 'system.virtualAccountResidualHistoryPurged',
    targetType: 'virtual_test_accounts', targetId: 'three_demo_accounts_20261022',
    result: 'succeeded', errorCode: null, occurredAt: new Date().toISOString(),
    schemaVersion: 1, version: 1, deletedAt: null,
    metadata: { preCleanupCutoff: new Date(cutoff).toISOString(),
      systemAuditCount: 19, revokedParentLinkCount: 4,
      snapshotAt: '2026-10-22T03:12:37.348Z', preservedCurrentRelationships: true } };
  await db.collection('operation_logs').add(audit);
}
const remainingLogs = await currentRows('operation_logs', oldLogs);
const remainingLinks = await currentRows('parent_student_links', oldLinks);
const activeLink = await db.collection('parent_student_links').where({
  organizationId: 'org_qihang_demo', parentId: 'usr_parent_demo_01',
  studentId: 'usr_student_g3_01', status: 'active', deletedAt: null,
}).limit(5).get();
const auditResult = await db.collection('operation_logs').doc(auditId).get();
if (remainingLogs.length !== 0 || remainingLinks.length !== 0
  || activeLink.data?.length !== 1 || auditResult.data?.[0]?.action
    !== 'system.virtualAccountResidualHistoryPurged') throw new Error('VERIFY_FAILED');
process.stdout.write(JSON.stringify({ status: 'verified', removedOldSystemAudits: 19,
  removedRevokedLinks: 4, activePrimaryLinkPreserved: true }) + '\n');
