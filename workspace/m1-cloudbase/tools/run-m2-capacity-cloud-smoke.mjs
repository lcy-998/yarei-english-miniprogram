import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envText = await readFile(resolve(root, '.env.local'), 'utf8');
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!/^[A-Za-z0-9_-]+$/u.test(envId ?? '')) throw new Error('Private environment unavailable.');
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
const statePath = resolve(root, '.runtime/m2-predeploy-20260927/capacity-task.json');
try { require('@cloudbase/js-sdk').useAdapters(require('@cloudbase/adapter-node').default); } catch { /* SDK may self-register. */ }
const sdk = require('@cloudbase/js-sdk');
const students = [
  ...Array.from({ length: 36 }, (_, index) => `usr_student_g3_${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 464 }, (_, index) => `usr_m2_capacity_${String(index + 1).padStart(4, '0')}`),
];
let state = await readState();

try {
  const teacherPassword = await preparePassword('demo_teacher_01');
  let teacher = await login('demo_teacher_01', 'teacher', teacherPassword);
  if (state === null) {
    const now = Date.now();
    const nonce = randomBytes(10).toString('hex');
    const overLimit = await call(teacher, 'task-command', 'saveDraft', {
      title: `M2 501 人应被拒绝 ${nonce}`,
      itemRefs: [{ id: `item_over_${nonce}`, resourceId: 'res_m2_exercise_animals_choice_demo',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }],
      target: { type: 'students', studentIds: [...students, 'usr_student_g4_01'] },
      startsAt: new Date(now - 60_000).toISOString(), dueAt: new Date(now + 86_400_000).toISOString(),
      latePolicy: { allowLate: true, lateDays: 7 },
    }, `op_m2_capacity_501_${nonce}`);
    if (overLimit.ok || overLimit.error?.code !== 'VALIDATION_ERROR') {
      throw new Error('CAPACITY_501_NOT_REJECTED');
    }
    process.stdout.write('capacity_501_rejected=passed\n');
    const draft = await call(teacher, 'task-command', 'saveDraft', {
      title: `M2 虚构 500 人容量 ${nonce}`,
      itemRefs: [{ id: `item_capacity_${nonce}`, resourceId: 'res_m2_exercise_animals_choice_demo',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }],
      target: { type: 'students', studentIds: students },
      startsAt: new Date(now - 60_000).toISOString(), dueAt: new Date(now + 86_400_000).toISOString(),
      latePolicy: { allowLate: true, lateDays: 7 }, description: '仅用于非生产 500 人容量联调。',
    }, `op_m2_capacity_draft_${nonce}`);
    requireOk(draft, 'capacity-draft');
    state = { taskId: requiredString(draft.data?.taskId),
      originalVersion: requiredNumber(draft.data?.version),
      publishOperationId: `op_m2_capacity_publish_${nonce}`,
      recycleOperationId: `op_m2_capacity_recycle_${nonce}`,
      publishedVersion: null, hiddenChecked: false, recycled: false };
    await saveState(state);
    process.stdout.write('capacity_draft_saved=passed\n');
  }
  if (!state.recycled) {
    for (let turn = 0; turn < 20 && state.publishedVersion === null; turn += 1) {
      const result = await call(teacher, 'task-command', 'publishTask', { taskId: state.taskId },
        state.publishOperationId, state.originalVersion);
      requireOk(result, 'capacity-publish');
      const count = Number(result.data?.assignmentCount);
      if (!Number.isSafeInteger(count) || count < 0 || count > 500) throw new Error('CAPACITY_PROGRESS_INVALID');
      process.stdout.write(`capacity_publish_progress=${count}/500\n`);
      if (result.data?.status === 'publishing') {
        if (count >= 480 && count < 500 && !state.hiddenChecked) {
          const studentPassword = await preparePassword('demo_student_01');
          const student = await login('demo_student_01', 'student', studentPassword);
          const hidden = await call(student, 'student-task-query', 'getMyTask', { taskId: state.taskId });
          if (hidden.ok || hidden.error?.code !== 'NOT_FOUND') throw new Error('PARTIAL_TASK_VISIBLE');
          state.hiddenChecked = true;
          await saveState(state);
          process.stdout.write('capacity_partial_task_hidden=passed\n');
          teacher = await login('demo_teacher_01', 'teacher', teacherPassword);
        }
        continue;
      }
      if (count !== 500 || !['active', 'scheduled'].includes(result.data?.status)) {
        throw new Error('CAPACITY_COMPLETION_INVALID');
      }
      state.publishedVersion = requiredNumber(result.data?.version);
      await saveState(state);
    }
    if (state.publishedVersion === null) throw new Error('CAPACITY_PUBLICATION_INCOMPLETE');
    const studentPassword = await preparePassword('demo_student_01');
    const student = await login('demo_student_01', 'student', studentPassword);
    const visible = await call(student, 'student-task-query', 'getMyTask', { taskId: state.taskId });
    requireOk(visible, 'capacity-student-visible');
    process.stdout.write('capacity_500_student_visible=passed\n');
    teacher = await login('demo_teacher_01', 'teacher', teacherPassword);
    const recycled = await call(teacher, 'task-command', 'recycleTask',
      { taskId: state.taskId, reason: 'M2 虚构容量联调结束回收。' },
      state.recycleOperationId, state.publishedVersion);
    requireOk(recycled, 'capacity-recycle');
    state.recycled = true;
    await saveState(state);
    process.stdout.write('capacity_500_recycled=passed\n');
  }
  process.stdout.write(`capacity_task_id=${state.taskId}\n`);
  process.stdout.write(`capacity_partial_visibility=${state.hiddenChecked ? 'checked' : 'not_checked'}\n`);
  process.stdout.write('m2_capacity_cloud_smoke=passed\n');
} catch (error) {
  process.stdout.write(`m2_capacity_cloud_smoke=failed:${safe(error?.message)}\n`);
  if (state?.taskId) process.stdout.write(`capacity_task_id=${state.taskId}\n`);
  process.exitCode = 2;
}
process.exit(process.exitCode ?? 0);

async function readState() {
  try {
    const value = JSON.parse(await readFile(statePath, 'utf8'));
    if (typeof value.taskId !== 'string' || !/^task_[A-Za-z0-9_-]+$/u.test(value.taskId)
      || typeof value.publishOperationId !== 'string' || value.originalVersion !== 1) {
      throw new Error('CAPACITY_TASK_STATE_INVALID');
    }
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
async function saveState(value) { await writeFile(statePath, JSON.stringify(value), 'utf8'); }
async function preparePassword(alias) {
  const users = await cliJson(['user', 'list', '-e', envId, '--name', alias, '--json']);
  const matches = Array.isArray(users.data) ? users.data.filter(row => row?.Name === alias) : [];
  if (matches.length !== 1) throw new Error('DEMO_ACCOUNT_UNAVAILABLE');
  const password = `YareiM2!${randomBytes(18).toString('base64url')}`;
  await cliJson(['user', 'update', '-e', envId, matches[0].Uid,
    '--password', password, '--status', 'ACTIVE', '--json']);
  return password;
}
async function login(alias, role, password) {
  const app = sdk.init({ env: envId });
  await app.auth({ persistence: 'local' }).signInWithPassword({ username: alias, password });
  const bootstrap = await call({ app, token: null }, 'auth-session', 'bootstrap', {});
  requireOk(bootstrap, 'bootstrap');
  const token = requiredString(bootstrap.data?.sessionId);
  requireOk(await call({ app, token }, 'auth-session', 'selectRole', { role }), 'select-role');
  return { app, token };
}
async function call(session, name, action, payload, operationId, expectedVersion) {
  try {
    const data = { apiVersion: 'm1.v1', action, payload,
      ...(session.token === null ? {} : { businessSessionToken: session.token }),
      ...(operationId === undefined ? {} : { operationId }),
      ...(expectedVersion === undefined ? {} : { expectedVersion }) };
    const response = await Promise.race([session.app.callFunction({ name, data, parse: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CALL_TIMEOUT')), 90_000))]);
    return response?.result ?? { ok: false, error: { code: 'INVALID_RESPONSE' } };
  } catch (error) { return { ok: false, error: { code: safe(error?.code ?? error?.message) } }; }
}
async function cliJson(args) {
  const { stdout } = await execute(process.execPath, [cli, ...args],
    { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  const starts = [stdout.indexOf('{'), stdout.indexOf('[')].filter(index => index >= 0);
  if (!starts.length) throw new Error('CLOUD_CLI_RESPONSE_UNAVAILABLE');
  return JSON.parse(stdout.slice(Math.min(...starts)));
}
function requireOk(result, stage) { if (!result?.ok) throw new Error(`${stage}_${safe(result?.error?.code)}`); }
function requiredString(value) { if (typeof value !== 'string' || !value) throw new Error('INVALID_RESPONSE'); return value; }
function requiredNumber(value) { if (!Number.isSafeInteger(value) || value < 1) throw new Error('INVALID_RESPONSE'); return value; }
function safe(value) { return String(value ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80); }
