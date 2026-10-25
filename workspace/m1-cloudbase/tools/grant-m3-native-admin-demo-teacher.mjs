// One-time, user-approved bootstrap for the virtual M3 administrator and teacher only.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

if (!process.argv.includes('--approved')) throw new Error('APPROVAL_FLAG_REQUIRED');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const envLine = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice('TCB_ENV_ID='.length).trim();
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');

function cliJson(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const parsed = JSON.parse(raw.slice(first));
  if (parsed.error) throw new Error(`CLOUD_API_${parsed.error.code ?? 'FAILED'}`);
  return parsed.data;
}

const environments = cliJson(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE');
}
const temporaryCredentials = cliJson(['secrets', 'get', '--json']);
if (temporaryCredentials?.isTemporary !== true || temporaryCredentials.envId !== envId
  || Date.parse(temporaryCredentials.expiredAt) <= Date.now() + 120_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID');
}

const outputDir = resolve(root, '.runtime/m3-native-admin-bootstrap-20261006');
await mkdir(outputDir, { recursive: true });
const bundlePath = join(outputDir, 'entry.cjs');
await build({ entryPoints: [resolve(root, 'src/seed/m3-native-admin-bootstrap-entry.ts')],
  outfile: bundlePath, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const require = createRequire(resolve(root, 'package.json'));
const api = require(bundlePath);
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: envId, secretId: temporaryCredentials.secretId,
  secretKey: temporaryCredentials.secretKey, sessionToken: temporaryCredentials.token });
const database = api.createCloudBaseDocumentDatabase(app.database());
const clock = { nowIso: () => new Date().toISOString() };
const ids = { next: prefix => `${prefix}_${randomUUID().replaceAll('-', '')}` };

const ORG = 'org_qihang_demo';
const ADMIN_ID = 'usr_admin_demo_01';
const ADMIN_ROLE_ID = 'rol_admin_demo_01';
const TEACHER_ID = 'usr_teacher_demo_01';
const TEACHER_ROLE_ID = 'rol_teacher_demo_01';
const ADMIN_ADDITIONS = ['textbook.manage', 'question.manage', 'task.manage', 'media.review'];
const REASON = '用户批准的 M3 非生产原生管理验收权限准备。';
const ROLE_AUDIT_ID = 'audit:org_qihang_demo:m3_native_admin_admin_permissions_20261006';
const ROLE_REQUEST_ID = 'm3_native_admin_admin_permissions_20261006';
const GRANT_OPERATION_ID = 'm3_native_admin_teacher_grant_20261006';

function matchesSeedRecord(audit, action, targetId, metadataKey, expectedValue) {
  return audit?.action === action && audit.targetId === targetId && audit.result === 'succeeded'
    && audit.metadata !== null && typeof audit.metadata === 'object'
    && JSON.stringify(audit.metadata[metadataKey]) === JSON.stringify(expectedValue);
}

const rolePreparation = await database.runTransaction(async tx => {
  const [adminUser, adminRole, roleAudit] = await Promise.all([
    tx.get('users', ADMIN_ID), tx.get('role_assignments', ADMIN_ROLE_ID),
    tx.get('operation_logs', ROLE_AUDIT_ID),
  ]);
  if (!adminUser || !adminRole || adminUser.organizationId !== ORG
    || adminRole.organizationId !== ORG || adminRole.userId !== ADMIN_ID
    || adminUser.status !== 'active' || adminRole.status !== 'active'
    || adminUser.deletedAt !== null || adminRole.deletedAt !== null
    || adminRole.role !== 'admin' || adminRole.scopeType !== 'organization'
    || !Array.isArray(adminRole.scopeIds) || !adminRole.scopeIds.includes(ORG)
    || !Array.isArray(adminRole.permissions)
    || !['authorization.manage', 'organization.manage', 'organization.read', 'user.manage']
      .every(permission => adminRole.permissions.includes(permission))) {
    throw new Error('ADMIN_VIRTUAL_ACTOR_PRECONDITION');
  }
  const present = ADMIN_ADDITIONS.filter(permission => adminRole.permissions.includes(permission));
  if (present.length === ADMIN_ADDITIONS.length) {
    if (!matchesSeedRecord(roleAudit, 'native_admin.admin_capabilities_prepared', ADMIN_ROLE_ID,
      'addedPermissions', ADMIN_ADDITIONS)) throw new Error('ADMIN_PERMISSION_AUDIT_MISMATCH');
    return { status: 'already-prepared', adminUserVersion: adminUser.version,
      adminAuthorizationVersion: adminUser.authorizationVersion, adminRoleVersion: adminRole.version };
  }
  if (present.length !== 0 || roleAudit !== null) throw new Error('ADMIN_PERMISSION_STATE_AMBIGUOUS');
  if (!Number.isSafeInteger(adminUser.version) || !Number.isSafeInteger(adminUser.authorizationVersion)
    || !Number.isSafeInteger(adminRole.version)) throw new Error('ADMIN_PERMISSION_VERSION_INVALID');

  const updatedRole = { ...adminRole, version: adminRole.version + 1,
    permissions: [...adminRole.permissions, ...ADMIN_ADDITIONS],
    grantedBy: 'authorized_m3_nonproduction_operator', grantedAt: clock.nowIso() };
  const updatedUser = { ...adminUser, version: adminUser.version + 1,
    authorizationVersion: adminUser.authorizationVersion + 1 };
  const audit = { _id: ROLE_AUDIT_ID, id: ROLE_AUDIT_ID, organizationId: ORG,
    schemaVersion: 1, version: 1, deletedAt: null, requestId: ROLE_REQUEST_ID,
    actorUserId: null, actorRole: null, action: 'native_admin.admin_capabilities_prepared',
    targetType: 'role_assignment', targetId: ADMIN_ROLE_ID, result: 'succeeded', errorCode: null,
    metadata: { source: 'user_approved_m3_nonproduction', targetUserId: ADMIN_ID,
      addedPermissions: [...ADMIN_ADDITIONS], reason: REASON,
      previousRoleVersion: adminRole.version, nextRoleVersion: updatedRole.version,
      previousAuthorizationVersion: adminUser.authorizationVersion,
      nextAuthorizationVersion: updatedUser.authorizationVersion }, occurredAt: clock.nowIso() };
  if (!await tx.replace('role_assignments', ADMIN_ROLE_ID, adminRole.version, updatedRole)
    || !await tx.replace('users', ADMIN_ID, adminUser.version, updatedUser)
    || !await tx.create('operation_logs', audit)) throw new Error('ADMIN_PERMISSION_TRANSACTION_CONFLICT');
  return { status: 'prepared', adminUserVersion: updatedUser.version,
    adminAuthorizationVersion: updatedUser.authorizationVersion, adminRoleVersion: updatedRole.version };
});
process.stdout.write(JSON.stringify({ step: 'admin-capabilities', ...rolePreparation,
  addedPermissions: ADMIN_ADDITIONS }) + '\n');

