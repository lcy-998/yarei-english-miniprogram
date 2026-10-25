import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(root, '..', '..');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const CLI = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
const FUNCTION = 'content-query';
const OLD_HASH = 'ABD37988CE650F90D48D7A4549D4D974CB02DA10B92FCF1DA91126746C2115FE';
const NEW_HASH = '5A78BACDF849D332FF9DD33967BF747B74759290046E2270E2F684D3E53B295B';
const CACHE_ROOT = 'D:/app-m3-cache/student/content-query-pending-readings-20261006';
const CONFIG = resolve(CACHE_ROOT, 'cloudbaserc.json');
const LOCAL_PACKAGE = resolve(root, 'dist/functions-m3-reading-pending-20261006/content-query');
const BEFORE = resolve(CACHE_ROOT, 'content-query-before');
const AFTER = resolve(CACHE_ROOT, 'content-query-after-retry');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();

function cliJson(args) {
  const raw = execFileSync(process.execPath, [CLI, '--config-file', CONFIG, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const result = JSON.parse(raw.slice(start));
  if (result.error) throw new Error('CLOUD_CLI_FAILED');
  return result.data;
}

function hashOf(path) { return sha256(readFileSync(path)); }

function detail() {
  const row = cliJson(['fn', 'detail', FUNCTION, '--json']);
  const variables = Array.isArray(row.Environment?.Variables) ? row.Environment.Variables : [];
  return { status: row.Status, runtime: row.Runtime, memory: row.MemorySize, timeout: row.Timeout,
    handler: row.Handler, triggerCount: Array.isArray(row.Triggers) ? row.Triggers.length : -1,
    installDependency: row.InstallDependency === true || String(row.InstallDependency).toUpperCase() === 'TRUE',
    environmentKeys: variables.map(item => item.Key).sort(),
    environmentValuesPresent: variables.every(item => typeof item.Value === 'string' && item.Value.length > 0) };
}

function route() {
  const row = cliJson(['fn', 'get-route', FUNCTION, '--json']);
  return { functionVersion: row.FunctionVersion ?? row.RoutingConfig?.FunctionVersion ?? null,
    additionalVersionWeights: row.RoutingConfig?.AdditionalVersionWeights ?? [],
    additionVersionMatches: row.RoutingConfig?.AdditionVersionMatches ?? [],
    addtionVersionMatchs: row.RoutingConfig?.AddtionVersionMatchs ?? [] };
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function download(dest) {
  if ((await readdir(dest).catch(() => [])).length) throw new Error('BACKUP_TARGET_NOT_EMPTY');
  cliJson(['fn', 'code', 'download', FUNCTION, dest, '--json']);
  const hash = hashOf(join(dest, 'index.js'));
  if (!(await stat(join(dest, 'package.json'))).isFile()) throw new Error('REMOTE_PACKAGE_JSON_MISSING');
  return hash;
}

async function deploy(directory) {
  cliJson(['fn', 'code', 'update', FUNCTION, '--dir', directory, '--deployMode', 'zip', '--json']);
}

await mkdir(CACHE_ROOT, { recursive: true });
const envText = await readFile(resolve(root, '.env.local'), 'utf8');
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
const sourceConfig = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
if (!envId || sourceConfig.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const isolatedConfig = { envId };
try {
  const existingConfig = JSON.parse(await readFile(CONFIG, 'utf8'));
  if (!same(existingConfig, isolatedConfig)) throw new Error('ISOLATED_CONFIG_MISMATCH');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  await mkdir(dirname(CONFIG), { recursive: true });
  await writeFile(CONFIG, `${JSON.stringify(isolatedConfig, null, 2)}\n`, 'utf8', { flag: 'wx' });
}
const envs = cliJson(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE');
}
const beforeDetail = detail();
const beforeRoute = route();
if (beforeDetail.status !== 'Active' || beforeDetail.runtime !== 'Nodejs20.19'
  || beforeDetail.memory !== 256 || beforeDetail.timeout !== 10 || beforeDetail.triggerCount !== 0
  || !beforeDetail.installDependency || !beforeDetail.environmentValuesPresent
  || !same(beforeDetail.environmentKeys, [
    'YAREI_BATCH_REVIEW_SIGNING_KEY', 'YAREI_BINDING_CODE_DERIVATION_KEY', 'YAREI_BINDING_CODE_PEPPER',
    'YAREI_BUSINESS_SESSION_ENCRYPTION_KEY', 'YAREI_QUERY_CURSOR_SIGNING_KEY', 'YAREI_SUBJECT_PEPPER',
  ]) || beforeRoute.functionVersion !== '$LATEST' || beforeRoute.additionalVersionWeights.length !== 0
    || beforeRoute.additionVersionMatches.length !== 0 || beforeRoute.addtionVersionMatchs.length !== 0) {
  throw new Error('FUNCTION_BASELINE_CHANGED');
}

const localIndexHash = hashOf(join(LOCAL_PACKAGE, 'index.js'));
if (localIndexHash !== NEW_HASH) throw new Error('LOCAL_FUNCTION_HASH_MISMATCH');
const localEntries = await readdir(LOCAL_PACKAGE);
if (!same(localEntries.sort(), ['index.js', 'package.json'])) throw new Error('LOCAL_PACKAGE_SCOPE_INVALID');
if (mode === 'inspect') {
  if ((await readdir(BEFORE).catch(() => [])).length || (await readdir(AFTER).catch(() => [])).length) {
    throw new Error('DEPLOYMENT_BACKUP_PATH_NOT_EMPTY');
  }
  const size = (await stat(join(LOCAL_PACKAGE, 'index.js'))).size
    + (await stat(join(LOCAL_PACKAGE, 'package.json'))).size;
  if (size > 1_500_000) throw new Error('DIRECT_ZIP_LIMIT_RISK');
  const currentCode = await download(BEFORE);
  if (currentCode !== OLD_HASH) throw new Error('REMOTE_FUNCTION_HASH_CHANGED');
  process.stdout.write(JSON.stringify({ status: 'ready', function: FUNCTION,
    currentCodeHash: currentCode, newCodeHash: localIndexHash, sourceSizeBytes: size,
    deploymentMode: 'code-only direct ZIP', envVariableKeysPreserved: true,
    runtime: beforeDetail.runtime, memory: beforeDetail.memory, timeout: beforeDetail.timeout,
    triggers: beforeDetail.triggerCount, route: beforeRoute }) + '\n');
} else if (mode === 'apply') {
  const previousCode = hashOf(join(BEFORE, 'index.js'));
  if (previousCode !== OLD_HASH) throw new Error('VERIFIED_BACKUP_REQUIRED');
  await deploy(LOCAL_PACKAGE);
  const afterCode = await download(AFTER);
  const afterDetail = detail();
  const afterRoute = route();
  if (afterCode !== NEW_HASH || !same(afterDetail, beforeDetail) || !same(afterRoute, beforeRoute)) {
    await deploy(BEFORE);
    const rollbackCode = await download(resolve(CACHE_ROOT, 'content-query-rollback-readback'));
    if (rollbackCode !== OLD_HASH) throw new Error('DEPLOYMENT_FAILED_AND_ROLLBACK_UNVERIFIED');
    throw new Error('DEPLOYMENT_POSTCHECK_FAILED_ROLLED_BACK');
  }
  process.stdout.write(JSON.stringify({ status: 'deployed', function: FUNCTION,
    remoteCodeHash: afterCode, runtimeConfigurationUnchanged: true,
    environmentVariableKeysUnchanged: true, routeUnchanged: true }) + '\n');
} else {
  const currentCode = hashOf(join(AFTER, 'index.js'));
  if (currentCode !== NEW_HASH || beforeDetail.status !== 'Active') throw new Error('DEPLOYMENT_VERIFY_FAILED');
  process.stdout.write(JSON.stringify({ status: 'verified', function: FUNCTION,
    remoteCodeHash: currentCode, status: beforeDetail.status, runtime: beforeDetail.runtime,
    memory: beforeDetail.memory, timeout: beforeDetail.timeout, triggers: beforeDetail.triggerCount,
    environmentVariableKeysUnchanged: true, route: beforeRoute }) + '\n');
}
