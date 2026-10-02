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
const envId = envText.split(/\r?\n/u).find((line) => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!envId || !/^[A-Za-z0-9_-]+$/u.test(envId)) throw new Error('Private nonproduction environment is unavailable.');
const cliPath = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
try {
  require('@cloudbase/js-sdk').useAdapters(require('@cloudbase/adapter-node').default);
} catch {
  // Current SDK versions may register the Node adapter automatically.
}
const sdk = require('@cloudbase/js-sdk');
const partialSeedProbe = process.argv.includes('--partial-seed-probe');
const visibleSeedProbe = process.argv.includes('--seed-visible-probe');
if (process.argv.length > 3 || (process.argv.length === 3 && !partialSeedProbe && !visibleSeedProbe)) {
  throw new Error('Invalid read smoke option.');
}

const scenarios = [
  { alias: 'demo_student_01', role: 'student', queries: [
    ['phonics-query', 'listCourses', {}],
    ['student-work-query', 'listMaterials', {}],
    ['student-work-query', 'listMine', {}],
    ['activity-query', 'listForStudent', {}],
    ['notification-query', 'list', { filter: 'all', offset: 0, limit: 20, days: 30 }],
  ] },
  { alias: 'demo_teacher_01', role: 'teacher', queries: [
    ['task-template-query', 'listTemplates', {}],
    ['activity-query', 'listForTeacher', {}],
    ['learning-stats-query', 'teacherReport', { filters: { startsOn: '2026-09-01', endsOn: '2026-09-30' } }],
    ['learning-stats-query', 'exportTeacherCsv', { filters: { startsOn: '2026-09-01', endsOn: '2026-09-30' } }],
  ] },
  { alias: 'demo_parent_01', role: 'parent', queries: [
    ['learning-stats-query', 'parentReport', { childId: 'usr_student_g3_01',
      filters: { startsOn: '2026-09-01', endsOn: '2026-09-30' } }],
  ] },
  { alias: 'demo_admin_01', role: 'admin', authFunction: 'admin-session', queries: [
    ['organization-admin', 'listDeletedWorkDrafts',
      { studentId: 'usr_student_g3_01', page: { limit: 20, offset: 0 } }],
    ['textbook-admin-query', 'getOverview', {}],
    ['textbook-admin-query', 'previewTextbook', { resourceId: 'res_m2_sync_book_outline_demo' }],
    ['organization-admin', 'listAdminQuestions', { filters: {}, page: { limit: 20, offset: 0 } }],
    ['organization-admin', 'getAdminQuestion', { id: 'res_m2_exercise_animals_choice_demo' }],
    ['admin-task-activity-query', 'list', { filters: { startsOn: '2026-09-01', endsOn: '2026-10-31' },
      page: { limit: 20, offset: 0 } }],
    ['admin-task-activity-query', 'detail', { kind: 'activity', id: 'activity_m2_animals_choice_demo' }],
  ] },
];

let failed = 0;
let candidateLeak = false;
const seedCandidateIds = ['res_m2_exercise_animals_choice_demo', 'res_m2_sync_book_outline_demo',
  'phonics_m2_short_a_demo', 'template_m2_animals_choice_demo', 'activity_m2_animals_choice_demo'];
