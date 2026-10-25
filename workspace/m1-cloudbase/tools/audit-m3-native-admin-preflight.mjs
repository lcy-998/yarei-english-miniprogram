import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
if (typeof config.envId !== 'string' || !config.envId) throw new Error('Environment not configured');

function runCli(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLI did not return JSON');
  return JSON.parse(raw.slice(first));
}

const expectedNames = ['native-admin-query', 'native-admin-command',
  'native-admin-management-command', 'native-admin-operations-command',
  'native-admin-media-command'];
const functionRows = runCli(['fn', 'list', '--limit', '100', '--offset', '0', '--json']).data?.Functions;
if (!Array.isArray(functionRows)) throw new Error('Cloud function list unavailable');
for (const name of expectedNames) {
  const row = functionRows.find(item => item.FunctionName === name);
  process.stdout.write(JSON.stringify({ kind: 'function', name,
    status: row?.Status ?? 'not-deployed', runtime: row?.Runtime ?? null }) + '\n');
}

const environments = runCli(['env', 'list', '--json']).data;
process.stdout.write(JSON.stringify({ kind: 'environment', count: Array.isArray(environments) ? environments.length : null,
  status: Array.isArray(environments) && environments.length === 1 ? environments[0].Status ?? null : null,
  packageName: Array.isArray(environments) && environments.length === 1 ? environments[0].PackageName ?? null : null,
  overrunEnabled: Array.isArray(environments) && environments.length === 1 ? environments[0].EnableOverrun ?? null : null,
  paid: Array.isArray(environments) && environments.length === 1 ? environments[0].EnvPaid ?? null : null,
  charged: Array.isArray(environments) && environments.length === 1 ? environments[0].EnvCharged ?? null : null }) + '\n');
const credentials = runCli(['secrets', 'get', '--json']).data;
process.stdout.write(JSON.stringify({ kind: 'credentials', temporary: credentials?.isTemporary === true,
  expiresInSeconds: Number.isFinite(Date.parse(credentials?.expiredAt))
    ? Math.floor((Date.parse(credentials.expiredAt) - Date.now()) / 1000) : null }) + '\n');
if (credentials?.isTemporary === true && credentials.envId === config.envId
  && Date.parse(credentials.expiredAt) > Date.now() + 60_000) {
  const require = createRequire(resolve(root, 'package.json'));
  const cloudbase = require('@cloudbase/node-sdk');
  const database = cloudbase.init({ env: config.envId, secretId: credentials.secretId,
    secretKey: credentials.secretKey, sessionToken: credentials.token }).database();
  for (const name of ['native_admin_grants', 'native_admin_operations',
    'native_admin_management_operations', 'native_admin_content_operations',
    'teacher_media_records', 'teacher_media_operations']) {
    try {
      const response = await database.collection(name).limit(1).get();
      const rows = Array.isArray(response.data) ? response.data : [];
      process.stdout.write(JSON.stringify({ kind: 'collection', name,
        readable: true, returnedAtMostOne: rows.length <= 1 }) + '\n');
    } catch (error) {
      const candidate = typeof error?.code === 'string' || typeof error?.code === 'number'
        ? String(error.code) : 'UNAVAILABLE';
      const code = /^[A-Za-z0-9_-]{1,40}$/.test(candidate) ? candidate : 'UNAVAILABLE';
      process.stdout.write(JSON.stringify({ kind: 'collection', name, readable: false, code }) + '\n');
    }
  }
  for (const [label, userId, roleId] of [
    ['adminActor', 'usr_admin_demo_01', 'rol_admin_demo_01'],
    ['teacherTarget', 'usr_teacher_demo_01', 'rol_teacher_demo_01'],
  ]) {
    const [userResult, roleResult] = await Promise.all([
      database.collection('users').doc(userId).get(),
      database.collection('role_assignments').doc(roleId).get(),
    ]);
    const userRows = Array.isArray(userResult.data) ? userResult.data : [userResult.data];
    const roleRows = Array.isArray(roleResult.data) ? roleResult.data : [roleResult.data];
    const user = userRows.find(row => row?._id === userId);
    const role = roleRows.find(row => row?._id === roleId);
    process.stdout.write(JSON.stringify({ kind: 'fixture', label,
      userPresent: Boolean(user), userStatus: user?.status ?? null,
      userVersion: user?.version ?? null, authzVersion: user?.authorizationVersion ?? null,
      rolePresent: Boolean(role), roleVersion: role?.version ?? null,
      organizationIdMatches: user?.organizationId === 'org_qihang_demo'
        && role?.organizationId === 'org_qihang_demo',
      roleName: role?.role ?? null, roleStatus: role?.status ?? null,
      permissions: Array.isArray(role?.permissions) ? role.permissions.filter(value => typeof value === 'string').sort() : [],
      scopeType: role?.scopeType ?? null, scopeCount: Array.isArray(role?.scopeIds) ? role.scopeIds.length : null,
      includesOrganizationScope: Array.isArray(role?.scopeIds) && role.scopeIds.includes('org_qihang_demo') }) + '\n');
  }
  const organizationId = 'org_qihang_demo';
  const adminId = 'usr_admin_demo_01';
  const teacherId = 'usr_teacher_demo_01';
  const grantId = `native_admin_${createHash('sha256')
    .update(JSON.stringify([organizationId, teacherId])).digest('hex').slice(0, 40)}`;
  const receiptId = `native_admin_op_${createHash('sha256')
    .update(JSON.stringify([organizationId, adminId, 'm3_native_admin_teacher_grant_20261006']))
    .digest('hex').slice(0, 40)}`;
  const [grantResult, receiptResult, bootstrapAuditResult, serviceAuditResult] = await Promise.all([
    database.collection('native_admin_grants').doc(grantId).get(),
    database.collection('native_admin_operations').doc(receiptId).get(),
    database.collection('operation_logs').doc('audit:org_qihang_demo:m3_native_admin_admin_permissions_20261006').get(),
    database.collection('operation_logs').where({ organizationId, action: 'native_admin.granted',
      targetId: teacherId, result: 'succeeded' }).limit(10).get(),
  ]);
  const getRow = (response, id) => Array.isArray(response?.data)
    ? response.data.find(row => row?._id === id) ?? null : response?.data ?? null;
  const grant = getRow(grantResult, grantId);
  const receipt = getRow(receiptResult, receiptId);
  const bootstrapAudit = getRow(bootstrapAuditResult,
    'audit:org_qihang_demo:m3_native_admin_admin_permissions_20261006');
  const serviceAudits = Array.isArray(serviceAuditResult?.data) ? serviceAuditResult.data : [];
  const expectedPermissions = ['dashboard.read', 'organization.manage', 'user.manage',
    'authorization.manage', 'textbook.manage', 'question.manage', 'task.manage', 'media.review',
    'student_work.restore'];
  process.stdout.write(JSON.stringify({ kind: 'nativeAdminGrant',
    grantActive: grant?.status === 'active', grantOrganizationWide: grant?.scope?.organizationWide === true,
    permissionCount: Array.isArray(grant?.permissions) ? grant.permissions.length : null,
    allExpectedPermissions: Array.isArray(grant?.permissions)
      && expectedPermissions.every(permission => grant.permissions.includes(permission)),
    grantVersion: grant?.version ?? null, operationReceiptPresent: Boolean(receipt),
    adminBootstrapAuditPresent: bootstrapAudit?.action === 'native_admin.admin_capabilities_prepared',
    teacherGrantAuditCount: serviceAudits.length }) + '\n');
}

