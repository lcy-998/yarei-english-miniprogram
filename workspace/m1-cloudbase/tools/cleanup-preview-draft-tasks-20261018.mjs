import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(import.meta.dirname, '..');
const envId = 'cloud1-d8ggzrwwedb786e41';
const organizationId = 'org_qihang_demo';
const auditId = 'audit_preview_draft_tasks_recycled_20261018';
const packId = 'preview-draft-task-cleanup-2026-10-18';
const retainedTeacherAlias = 'demo_teacher_01';
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const require = createRequire(resolve(root, 'package.json'));

function cliJson(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const parsed = JSON.parse(raw.slice(start));
  if (parsed.error) throw new Error('CLOUD_CLI_FAILED');
  return parsed.data;
}

const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const localEnv = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (localEnv !== envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');
const envs = cliJson(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE');
}
const secrets = cliJson(['secrets', 'get', '--json']);
if (secrets?.envId !== envId || secrets.isTemporary !== true
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');
const accounts = cliJson(['user', 'list', '-e', envId, '--offset', '0', '--limit', '100', '--json']);
if (!Array.isArray(accounts) || accounts.length >= 100) throw new Error('AUTH_ACCOUNT_SET_INCOMPLETE');
const teacherAccount = accounts.filter(account => account.Name === retainedTeacherAlias);
if (teacherAccount.length !== 1 || typeof teacherAccount[0].Uid !== 'string') {
  throw new Error('RETAINED_TEACHER_ACCOUNT_MISSING');
}
const pepper = config.functions?.[0]?.envVariables?.YAREI_SUBJECT_PEPPER;
if (typeof pepper !== 'string' || pepper.length < 16) throw new Error('SUBJECT_KEY_UNAVAILABLE');
const digest = `sd1_${createHmac('sha256', pepper)
  .update(`yarei:platform-subject:v1\u0000cloudbase:username:${teacherAccount[0].Uid}`).digest('base64url')}`;
const sdk = require('@cloudbase/node-sdk');
const database = require(resolve(root, '.runtime/m3-real-vocabulary-audio-v2/entry.cjs'))
  .createCloudBaseDocumentDatabase(sdk.init({ env: envId, secretId: secrets.secretId,
    secretKey: secrets.secretKey, sessionToken: secrets.token }).database());
const identityRows = await database.find('auth_identities', { provider: 'cloudbase_uid',
  providerSubjectDigest: digest, status: 'active', deletedAt: null });
if (identityRows.length !== 1 || identityRows[0].organizationId !== organizationId) {
  throw new Error('RETAINED_TEACHER_IDENTITY_INVALID');
}
const teacherId = identityRows[0].userId;
const allTasks = await database.find('tasks', { organizationId, deletedAt: null });
const visibleDrafts = allTasks.filter(task => task.status === 'draft'
  && task.visibility === 'visible' && task.creatorTeacherId === teacherId);
const assignmentsByTask = new Map();
for (const task of visibleDrafts) {
  assignmentsByTask.set(task._id, await database.find('task_assignments', {
    organizationId, taskId: task._id, deletedAt: null,
  }));
}
const priorAudit = await database.get('operation_logs', auditId);
if (mode !== 'verify' && (visibleDrafts.length !== 7 || visibleDrafts.some(task => !Number.isSafeInteger(task.version)
  || (task.targetStudentIds?.length ?? 0) > 0 || (assignmentsByTask.get(task._id)?.length ?? 0) > 0))) {
  throw new Error('DRAFT_TASK_SCOPE_CHANGED');
}
if (mode !== 'verify' && priorAudit) throw new Error('AUDIT_ALREADY_EXISTS');

if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ status: 'ready', unassignedDrafts: visibleDrafts.length,
    activeStudentTasksPreserved: allTasks.filter(task => task.status === 'active'
      && task.visibility === 'visible').length, assignmentsDeleted: false,
    recoverableForDays: 7 }) + '\n');
} else if (mode === 'apply') {
  const now = new Date().toISOString();
  const recoverableUntil = new Date(Date.now() + 7 * 86400_000).toISOString();
  const nextTasks = visibleDrafts.map(task => ({ ...task, visibility: 'recycled',
    recycledAt: now, recycledBy: 'system_preview_task_cleanup',
    recycleReason: 'unassigned_virtual_preview_draft_cleanup', recoverableUntil,
    version: task.version + 1 }));
  const log = { _id: auditId, id: auditId, organizationId, schemaVersion: 1, version: 1,
    deletedAt: null, requestId: packId, actorUserId: null, actorRole: null,
    action: 'task.previewDraftsRecycled', targetType: 'classroom_tasks', targetId: packId,
    result: 'succeeded', errorCode: null, occurredAt: now,
    metadata: { packId, taskIds: visibleDrafts.map(task => task._id),
      taskVersions: visibleDrafts.map((task, index) => ({ id: task._id,
        from: task.version, to: nextTasks[index].version })),
      assignmentsDeleted: false, submissionsDeleted: false,
      recoverableUntil } };
  await database.runTransaction(async tx => {
    if (await tx.get('operation_logs', auditId)) throw new Error('AUDIT_ALREADY_EXISTS');
    for (let i = 0; i < visibleDrafts.length; i += 1) {
      const task = visibleDrafts[i];
      if ((await tx.get('tasks', task._id))?.version !== task.version
        || !await tx.replace('tasks', task._id, task.version, nextTasks[i])) {
        throw new Error('TASK_VERSION_CHANGED');
      }
      const assignments = await tx.find('task_assignments', { organizationId,
        taskId: task._id, deletedAt: null });
      if (assignments.length !== 0) throw new Error('TASK_ASSIGNMENTS_CHANGED');
    }
    if (!await tx.create('operation_logs', log)) throw new Error('AUDIT_CREATE_FAILED');
  });
  process.stdout.write(JSON.stringify({ status: 'recycled', drafts: nextTasks.length,
    assignmentsDeleted: 0, submissionsDeleted: 0, recoverableForDays: 7 }) + '\n');
} else {
  const ids = priorAudit?.metadata?.taskIds;
  if (priorAudit?.metadata?.packId !== packId || !Array.isArray(ids) || ids.length !== 7) {
    throw new Error('CLEANUP_AUDIT_INVALID');
  }
  const finalTasks = await Promise.all(ids.map(id => database.get('tasks', id)));
  if (finalTasks.some(task => task?.status !== 'draft' || task?.visibility !== 'recycled'
    || task.deletedAt !== null || typeof task.recoverableUntil !== 'string')) {
    throw new Error('CLEANUP_VERIFY_FAILED');
  }
  process.stdout.write(JSON.stringify({ status: 'verified', recycledDrafts: finalTasks.length,
    assignmentsPreserved: 0, auditPresent: true }) + '\n');
}