const grants = new api.DocumentNativeAdminGrantRepository(database);
const grantService = new api.NativeAdminGrantService(grants, clock, ids, grants);
const [adminUser, adminRole, teacherUser, teacherRole] = await Promise.all([
  database.get('users', ADMIN_ID), database.get('role_assignments', ADMIN_ROLE_ID),
  database.get('users', TEACHER_ID), database.get('role_assignments', TEACHER_ROLE_ID),
]);
if (!adminUser || !adminRole || !teacherUser || !teacherRole || adminRole.role !== 'admin'
  || teacherRole.role !== 'teacher' || adminUser.organizationId !== ORG
  || adminRole.organizationId !== ORG || teacherUser.organizationId !== ORG
  || teacherRole.organizationId !== ORG || adminUser.status !== 'active'
  || teacherUser.status !== 'active' || adminRole.status !== 'active' || teacherRole.status !== 'active'
  || adminRole.scopeType !== 'organization' || !adminRole.scopeIds.includes(ORG)) {
  throw new Error('NATIVE_ADMIN_GRANT_FIXTURE_PRECONDITION');
}
const priorGrant = await grants.findGrant(ORG, TEACHER_ID);
if (priorGrant) {
  const complete = priorGrant.status === 'active' && priorGrant.scope.organizationWide
    && priorGrant.permissions.length === api.NATIVE_ADMIN_PERMISSIONS.length
    && api.NATIVE_ADMIN_PERMISSIONS.every(permission => priorGrant.permissions.includes(permission));
  if (!complete) throw new Error('NATIVE_ADMIN_GRANT_STATE_AMBIGUOUS');
  const receipt = await database.get('native_admin_operations',
    `native_admin_op_${await operationDigest(ORG, ADMIN_ID, GRANT_OPERATION_ID)}`);
  if (!receipt || receipt.operationId !== GRANT_OPERATION_ID) throw new Error('NATIVE_ADMIN_GRANT_RECEIPT_MISSING');
  process.stdout.write(JSON.stringify({ step: 'teacher-grant', status: 'already-granted',
    teacherAuthorizationVersion: teacherUser.authorizationVersion, grantVersion: priorGrant.version }) + '\n');
} else {
  const actor = { requestId: `req_${ROLE_REQUEST_ID}`, sessionId: `operator_${ROLE_REQUEST_ID}`,
    actorUserId: ADMIN_ID, actorRole: 'admin', organizationId: ORG,
    platformSubjectDigest: 'authorized_m3_nonproduction_operator',
    permissions: [...adminRole.permissions], scopeIds: [...adminRole.scopeIds],
    authzVersion: adminUser.authorizationVersion };
  const grant = await grantService.setGrant(actor, TEACHER_ID,
    { status: 'active', permissions: [...api.NATIVE_ADMIN_PERMISSIONS],
      scope: { organizationWide: true, classIds: [] } }, 0, teacherUser.version, REASON, GRANT_OPERATION_ID);
  process.stdout.write(JSON.stringify({ step: 'teacher-grant', status: grant.status,
    teacherId: grant.teacherId, grantVersion: grant.version,
    permissionCount: grant.permissions.length, organizationWide: grant.scope.organizationWide }) + '\n');
}

async function operationDigest(organizationId, actorId, operationId) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(JSON.stringify([organizationId, actorId, operationId]))
    .digest('hex').slice(0, 40);
}