const now = new Date();
const today = now.toISOString().slice(0, 10);
const firstDay = `${today.slice(0, 7)}-01`;
for (const [metric, body] of [
  ['credits', { EnvId: config.envId, StartDate: firstDay, EndDate: today }],
  ['FunctionInvocation', { EnvId: config.envId, MetricName: 'FunctionInvocation',
    StartTime: `${firstDay} 00:00:00`, EndTime: `${today} 23:59:59` }],
  ['FunctionGBs', { EnvId: config.envId, MetricName: 'FunctionGBs',
    StartTime: `${firstDay} 00:00:00`, EndTime: `${today} 23:59:59` }],
  ['DbReadpkg', { EnvId: config.envId, MetricName: 'DbReadpkg' }],
  ['DbWritepkg', { EnvId: config.envId, MetricName: 'DbWritepkg' }],
  ['DbSizepkg', { EnvId: config.envId, MetricName: 'DbSizepkg' }],
  ['StorageSizepkg', { EnvId: config.envId, MetricName: 'StorageSizepkg' }],
]) {
  const action = metric === 'credits' ? 'DescribeCreditsUsage'
    : metric === 'FunctionInvocation' || metric === 'FunctionGBs' ? 'DescribeCurveData' : 'DescribeQuotaData';
  try {
    const data = runCli(['api', 'tcb', action, '--body', JSON.stringify(body), '--json']).data ?? {};
    if (metric === 'credits') {
      process.stdout.write(JSON.stringify({ kind: 'usage', metric,
        reportValue: typeof data.ReportValue === 'number' ? data.ReportValue : null }) + '\n');
    } else if (action === 'DescribeCurveData') {
      const values = Array.isArray(data.NewValues) ? data.NewValues : data.Values;
      process.stdout.write(JSON.stringify({ kind: 'usage', metric,
        pointCount: Array.isArray(values) ? values.length : null,
        total: Array.isArray(values) && values.every(value => typeof value === 'number')
          ? values.reduce((sum, value) => sum + value, 0) : null }) + '\n');
    } else {
      process.stdout.write(JSON.stringify({ kind: 'quota', metric,
        value: typeof data.Value === 'number' ? data.Value : null,
        subValue: typeof data.SubValue === 'string' ? data.SubValue : null }) + '\n');
    }
  } catch {
    process.stdout.write(JSON.stringify({ kind: 'quota', metric, status: 'unavailable' }) + '\n');
  }
}
