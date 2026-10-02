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
const templateId = 'template_m2_animals_choice_demo';
const resourceId = 'res_m2_exercise_animals_choice_demo';
const nonce = randomBytes(10).toString('hex');
let taskId = null;
let publishedVersion = null;
let teacherPassword = null;

try {
  teacherPassword = await preparePassword('demo_teacher_01');
  const teacher = await login(teacherPassword);
  const list = await call(teacher, 'task-template-query', 'listTemplates', {});
  requireOk(list, 'template-list');
  const templates = Array.isArray(list.data) ? list.data : list.data?.items;
  const template = Array.isArray(templates) ? templates.find(item => item?.id === templateId) : null;
  if (!template || !Number.isSafeInteger(template.version)
    || !Number.isSafeInteger(template.useCount)) throw new Error('TEMPLATE_UNAVAILABLE');
  const operationId = `op_m2_template_use_${nonce}`;
  const created = await call(teacher, 'task-command', 'instantiateTemplate', { templateId },
    operationId, template.version);
  requireOk(created, 'template-instantiate');
  taskId = requiredString(created.data?.taskId);
  const retry = await call(teacher, 'task-command', 'instantiateTemplate', { templateId },
    operationId, template.version);
  requireOk(retry, 'template-instantiate-retry');
  if (retry.data?.taskId !== taskId) throw new Error('TEMPLATE_USE_NOT_IDEMPOTENT');
  const after = await call(teacher, 'task-template-query', 'listTemplates', {});
  requireOk(after, 'template-list-after');
  const nextTemplates = Array.isArray(after.data) ? after.data : after.data?.items;
  const next = Array.isArray(nextTemplates) ? nextTemplates.find(item => item?.id === templateId) : null;
  if (next?.useCount !== template.useCount + 1 || next?.version !== template.version + 1) {
    throw new Error('TEMPLATE_USE_COUNT_MISMATCH');
  }
  const edit = await call(teacher, 'task-query', 'getTaskForEdit', { taskId });
  requireOk(edit, 'template-task-edit');
  if (edit.data?.copiedFromTemplateId !== templateId
    || !JSON.stringify(edit.data?.items ?? []).includes(resourceId)) {
    throw new Error('TEMPLATE_FROZEN_ITEM_MISSING');
  }
  process.stdout.write('template_instantiate_snapshot_and_idempotency=passed\n');

  const now = Date.now();
  const saved = await call(teacher, 'task-command', 'saveDraft', {
    taskId, title: edit.data.title ?? '虚构动物词汇练习模板',
    itemRefs: [{ id: 'item_m2_animals_choice_demo', resourceId,
      completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
      scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }],
    target: { type: 'students', studentIds: ['usr_student_g3_01'] },
    startsAt: new Date(now - 60_000).toISOString(), dueAt: new Date(now + 86_400_000).toISOString(),
    latePolicy: { allowLate: true, lateDays: 7 }, description: '虚构模板云端联调。',
  }, `op_m2_template_draft_${nonce}`, requiredNumber(edit.data.version));
  requireOk(saved, 'template-draft-save');
  const published = await call(teacher, 'task-command', 'publishTask', { taskId },
    `op_m2_template_publish_${nonce}`, requiredNumber(saved.data?.version));
  requireOk(published, 'template-publish');
  publishedVersion = requiredNumber(published.data?.version);
  const recycled = await call(teacher, 'task-command', 'recycleTask',
    { taskId, reason: 'M2 虚构模板联调结束回收。' },
    `op_m2_template_recycle_${nonce}`, publishedVersion);
  requireOk(recycled, 'template-recycle');
  process.stdout.write('template_task_publish_and_recycle=passed\n');
  process.stdout.write('m2_template_cloud_smoke=passed\n');
} catch (error) {
  let cleanup = 'not-needed';
  if (taskId !== null && publishedVersion !== null && teacherPassword !== null) {
    try {
      const teacher = await login(teacherPassword);
      const result = await call(teacher, 'task-command', 'recycleTask',
        { taskId, reason: 'M2 虚构模板联调失败后回收。' },
        `op_m2_template_failure_recycle_${nonce}`, publishedVersion);
      cleanup = result.ok ? 'recycled' : `failed_${safe(result.error?.code)}`;
    } catch { cleanup = 'failed'; }
  }
  process.stdout.write(`m2_template_cloud_smoke=failed:${safe(error?.message)};cleanup=${cleanup}\n`);
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
async function login(password) {
  const app = sdk.init({ env: envId });
  await app.auth({ persistence: 'local' }).signInWithPassword({ username: 'demo_teacher_01', password });
  const bootstrap = await call({ app, token: null }, 'auth-session', 'bootstrap', {});
  requireOk(bootstrap, 'bootstrap');
  const token = requiredString(bootstrap.data?.sessionId);
  const selected = await call({ app, token }, 'auth-session', 'selectRole', { role: 'teacher' });
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
