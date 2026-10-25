import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const ORG = 'org_qihang_demo';
const TASKS = [
  'task_2rtsbbyRxLy2vOQOICRYtaW0ic8gTwJM',
  'task_HIP-en0iCyyKNnLpNaoPOEfOsHXxMd37',
  'task_YeuQR0ASbia6a6hPljR80rdUkrkdiFG2',
  'task_xzAlztdU7TLch2zzl4r3IPIB1__cuWX2',
];
const AUDIT = 'audit_m3_remaining_demo_tasks_recycled_20261006';
const PACK = 'm3-recycle-remaining-demo-tasks-2026-10-06';
const REAL_RESOURCES = [
  'res_m3_peter_rabbit_listening_auto_20261005',
  'res_m3_sbc0008_dubbing_auto_20261005',
  'res_m3_sbc0008_video_auto_20261005',
];

function cliJson(cli, args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const result = JSON.parse(raw.slice(start));
  if (result.error) throw new Error('CLOUD_PREFLIGHT_FAILED');
  return result;
}

const envLine = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice(11).trim();
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const envs = cliJson(cli, ['env', 'list', '--json']).data;
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE');
}
const secrets = cliJson(cli, ['secrets', 'get', '--json']).data;
if (secrets?.isTemporary !== true || secrets.envId !== envId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token });
const api = require(resolve(root, '.runtime/m3-real-vocabulary-audio-v2/entry.cjs'));
const database = api.createCloudBaseDocumentDatabase(app.database());
const [tasks, assignments, audit, resources] = await Promise.all([
  Promise.all(TASKS.map(id => database.get('tasks', id))),
  database.find('task_assignments', { organizationId: ORG }), database.get('operation_logs', AUDIT),
  Promise.all(REAL_RESOURCES.map(id => database.get('learning_resources', id))),
]);
if (tasks.some(task => task?.organizationId !== ORG || !(task.itemRefs ?? []).length
  || (mode === 'verify'
    ? task.visibility !== 'recycled' || task.status !== 'withdrawn'
    : task.visibility === 'recycled' || task.status !== 'active'))) throw new Error('TASK_SCOPE_CHANGED');
if (resources.some(resource => resource?.status !== 'published'
  || resource.acceptanceStatus !== 'pending_user_acceptance' || resource.testOnly !== true
  || resource.organizationId !== ORG)) throw new Error('REAL_MEDIA_NOT_STAGED');
const assignmentsForTasks = assignments.filter(item => TASKS.includes(item.taskId));
const expectedCounts = new Map(TASKS.map(id => [id,
  assignmentsForTasks.filter(item => item.taskId === id).length]));
if ([...expectedCounts.values()].reduce((sum, count) => sum + count, 0) !== 39) {
  throw new Error('TASK_ASSIGNMENT_SCOPE_CHANGED');
}
const alreadyApplied = audit?.metadata?.packId === PACK;
if (mode === 'inspect') {
  if (alreadyApplied) throw new Error('AUDIT_ALREADY_EXISTS');
  process.stdout.write(JSON.stringify({ status: 'ready', tasks: TASKS.length,
    taskTitles: tasks.map(task => task.title), assignedDemoStudents: 39,
    sourceMaterialsRemainPublished: REAL_RESOURCES.length, assignmentHistoryWillBePreserved: true }) + '\n');
} else if (mode === 'apply') {
  if (alreadyApplied) throw new Error('AUDIT_ALREADY_EXISTS');
  const now = new Date().toISOString();
  const recoverableUntil = new Date(Date.now() + 7 * 86400_000).toISOString();
  const nextTasks = tasks.map(task => ({ ...task, status: 'withdrawn', visibility: 'recycled',
    withdrawnAt: now, withdrawnBy: 'system_m3_english_task_retirement',
    withdrawReason: 'old_virtual_student_acceptance_task_retired', recycledAt: now,
    recycledBy: 'system_m3_english_task_retirement', recycleReason: 'old_virtual_student_acceptance_task_retired',
    recoverableUntil, version: task.version + 1 }));
  const log = { _id: AUDIT, id: AUDIT, organizationId: ORG, schemaVersion: 1, version: 1,
    deletedAt: null, requestId: PACK, actorUserId: null, actorRole: null,
    action: 'task.oldM3DemoAssignmentsRecycled', targetType: 'classroom_tasks', targetId: PACK,
    result: 'succeeded', errorCode: null, occurredAt: now,
    metadata: { packId: PACK, taskIds: TASKS,
      taskVersions: tasks.map(task => ({ id: task._id, from: task.version, to: task.version + 1 })),
      assignmentCountPreserved: assignmentsForTasks.length, assignmentsByTask: [...expectedCounts],
      realResourceIdsRetained: REAL_RESOURCES, assignmentDataDeleted: false,
      mediaDeleted: false, functionsDeployed: 0 } };
  await database.runTransaction(async tx => {
    if (await tx.get('operation_logs', AUDIT)) throw new Error('AUDIT_ALREADY_EXISTS');
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      if ((await tx.get('tasks', task._id))?.version !== task.version
        || !await tx.replace('tasks', task._id, task.version, nextTasks[index])) throw new Error('TASK_VERSION_CHANGED');
    }
    if (!await tx.create('operation_logs', log)) throw new Error('AUDIT_CREATE_FAILED');
  });
  process.stdout.write(JSON.stringify({ status: 'recycled', tasks: TASKS.length,
    preservedAssignments: assignmentsForTasks.length, resourcesRetained: REAL_RESOURCES.length }) + '\n');
} else {
  const [finalTasks, finalAudit, finalAssignments, allTasks] = await Promise.all([
    Promise.all(TASKS.map(id => database.get('tasks', id))), database.get('operation_logs', AUDIT),
    database.find('task_assignments', { organizationId: ORG }), database.find('tasks', { organizationId: ORG, deletedAt: null }),
  ]);
  const activeStudentTasks = allTasks.filter(task => task.visibility === 'visible'
    && ['active', 'scheduled'].includes(task.status));
  if (finalTasks.some(task => task?.status !== 'withdrawn' || task.visibility !== 'recycled')
    || finalAudit?.metadata?.packId !== PACK
    || finalAssignments.filter(item => TASKS.includes(item.taskId)).length !== assignmentsForTasks.length
    || activeStudentTasks.length !== 0) throw new Error('RECYCLE_VERIFY_FAILED');
  process.stdout.write(JSON.stringify({ status: 'verified', recycledTasks: finalTasks.length,
    preservedAssignments: assignmentsForTasks.length, visibleActiveStudentTasks: 0,
    realMediaResourcesRetained: resources.length }) + '\n');
}
