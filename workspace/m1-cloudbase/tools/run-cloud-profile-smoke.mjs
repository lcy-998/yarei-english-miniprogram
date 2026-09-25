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

const users = await cliJson(['user', 'list', '-e', envId, '--name', 'demo_student_01', '--json']);
const user = Array.isArray(users.data) ? users.data.find((item) => item?.Name === 'demo_student_01') : null;
if (!user?.Uid) throw new Error('VIRTUAL_STUDENT_NOT_FOUND');
const password = `YareiM1!${randomBytes(18).toString('base64url')}`;
await cliJson(['user', 'update', '-e', envId, user.Uid, '--password', password, '--status', 'ACTIVE', '--json']);
const app = sdk.init({ env: envId });
await app.auth({ persistence: 'local' }).signInWithPassword({ username: 'demo_student_01', password });
const bootstrap = await call('bootstrap', {}, null);
if (!bootstrap.ok || typeof bootstrap.data?.sessionId !== 'string') fail('bootstrap', bootstrap);
const selected = await call('selectRole', { role: 'student' }, bootstrap.data.sessionId);
if (!selected.ok || typeof selected.data?.sessionId !== 'string') fail('select_role', selected);
const token = selected.data.sessionId;
const current = await call('getCurrentSession', {}, token);
if (!current.ok || typeof current.data?.displayName !== 'string' || typeof current.data?.profileVersion !== 'number') fail('get_current_profile', current);
const originalName = current.data.displayName;
const changed = await call('updateProfile', { displayName: '虚构资料验收学生' }, token, {
  operationId: `profile_smoke_change_${randomBytes(8).toString('hex')}`,
  expectedVersion: current.data.profileVersion,
});
if (!changed.ok || changed.data?.displayName !== '虚构资料验收学生' || changed.data?.profileVersion !== current.data.profileVersion + 1) fail('update_profile', changed);
const restored = await call('updateProfile', { displayName: originalName }, token, {
  operationId: `profile_smoke_restore_${randomBytes(8).toString('hex')}`,
  expectedVersion: changed.data.profileVersion,
});
if (!restored.ok || restored.data?.displayName !== originalName) fail('restore_profile', restored);
process.stdout.write('profile_read=passed; profile_update=passed; profile_restore=passed\n');

async function call(action, payload, token, options = {}) {
  try {
    const response = await app.callFunction({ name: 'auth-session', data: {
      apiVersion: 'm1.v1', action, payload, ...(token === null ? {} : { businessSessionToken: token }),
      ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
      ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
    }, parse: true });
    return response?.result ?? { ok: false, error: { code: 'INVALID_RESPONSE' } };
  } catch (error) { return { ok: false, error: { code: String(error?.code ?? error?.message ?? 'NETWORK_ERROR').slice(0, 80) } }; }
}

async function cliJson(args) {
  const { stdout } = await execute(cli[0], [...cli.slice(1), ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  const start = Math.min(...[stdout.indexOf('{'), stdout.indexOf('[')].filter((index) => index >= 0));
  return JSON.parse(stdout.slice(start));
}

function fail(stage, result) {
  const code = String(result?.error?.code ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80);
  process.stdout.write(`profile_smoke=failed:${stage}:${code}\n`);
  process.exit(2);
}