const observedSeedIds = new Set();
for (const scenario of scenarios) {
  const app = sdk.init({ env: envId });
  const users = await runCli(['user', 'list', '-e', envId, '--name', scenario.alias, '--json']);
  const matches = Array.isArray(users.data) ? users.data.filter((user) => user?.Name === scenario.alias) : [];
  if (matches.length !== 1) throw new Error(`Fictitious ${scenario.role} account unavailable.`);
  const password = `YareiM2!${randomBytes(18).toString('base64url')}`;
  await runCli(['user', 'update', '-e', envId, matches[0].Uid, '--password', password, '--status', 'ACTIVE', '--json']);
  await app.auth({ persistence: 'local' }).signInWithPassword({ username: scenario.alias, password });
  const bootstrap = await call(app, scenario.authFunction ?? 'auth-session', 'bootstrap', {}, null);
  const token = scenario.authFunction === 'admin-session' ? bootstrap.data?.token : bootstrap.data?.sessionId;
  const selected = scenario.authFunction === 'admin-session' ? bootstrap
    : bootstrap.ok && typeof token === 'string'
      ? await call(app, 'auth-session', 'selectRole', { role: scenario.role }, token)
      : bootstrap;
  if (!selected.ok || typeof token !== 'string') {
    failed += scenario.queries.length;
    for (const [name, action] of scenario.queries) process.stdout.write(`${scenario.role}:${name}.${action}=failed:AUTH\n`);
    continue;
  }
  for (const [name, action, payload] of scenario.queries) {
    const result = await call(app, name, action, payload, token);
    const outcome = result.ok ? 'passed' : `failed:${safeCode(result.error?.code)}`;
    if (!result.ok) failed += 1;
    if (partialSeedProbe && result.ok && seedCandidateIds.some(id => JSON.stringify(result.data ?? null).includes(id))) {
      candidateLeak = true;
    }
    if (visibleSeedProbe && result.ok) {
      for (const id of seedCandidateIds) {
        if (JSON.stringify(result.data ?? null).includes(id)) observedSeedIds.add(id);
      }
    }
    if (result.ok && name === 'learning-stats-query') {
      const valid = action === 'exportTeacherCsv'
        ? typeof result.data?.csv === 'string' && result.data.csv.length > 20
          && typeof result.data?.fileName === 'string'
        : Array.isArray(result.data?.details) && Number.isSafeInteger(result.data?.summary?.assignedCount)
          && Number.isSafeInteger(result.data?.summary?.completedCount)
          && result.data.summary.completedCount <= result.data.summary.assignedCount
          && (action !== 'parentReport' || result.data.details.every(item => item.studentId === 'usr_student_g3_01'));
      if (!valid) failed += 1;
      process.stdout.write(`${scenario.role}:${action}-shape=${valid ? 'passed' : 'failed'}\n`);
    }
    process.stdout.write(`${scenario.role}:${name}.${action}=${outcome}\n`);
  }
  if (visibleSeedProbe && scenario.role === 'student') {
    const forbidden = await call(app, 'content-query', 'getSchoolQuestion',
      { resourceId: 'res_m2_exercise_animals_choice_demo', targetClassIds: ['cls_grade3_2'] }, token);
    const denied = !forbidden.ok && forbidden.error?.code === 'FORBIDDEN';
    if (!denied) failed += 1;
    process.stdout.write(`student:teacher-question-denied=${denied ? 'passed' : 'failed'}\n`);
  }
  if (partialSeedProbe && scenario.role === 'teacher') {
    const detail = await call(app, 'content-query', 'getSchoolQuestion',
      { resourceId: 'res_m2_exercise_animals_choice_demo', targetClassIds: ['cls_grade3_2'] }, token);
    const page = await call(app, 'content-query', 'listSchoolQuestions',
      { filters: { targetClassIds: ['cls_grade3_2'] }, page: { limit: 50, offset: 0 } }, token);
    const hidden = !detail.ok && detail.error?.code === 'NOT_FOUND'
      && page.ok && Array.isArray(page.data?.items)
      && !page.data.items.some((item) => item?.resourceId === 'res_m2_exercise_animals_choice_demo'
        || item?.id === 'res_m2_exercise_animals_choice_demo');
    if (!hidden) failed += 1;
    process.stdout.write(`teacher:incomplete-seed-hidden=${hidden ? 'passed' : 'failed'}\n`);
  }
  if (visibleSeedProbe && scenario.role === 'teacher') {
    const outside = await call(app, 'content-query', 'getSchoolQuestion',
      { resourceId: 'res_m2_exercise_animals_choice_demo', targetClassIds: ['cls_unowned_demo'] }, token);
    const outsideDenied = !outside.ok && outside.error?.code === 'FORBIDDEN';
    if (!outsideDenied) failed += 1;
    process.stdout.write(`teacher:unowned-class-question-denied=${outsideDenied ? 'passed' : 'failed'}\n`);
    const detail = await call(app, 'content-query', 'getSchoolQuestion',
      { resourceId: 'res_m2_exercise_animals_choice_demo', targetClassIds: ['cls_grade3_2'] }, token);
    const page = await call(app, 'content-query', 'listSchoolQuestions',
      { filters: { targetClassIds: ['cls_grade3_2'] }, page: { limit: 50, offset: 0 } }, token);
    const visible = detail.ok && page.ok && Array.isArray(page.data?.items)
      && page.data.items.some((item) => item?.resourceId === 'res_m2_exercise_animals_choice_demo'
        || item?.id === 'res_m2_exercise_animals_choice_demo');
    if (!visible) failed += 1;
    process.stdout.write(`teacher:completed-seed-question-visible=${visible ? 'passed' : 'failed'}\n`);
    if (!visible) process.stdout.write(`teacher:question-probe=detail:${detail.ok ? 'ok' : safeCode(detail.error?.code)},`
      + `page:${page.ok ? 'ok' : safeCode(page.error?.code)},items:${Array.isArray(page.data?.items) ? page.data.items.length : 'none'},`
      + `itemKeys:${Array.isArray(page.data?.items) && page.data.items.length > 0 ? Object.keys(page.data.items[0]).join('|') : 'none'}\n`);
  }
}
if (partialSeedProbe) {
  if (candidateLeak) failed += 1;
  process.stdout.write(`incomplete-seed-absent-from-m2-lists=${candidateLeak ? 'failed' : 'passed'}\n`);
}
if (visibleSeedProbe) {
  const expected = ['phonics_m2_short_a_demo', 'template_m2_animals_choice_demo',
    'activity_m2_animals_choice_demo'];
  const visible = expected.every(id => observedSeedIds.has(id));
  if (!visible) failed += 1;
  process.stdout.write(`completed-seed-m2-list-visibility=${visible ? 'passed' : 'failed'}\n`);
}
process.stdout.write(`m2_cloud_read_smoke_passed=${failed === 0}; query_count=${partialSeedProbe ? 19 : visibleSeedProbe ? 21 : 17}\n`);
process.exit(failed === 0 ? 0 : 2);

async function runCli(args) {
  const { stdout } = await execute(process.execPath, [cliPath, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024,
  });
  const starts = [stdout.indexOf('{'), stdout.indexOf('[')].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error('CloudBase CLI response unavailable.');
  return JSON.parse(stdout.slice(Math.min(...starts)));
}

async function call(app, name, action, payload, businessSessionToken) {
  try {
    const data = { apiVersion: 'm1.v1', action, payload,
      ...(businessSessionToken === null ? {} : { businessSessionToken }) };
    const response = await app.callFunction({ name, data, parse: true });
    const result = response?.result;
    return result && typeof result.ok === 'boolean' ? result : { ok: false, error: { code: 'INVALID_RESPONSE' } };
  } catch (error) {
    return { ok: false, error: { code: safeCode(error?.code ?? error?.errCode ?? error?.message) } };
  }
}

function safeCode(value) {
  return String(value ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80);
}
