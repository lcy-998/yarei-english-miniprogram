// Requires the user-approved 2026-10-06 M3 native-admin review package.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--approved')) throw new Error('APPROVAL_FLAG_REQUIRED');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const functionRoot = './dist/native-admin-review/functions';
const names = ['native-admin-query', 'native-admin-command',
  'native-admin-management-command', 'native-admin-operations-command',
  'native-admin-media-command'];
const approvedHashes = new Map([
  ['native-admin-command.zip', 'A2ED2FB4C786FFEAA647376F9E0A54D48BA451A3F0C4ADF4398E8538B286165E'],
  ['native-admin-management-command.zip', '196A5FF06CDE0462937E17386C59BD9349768D41CD0C13F00226B924CE0E9CC2'],
  ['native-admin-media-command.zip', '068B4218939643779D1FAAD34FC29136381E0BE1F80FB7896B532D7D87784C4C'],
  ['native-admin-operations-command.zip', '3C89A545FDF0A57C8FFEB305F52F99C70873F6E87413A92B24A043AF37CA02D2'],
  ['native-admin-query.zip', 'C3DA0F0A683B2A015049EFFEB69DBB0E0559CCEC98AD6FF07A0DBA661AEDDC7C'],
]);
const keys = ['YAREI_SUBJECT_PEPPER', 'YAREI_QUERY_CURSOR_SIGNING_KEY',
  'YAREI_BATCH_REVIEW_SIGNING_KEY', 'YAREI_BUSINESS_SESSION_ENCRYPTION_KEY',
  'YAREI_BINDING_CODE_DERIVATION_KEY', 'YAREI_BINDING_CODE_PEPPER'];
const localConfig = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const localEnv = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!localEnv || localConfig.envId !== localEnv) throw new Error('LOCAL_ENVIRONMENT_MISMATCH');
const templateEnvironment = localConfig.functions?.find(row => row.name === 'task-query')?.envVariables;
if (!templateEnvironment || keys.some(key => typeof templateEnvironment[key] !== 'string'
  || templateEnvironment[key].length < 16)) throw new Error('FUNCTION_KEY_SET_INVALID');

function run(args, timeout = 90000) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const result = JSON.parse(raw.slice(first));
  if (result.error) throw new Error(`CLOUD_API_${result.error.code ?? 'FAILED'}`);
  return result;
}

function sanitizeError(error) {
  let value = String(error?.stdout ?? error?.stderr ?? error?.message ?? 'DEPLOY_FAILED');
  value = value.replaceAll(localEnv, '[ENV]');
  for (const key of keys) {
    const secret = templateEnvironment[key];
    if (secret) value = value.replaceAll(secret, '[REDACTED]');
  }
  return value.replace(/\b(?:AKID|SK)[A-Za-z0-9]{10,}\b/g, '[REDACTED]').slice(0, 260);
}

const environmentResult = run(['env', 'list', '--json']);
const environments = environmentResult.data;
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== localEnv || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE');
}
const temporaryCredentials = run(['secrets', 'get', '--json']).data;
if (temporaryCredentials?.isTemporary !== true || temporaryCredentials.envId !== localEnv
  || Date.parse(temporaryCredentials.expiredAt) <= Date.now() + 300_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID');
}
const functionList = run(['fn', 'list', '--limit', '100', '--offset', '0', '--json']).data?.Functions;
if (!Array.isArray(functionList)) throw new Error('FUNCTION_LIST_INCOMPLETE');
for (const name of names) {
  if (functionList.some(row => row.FunctionName === name)) {
    throw new Error(`FUNCTION_STATE_CHANGED_${name}`);
  }
}

for (const [zipName, expected] of approvedHashes) {
  const archive = await readFile(resolve(root, 'dist/native-admin-review/zips', zipName));
  const actual = createHash('sha256').update(archive).digest('hex').toUpperCase();
  if (actual !== expected) throw new Error(`APPROVED_BUNDLE_HASH_MISMATCH_${zipName}`);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'yarei-m3-native-admin-'));
const temporaryConfig = join(temporaryRoot, 'cloudbaserc.json');
const functionDefinitions = names.map(name => ({ name, runtime: 'Nodejs20.19', handler: 'index.main',
  timeout: 20, memorySize: 256, installDependency: true,
  envVariables: Object.fromEntries(keys.map(key => [key, templateEnvironment[key]])) }));
try {
  await writeFile(temporaryConfig, JSON.stringify({ $schema: localConfig.$schema, version: '2.0',
    envId: localEnv, region: localConfig.region, functionRoot, functions: functionDefinitions }, null, 2),
  { encoding: 'utf8', mode: 0o600 });

  for (const name of names) {
    process.stdout.write(`deploy ${name}\n`);
    try {
      run(['--config-file', temporaryConfig, 'fn', 'deploy', name, '--json']);
    } catch (error) {
      throw new Error(`DEPLOY_${name}:${sanitizeError(error)}`);
    }
    const detail = run(['--config-file', temporaryConfig, 'fn', 'detail', name, '--json']).data ?? {};
    const environment = detail.Environment ?? {};
    const actualKeys = (Array.isArray(environment.Variables) ? environment.Variables : [])
      .map(item => item.Key).filter(value => typeof value === 'string').sort();
    if (detail.Status !== 'Active' || detail.Runtime !== 'Nodejs20.19'
      || detail.Handler !== 'index.main' || detail.Timeout !== 20 || detail.MemorySize !== 256
      || (Array.isArray(detail.Triggers) && detail.Triggers.length !== 0)
      || JSON.stringify(actualKeys) !== JSON.stringify([...keys].sort())) {
      throw new Error(`DEPLOYED_FUNCTION_CONFIG_MISMATCH_${name}`);
    }
    process.stdout.write(JSON.stringify({ status: detail.Status, functionName: name,
      runtime: detail.Runtime, timeout: detail.Timeout, memorySize: detail.MemorySize,
      triggerCount: Array.isArray(detail.Triggers) ? detail.Triggers.length : null,
      environmentKeyCount: actualKeys.length }) + '\n');
  }
} finally {
  const resolvedRoot = resolve(temporaryRoot);
  const resolvedTemp = resolve(tmpdir());
  if (!resolvedRoot.startsWith(`${resolvedTemp}/`) && !resolvedRoot.startsWith(`${resolvedTemp}\\`)) {
    throw new Error('TEMP_CONFIG_PATH_UNSAFE');
  }
  await unlink(temporaryConfig).catch(() => undefined);
  await rmdir(temporaryRoot).catch(() => undefined);
}
