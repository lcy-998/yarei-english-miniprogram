import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile); const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const require = createRequire(import.meta.url);
const env = Object.fromEntries((await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u).flatMap((line) => { const i = line.indexOf('='); return i > 0 ? [[line.slice(0, i), line.slice(i + 1)]] : []; }));
const envId = required(env.TCB_ENV_ID); const cli = [process.execPath, resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')];
try { require('@cloudbase/adapter-node'); } catch { /* optional */ }
const user = await cliJson(['user', 'list', '-e', envId, '--name', 'demo_parent_01', '--json']); const account = user.data.find((item) => item?.Name === 'demo_parent_01');
const password = `YareiM1!${randomBytes(18).toString('base64url')}`; await cliJson(['user', 'update', '-e', envId, account.Uid, '--password', password, '--status', 'ACTIVE', '--json']);
const app = require('@cloudbase/js-sdk').init({ env: envId }); await app.auth({ persistence: 'local' }).signInWithPassword({ username: 'demo_parent_01', password });
const boot = await call(app, 'auth-session', 'bootstrap', {}, null); if (!boot.ok) fail('bootstrap'); const token = boot.data.sessionId;
const selected = await call(app, 'auth-session', 'selectRole', { role: 'parent' }, token); if (!selected.ok) fail('select-role');
const children = await call(app, 'parent-query', 'listChildren', {}, token); if (!children.ok) fail('list-children');
const tasks = await call(app, 'parent-query', 'listChildTasks', { childId: 'usr_student_g3_01', filters: {}, page: { limit: 100 } }, token);
if (!tasks.ok) fail('list-child-tasks'); const feedbackItems = Array.isArray(tasks.data?.items) ? tasks.data.items.filter((item) => typeof item.feedbackId === 'string') : [];
const latest = feedbackItems[0];
const feedback = latest === undefined ? { ok: false } : await call(app, 'parent-query', 'getFeedback', { childId: 'usr_student_g3_01', feedbackId: latest.feedbackId }, token);
if (!feedback.ok) fail('get-feedback');
process.stdout.write(`parent_feedback_list=passed; task_items=${Array.isArray(tasks.data?.items) ? tasks.data.items.length : 0}; feedback_items=${feedbackItems.length}; get_feedback=passed\n`);
function fail(step) { process.stdout.write(`parent_feedback_list=failed:${step}\n`); process.exit(2); }
async function call(app, name, action, payload, token) { try { const response = await Promise.race([app.callFunction({ name, data: { apiVersion: 'm1.v1', action, payload, ...(token === null ? {} : { businessSessionToken: token }) }, parse: true }), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15_000))]); return response?.result ?? { ok: false }; } catch { return { ok: false }; } }
async function cliJson(args) { const { stdout } = await exec(cli[0], [...cli.slice(1), ...args], { cwd: root, encoding: 'utf8', windowsHide: true }); const index = Math.min(...[stdout.indexOf('{'), stdout.indexOf('[')].filter((v) => v >= 0)); return JSON.parse(stdout.slice(index)); }
function required(value) { if (typeof value !== 'string' || value.trim().length === 0) throw new Error('config'); return value.trim(); }
