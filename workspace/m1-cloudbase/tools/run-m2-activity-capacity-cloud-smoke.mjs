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
const statePath = resolve(root, '.runtime/m2-predeploy-20260927/activity-capacity.json');
try { require('@cloudbase/js-sdk').useAdapters(require('@cloudbase/adapter-node').default); } catch { /* SDK may self-register. */ }
const sdk = require('@cloudbase/js-sdk');
let state = await readState();

try {
  const teacherPassword = await preparePassword('demo_teacher_01');
  const teacher = await login('demo_teacher_01', 'teacher', teacherPassword);
  if (state === null) {
    const nonce = randomBytes(10).toString('hex');
    const draft = await call(teacher, 'activity-command', 'saveDraft', {
      title: `M2 虚构 500 人打卡容量 ${nonce}`,
      classId: 'cls_grade3_2', startsOn: '2026-09-28', endsOn: '2026-09-29',
      restDates: [], conditions: [{ kind: 'exercise',
        resourceId: 'res_m2_exercise_animals_choice_demo', minimumScore: 60 }],
      description: '仅用于非生产 500 人打卡容量测试。',
    }, `op_m2_activity_capacity_draft_${nonce}`, 0);
    requireOk(draft, 'activity-draft');
    state = { activityId: requiredString(draft.data?.id),
      publishOperationId: `op_m2_activity_capacity_publish_${nonce}`,
      published: false, boardVerified: false };
    await saveState(state);
    process.stdout.write('activity_500_draft_saved=passed\n');
  }
  if (!state.published) {
    const start = Date.now();
    const result = await call(teacher, 'activity-command', 'publish',
      { activityId: state.activityId }, state.publishOperationId, 1);
    requireOk(result, 'activity-publish');
    if (result.data?.status !== 'published' || result.data?.participants?.length !== 500
      || result.data?.dailyInstances?.length !== 2) {
      throw new Error('ACTIVITY_500_SNAPSHOT_INVALID');
    }
    state.published = true;
    await saveState(state);
    process.stdout.write(`activity_500_publish=passed;elapsedMs=${Date.now() - start}\n`);
  }
  const studentPassword = await preparePassword('demo_student_01');
  const student = await login('demo_student_01', 'student', studentPassword);
  const detail = await call(student, 'activity-query', 'getForStudent', { activityId: state.activityId });
  requireOk(detail, 'student-activity');
  if (detail.data?.participants?.length !== 500) throw new Error('STUDENT_500_ACTIVITY_MISSING');
  const start = Date.now();
  const board = await call(student, 'activity-query', 'getLeaderboard', { activityId: state.activityId });
  requireOk(board, 'student-leaderboard');
  if (board.data?.evidenceStatus !== 'available'
    || board.data?.leaderboard?.ranks?.length !== 500) throw new Error('LEADERBOARD_500_INVALID');
  state.boardVerified = true;
  await saveState(state);
  process.stdout.write(`activity_500_leaderboard=passed;elapsedMs=${Date.now() - start}\n`);
  process.stdout.write(`activity_capacity_id=${state.activityId}\n`);
  process.stdout.write('m2_activity_capacity_cloud_smoke=passed\n');
} catch (error) {
  process.stdout.write(`m2_activity_capacity_cloud_smoke=failed:${safe(error?.message)}\n`);
  if (state?.activityId) process.stdout.write(`activity_capacity_id=${state.activityId}\n`);
  process.exitCode = 2;
}
process.exit(process.exitCode ?? 0);

async function readState() {
  try {
    const value = JSON.parse(await readFile(statePath, 'utf8'));
    if (typeof value.activityId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/u.test(value.activityId)
      || typeof value.publishOperationId !== 'string' || typeof value.published !== 'boolean') {
      throw new Error('ACTIVITY_CAPACITY_STATE_INVALID');
    }
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
async function saveState(value) { await writeFile(statePath, JSON.stringify(value), 'utf8'); }
async function preparePassword(alias) {
  const { stdout } = await execute(process.execPath, [cli, 'user', 'list', '-e', envId,
    '--name', alias, '--json'], { cwd: root, encoding: 'utf8', windowsHide: true });
  const users = parse(stdout);
  const matches = Array.isArray(users.data) ? users.data.filter(row => row?.Name === alias) : [];
  if (matches.length !== 1) throw new Error('DEMO_ACCOUNT_UNAVAILABLE');
  const password = `YareiM2!${randomBytes(18).toString('base64url')}`;
  await execute(process.execPath, [cli, 'user', 'update', '-e', envId, matches[0].Uid,
    '--password', password, '--status', 'ACTIVE', '--json'],
  { cwd: root, encoding: 'utf8', windowsHide: true });
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
      new Promise((_, reject) => setTimeout(() => reject(new Error('CALL_TIMEOUT')), 60_000))]);
    return response?.result ?? { ok: false, error: { code: 'INVALID_RESPONSE' } };
  } catch (error) { return { ok: false, error: { code: safe(error?.code ?? error?.message) } }; }
}
function parse(output) {
  const starts = [output.indexOf('{'), output.indexOf('[')].filter(index => index >= 0);
  if (!starts.length) throw new Error('CLOUD_CLI_RESPONSE_UNAVAILABLE');
  return JSON.parse(output.slice(Math.min(...starts)));
}
function requireOk(result, stage) { if (!result?.ok) throw new Error(`${stage}_${safe(result?.error?.code)}`); }
function requiredString(value) { if (typeof value !== 'string' || !value) throw new Error('INVALID_RESPONSE'); return value; }
function safe(value) { return String(value ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80); }
