import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries((await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u).flatMap((line) => {
  const i = line.indexOf('='); return i > 0 ? [[line.slice(0, i).trim(), line.slice(i + 1).trim()]] : [];
}));
const envId = required(env.TCB_ENV_ID);
const require = createRequire(import.meta.url);
try { require('@cloudbase/adapter-node'); } catch { /* Supported runtimes may not need it. */ }
const sdk = require('@cloudbase/js-sdk');
const cli = { command: process.execPath, arguments: [resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')] };
const testId = randomBytes(12).toString('base64url');
let publishedTask = null;
let publishedVersion = null;
let lastRequestId = null;

try {
  const credentials = await prepareCredentials(['demo_parent_01', 'demo_student_01', 'demo_teacher_01']);
  process.stdout.write('stage=teacher-login\n');
  const teacher = await loginWithPassword('demo_teacher_01', 'teacher', credentials.demo_teacher_01);
  const now = Date.now();
  process.stdout.write('stage=save-draft\n');
  const draft = await call(teacher.app, 'task-command', 'saveDraft', {
    title: `M1 虚构闭环 ${testId}`,
    itemRefs: [{ id: `item_${testId}`, resourceId: 'res_reading_zoo_demo', completionRule: { kind: 'reading_pages', requiredPageCount: 1 }, scoringRule: { kind: 'completion_only' }, order: 1 }],
    target: { type: 'students', studentIds: ['usr_student_g3_01'] },
    startsAt: new Date(now - 60_000).toISOString(), dueAt: new Date(now + 86_400_000).toISOString(),
    latePolicy: { allowLate: true, lateDays: 7 }, description: '仅用于 M1 虚构联调。',
  }, teacher.token, { operationId: `op_loop_draft_${testId}` });
  assertOk(draft, 'save-draft');
  publishedTask = stringValue(draft.data.taskId);
  process.stdout.write('stage=publish-task\n');
  const published = await call(teacher.app, 'task-command', 'publishTask', { taskId: publishedTask }, teacher.token, { expectedVersion: numberValue(draft.data.version), operationId: `op_loop_publish_${testId}` });
  assertOk(published, 'publish-task');
  publishedVersion = numberValue(published.data.version);

  process.stdout.write('stage=student-login\n');
  const student = await loginWithPassword('demo_student_01', 'student', credentials.demo_student_01);
  const detail = await call(student.app, 'student-task-query', 'getMyTask', { taskId: publishedTask }, student.token);
  assertOk(detail, 'student-read-task');
  const assignmentVersion = numberValue(detail.data.assignment?.version);
  const submitPayload = { taskId: publishedTask, answers: [{ itemId: `item_${testId}`, value: { kind: 'reading', completedPageCount: 1 } }] };
  const submitOptions = { expectedVersion: assignmentVersion, operationId: `op_loop_submit_${testId}` };
  process.stdout.write('stage=student-submit\n');
  const firstSubmit = await call(student.app, 'submission-command', 'submit', submitPayload, student.token, submitOptions);
  const retrySubmit = await call(student.app, 'submission-command', 'submit', submitPayload, student.token, submitOptions);
  assertOk(firstSubmit, 'student-submit'); assertOk(retrySubmit, 'student-submit-retry');
  if (stringValue(firstSubmit.data.submissionId) !== stringValue(retrySubmit.data.submissionId)) throw new Error('IDEMPOTENCY_FAILURE');

  process.stdout.write('stage=reviewer-login\n');
  const reviewer = await loginWithPassword('demo_teacher_01', 'teacher', credentials.demo_teacher_01);
  process.stdout.write('stage=review-read-submission\n');
  const reviewView = await call(reviewer.app, 'review-query', 'getSubmissionForReview', { submissionId: stringValue(firstSubmit.data.submissionId) }, reviewer.token);
  assertOk(reviewView, 'teacher-read-submission');
  process.stdout.write('stage=publish-review\n');
  const review = await call(reviewer.app, 'review-command', 'publishReview', {
    submissionId: stringValue(firstSubmit.data.submissionId), decision: 'approved', score: 88,
    textComment: '虚构联调点评。', expectedSubmissionVersion: numberValue(reviewView.data.submissionVersion),
  }, reviewer.token, { expectedVersion: numberValue(reviewView.data.assignmentVersion), operationId: `op_loop_review_${testId}` });
  assertOk(review, 'teacher-review');
  process.stdout.write('stage=review-complete\n');

  process.stdout.write('stage=parent-login\n');
  const parent = await loginWithPassword('demo_parent_01', 'parent', credentials.demo_parent_01);
  process.stdout.write('stage=parent-read-feedback\n');
  const feedback = await call(parent.app, 'parent-query', 'getFeedback', { childId: 'usr_student_g3_01', feedbackId: stringValue(review.data.feedbackId) }, parent.token);
  assertOk(feedback, 'parent-read-feedback');

  process.stdout.write('stage=cleanup-login\n');
  const cleanupReviewer = await loginWithPassword('demo_teacher_01', 'teacher', credentials.demo_teacher_01);
  const cleanup = await call(cleanupReviewer.app, 'task-command', 'recycleTask', { taskId: publishedTask, reason: 'M1 虚构联调结束回收。' }, cleanupReviewer.token, { expectedVersion: publishedVersion, operationId: `op_loop_recycle_${testId}` });
  assertOk(cleanup, 'recycle-task');
  process.stdout.write('main_loop=passed\nsubmission_retry=single-write\ncleanup=recycled\n');
} catch (error) {
  process.stdout.write(`main_loop=failed:${safe(error)}; log_category=${await logCategory()}\n`);
  process.exitCode = 2;
}

async function prepareCredentials(aliases) {
  const credentials = {};
  for (const alias of aliases) {
    const users = await cliJson(['user', 'list', '-e', envId, '--name', alias, '--json']);
    const account = Array.isArray(users.data) ? users.data.find((item) => item?.Name === alias) : null;
    if (!account?.Uid) throw new Error('ACCOUNT_UNAVAILABLE');
    const password = `YareiM1!${randomBytes(18).toString('base64url')}`;
    await cliJson(['user', 'update', '-e', envId, account.Uid, '--password', password, '--status', 'ACTIVE', '--json']);
    credentials[alias] = password;
  }
  return credentials;
}
async function loginWithPassword(alias, role, password) {
  process.stdout.write(`login-step=auth-${role}\n`);
  const app = sdk.init({ env: envId });
  await app.auth({ persistence: 'local' }).signInWithPassword({ username: alias, password });
  const functionName = role === 'admin' ? 'admin-session' : 'auth-session';
  const boot = await call(app, functionName, 'bootstrap', {}, null); assertOk(boot, 'bootstrap');
  process.stdout.write(`login-step=bootstrap-${role}\n`);
  const token = role === 'admin' ? stringValue(boot.data.token) : stringValue(boot.data.sessionId);
  if (role !== 'admin') { const selected = await call(app, 'auth-session', 'selectRole', { role }, token); assertOk(selected, 'select-role'); }
  return { app, token };
}
async function call(app, name, action, payload, token, extras = {}) {
  try { const request = app.callFunction({ name, data: { apiVersion: 'm1.v1', action, payload, ...(token === null ? {} : { businessSessionToken: token }), ...extras }, parse: true }); const response = await Promise.race([request, new Promise((_, reject) => setTimeout(() => reject(new Error('CALL_TIMEOUT')), 20_000))]); const result = response?.result ?? { ok: false, error: { code: 'INVALID_RESPONSE' } }; if (!result.ok && typeof result.meta?.requestId === 'string') lastRequestId = result.meta.requestId; return result; }
  catch (error) { return { ok: false, error: { code: safe(error) } }; }
}
async function cliJson(args) { const { stdout } = await exec(cli.command, [...cli.arguments, ...args], { cwd: root, encoding: 'utf8', windowsHide: true }); const i = Math.min(...[stdout.indexOf('{'), stdout.indexOf('[')].filter((v) => v >= 0)); return JSON.parse(stdout.slice(i)); }
function assertOk(result, step) { if (!result?.ok) throw new Error(`${step}_${result?.error?.code ?? 'FAILED'}`); }
function stringValue(value) { if (typeof value !== 'string' || value.length === 0) throw new Error('INVALID_RESPONSE'); return value; }
function numberValue(value) { if (!Number.isSafeInteger(value) || value < 1) throw new Error('INVALID_RESPONSE'); return value; }
function required(value) { if (typeof value !== 'string' || value.trim().length === 0) throw new Error('CONFIG_UNAVAILABLE'); return value.trim(); }
function safe(error) { return String(error?.message ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80); }
async function logCategory() {
  if (lastRequestId === null) return 'unavailable';
  try {
    const { stdout } = await exec(cli.command, [...cli.arguments, 'fn', 'log', 'task-command', '--reqId', lastRequestId, '--json'], { cwd: root, encoding: 'utf8', windowsHide: true });
    const value = stdout.toLowerCase();
    if (value.includes('invalidparameter') || value.includes('invalid parameter')) return 'invalid-parameter';
    if (value.includes('permission') || value.includes('forbidden')) return 'permission';
    if (value.includes('transaction')) return 'transaction';
    if (value.includes('duplicate')) return 'duplicate';
    if (value.includes('not found') || value.includes('not_found')) return 'not-found';
    return 'unclassified';
  } catch { return 'unavailable'; }
}
