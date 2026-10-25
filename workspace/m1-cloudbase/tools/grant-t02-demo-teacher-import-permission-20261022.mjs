// Managed, reversible T-02 permission change for the virtual nonproduction teacher.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const envLine = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find((line) => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice('TCB_ENV_ID='.length).trim();
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');

function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const parsed = JSON.parse(raw.slice(first));
  if (parsed.error) throw new Error(`CLOUD_API_${parsed.error.code ?? 'FAILED'}`);
  return parsed.data;
}

const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE');
}
const credentials = cliData(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 120_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID');
}

const OUTPUT = resolve(root, '.runtime/t02-demo-teacher-import-permission-20261022/adapter.cjs');
await build({ entryPoints: [resolve(root, 'src/seed/m3-native-admin-bootstrap-entry.ts')],
  outfile: OUTPUT, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const require = createRequire(resolve(root, 'package.json'));
const api = require(OUTPUT);
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const database = api.createCloudBaseDocumentDatabase(app.database());

const ORG = 'org_qihang_demo';
const TEACHER_ID = 'usr_teacher_demo_01';
const ROLE_ID = 'rol_teacher_demo_01';
const CLASS_IDS = ['cls_grade3_2', 'cls_grade4_1'];
const OPERATION_ID = 't02_demo_teacher_student_import_permission_20261022';
const AUDIT_ID = `audit:${ORG}:${OPERATION_ID}`;
const PERMISSION = 'student.import';
const EXPECTED_ROLE_PERMISSIONS = ['task.read', 'task.publish', 'submission.review', 'student.manage',
  'content.read', 'class.read', 'student.read', 'student.bind-code.issue'];
const EXPECTED_GRANT_PERMISSIONS = {
  cls_grade3_2: ['class.read', 'student.read', 'content.read', 'task.read', 'task.publish',
    'submission.review', 'student.manage', 'student.bind-code.issue'],
  cls_grade4_1: ['task.read', 'task.publish', 'submission.review', 'student.manage', 'content.read'],
};
const action = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--rollback') ? 'rollback' : 'inspect';
if (process.argv.includes('--apply') && process.argv.includes('--rollback')) {
  throw new Error('SELECT_ONE_ACTION');
}

function sorted(values) {
  return [...values].sort();
}

function sameStrings(actual, expected) {
  return Array.isArray(actual) && JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));
}

function requireTeacherState(teacher, role, grants) {
  if (!teacher || teacher._id !== TEACHER_ID || teacher.organizationId !== ORG
    || teacher.status !== 'active' || teacher.deletedAt !== null
    || !Number.isSafeInteger(teacher.version) || !Number.isSafeInteger(teacher.authorizationVersion)
    || !role || role._id !== ROLE_ID || role.organizationId !== ORG || role.userId !== TEACHER_ID
    || role.role !== 'teacher' || role.status !== 'active' || role.deletedAt !== null
    || role.scopeType !== 'classes' || !sameStrings(role.scopeIds, CLASS_IDS)
    || !Number.isSafeInteger(role.version) || !Array.isArray(role.permissions)
    || !Array.isArray(grants) || grants.length !== CLASS_IDS.length) {
    throw new Error('TEACHER_FIXTURE_MISMATCH');
  }
  const grantsByClass = new Map(grants.map((grant) => [grant.classId, grant]));
  if (CLASS_IDS.some((classId) => {
    const grant = grantsByClass.get(classId);
    return !grant || grant.organizationId !== ORG || grant.teacherId !== TEACHER_ID
      || grant.status !== 'active' || grant.deletedAt !== null
      || !Number.isSafeInteger(grant.version) || !Array.isArray(grant.permissions);
  })) throw new Error('TEACHER_CLASS_GRANT_FIXTURE_MISMATCH');
  return grantsByClass;
}

