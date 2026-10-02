import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
try { require('@cloudbase/js-sdk').useAdapters(require('@cloudbase/adapter-node').default); } catch { /* SDK may self-register. */ }
const sdk = require('@cloudbase/js-sdk');
const activityId = 'activity_m2_animals_choice_demo';

try {
  const teacherPassword = await preparePassword('demo_teacher_01');
  const studentPassword = await preparePassword('demo_student_01');
  const teacher = await login('demo_teacher_01', 'teacher', teacherPassword);
  const before = await call(teacher, 'activity-query', 'listForTeacher', {});
  requireOk(before, 'teacher-list');
  const activity = Array.isArray(before.data) ? before.data.find(item => item?.id === activityId) : null;
  if (!activity || !['draft', 'published'].includes(activity.status)) throw new Error('ACTIVITY_DRAFT_UNAVAILABLE');
  if (activity.status === 'draft') {
    const published = await call(teacher, 'activity-command', 'publish', { activityId },
      'op_m2_publish_activity_seed_20260927', requiredNumber(activity.version));
    requireOk(published, 'activity-publish');
    if (published.data?.status !== 'published' || published.data?.participants?.length < 1
      || published.data?.dailyInstances?.length !== 6
      || !published.data?.schedule?.restDates?.includes('2026-10-04')) {
      throw new Error('ACTIVITY_SNAPSHOT_INVALID');
    }
    const retry = await call(teacher, 'activity-command', 'publish', { activityId },
      'op_m2_publish_activity_seed_20260927', requiredNumber(activity.version));
    requireOk(retry, 'activity-publish-retry');
    if (retry.data?.version !== published.data.version) throw new Error('ACTIVITY_PUBLISH_NOT_IDEMPOTENT');
    process.stdout.write(`activity_publish=passed;participants=${published.data.participants.length};active_days=6\n`);
  } else {
    process.stdout.write(`activity_publish=already-published;participants=${activity.participants?.length ?? -1}\n`);
  }
  const student = await login('demo_student_01', 'student', studentPassword);
  const detail = await call(student, 'activity-query', 'getForStudent', { activityId });
  requireOk(detail, 'student-activity');
  if (detail.data?.status !== 'published' || !detail.data?.participants?.some(item => item.studentId === 'usr_student_g3_01')) {
    throw new Error('STUDENT_ACTIVITY_NOT_VISIBLE');
  }
  const rest = await call(student, 'activity-query', 'getMyDay', { activityId, date: '2026-10-04' });
  requireOk(rest, 'student-rest-day');
  if (rest.data?.restDay !== true || rest.data?.complete !== null) throw new Error('REST_DAY_INVALID');
  const board = await call(student, 'activity-query', 'getLeaderboard', { activityId });
  if (!board.ok) process.stdout.write(`leaderboard_failure_request=${safe(board.meta?.requestId)}\n`);
  requireOk(board, 'student-leaderboard');
  if (board.data?.evidenceStatus !== 'available' || !board.data?.leaderboard) {
    throw new Error('LEADERBOARD_UNAVAILABLE');
  }
  process.stdout.write('student_activity_calendar_rest_day_and_leaderboard=passed\n');
  process.stdout.write('m2_activity_cloud_smoke=passed\n');
} catch (error) {
  process.stdout.write(`m2_activity_cloud_smoke=failed:${safe(error?.message)}\n`);
  process.exitCode = 2;
}
process.exit(process.exitCode ?? 0);

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
  const selected = await call({ app, token }, 'auth-session', 'selectRole', { role });
  requireOk(selected, 'select-role');
  return { app, token };
}
async function call(session, name, action, payload, operationId, expectedVersion) {
  try {
    const data = { apiVersion: 'm1.v1', action, payload,
      ...(session.token === null ? {} : { businessSessionToken: session.token }),
      ...(operationId === undefined ? {} : { operationId }),
      ...(expectedVersion === undefined ? {} : { expectedVersion }) };
    const response = await Promise.race([session.app.callFunction({ name, data, parse: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CALL_TIMEOUT')), 20_000))]);
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
