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
const env = parseEnvironment(await readFile(resolve(root, '.env.local'), 'utf8'));
const envId = requirePrivateValue(env.TCB_ENV_ID);
const cli = {
  command: process.execPath,
  arguments: [resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')],
};

const scenarios = [
  {
    id: 'authenticated-role-student',
    alias: 'demo_student_01',
    authFunction: 'auth-session',
    role: 'student',
    smoke: {
      functionName: 'student-task-query',
      action: 'getHome',
      payload: { localDate: currentLocalDate() },
    },
  },
  {
    id: 'authenticated-role-parent',
    alias: 'demo_parent_01',
    authFunction: 'auth-session',
    role: 'parent',
    smoke: {
      functionName: 'parent-query',
      action: 'listChildren',
      payload: {},
    },
  },
  {
    id: 'authenticated-role-teacher',
    alias: 'demo_teacher_01',
    authFunction: 'auth-session',
    role: 'teacher',
    smoke: {
      functionName: 'task-query',
      action: 'getTeacherWorkbench',
      payload: { date: currentLocalDate() },
    },
  },
  {
    id: 'authenticated-role-admin',
    alias: 'demo_admin_01',
    authFunction: 'admin-session',
    role: 'admin',
    smoke: {
      functionName: 'organization-admin',
      action: 'listClasses',
      payload: {},
    },
  },
];

registerNodeAdapter();
const sdk = require('@cloudbase/js-sdk');

if (process.env.YAREI_AUTH_SMOKE_CHILD === 'scenario') {
  const index = Number(process.env.YAREI_AUTH_SMOKE_INDEX);
  if (!Number.isInteger(index) || index < 0 || index >= scenarios.length) throw new Error('Invalid smoke scenario index.');
  const result = await runScenario(scenarios[index]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.outcome === 'passed' ? 0 : 2);
}

if (process.env.YAREI_AUTH_SMOKE_CHILD === 'database-deny') {
  const databaseDenied = await verifyClientDatabaseDenied();
  const result = {
    scenarioId: 'authenticated-client-database-direct-access-rejected',
    outcome: databaseDenied.ok ? 'passed' : 'failed',
    errorCode: databaseDenied.ok ? null : databaseDenied.errorCode,
    assertions: [{ checkId: 'client-database-denied', passed: databaseDenied.ok }],
    counts: {},
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.outcome === 'passed' ? 0 : 2);
}

const evidence = [];

for (const [index] of scenarios.entries()) {
  evidence.push(await runChild({ YAREI_AUTH_SMOKE_CHILD: 'scenario', YAREI_AUTH_SMOKE_INDEX: String(index) }));
}

evidence.push(await runChild({ YAREI_AUTH_SMOKE_CHILD: 'database-deny' }));

const failures = evidence.filter((item) => item.outcome !== 'passed');
for (const item of evidence) {
  const stages = item.stages === undefined ? '' : `; stages=${Object.values(item.stages).join(',')}`;
  process.stdout.write(`${item.scenarioId}=${item.outcome}${item.errorCode === null ? '' : `:${item.errorCode}`}${stages}\n`);
}
process.stdout.write(`authenticated_cloud_smoke_passed=${failures.length === 0 ? 'true' : 'false'}; scenario_count=${evidence.length}\n`);
process.exit(failures.length === 0 ? 0 : 2);

async function runScenario(scenario) {
  const app = sdk.init({ env: envId });
  const password = `YareiM1!${randomBytes(18).toString('base64url')}`;
  const account = await readSyntheticAccount(scenario.alias);
  await resetSyntheticPassword(account.uid, password);
  await signIn(app, scenario.alias, password);

  const bootstrap = await call(app, scenario.authFunction, 'bootstrap', {}, null);
  const token = bootstrap.ok
    ? scenario.authFunction === 'admin-session'
      ? bootstrap.data?.token
      : bootstrap.data?.sessionId
    : null;
  let selected = bootstrap;
  if (bootstrap.ok && scenario.authFunction === 'auth-session') {
    selected = await call(app, scenario.authFunction, 'selectRole', { role: scenario.role }, token);
  }
  const smoke = selected.ok && typeof token === 'string'
    ? await call(app, scenario.smoke.functionName, scenario.smoke.action, scenario.smoke.payload, token)
    : selected;

  return {
    scenarioId: scenario.id,
    outcome: bootstrap.ok && selected.ok && smoke.ok ? 'passed' : 'failed',
    errorCode: firstErrorCode(bootstrap, selected, smoke),
    assertions: [
      { checkId: 'login-bootstrap', passed: bootstrap.ok },
      { checkId: 'role-or-admin-session', passed: selected.ok },
      { checkId: 'authorized-read-smoke', passed: smoke.ok },
    ],
    stages: {
      bootstrap: bootstrap.ok ? 'passed' : bootstrap.error?.code ?? 'failed',
      roleOrAdminSession: selected.ok ? 'passed' : selected.error?.code ?? 'failed',
      authorizedRead: smoke.ok ? 'passed' : smoke.error?.code ?? 'failed',
    },
    counts: {
      roles: bootstrap.ok && Array.isArray(bootstrap.data?.roles) ? bootstrap.data.roles.length : null,
    },
  };
}

async function runChild(environment) {
  try {
    const { stdout } = await execute(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, ...environment },
    });
    const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
    return JSON.parse(lines.at(-1));
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim().split(/\r?\n/u).filter(Boolean) : [];
    if (stdout.length > 0) return JSON.parse(stdout.at(-1));
    return {
      scenarioId: environment.YAREI_AUTH_SMOKE_CHILD === 'database-deny'
        ? 'authenticated-client-database-direct-access-rejected'
        : scenarios[Number(environment.YAREI_AUTH_SMOKE_INDEX)]?.id ?? 'unknown-scenario',
      outcome: 'failed',
      errorCode: safeCode(error),
      assertions: [],
      counts: {},
    };
  }
}