async function readState(reader) {
  // CloudBase transactions require sequential reads to avoid TransactionBusy.
  const teacher = await reader.get('users', TEACHER_ID);
  const role = await reader.get('role_assignments', ROLE_ID);
  const grants = await reader.find('teacher_class_grants', { organizationId: ORG,
    teacherId: TEACHER_ID, status: 'active', deletedAt: null });
  const audit = await reader.get('operation_logs', AUDIT_ID);
  const grantsByClass = requireTeacherState(teacher, role, grants);
  return { teacher, role, grantsByClass, audit };
}

const initial = await readState(database);
const initialClassPermissions = Object.fromEntries(CLASS_IDS.map((classId) => [
  classId, [...initial.grantsByClass.get(classId).permissions],
]));
const initialHasPermission = initial.role.permissions.includes(PERMISSION)
  && CLASS_IDS.every((classId) => initialClassPermissions[classId].includes(PERMISSION));
process.stdout.write(JSON.stringify({
  action,
  environment: { status: environments[0].Status, paid: environments[0].EnvPaid,
    charged: environments[0].EnvCharged, overrun: environments[0].EnableOverrun },
  teacherId: TEACHER_ID,
  roleVersion: initial.role.version,
  teacherAuthorizationVersion: initial.teacher.authorizationVersion,
  roleHasStudentImport: initial.role.permissions.includes(PERMISSION),
  classes: CLASS_IDS.map((classId) => ({ classId,
    grantVersion: initial.grantsByClass.get(classId).version,
    grantHasStudentImport: initialClassPermissions[classId].includes(PERMISSION) })),
  permissionAlreadyActive: initialHasPermission,
}) + '\n');

if (action === 'inspect') process.exit(0);

