import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile); const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const require = createRequire(import.meta.url);
const env = Object.fromEntries((await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u).flatMap((line) => { const i = line.indexOf('='); return i > 0 ? [[line.slice(0, i), line.slice(i + 1)]] : []; })); const envId = required(env.TCB_ENV_ID); const cli = [process.execPath, resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')];
try { require('@cloudbase/adapter-node'); } catch { /* optional */ }
const sdk = require('@cloudbase/js-sdk'); const alias = 'demo_teacher_01'; const account = (await cliJson(['user', 'list', '-e', envId, '--name', alias, '--json'])).data.find((item) => item?.Name === alias); const password = `YareiM1!${randomBytes(18).toString('base64url')}`; await cliJson(['user', 'update', '-e', envId, account.Uid, '--password', password, '--status', 'ACTIVE', '--json']);
const app = sdk.init({ env: envId }); await app.auth({ persistence: 'local' }).signInWithPassword({ username: alias, password }); const boot = await call('auth-session', 'bootstrap', {}, null); if (!boot.ok) fail('bootstrap'); const token = boot.data.sessionId; const selected = await call('auth-session', 'selectRole', { role: 'teacher' }, token); if (!selected.ok) fail('select-role');
const students = [...Array.from({ length: 36 }, (_, i) => `usr_student_g3_${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 14 }, (_, i) => `usr_student_g4_${String(i + 1).padStart(2, '0')}`)]; const testId = randomBytes(8).toString('base64url');
const draft = await call('task-command', 'saveDraft', { title: `M1 50人容量 ${testId}`, itemRefs: [{ id: `item_${testId}`, resourceId: 'res_reading_zoo_demo', completionRule: { kind: 'reading_pages', requiredPageCount: 1 }, scoringRule: { kind: 'completion_only' }, order: 1 }], target: { type: 'students', studentIds: students }, startsAt: new Date(Date.now() - 60000).toISOString(), dueAt: new Date(Date.now() + 86400000).toISOString(), latePolicy: { allowLate: true, lateDays: 7 } }, token, { operationId: `op_capacity_draft_${testId}` }); if (!draft.ok) fail(`draft_${draft.error?.code ?? 'failed'}`);
const published = await call('task-command', 'publishTask', { taskId: draft.data.taskId }, token, { expectedVersion: draft.data.version, operationId: `op_capacity_publish_${testId}` }); if (!published.ok) fail(`publish_${published.error?.code ?? 'failed'}`); if (published.data.assignmentCount !== 50) fail('assignment-count');
const recycled = await call('task-command', 'recycleTask', { taskId: draft.data.taskId, reason: '容量联调完成回收。' }, token, { expectedVersion: published.data.version, operationId: `op_capacity_recycle_${testId}` }); if (!recycled.ok) fail(`recycle_${recycled.error?.code ?? 'failed'}`);
process.stdout.write('capacity_50_publish=passed\ncapacity_50_assignments=50\ncapacity_cleanup=recycled\n');
async function call(name, action, payload, token, extras = {}) { try { const response = await Promise.race([app.callFunction({ name, data: { apiVersion: 'm1.v1', action, payload, ...(token === null ? {} : { businessSessionToken: token }), ...extras }, parse: true }), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000))]); return response?.result ?? { ok: false, error: { code: 'INVALID_RESPONSE' } }; } catch (error) { return { ok: false, error: { code: safe(error) } }; } }
async function cliJson(args) { const { stdout } = await exec(cli[0], [...cli.slice(1), ...args], { cwd: root, encoding: 'utf8', windowsHide: true }); const start = Math.min(...[stdout.indexOf('{'), stdout.indexOf('[')].filter((v) => v >= 0)); return JSON.parse(stdout.slice(start)); }
function required(value) { if (typeof value !== 'string' || value.trim().length === 0) throw new Error('config'); return value.trim(); }
function safe(error) { return String(error?.message ?? 'unknown').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80); }
function fail(reason) { process.stdout.write(`capacity_smoke=failed:${reason}\n`); process.exit(2); }
