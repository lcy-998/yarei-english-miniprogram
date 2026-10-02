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
const readingId = 'res_reading_zoo_cloud_v2';
const packId = 'res_vocabulary_animals_cloud_v1';
const readingItemId = `read_m2_${nonce}`;
const wordItemId = `word_m2_${nonce}`;
let taskId = null;
let publishedVersion = null;
let teacherPassword = null;

try {
  const passwords = {};
  for (const alias of ['demo_student_01', 'demo_teacher_01', 'demo_parent_01']) {
    passwords[alias] = await preparePassword(alias);
  }
  teacherPassword = passwords.demo_teacher_01;
  const previewStudent = await login('demo_student_01', 'student', passwords.demo_student_01);
  const reading = await call(previewStudent, 'content-query', 'getReadingResource', { resourceId: readingId });
  const vocabulary = await call(previewStudent, 'content-query', 'getVocabularyPack', { resourceId: packId });
  requireOk(reading, 'reading-resource'); requireOk(vocabulary, 'vocabulary-resource');
  const chapter = reading.data?.chapters?.[0];
  const page = chapter?.pages?.[0];
  const word = vocabulary.data?.words?.[0];
  if (typeof chapter?.id !== 'string' || typeof page?.id !== 'string'
    || !Number.isSafeInteger(page?.pageNumber) || typeof word?.id !== 'string'
    || typeof word?.word !== 'string') throw new Error('RESOURCE_DETAIL_UNAVAILABLE');

  const teacher = await login('demo_teacher_01', 'teacher', teacherPassword);
  const now = Date.now();
  const draft = await call(teacher, 'task-command', 'saveDraft', {
    title: `M2 虚构阅读和单词云端闭环 ${nonce}`,
    itemRefs: [
      { id: readingItemId, resourceId: readingId,
        completionRule: { kind: 'reading_pages', requiredPageCount: 1, pageIds: [page.id] },
        scoringRule: { kind: 'completion_only' }, order: 1 },
      { id: wordItemId, resourceId: packId,
        completionRule: { kind: 'vocabulary_words', requiredWordCount: 1 },
        scoringRule: { kind: 'completion_only' }, order: 2 },
    ],
    target: { type: 'students', studentIds: ['usr_student_g3_01'] },
    startsAt: new Date(now - 60_000).toISOString(), dueAt: new Date(now + 86_400_000).toISOString(),
    latePolicy: { allowLate: true, lateDays: 7 }, description: '仅用于非生产虚构阅读和单词闭环。',
  }, `op_m2_read_word_draft_${nonce}`);
  requireOk(draft, 'draft');
  taskId = requiredString(draft.data?.taskId);
  const published = await call(teacher, 'task-command', 'publishTask', { taskId },
    `op_m2_read_word_publish_${nonce}`, requiredNumber(draft.data?.version));
  requireOk(published, 'publish');
  publishedVersion = requiredNumber(published.data?.version);
  process.stdout.write('teacher_reading_vocabulary_publish=passed\n');

  const student = await login('demo_student_01', 'student', passwords.demo_student_01);
  const detail = await call(student, 'student-task-query', 'getMyTask', { taskId });
  requireOk(detail, 'student-task');
  if (detail.data?.items?.length !== 2
    || detail.data.items[0]?.completionRule?.pageIds?.[0] !== page.id
    || detail.data.items[1]?.resourceId !== packId) throw new Error('TASK_SNAPSHOT_MISMATCH');
  const progress = await call(student, 'learning-progress-query', 'getReadingProgress', { resourceId: readingId });
  requireOk(progress, 'reading-progress');
  const visit = await call(student, 'learning-progress-command', 'saveReadingProgress', {
    resourceId: readingId, chapterId: chapter.id, pageId: page.id,
    pageNumber: page.pageNumber, favorite: progress.data?.favorite ?? false,
  }, `op_m2_read_page_${nonce}`, progress.data?.version ?? 0);
  requireOk(visit, 'reading-page-visit');
  process.stdout.write('student_specified_page_event=passed\n');

  const state = await call(student, 'vocabulary-evidence-query', 'getWordAttemptState',
    { packId, wordId: word.id, taskId, itemId: wordItemId });
  requireOk(state, 'word-state');
  const attempt = await call(student, 'vocabulary-evidence-command', 'submitWordAnswer',
    { packId, wordId: word.id, taskId, itemId: wordItemId, studentInput: word.word },
    `op_m2_word_attempt_${nonce}`, state.data?.version ?? 0);
  requireOk(attempt, 'word-attempt');
  if (attempt.data?.firstAttempt !== true || attempt.data?.isCorrect !== true) {
    throw new Error('WORD_FIRST_ATTEMPT_INVALID');
  }
  process.stdout.write('student_first_word_attempt=passed\n');

  const answer = { taskId, answers: [
    { itemId: readingItemId, value: { kind: 'reading', completedPageCount: 1 } },
    { itemId: wordItemId, value: { kind: 'vocabulary', completedWordCount: 1, correctWordCount: 1 } },
  ] };
  const assignmentVersion = requiredNumber(detail.data?.assignment?.version);
  const submitted = await call(student, 'submission-command', 'submit', answer,
    `op_m2_read_word_submit_${nonce}`, assignmentVersion);
  requireOk(submitted, 'submit');
  process.stdout.write('student_reading_vocabulary_submit=passed\n');

  const reviewer = await login('demo_teacher_01', 'teacher', teacherPassword);
  const evidence = await call(reviewer, 'review-query', 'getSubmissionForReview',
    { submissionId: requiredString(submitted.data?.submissionId) });
  requireOk(evidence, 'review-read');
  const serialized = JSON.stringify(evidence.data ?? null);
  if (!serialized.includes(page.id) || !serialized.includes(word.id)
    || !serialized.includes(word.word)) throw new Error('ITEM_EVIDENCE_MISSING');
  const review = await call(reviewer, 'review-command', 'publishReview', {
    submissionId: requiredString(submitted.data?.submissionId), decision: 'approved',
    score: 100, textComment: '虚构阅读和单词云端联调点评。',
    expectedSubmissionVersion: requiredNumber(evidence.data?.submissionVersion),
  }, `op_m2_read_word_review_${nonce}`, requiredNumber(evidence.data?.assignmentVersion));
  requireOk(review, 'review-publish');
  process.stdout.write('teacher_page_word_evidence_and_review=passed\n');

  const parent = await login('demo_parent_01', 'parent', passwords.demo_parent_01);
  const feedback = await call(parent, 'parent-query', 'getFeedback',
    { childId: 'usr_student_g3_01', feedbackId: requiredString(review.data?.feedbackId) });
  requireOk(feedback, 'parent-feedback');
  process.stdout.write('parent_reading_vocabulary_feedback=passed\n');
  const cleanupTeacher = await login('demo_teacher_01', 'teacher', teacherPassword);
  const recycled = await call(cleanupTeacher, 'task-command', 'recycleTask',
    { taskId, reason: 'M2 虚构阅读单词联调结束回收。' },
    `op_m2_read_word_recycle_${nonce}`, publishedVersion);
  requireOk(recycled, 'recycle');
  process.stdout.write('m2_reading_vocabulary_cloud_loop=passed\ncleanup=recycled\n');
} catch (error) {
  let cleanup = 'not-needed';
  if (taskId !== null && publishedVersion !== null && teacherPassword !== null) {
    try {
      const teacher = await login('demo_teacher_01', 'teacher', teacherPassword);
      const result = await call(teacher, 'task-command', 'recycleTask',
        { taskId, reason: 'M2 虚构阅读单词联调失败后回收。' },
        `op_m2_read_word_failure_recycle_${nonce}`, publishedVersion);
      cleanup = result.ok ? 'recycled' : `failed_${safe(result.error?.code)}`;
    } catch { cleanup = 'failed'; }
  }
  process.stdout.write(`m2_reading_vocabulary_cloud_loop=failed:${safe(error?.message)};cleanup=${cleanup}\n`);
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
