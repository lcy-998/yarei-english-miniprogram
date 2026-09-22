import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile); const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const require = createRequire(import.meta.url);
const env = Object.fromEntries((await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u).flatMap((line) => { const i = line.indexOf('='); return i > 0 ? [[line.slice(0, i), line.slice(i + 1)]] : []; })); const envId = required(env.TCB_ENV_ID);
const cli = [process.execPath, resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')]; try { require('@cloudbase/adapter-node'); } catch { /* optional */ }
const sdk = require('@cloudbase/js-sdk'); const suffix = randomBytes(8).toString('base64url');
const credentials = await prepare(['demo_teacher_01', 'demo_admin_01']);
const teacher = await login('demo_teacher_01', 'teacher', credentials.demo_teacher_01); const admin = await login('demo_admin_01', 'admin', credentials.demo_admin_01);
const revoked = await call(admin.app, 'organization-admin', 'revokeTeacherClass', { teacherId: 'usr_teacher_demo_01', classId: 'cls_grade3_2', reason: 'M1 撤权旧会话联调。' }, admin.token, { expectedVersion: 1, operationId: `op_revoke_smoke_${suffix}` });
if (!revoked.ok && !['NOT_FOUND', 'CONFLICT'].includes(revoked.error?.code)) fail(`revoke_${revoked.error?.code ?? 'failed'}`);
const stale = await call(teacher.app, 'task-query', 'getTeacherWorkbench', { date: localDate() }, teacher.token);
if (stale.ok || !['UNAUTHENTICATED', 'FORBIDDEN'].includes(stale.error?.code)) fail(`stale_${stale.ok ? 'allowed' : stale.error?.code ?? 'unknown'}`);
const restored = await call(admin.app, 'organization-admin', 'grantTeacherClass', { teacherId: 'usr_teacher_demo_01', classId: 'cls_grade3_2', permissions: ['class.read', 'student.read', 'content.read', 'task.read', 'task.publish', 'submission.review', 'student.manage', 'student.bind-code.issue'], reason: 'M1 撤权旧会话联调恢复。' }, admin.token, { expectedVersion: 2, operationId: `op_restore_smoke_${suffix}` });
if (!restored.ok) fail(`restore_${restored.error?.code ?? 'failed'}`);
process.stdout.write('revocation_smoke=passed\nstale_session=rejected\nauthorization_restored=true\n');

async function prepare(aliases) { const result = {}; for (const alias of aliases) { const users = await cliJson(['user', 'list', '-e', envId, '--name', alias, '--json']); const account = users.data.find((item) => item?.Name === alias); if (!account?.Uid) throw new Error('ACCOUNT_UNAVAILABLE'); const password = `YareiM1!${randomBytes(18).toString('base64url')}`; await cliJson(['user', 'update', '-e', envId, account.Uid, '--password', password, '--status', 'ACTIVE', '--json']); result[alias] = password; } return result; }
async function login(alias, role, password) { const app = sdk.init({ env: envId }); await app.auth({ persistence: 'local' }).signInWithPassword({ username: alias, password }); const fn = role === 'admin' ? 'admin-session' : 'auth-session'; const boot = await call(app, fn, 'bootstrap', {}, null); if (!boot.ok) fail(`bootstrap_${role}`); const token = role === 'admin' ? boot.data.token : boot.data.sessionId; if (role !== 'admin') { const selected = await call(app, 'auth-session', 'selectRole', { role }, token); if (!selected.ok) fail(`select_${role}`); } return { app, token }; }
async function call(app, name, action, payload, token, extras = {}) { try { const response = await app.callFunction({ name, data: { apiVersion: 'm1.v1', action, payload, ...(token === null ? {} : { businessSessionToken: token }), ...extras }, parse: true }); return response?.result ?? { ok: false, error: { code: 'INVALID_RESPONSE' } }; } catch (error) { return { ok: false, error: { code: safe(error) } }; } }
async function cliJson(args) { const { stdout } = await exec(cli[0], [...cli.slice(1), ...args], { cwd: root, encoding: 'utf8', windowsHide: true }); const start = Math.min(...[stdout.indexOf('{'), stdout.indexOf('[')].filter((value) => value >= 0)); return JSON.parse(stdout.slice(start)); }
function localDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()); }
function required(value) { if (typeof value !== 'string' || value.trim().length === 0) throw new Error('CONFIG_UNAVAILABLE'); return value.trim(); }
function safe(error) { return String(error?.message ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80); }
function fail(code) { process.stdout.write(`revocation_smoke=failed:${code}\n`); process.exit(2); }
