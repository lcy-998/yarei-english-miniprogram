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
const env = Object.fromEntries((await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u).flatMap((line) => {
  const separator = line.indexOf('=');
  return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
}));
const envId = env.TCB_ENV_ID;
if (typeof envId !== 'string' || envId.length === 0) throw new Error('MISSING_DEV_ENVIRONMENT');

const sdk = require('@cloudbase/js-sdk');
sdk.useAdapters(require('@cloudbase/adapter-node').default);
const cli = [process.execPath, 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'];
const studentId = 'usr_student_g3_02';
const studentNumber = 'STU-G3-002';

const teacher = await signInSynthetic('demo_teacher_01');
const issued = await call(teacher.app, 'relationship-command', 'issueBindingCode', { studentId }, teacher.token, { operationId: operationId('issue') });
if (!issued.ok || typeof issued.data?.code !== 'string') fail('issue_code', issued);

const parent = await signInSynthetic('demo_parent_01');
const beforeBind = await call(parent.app, 'parent-query', 'listChildren', {}, parent.token);
const existing = children(beforeBind).find((child) => child?.childId === studentId);
if (existing && typeof existing.linkVersion === 'number') {
  const cleaned = await call(parent.app, 'relationship-command', 'unbindChild', {
    childId: studentId, reason: '清理上次虚构验收',
  }, parent.token, { operationId: operationId('cleanup'), expectedVersion: existing.linkVersion });
  if (!cleaned.ok) fail('cleanup_previous_link', cleaned);
}
const bound = await call(parent.app, 'relationship-command', 'bindChild', {
  studentNumber, code: issued.data.code,
}, parent.token, { operationId: operationId('bind') });
if (!bound.ok || typeof bound.data?.version !== 'number') fail('bind_child', bound);

const listedAfterBind = await call(parent.app, 'parent-query', 'listChildren', {}, parent.token);
if (!listedAfterBind.ok || !children(listedAfterBind).some((child) => child?.childId === studentId)) fail('read_after_bind', listedAfterBind);

const unbound = await call(parent.app, 'relationship-command', 'unbindChild', {
  childId: studentId, reason: '虚构验收回收',
}, parent.token, { operationId: operationId('unbind'), expectedVersion: bound.data.version });
if (!unbound.ok) fail('unbind_child', unbound);

const listedAfterUnbind = await call(parent.app, 'parent-query', 'listChildren', {}, parent.token);
if (!listedAfterUnbind.ok || children(listedAfterUnbind).some((child) => child?.childId === studentId)) fail('read_after_unbind', listedAfterUnbind);

process.stdout.write('relationship_issue=passed; bind=passed; read_after_bind=passed; unbind=passed; read_after_unbind=passed\n');

async function signInSynthetic(alias) {
  const account = await cliJson(['user', 'list', '-e', envId, '--name', alias, '--json']);
  const match = Array.isArray(account.data) ? account.data.find((candidate) => candidate?.Name === alias) : null;
  if (!match?.Uid) throw new Error('VIRTUAL_ACCOUNT_NOT_FOUND');
  const password = `YareiM1!${randomBytes(18).toString('base64url')}`;
  await cliJson(['user', 'update', '-e', envId, match.Uid, '--password', password, '--status', 'ACTIVE', '--json']);
  const app = sdk.init({ env: envId });
  await app.auth({ persistence: 'local' }).signInWithPassword({ username: alias, password });
  const bootstrap = await call(app, 'auth-session', 'bootstrap', {}, null);
  if (!bootstrap.ok || typeof bootstrap.data?.sessionId !== 'string') fail(`${alias}_bootstrap`, bootstrap);
  const role = alias.includes('teacher') ? 'teacher' : 'parent';
  const selected = await call(app, 'auth-session', 'selectRole', { role }, bootstrap.data.sessionId);
  if (!selected.ok) fail(`${alias}_select_role`, selected);
  return { app, token: bootstrap.data.sessionId };
}

async function call(app, name, action, payload, businessSessionToken, options = {}) {
  try {
    const response = await app.callFunction({
      name,
      data: {
        apiVersion: 'm1.v1', action, payload,
        ...(businessSessionToken === null ? {} : { businessSessionToken }),
        ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
        ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
      },
      parse: true,
    });
    return response?.result ?? { ok: false, error: { code: 'INVALID_RESPONSE' } };
  } catch (error) {
    return { ok: false, error: { code: String(error?.code ?? error?.message ?? 'NETWORK_ERROR').slice(0, 80) } };
  }
}

async function cliJson(args) {
  const { stdout } = await execute(cli[0], [...cli.slice(1), ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  const start = Math.min(...[stdout.indexOf('{'), stdout.indexOf('[')].filter((index) => index >= 0));
  return JSON.parse(stdout.slice(start));
}

function operationId(action) { return `relationship_smoke_${action}_${randomBytes(9).toString('hex')}`; }
function children(response) { return Array.isArray(response?.data) ? response.data : []; }
function fail(stage, response) {
  const code = String(response?.error?.code ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80);
  process.stdout.write(`relationship_smoke=failed:${stage}:${code}\n`);
  process.exit(2);
}
