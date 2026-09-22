import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const env = Object.fromEntries((await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u).flatMap((line) => {
  const index = line.indexOf('='); return index > 0 ? [[line.slice(0, index).trim(), line.slice(index + 1).trim()]] : [];
}));
const envId = required(env.TCB_ENV_ID);
const cli = [process.execPath, resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')];
const require = createRequire(import.meta.url);
const sdk = require('@cloudbase/js-sdk');
const suffix = randomBytes(8).toString('base64url');

try {
  const password = await preparePassword('demo_admin_01');
  const app = sdk.init({ env: envId });
  await app.auth({ persistence: 'local' }).signInWithPassword({ username: 'demo_admin_01', password });
  const bootstrap = await call(app, 'admin-session', 'bootstrap', {}, undefined);
  assertOk(bootstrap, 'bootstrap');
  const token = bootstrap.data.token;
  const users = await call(app, 'organization-admin', 'listUsers', {}, token);
  assertOk(users, 'list-users');
  const target = users.data.find((item) => item.id === 'usr_student_g3_01');
  if (!target) throw new Error('TARGET_USER_NOT_FOUND');
  const firstName = `${target.displayName}·验证`;
  const updated = await call(app, 'organization-admin', 'updateUser', {
    userId: target.id, displayName: firstName, reason: 'M1 updateUser 云端冒烟。',
  }, token, { expectedVersion: target.version, operationId: `op_admin_update_${suffix}` });
  assertOk(updated, 'update-user');
  if (updated.data.displayName !== firstName || updated.data.version !== target.version + 1) throw new Error('UPDATE_RESPONSE_MISMATCH');
  const restored = await call(app, 'organization-admin', 'updateUser', {
    userId: target.id, displayName: target.displayName, reason: 'M1 updateUser 云端冒烟恢复。',
  }, token, { expectedVersion: updated.data.version, operationId: `op_admin_restore_${suffix}` });
  assertOk(restored, 'restore-user');
  if (restored.data.displayName !== target.displayName) throw new Error('RESTORE_RESPONSE_MISMATCH');
  process.stdout.write('admin_update_user=passed\nadmin_update_user_restore=passed\n');
  process.exit(0);
} catch (error) {
  process.stdout.write(`admin_update_user=failed:${safe(error)}\n`);
  process.exitCode = 2;
}

async function preparePassword(alias) {
  const users = await cliJson(['user', 'list', '-e', envId, '--name', alias, '--json']);
  const account = Array.isArray(users.data) ? users.data.find((item) => item?.Name === alias) : undefined;
  if (!account?.Uid) throw new Error('ACCOUNT_UNAVAILABLE');
  const password = `YareiM1!${randomBytes(18).toString('base64url')}`;
  await cliJson(['user', 'update', '-e', envId, account.Uid, '--password', password, '--status', 'ACTIVE', '--json']);
  return password;
}
async function call(app, name, action, payload, token, extras = {}) {
  try {
    const response = await app.callFunction({ name, data: { apiVersion: 'm1.v1', action, payload, ...(token === undefined ? {} : { businessSessionToken: token }), ...extras }, parse: true });
    return response?.result ?? { ok: false, error: { code: 'INVALID_RESPONSE' } };
  } catch (error) {
    return { ok: false, error: { code: safe(error) } };
  }
}
async function cliJson(args) {
  const { stdout } = await exec(cli[0], [...cli.slice(1), ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  const start = Math.min(...[stdout.indexOf('{'), stdout.indexOf('[')].filter((value) => value >= 0));
  return JSON.parse(stdout.slice(start));
}
function assertOk(result, stage) { if (!result.ok) throw new Error(`${stage}_${result.error?.code ?? 'failed'}`); }
function required(value) { if (typeof value !== 'string' || value.trim().length === 0) throw new Error('CONFIG_UNAVAILABLE'); return value.trim(); }
function safe(error) { return String(error?.message ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80); }
