import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries((await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u).flatMap(line => {
  const index = line.indexOf('=');
  return index > 0 ? [[line.slice(0, index).trim(), line.slice(index + 1).trim()]] : [];
}));
const envId = env.TCB_ENV_ID;
if (!envId) throw new Error('MISSING_DEV_ENVIRONMENT');
const sdk = require('@cloudbase/js-sdk');
sdk.useAdapters(require('@cloudbase/adapter-node').default);
const cli = { command: process.execPath, arguments: [resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')] };
const nonce = randomBytes(8).toString('hex');
const publishOperationId = `op_teacher_diag_publish_${nonce}`;
let createdTaskId = null;
let createdVersion = null;
let teacher = null;
let stage = 'prepare';
let cleanupState = 'not-needed';

try {
  const account = await cliJson(['user', 'list', '-e', envId, '--name', 'demo_teacher_01', '--json']);
  const user = Array.isArray(account.data) ? account.data.find(item => item?.Name === 'demo_teacher_01') : null;
  if (!user?.Uid) throw new Error('VIRTUAL_TEACHER_UNAVAILABLE');
  const password = `YareiM1!${randomBytes(18).toString('base64url')}`;
  await cliJson(['user', 'update', '-e', envId, user.Uid, '--password', password, '--status', 'ACTIVE', '--json']);
  const app = sdk.init({ env: envId });
  await app.auth({ persistence: 'local' }).signInWithPassword({ username: 'demo_teacher_01', password });
  const boot = await call(app, 'auth-session', 'bootstrap', {}, null);
  assertOk(boot, 'bootstrap');
  const token = boot.data?.sessionId;
  if (typeof token !== 'string') throw new Error('MISSING_BUSINESS_SESSION');
  const selected = await call(app, 'auth-session', 'selectRole', { role: 'teacher' }, token);
  assertOk(selected, 'select-role');
  teacher = { app, token };

  stage = 'draft-options';
  const options = await call(app, 'task-query', 'getDraftOptions', {}, token);
  assertOk(options, stage);
  const classOption = options.data?.classes?.find(item => item.name?.includes('三年级 2 班'));
  if (!classOption?.id) throw new Error('VIRTUAL_CLASS_UNAVAILABLE');
  const studentPage = await call(app, 'teacher-student-query', 'listStudents', { filters: { status: 'all', classId: classOption.id }, page: { limit: 50 } }, token);
  assertOk(studentPage, 'class-count');
  const count = studentPage.data?.total;
  if (!Number.isSafeInteger(count) || count < 1 || count > 50) throw new Error('CLASS_CAPACITY_OUT_OF_RANGE');
  const items = [];
  for (const type of ['reading', 'vocabulary', 'exercise']) {
    const resource = options.data?.resources?.find(item => item.type === type && item.allowedClassIds?.includes(classOption.id));
    if (!resource) continue;
    const requiredCount = type === 'reading' ? resource.completionRule?.requiredPageCount
      : type === 'vocabulary' ? resource.completionRule?.requiredWordCount : resource.completionRule?.requiredQuestionCount;
    if (!Number.isSafeInteger(requiredCount) || requiredCount < 1) continue;
    items.push({ id: `item_${type}`, resourceId: resource.id,
      completionRule: type === 'reading' ? { kind: 'reading_pages', requiredPageCount: requiredCount }
        : type === 'vocabulary' ? { kind: 'vocabulary_words', requiredWordCount: requiredCount }
          : { kind: 'exercise_questions', requiredQuestionCount: requiredCount },
      scoringRule: { kind: 'manual', maxScore: Number.isSafeInteger(resource.scoringRule?.maxScore) ? resource.scoringRule.maxScore : 100 }, order: items.length + 1,
    });
  }
  if (items.length === 0) throw new Error('NO_AUTHORIZED_RESOURCES');
  const startsAt = new Date();
  const dueAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
  const payload = { title: `${options.data.resources.find(item => item.id === items[0].resourceId)?.title ?? '虚构课堂'}学习任务`,
    description: '', teacherNote: '', itemRefs: items, target: { type: 'classes', classIds: [classOption.id] },
    startsAt: startsAt.toISOString(), dueAt: dueAt.toISOString(), latePolicy: { allowLate: true, lateDays: 7 },
  };

  stage = 'save-draft';
  const draft = await call(app, 'task-command', 'saveDraft', payload, token, { operationId: publishOperationId });
  if (!draft.ok) throw codedError(stage, draft);
  createdTaskId = draft.data?.taskId;
  createdVersion = draft.data?.version;
  if (typeof createdTaskId !== 'string' || !Number.isSafeInteger(createdVersion)) throw new Error('INVALID_DRAFT_RECEIPT');

  stage = 'publish-task';
  const published = await call(app, 'task-command', 'publishTask', { taskId: createdTaskId }, token,
    { operationId: publishOperationId, expectedVersion: createdVersion });
  if (!published.ok) throw codedError(stage, published);
  createdVersion = published.data?.version;
  if (!Number.isSafeInteger(createdVersion)) throw new Error('INVALID_PUBLISH_RECEIPT');
  process.stdout.write(`publish_diagnostic=passed; class_count=${count}; item_count=${items.length}\n`);
} catch (error) {
  const code = safeCode(error?.code ?? error?.message ?? 'UNKNOWN');
  const fieldErrors = error?.fieldErrors && typeof error.fieldErrors === 'object'
    ? Object.entries(error.fieldErrors).filter(([key, value]) => /^[A-Za-z0-9_.\[\]-]{1,80}$/.test(key) && typeof value === 'string').map(([key, value]) => `${key}:${safeMessage(value)}`).slice(0, 8).join('|')
    : '';
  process.stdout.write(`publish_diagnostic=failed; stage=${stage}; code=${code}${fieldErrors ? `; field_errors=${fieldErrors}` : ''}\n`);
  process.exitCode = 2;
} finally {
  if (createdTaskId && Number.isSafeInteger(createdVersion) && teacher) {
    cleanupState = 'failed';
    for (let attempt = 0; attempt < 3; attempt++) {
      const cleanup = await call(teacher.app, 'task-command', 'recycleTask', { taskId: createdTaskId, reason: 'M1 虚构教师发布诊断后精确回收。' }, teacher.token,
        { operationId: `op_teacher_diag_cleanup_${nonce}`, expectedVersion: createdVersion });
      if (cleanup.ok) { cleanupState = 'recycled'; break; }
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    if (cleanupState !== 'recycled') {
      const privatePath = join(tmpdir(), `yarei-m1-publish-cleanup-${nonce}.json`);
      await writeFile(privatePath, JSON.stringify({ envId, taskId: createdTaskId, version: createdVersion }), { mode: 0o600 });
      process.stdout.write('cleanup=failed; private_cleanup_record_saved=true\n');
    }
  }
  process.stdout.write(`cleanup=${cleanupState}\n`);
  await new Promise(resolve => process.stdout.write('', resolve));
  process.exit(process.exitCode ?? 0);
}

async function call(app, name, action, payload, token, options = {}) {
  try {
    const response = await Promise.race([
      app.callFunction({ name, data: { apiVersion: 'm1.v1', action, payload,
        ...(token === null ? {} : { businessSessionToken: token }), ...options }, parse: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CALL_TIMEOUT')), 25000)),
    ]);
    return response?.result ?? { ok: false, error: { code: 'INVALID_RESPONSE' } };
  } catch (error) { return { ok: false, error: { code: safeCode(error?.code ?? error?.message ?? 'NETWORK_ERROR') } }; }
}

async function cliJson(args) {
  const { stdout } = await execute(cli.command, [...cli.arguments, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  const start = Math.min(...[stdout.indexOf('{'), stdout.indexOf('[')].filter(index => index >= 0));
  return JSON.parse(stdout.slice(start));
}

function assertOk(result, step) { if (!result?.ok) throw codedError(step, result); }
function codedError(step, result) { return { code: result?.error?.code ?? 'UNKNOWN', fieldErrors: result?.error?.fieldErrors, message: step }; }
function safeCode(value) { return String(value).replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80); }
function safeMessage(value) { return String(value).replace(/[\r\n;|]/gu, ' ').slice(0, 120); }