async function signIn(app, username, password) {
  const auth = app.auth({ persistence: 'local' });
  await auth.signInWithPassword({ username, password });
}

async function call(app, functionName, action, payload, businessSessionToken) {
  try {
    const data = {
      apiVersion: 'm1.v1',
      action,
      payload,
      ...(businessSessionToken === null ? {} : { businessSessionToken }),
    };
    const response = await app.callFunction({ name: functionName, data, parse: true });
    return normalizeServiceResult(response?.result);
  } catch (error) {
    return { ok: false, error: { code: safeCode(error) } };
  }
}

async function readSyntheticAccount(alias) {
  const parsed = await runCliJson(['user', 'list', '-e', envId, '--name', alias, '--json']);
  const matches = Array.isArray(parsed.data) ? parsed.data.filter((candidate) => candidate?.Name === alias) : [];
  if (matches.length !== 1) throw new Error(`Synthetic account lookup failed for ${alias}.`);
  return { uid: matches[0].Uid };
}

async function resetSyntheticPassword(uid, password) {
  await runCliJson(['user', 'update', '-e', envId, uid, '--password', password, '--status', 'ACTIVE', '--json']);
}

async function verifyClientDatabaseDenied() {
  const app = sdk.init({ env: envId });
  const password = `YareiM1!${randomBytes(18).toString('base64url')}`;
  const account = await readSyntheticAccount('demo_student_01');
  await resetSyntheticPassword(account.uid, password);
  await signIn(app, 'demo_student_01', password);
  try {
    await app.database().collection('users').limit(1).get();
    return { ok: false, errorCode: 'CLIENT_DATABASE_READ_ALLOWED' };
  } catch (error) {
    return { ok: true, errorCode: safeCode(error) };
  }
}

async function runCliJson(args) {
  const { stdout } = await execute(cli.command, [...cli.arguments, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return parseCliJson(stdout);
}

function normalizeServiceResult(value) {
  if (value !== null && typeof value === 'object' && typeof value.ok === 'boolean') return value;
  return { ok: false, error: { code: 'INVALID_CLOUD_FUNCTION_RESPONSE' } };
}

function firstErrorCode(...results) {
  return results.find((result) => !result.ok)?.error?.code ?? null;
}

function safeCode(error) {
  if (error !== null && typeof error === 'object') {
    for (const candidate of [error.code, error.errorCode, error.errCode, error.message]) {
      if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate).replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80);
    }
  }
  return 'UNKNOWN';
}

function parseCliJson(output) {
  const objectStart = output.indexOf('{');
  const arrayStart = output.indexOf('[');
  const starts = [objectStart, arrayStart].filter((value) => value >= 0);
  if (starts.length === 0) throw new Error('CloudBase CLI returned no JSON payload.');
  return JSON.parse(output.slice(Math.min(...starts)));
}

function parseEnvironment(text) {
  const result = {};
  for (const line of text.split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
}

function requirePrivateValue(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('Required private local configuration is unavailable.');
  return value.trim();
}

function registerNodeAdapter() {
  try {
    require('@cloudbase/js-sdk').useAdapters(require('@cloudbase/adapter-node').default);
  } catch {
    // The current SDK also works in some Node versions without explicit registration.
  }
}

function currentLocalDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}
