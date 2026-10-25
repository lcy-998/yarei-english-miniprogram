import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build, stop } from 'esbuild';

const mode = process.argv[2];
if (!['inspect', 'apply'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const orgId = 'org_qihang_demo';
const classId = 'cls_grade3_2';
const teacherId = 'usr_teacher_demo_01';
const studentId = 'usr_student_g3_01';
const sourceTaskIds = ['task_yNOcyfq3hRsHj79K8AxKstPf02dnUkqW',
  'task_9TRRyOZwu-8ffO5Q3-grnmuK8EwSDC0H'];
const expectedCode = '6d3283b71c24517222bc19759d0c45392660c134ba19988f2578a931cade4750';
const require = createRequire(resolve(root, 'package.json'));
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  return JSON.parse(raw.slice(first)).data;
}
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envLine = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice('TCB_ENV_ID='.length).trim();
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_GATE');
const detail = cliData(['fn', 'detail', 'task-command', '--json']);
const codeHash = createHash('sha256').update(detail.CodeInfo ?? '').digest('hex');
if (detail.Status !== 'Active' || detail.InstallDependency !== 'FALSE'
  || (mode === 'apply' && codeHash !== expectedCode)) throw new Error('FUNCTION_CODE_GATE');
const credentials = cliData(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const sdk = require('@cloudbase/js-sdk');
const app = sdk.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const entry = resolve(root, '.runtime/m3-task-publication-probe-entry.cjs');
await build({ entryPoints: [resolve(root, 'src/seed/m2-acceptance-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node20',
  logLevel: 'silent' });
const api = require(entry);
const database = api.createCloudBaseDocumentDatabase(app.database());
const [teacher, student, roles, grants, memberships, firstTask, secondTask] = await Promise.all([
  database.get('users', teacherId), database.get('users', studentId),
  database.find('role_assignments', { organizationId: orgId, userId: teacherId,
    status: 'active', deletedAt: null }),
  database.find('teacher_class_grants', { organizationId: orgId, teacherId,
    classId, status: 'active', deletedAt: null }),
  database.find('class_memberships', { organizationId: orgId, classId,
    studentId, status: 'active', deletedAt: null }),
  database.get('tasks', sourceTaskIds[0]), database.get('tasks', sourceTaskIds[1]),
]);
const role = roles.find(item => item.role === 'teacher') ?? roles[0];
const grant = grants[0];
if (teacher?.status !== 'active' || student?.status !== 'active'
  || !role?.permissions?.includes('task.publish') || !role.permissions.includes('content.read')
  || !role.permissions.includes('submission.review')
  || !grant?.permissions?.includes('task.publish') || !grant.permissions.includes('content.read')
  || !grant.permissions.includes('submission.review') || memberships.length !== 1
  || firstTask?.status !== 'draft' || secondTask?.status !== 'draft'
  || firstTask?.itemRefs?.length !== 5 || secondTask?.itemRefs?.length !== 5) {
  throw new Error('VIRTUAL_ACTOR_OR_SOURCE_DRAFT_CHANGED');
}
if (mode === 'inspect') {
  const probeTasks = await database.find('tasks', { organizationId: orgId,
    title: 'M3 虚构单人发布修复探针', deletedAt: null });
  process.stdout.write(JSON.stringify({ status: 'ready', codeHash,
    rolePermissionsPresent: true, grantPermissionsPresent: true,
    oneActiveVirtualStudent: true, sourceDraftCount: 2, itemCount: 5,
    probeTasks: probeTasks.map(task => ({ id: task.id, version: task.version,
      visibility: task.visibility, itemCount: task.itemRefs?.length ?? 0,
      targetCount: task.targetStudentIds?.length ?? 0 })) }) + '\n');
  stop();
  await new Promise(resolve => setTimeout(resolve, 1000));
  process.exit(0);
}
const nonce = randomUUID().replaceAll('-', '');
const testTaskId = `task_m3_publication_fix_${nonce}`;
const clock = { nowIso: () => new Date().toISOString() };
let idSequence = 0;
const ids = { next: prefix => prefix === 'task' ? testTaskId
  : `${prefix}_m3pub_${nonce}_${++idSequence}` };
let requestSequence = 0;
const requestIds = { next: () => `request_m3pub_${nonce}_${++requestSequence}` };
const actor = { requestId: requestIds.next(), sessionId: 'controlled-m3-publication-probe',
  actorUserId: teacherId, actorRole: 'teacher', organizationId: orgId,
  platformSubjectDigest: 'controlled-m3-publication-probe',
  permissions: role.permissions, scopeIds: [classId], authzVersion: teacher.authzVersion ?? 1 };
const studentActor = { ...actor, actorUserId: studentId, actorRole: 'student',
  permissions: [], scopeIds: [classId], authzVersion: student.authzVersion ?? 1 };
const taskService = new api.TaskCoreService(api.createTaskCoreDocumentRepository(database),
  api.createIdentityDocumentRepository(database), clock, ids, requestIds);
const queryDependencies = { repository: api.createTaskQueryDocumentRepository(database),
  clock, requestIds };
const studentQuery = new api.StudentTaskQueryService(queryDependencies);
const teacherQuery = new api.TeacherTaskQueryService(queryDependencies);
const now = Date.now();
const input = { title: 'M3 虚构单人发布修复探针',
  itemRefs: structuredClone(firstTask.itemRefs), targetType: 'students',
  targetClassIds: [], targetStudentIds: [studentId],
  startsAt: new Date(now - 60000).toISOString(),
  dueAt: new Date(now + 86400000).toISOString(),
  latePolicy: { allowLate: true, lateDays: 7 },
  description: '仅限非生产虚构账号，完成后软回收。', teacherNote: '',
};
let stage = 'save-draft';
let created = false;
let published = false;
let recycled = false;
try {
  const saved = await taskService.saveTaskDraft(actor, input, 0,
    `operation_m3pub_save_${nonce}`);
  if (!saved.ok || saved.data?.taskId !== testTaskId || saved.data?.version !== 1) {
    throw new Error(`SAVE_DRAFT_${saved.error?.code ?? 'INVALID_RECEIPT'}`);
  }
  created = true;
  stage = 'publish';
  const result = await taskService.publishTask(actor, testTaskId, 1,
    `operation_m3pub_publish_${nonce}`);
  if (!result.ok || (result.data?.status !== 'active' && result.data?.status !== 'scheduled')) {
    throw new Error(`PUBLISH_${result.error?.code ?? 'INVALID_RECEIPT'}`);
  }
  published = true;
  stage = 'student-read';
  const studentTask = await studentQuery.getMyTask(studentActor, testTaskId);
  if (!studentTask.ok || studentTask.data.items?.length !== 5) {
    throw new Error(`STUDENT_READ_${studentTask.error?.code ?? 'INVALID_ITEMS'}`);
  }
  stage = 'teacher-read';
  const completion = await teacherQuery.getCompletion(actor, testTaskId, {}, { limit: 20 });
  if (!completion.ok || completion.data.assignments.items.length !== 1) {
    throw new Error(`TEACHER_READ_${completion.error?.code ?? 'INVALID_ASSIGNMENTS'}`);
  }
  stage = 'recycle';
  const current = await database.get('tasks', testTaskId);
  const cleanup = await taskService.recycleTask(actor, testTaskId,
    'M3 非生产单人发布探针完成，精确软回收。', current.version,
    `operation_m3pub_recycle_${nonce}`);
  if (!cleanup.ok) throw new Error(`RECYCLE_${cleanup.error?.code ?? 'INVALID_RECEIPT'}`);
  recycled = true;
  const finalTask = await database.get('tasks', testTaskId);
  if (finalTask?.visibility !== 'recycled') throw new Error('RECYCLE_READBACK_MISMATCH');
  const [firstAfter, secondAfter] = await Promise.all(sourceTaskIds.map(id => database.get('tasks', id)));
  if (firstAfter?.status !== 'draft' || secondAfter?.status !== 'draft') {
    throw new Error('USER_DRAFT_CHANGED');
  }
  process.stdout.write(JSON.stringify({ status: 'passed', itemCount: 5,
    targetStudents: 1, studentRead: true, teacherRead: true,
    testTaskRecycled: true, sourceDraftsUntouched: true }) + '\n');
  stop();
  await new Promise(resolve => setTimeout(resolve, 1000));
  process.exit(0);
} catch (error) {
  if (created && !recycled) {
    const current = await database.get('tasks', testTaskId).catch(() => null);
    if (current?.visibility !== 'recycled' && Number.isSafeInteger(current?.version)) {
      const cleanup = await taskService.recycleTask(actor, testTaskId,
        'M3 非生产发布探针失败后精确软回收。', current.version,
        `operation_m3pub_cleanup_${nonce}`).catch(() => null);
      recycled = cleanup?.ok === true;
    }
  }
  const recordPath = 'D:/app-m3-cache/task-publication-hotfix-20261008-rebased/probe-failure.json';
  await writeFile(recordPath, `${JSON.stringify({ taskId: created ? testTaskId : null,
    stage, published, recycled, code: String(error?.message ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) })}\n`,
  { flag: 'wx' }).catch(() => {});
  process.stdout.write(JSON.stringify({ status: 'failed', stage,
    published, recycled, privateFailureRecordSaved: true }) + '\n');
  stop();
  await new Promise(resolve => setTimeout(resolve, 1000));
  process.exit(2);
}
