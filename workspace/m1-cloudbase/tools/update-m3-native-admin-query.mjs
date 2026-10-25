// Deploys the in-scope user-facing projection correction to the already-approved query function.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--approved')) throw new Error('APPROVAL_FLAG_REQUIRED');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const name = 'native-admin-query';
const packageRoot = './dist/native-admin-review/functions';
const archivePath = resolve(root, 'dist/native-admin-review/zips/native-admin-query-display-label-fix-v2-20261006.zip');
const expectedArchiveHash = '8C38CAA54F4D478AFBD51E6D75060C597ED7573FFB6239D6F4BBC0CFE2AD8E19';
const keys = ['YAREI_SUBJECT_PEPPER', 'YAREI_QUERY_CURSOR_SIGNING_KEY',
  'YAREI_BATCH_REVIEW_SIGNING_KEY', 'YAREI_BUSINESS_SESSION_ENCRYPTION_KEY',
  'YAREI_BINDING_CODE_DERIVATION_KEY', 'YAREI_BINDING_CODE_PEPPER'];
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const localEnv = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!localEnv || config.envId !== localEnv) throw new Error('LOCAL_ENVIRONMENT_MISMATCH');
const envVariables = config.functions?.find(row => row.name === 'task-query')?.envVariables;
if (!envVariables || keys.some(key => typeof envVariables[key] !== 'string' || envVariables[key].length < 16)) {
  throw new Error('FUNCTION_KEY_SET_INVALID');
}
const archiveHash = createHash('sha256').update(await readFile(archivePath)).digest('hex').toUpperCase();
if (archiveHash !== expectedArchiveHash) throw new Error('APPROVED_QUERY_BUNDLE_HASH_MISMATCH');

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

const environments = run(['env', 'list', '--json']).data;
if (!Array.isArray(environments) || environments.length !== 1 || environments[0].EnvId !== localEnv
  || environments[0].Status !== 'NORMAL' || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_OR_COST_GATE');
const before = run(['fn', 'detail', name, '--json']).data ?? {};
const beforeKeys = (Array.isArray(before.Environment?.Variables) ? before.Environment.Variables : [])
  .map(row => row.Key).filter(value => typeof value === 'string').sort();
if (before.Status !== 'Active' || before.Runtime !== 'Nodejs20.19' || before.Handler !== 'index.main'
  || before.Timeout !== 20 || before.MemorySize !== 256
  || JSON.stringify(beforeKeys) !== JSON.stringify([...keys].sort())
  || (Array.isArray(before.Triggers) && before.Triggers.length !== 0)) {
  throw new Error('CURRENT_QUERY_FUNCTION_STATE_MISMATCH');
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'yarei-m3-native-admin-query-update-'));
const temporaryConfig = join(temporaryRoot, 'cloudbaserc.json');
try {
  await writeFile(temporaryConfig, JSON.stringify({ $schema: config.$schema, version: '2.0',
    envId: localEnv, region: config.region, functionRoot: packageRoot,
    functions: [{ name, runtime: 'Nodejs20.19', handler: 'index.main', timeout: 20,
      memorySize: 256, installDependency: true,
      envVariables: Object.fromEntries(keys.map(key => [key, envVariables[key]])) }] }, null, 2),
  { encoding: 'utf8', mode: 0o600 });
  run(['--config-file', temporaryConfig, 'fn', 'deploy', name, '--force', '--json']);
  const after = run(['--config-file', temporaryConfig, 'fn', 'detail', name, '--json']).data ?? {};
  const afterKeys = (Array.isArray(after.Environment?.Variables) ? after.Environment.Variables : [])
    .map(row => row.Key).filter(value => typeof value === 'string').sort();
  if (after.Status !== 'Active' || after.Runtime !== 'Nodejs20.19' || after.Handler !== 'index.main'
    || after.Timeout !== 20 || after.MemorySize !== 256
    || JSON.stringify(afterKeys) !== JSON.stringify([...keys].sort())
    || (Array.isArray(after.Triggers) && after.Triggers.length !== 0)) {
    throw new Error('UPDATED_QUERY_FUNCTION_CONFIG_MISMATCH');
  }
  process.stdout.write(JSON.stringify({ status: after.Status, functionName: name,
    codeUpdated: true, runtime: after.Runtime, timeout: after.Timeout,
    memorySize: after.MemorySize, triggerCount: Array.isArray(after.Triggers) ? after.Triggers.length : null,
    environmentKeyCount: afterKeys.length, bundleSha256: archiveHash }) + '\n');
} finally {
  const resolvedRoot = resolve(temporaryRoot);
  const resolvedTemp = resolve(tmpdir());
  if (!resolvedRoot.startsWith(`${resolvedTemp}/`) && !resolvedRoot.startsWith(`${resolvedTemp}\\`)) {
    throw new Error('TEMP_CONFIG_PATH_UNSAFE');
  }
  await unlink(temporaryConfig).catch(() => undefined);
  await rmdir(temporaryRoot).catch(() => undefined);
}
