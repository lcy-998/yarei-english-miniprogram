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
const courseId = 'phonics_m2_short_a_demo';

try {
  const password = await preparePassword('demo_student_01');
  const app = sdk.init({ env: envId });
  await app.auth({ persistence: 'local' }).signInWithPassword({ username: 'demo_student_01', password });
  const bootstrap = await call(app, 'auth-session', 'bootstrap', {}, null);
  requireOk(bootstrap, 'bootstrap');
  const token = requiredString(bootstrap.data?.sessionId);
  requireOk(await call(app, 'auth-session', 'selectRole', { role: 'student' }, token), 'select-role');
  const course = await call(app, 'phonics-query', 'getCourse', { courseId }, token);
  requireOk(course, 'course');
  if (!JSON.stringify(course.data ?? null).includes('question_m2_short_a_demo')) {
    throw new Error('COURSE_QUESTION_MISSING');
  }
  const before = await call(app, 'phonics-query', 'getState', { courseId }, token);
  requireOk(before, 'state-before');
  const previous = before.data?.questions?.find(item => item.questionId === 'question_m2_short_a_demo');
  if (!Number.isSafeInteger(previous?.version) || !Number.isSafeInteger(before.data?.currentRound)) {
    throw new Error('STATE_VERSION_INVALID');
  }
  const round = previous.version === 0 ? before.data.currentRound : before.data.currentRound + 1;
  const version = 0;
  const operationId = `op_m2_phonics_${randomBytes(10).toString('hex')}`;
  const answer = { courseId, questionId: 'question_m2_short_a_demo',
    selectedOptionId: 'option_m2_cat_demo', round };
  const first = await call(app, 'phonics-command', 'submitAnswer', answer, token, operationId, version);
  requireOk(first, 'answer');
  const retry = await call(app, 'phonics-command', 'submitAnswer', answer, token, operationId, version);
  requireOk(retry, 'answer-retry');
  if (JSON.stringify(first.data) !== JSON.stringify(retry.data)) throw new Error('ANSWER_NOT_IDEMPOTENT');
  const after = await call(app, 'phonics-query', 'getState', { courseId }, token);
  requireOk(after, 'state-after');
  const current = after.data?.questions?.find(item => item.questionId === 'question_m2_short_a_demo');
  if (after.data?.currentRound !== round || !Number.isSafeInteger(current?.version)
    || current.version < 1 || after.data.completedCount < 1) {
    throw new Error('PHONICS_PROGRESS_MISSING');
  }
  process.stdout.write('phonics_text_answer_and_progress=passed\nphonics_answer_retry=single-write\n');
  process.stdout.write('m2_phonics_cloud_smoke=passed\n');
} catch (error) {
  process.stdout.write(`m2_phonics_cloud_smoke=failed:${safe(error?.message)}\n`);
  process.exitCode = 2;
}
process.exit(process.exitCode ?? 0);

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
async function call(app, name, action, payload, token, operationId, expectedVersion) {
  try {
    const data = { apiVersion: 'm1.v1', action, payload,
      ...(token === null ? {} : { businessSessionToken: token }),
      ...(operationId === undefined ? {} : { operationId }),
      ...(expectedVersion === undefined ? {} : { expectedVersion }) };
    const response = await Promise.race([app.callFunction({ name, data, parse: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CALL_TIMEOUT')), 20_000))]);
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
