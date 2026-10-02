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
const nonce = randomBytes(10).toString('hex');
const resourceId = 'res_m2_exercise_animals_choice_demo';
const itemId = `item_m2_loop_${nonce}`;
let taskId = null;
let publishedVersion = null;
let teacherPassword = null;

try {
  const passwords = {};
  for (const alias of ['demo_teacher_01', 'demo_student_01', 'demo_parent_01']) {
    passwords[alias] = await preparePassword(alias);
  }
  teacherPassword = passwords.demo_teacher_01;
  const teacher = await login('demo_teacher_01', 'teacher', teacherPassword);
  const now = Date.now();
  const draft = await call(teacher, 'task-command', 'saveDraft', {
    title: `M2 虚构习题云端闭环 ${nonce}`,
    itemRefs: [{ id: itemId, resourceId,
      completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
      scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }],
    target: { type: 'students', studentIds: ['usr_student_g3_01'] },
    startsAt: new Date(now - 60_000).toISOString(), dueAt: new Date(now + 86_400_000).toISOString(),
    latePolicy: { allowLate: true, lateDays: 7 }, description: '仅用于非生产虚构习题闭环。',
  }, `op_m2_draft_${nonce}`);
  requireOk(draft, 'draft');
  taskId = requiredString(draft.data?.taskId);
  const published = await call(teacher, 'task-command', 'publishTask', { taskId },
    `op_m2_publish_${nonce}`, requiredNumber(draft.data?.version));
  requireOk(published, 'publish');
  publishedVersion = requiredNumber(published.data?.version);
  process.stdout.write('teacher_exercise_publish=passed\n');

  const student = await login('demo_student_01', 'student', passwords.demo_student_01);
  const task = await call(student, 'student-task-query', 'getMyTask', { taskId });
  requireOk(task, 'student-task');
  if (task.data?.items?.length !== 1 || task.data.items[0]?.resourceId !== resourceId) {
    throw new Error('TASK_SNAPSHOT_MISMATCH');
  }
  const answer = { taskId, answers: [{ itemId,
    value: { kind: 'exercise', questionResponses: [{ questionId: resourceId, response: 'cat' }] } }] };
  const assignmentVersion = requiredNumber(task.data?.assignment?.version);
  const operationId = `op_m2_submit_${nonce}`;
  const first = await call(student, 'submission-command', 'submit', answer, operationId, assignmentVersion);
  requireOk(first, 'student-submit');
  const retry = await call(student, 'submission-command', 'submit', answer, operationId, assignmentVersion);
  requireOk(retry, 'student-submit-retry');
  if (first.data?.submissionId !== retry.data?.submissionId) throw new Error('SUBMISSION_NOT_IDEMPOTENT');
  process.stdout.write('student_exercise_submit=passed\nsubmission_retry=single-write\n');

  const reviewer = await login('demo_teacher_01', 'teacher', teacherPassword);
  const reviewView = await call(reviewer, 'review-query', 'getSubmissionForReview',
    { submissionId: requiredString(first.data?.submissionId) });
  requireOk(reviewView, 'review-read');
  if (!JSON.stringify(reviewView.data ?? null).includes('"response":"cat"')) {
    throw new Error('EXERCISE_RESPONSE_EVIDENCE_MISSING');
  }
  const review = await call(reviewer, 'review-command', 'publishReview', {
    submissionId: requiredString(first.data?.submissionId), decision: 'approved',
    score: 100, textComment: '虚构习题云端联调点评。',
    expectedSubmissionVersion: requiredNumber(reviewView.data?.submissionVersion),
  }, `op_m2_review_${nonce}`, requiredNumber(reviewView.data?.assignmentVersion));
  requireOk(review, 'review-publish');
  process.stdout.write('teacher_exercise_evidence_and_review=passed\n');

  const studentInbox = await login('demo_student_01', 'student', passwords.demo_student_01);
  const notices = await call(studentInbox, 'notification-query', 'list',
    { filter: 'all', offset: 0, limit: 50, days: 30 });
  requireOk(notices, 'student-inbox');
  const taskNotices = Array.isArray(notices.data?.items)
    ? notices.data.items.filter(item => item?.target?.id === taskId) : [];
  if (!taskNotices.some(item => item.kind === 'task_published')
    || !taskNotices.some(item => item.kind === 'task_reviewed')
    || new Set(taskNotices.map(item => item.id)).size !== taskNotices.length) {
    throw new Error('STUDENT_TASK_NOTICES_MISSING_OR_DUPLICATE');
  }
  const reviewedNotice = taskNotices.find(item => item.kind === 'task_reviewed');
  const marked = await call(studentInbox, 'notification-command', 'markRead',
    { noticeId: requiredString(reviewedNotice?.id) }, `op_m2_notice_${nonce}`);
  requireOk(marked, 'student-notice-read');
  const reread = await call(studentInbox, 'notification-query', 'list',
    { filter: 'feedback', offset: 0, limit: 50, days: 30 });
  requireOk(reread, 'student-inbox-reread');
  if (!reread.data?.items?.some(item => item.id === reviewedNotice.id && item.readAt)) {
    throw new Error('STUDENT_NOTICE_READ_STATE_MISSING');
  }
  process.stdout.write('student_notifications_publish_review_and_read=passed\n');

  const parent = await login('demo_parent_01', 'parent', passwords.demo_parent_01);
  const feedback = await call(parent, 'parent-query', 'getFeedback',
    { childId: 'usr_student_g3_01', feedbackId: requiredString(review.data?.feedbackId) });
  requireOk(feedback, 'parent-feedback');
  process.stdout.write('parent_exercise_feedback=passed\n');
  const parentNotices = await call(parent, 'notification-query', 'list',
    { filter: 'feedback', offset: 0, limit: 50, days: 30 });
  requireOk(parentNotices, 'parent-inbox');
  if (!parentNotices.data?.items?.some(item => item.kind === 'task_reviewed'
    && item.target?.id === taskId && item.target?.childId === 'usr_student_g3_01')) {
    throw new Error('PARENT_REVIEW_NOTICE_MISSING');
  }
  process.stdout.write('parent_review_notification=passed\n');

  const cleanupTeacher = await login('demo_teacher_01', 'teacher', teacherPassword);
  const recycled = await call(cleanupTeacher, 'task-command', 'recycleTask',
    { taskId, reason: 'M2 虚构习题联调结束回收。' },
    `op_m2_recycle_${nonce}`, publishedVersion);
  requireOk(recycled, 'recycle');
  process.stdout.write('m2_exercise_cloud_loop=passed\ncleanup=recycled\n');
} catch (error) {
  let cleanup = 'not-needed';
  if (taskId !== null && publishedVersion !== null && teacherPassword !== null) {
    try {
      const teacher = await login('demo_teacher_01', 'teacher', teacherPassword);
      const result = await call(teacher, 'task-command', 'recycleTask',
        { taskId, reason: 'M2 虚构习题联调失败后回收。' },
        `op_m2_failure_recycle_${nonce}`, publishedVersion);
      cleanup = result.ok ? 'recycled' : `failed_${safe(result.error?.code)}`;
    } catch { cleanup = 'failed'; }
  }
  process.stdout.write(`m2_exercise_cloud_loop=failed:${safe(error?.message)};cleanup=${cleanup}\n`);
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
    const request = session.app.callFunction({ name, data, parse: true });
    const response = await Promise.race([request,
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
function requireOk(result, stage) {
  if (!result?.ok) throw new Error(`${stage}_${safe(result?.error?.code)}`);
}
function requiredString(value) { if (typeof value !== 'string' || !value) throw new Error('INVALID_RESPONSE'); return value; }
function requiredNumber(value) { if (!Number.isSafeInteger(value) || value < 1) throw new Error('INVALID_RESPONSE'); return value; }
function safe(value) { return String(value ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80); }