const now = new Date().toISOString();
const result = await database.runTransaction(async (transaction) => {
  const current = await readState(transaction);
  if (action === 'apply' && current.audit !== null) throw new Error('OPERATION_ID_ALREADY_USED');
  if (action === 'rollback' && current.audit === null) throw new Error('APPLIED_PERMISSION_AUDIT_MISSING');
  const currentClassPermissions = Object.fromEntries(CLASS_IDS.map((classId) => [
    classId, [...current.grantsByClass.get(classId).permissions],
  ]));
  if (action === 'apply') {
    if (current.teacher.version !== 9 || current.teacher.authorizationVersion !== 8
      || current.role.version !== 2 || !sameStrings(current.role.permissions, EXPECTED_ROLE_PERMISSIONS)
      || CLASS_IDS.some((classId) => !sameStrings(currentClassPermissions[classId], EXPECTED_GRANT_PERMISSIONS[classId]))) {
      throw new Error('PRECONDITION_CHANGED');
    }
  } else {
    if (!current.role.permissions.includes(PERMISSION)
      || !CLASS_IDS.every((classId) => currentClassPermissions[classId].includes(PERMISSION))) {
      throw new Error('ROLLBACK_STATE_MISMATCH');
    }
    const rollbackLog = await transaction.get('operation_logs', `${AUDIT_ID}:rollback`);
    if (rollbackLog !== null) throw new Error('ROLLBACK_ALREADY_APPLIED');
  }

  let nextRolePermissions;
  let nextGrantPermissions;
  if (action === 'apply') {
    nextRolePermissions = [...current.role.permissions, PERMISSION];
    nextGrantPermissions = Object.fromEntries(CLASS_IDS.map((classId) => [
      classId, [...currentClassPermissions[classId], PERMISSION],
    ]));
  } else {
    const appliedRolePermissions = [...EXPECTED_ROLE_PERMISSIONS, PERMISSION];
    if (!sameStrings(current.role.permissions, appliedRolePermissions)
      || CLASS_IDS.some((classId) => !sameStrings(currentClassPermissions[classId],
        [...EXPECTED_GRANT_PERMISSIONS[classId], PERMISSION]))) {
      throw new Error('ROLLBACK_STATE_MISMATCH');
    }
    nextRolePermissions = [...EXPECTED_ROLE_PERMISSIONS];
    nextGrantPermissions = EXPECTED_GRANT_PERMISSIONS;
  }

  const nextRole = { ...current.role, version: current.role.version + 1,
    permissions: nextRolePermissions };
  const nextTeacher = { ...current.teacher, version: current.teacher.version + 1,
    authorizationVersion: current.teacher.authorizationVersion + 1 };
  if (!await transaction.replace('role_assignments', ROLE_ID, current.role.version, nextRole)) {
    throw new Error('ROLE_VERSION_CONFLICT');
  }
  for (const classId of CLASS_IDS) {
    const grant = current.grantsByClass.get(classId);
    const nextGrant = { ...grant, version: grant.version + 1,
      permissions: nextGrantPermissions[classId] };
    if (!await transaction.replace('teacher_class_grants', grant._id, grant.version, nextGrant)) {
      throw new Error('CLASS_GRANT_VERSION_CONFLICT');
    }
  }
  if (!await transaction.replace('users', TEACHER_ID, current.teacher.version, nextTeacher)) {
    throw new Error('TEACHER_VERSION_CONFLICT');
  }

  const audit = {
    _id: action === 'apply' ? AUDIT_ID : `${AUDIT_ID}:rollback`,
    id: action === 'apply' ? AUDIT_ID : `${AUDIT_ID}:rollback`,
    organizationId: ORG, schemaVersion: 1, version: 1, deletedAt: null,
    requestId: `${OPERATION_ID}_${action}`,
    actorUserId: null, actorRole: null,
    action: action === 'apply' ? 'teacher.permissions.updated' : 'teacher.permissions.rolled_back',
    targetType: 'role_assignment', targetId: ROLE_ID, result: 'succeeded', errorCode: null,
    metadata: {
      source: 'authorized_nonproduction_t02_validation', operationId: OPERATION_ID,
      targetTeacherId: TEACHER_ID, addedPermissions: action === 'apply' ? [PERMISSION] : [],
      removedPermissions: action === 'rollback' ? [PERMISSION] : [], classIds: [...CLASS_IDS],
      rolePermissionsBefore: [...current.role.permissions], rolePermissionsAfter: [...nextRolePermissions],
      classPermissionsBefore: currentClassPermissions, classPermissionsAfter: nextGrantPermissions,
      previousAuthorizationVersion: current.teacher.authorizationVersion,
      nextAuthorizationVersion: nextTeacher.authorizationVersion,
      reason: '用户要求修改当前虚构演示教师权限，用于 T-02 批量导入非生产验收。',
    },
    occurredAt: now,
  };
  if (!await transaction.create('operation_logs', audit)) throw new Error('AUDIT_CREATE_CONFLICT');
  return { roleVersion: nextRole.version, teacherVersion: nextTeacher.version,
    authorizationVersion: nextTeacher.authorizationVersion, classGrantVersions: Object.fromEntries(
      CLASS_IDS.map((classId) => [classId, current.grantsByClass.get(classId).version + 1])) };
});

const verified = await readState(database);
const verifiedHasPermission = verified.role.permissions.includes(PERMISSION)
  && CLASS_IDS.every((classId) => verified.grantsByClass.get(classId).permissions.includes(PERMISSION));
if (verifiedHasPermission !== (action === 'apply')) throw new Error('PERMISSION_READBACK_MISMATCH');
process.stdout.write(JSON.stringify({ step: action === 'apply' ? 'permission-applied' : 'permission-rolled-back',
  permissionActive: verifiedHasPermission, roleVersion: verified.role.version,
  teacherVersion: verified.teacher.version, authorizationVersion: verified.teacher.authorizationVersion,
  classGrantVersions: Object.fromEntries(CLASS_IDS.map((classId) => [classId,
    verified.grantsByClass.get(classId).version])), auditRecorded: true, ...result }) + '\n');
