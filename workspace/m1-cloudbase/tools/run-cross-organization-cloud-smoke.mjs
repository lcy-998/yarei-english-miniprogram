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
const environment = parseEnvironment(await readFile(resolve(root, '.env.local'), 'utf8'));
const envId = requirePrivateValue(environment.TCB_ENV_ID);
const cli = {
  command: process.execPath,
  arguments: [resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')],
};

const scenarios = [
  {
    id: 'cross-organization-parent-rejected',
    alias: 'demo_parent_01', role: 'parent',
    functionName: 'parent-query', action: 'getHome',
    payload: { childId: 'usr_isolation_student' },
  },
  {
    id: 'cross-organization-teacher-rejected',
    alias: 'demo_teacher_01', role: 'teacher',
    functionName: 'teacher-student-query', action: 'getStudent',
    payload: { studentId: 'usr_isolation_student' },
  },
  {
    id: 'cross-organization-admin-rejected',
    alias: 'demo_admin_01', role: 'admin',
    functionName: 'organization-admin', action: 'listUsers',
    payload: { classId: 'cls_isolation_secondary' },
  },
];

registerNodeAdapter();
const sdk = require('@cloudbase/js-sdk');
const evidence = [];
for (const scenario of scenarios) evidence.push(await runScenario(scenario));

for (const item of evidence) {
  process.stdout.write(`${item.scenarioId}=${item.outcome}${item.errorCode === null ? '' : `:${item.errorCode}`}\n`);
}
process.stdout.write(`cross_organization_smoke_passed=${evidence.every((item) => item.outcome === 'passed')}; scenario_count=${evidence.length}\n`);
process.exit(evidence.every((item) => item.outcome === 'passed') ? 0 : 2);

async function runScenario(scenario) {
  const app = sdk.init({ env: envId });
  const password = `YareiM1!${randomBytes(18).toString('base64url')}`;
  const account = await readSyntheticAccount(scenario.alias);
  await resetSyntheticPassword(account.uid, password);
  await app.auth({ persistence: 'local' }).signInWithPassword({ username: scenario.alias, password });

  const bootstrap = await call(app, scenario.role === 'admin' ? 'admin-session' : 'auth-session', 'bootstrap', {}, null);
  const token = bootstrap.ok ? (scenario.role === 'admin' ? bootstrap.data?.token : bootstrap.data?.sessionId) : null;
  const selected = bootstrap.ok && scenario.role !== 'admin'
    ? await call(app, 'auth-session', 'selectRole', { role: scenario.role }, token)
    : bootstrap;
  const result = selected.ok && typeof token === 'string'
    ? await call(app, scenario.functionName, scenario.action, scenario.payload, token)
    : selected;
  const denied = !result.ok && (result.error?.code === 'NOT_FOUND' || result.error?.code === 'FORBIDDEN');
  return {
    scenarioId: scenario.id,
    outcome: bootstrap.ok && selected.ok && denied ? 'passed' : 'failed',
    errorCode: denied ? null : firstErrorCode(bootstrap, selected, result),
  };
}

async function call(app, functionName, action, payload, businessSessionToken) {
  try {
    const response = await app.callFunction({
      name: functionName,
      data: { apiVersion: 'm1.v1', action, payload, ...(businessSessionToken === null ? {} : { businessSessionToken }) },
      parse: true,
    });
    return normalizeServiceResult(response?.result);
  } catch (error) {
    return { ok: false, error: { code: safeCode(error) } };
  }
}

async function readSyntheticAccount(alias) {
  const parsed = await runCliJson(['user', 'list', '-e', envId, '--name', alias, '--json']);
  const matches = Array.isArray(parsed.data) ? parsed.data.filter((candidate) => candidate?.Name === alias) : [];
  if (matches.length !== 1 || typeof matches[0]?.Uid !== 'string') throw new Error('Synthetic account lookup failed.');
  return { uid: matches[0].Uid };
}

async function resetSyntheticPassword(uid, password) {
  await runCliJson(['user', 'update', '-e', envId, uid, '--password', password, '--status', 'ACTIVE', '--json']);
}

async function runCliJson(argumentsList) {
  const { stdout } = await execute(cli.command, [...cli.arguments, ...argumentsList], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024,
  });
  return parseCliJson(stdout);
}

function normalizeServiceResult(value) {
  return value !== null && typeof value === 'object' && typeof value.ok === 'boolean'
    ? value
    : { ok: false, error: { code: 'INVALID_CLOUD_FUNCTION_RESPONSE' } };
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
  const starts = [output.indexOf('{'), output.indexOf('[')].filter((value) => value >= 0);
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
    require('@cloudbase/adapter-node');
  } catch {
    // Some supported Node runtimes do not require explicit adapter registration.
  }
}
