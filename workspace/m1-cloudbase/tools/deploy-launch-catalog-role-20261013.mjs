import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify', 'restore-config'].includes(mode)) throw new Error('MODE_INVALID');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const name = 'content-query';
const cache = 'D:/app-m3-cache/launch-catalog-role-20261013';
const config = resolve(cache, 'cloudbaserc.json');
const before = resolve(cache, 'content-query-before');
const after = resolve(cache, 'content-query-after');
const receiptPath = resolve(cache, 'inspect-receipt.json');
const local = resolve(root, 'dist/launch-catalog-role-20261013/content-query');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function cliData(args, configFile = config, allowEmpty = false) {
  let output;
  try {
    output = execFileSync(process.execPath, [cli, '--config-file', configFile, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS,
        `--require=${resolve(root, 'tools/launch-catalog-cos-dns-20261013.cjs')}`].filter(Boolean).join(' ') },
    });
  } catch (error) {
    let diagnostic = 'UNKNOWN';
    try {
      const parsed = JSON.parse(String(error?.stdout ?? ''));
      const value = parsed?.error?.code;
      if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/u.test(value)) diagnostic = value;
    } catch { /* Avoid exposing signed URLs or command output. */ }
    throw new Error(`CLOUD_CLI_FAILED:${diagnostic}`);
  }
  const start = output.indexOf('{');
  if (start < 0 && allowEmpty) return null;
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const parsed = JSON.parse(output.slice(start));
  if (parsed.error) throw new Error('CLOUD_CLI_FAILED');
  return parsed.data;
}

function detail() {
  const row = cliData(['fn', 'detail', name, '--json']);
  const variables = Array.isArray(row.Environment?.Variables) ? row.Environment.Variables : [];
  return { status: row.Status, runtime: row.Runtime, memory: row.MemorySize,
    timeout: row.Timeout, handler: row.Handler, triggers: Array.isArray(row.Triggers) ? row.Triggers.length : -1,
    installDependency: row.InstallDependency === true || String(row.InstallDependency).toUpperCase() === 'TRUE',
    environmentKeys: variables.map(item => item.Key).sort(),
    environmentValuesPresent: variables.every(item => typeof item.Value === 'string' && item.Value.length > 0) };
}

function route() {
  const row = cliData(['fn', 'get-route', name, '--json']);
  return { functionVersion: row.FunctionVersion ?? row.RoutingConfig?.FunctionVersion ?? null,
    additionalVersionWeights: row.RoutingConfig?.AdditionalVersionWeights ?? [],
    additionVersionMatches: row.RoutingConfig?.AdditionVersionMatches ?? [],
    addtionVersionMatchs: row.RoutingConfig?.AddtionVersionMatchs ?? [] };
}

async function download(destination) {
  if ((await readdir(destination).catch(() => [])).length) throw new Error('BACKUP_TARGET_NOT_EMPTY');
  cliData(['fn', 'code', 'download', name, destination, '--json']);
  if (!(await stat(join(destination, 'package.json'))).isFile()) throw new Error('REMOTE_PACKAGE_INCOMPLETE');
  return hash(join(destination, 'index.js'));
}

async function downloadWithRetry(prefix) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return await download(resolve(cache, `${prefix}-${attempt}`)); }
    catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolveWait => setTimeout(resolveWait, 2_000));
    }
  }
  throw new Error('READBACK_UNAVAILABLE');
}

function restoreDependencyFlag() {
  cliData(['config', 'update', 'fn', name, '--json'], resolve(cache, 'cloudbaserc-restore.json'), true);
}

await mkdir(cache, { recursive: true });
const envText = await readFile(resolve(root, '.env.local'), 'utf8');
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
const sourceConfig = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
if (!envId || sourceConfig.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
try {
  if (!same(JSON.parse(await readFile(config, 'utf8')), { envId })) throw new Error('ISOLATED_CONFIG_MISMATCH');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  await writeFile(config, `${JSON.stringify({ envId }, null, 2)}\n`, { flag: 'wx' });
}
const envs = cliData(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE');
}
const currentDetail = detail();
const currentRoute = route();
if (currentDetail.status !== 'Active' || currentDetail.runtime !== 'Nodejs20.19'
  || currentDetail.memory !== 256 || currentDetail.timeout !== 10 || currentDetail.triggers !== 0
  || !currentDetail.environmentValuesPresent
  || currentRoute.functionVersion !== '$LATEST' || currentRoute.additionalVersionWeights.length !== 0
  || currentRoute.additionVersionMatches.length !== 0 || currentRoute.addtionVersionMatchs.length !== 0) {
  throw new Error('FUNCTION_BASELINE_CHANGED');
}
if (!same((await readdir(local)).sort(), ['index.js', 'package.json'])) throw new Error('LOCAL_PACKAGE_SCOPE_INVALID');
const localHash = hash(join(local, 'index.js'));
const localSize = (await stat(join(local, 'index.js'))).size + (await stat(join(local, 'package.json'))).size;
if (localSize > 1_500_000) throw new Error('DIRECT_ZIP_LIMIT_RISK');

if (mode === 'restore-config') {
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  if (receipt.currentDetail.installDependency !== false || currentDetail.installDependency !== true
    || !same({ ...currentDetail, installDependency: false }, receipt.currentDetail)
    || !same(currentRoute, receipt.currentRoute)) throw new Error('CONFIG_RESTORE_BASELINE_CHANGED');
  const restoreConfig = resolve(cache, 'cloudbaserc-restore.json');
  try {
    if (!same(JSON.parse(await readFile(restoreConfig, 'utf8')),
      { envId, functions: [{ name, installDependency: false }] })) throw new Error('RESTORE_CONFIG_CHANGED');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(restoreConfig,
      `${JSON.stringify({ envId, functions: [{ name, installDependency: false }] }, null, 2)}\n`, { flag: 'wx' });
  }
  cliData(['config', 'update', 'fn', name, '--json'], restoreConfig, true);
  const restored = detail();
  if (!same(restored, receipt.currentDetail)) throw new Error('CONFIG_RESTORE_UNVERIFIED');
  process.stdout.write(JSON.stringify({ status: 'config-restored', function: name,
    configurationPreserved: true }) + '\n');
  process.exit(0);
}

if (mode === 'inspect') {
  if ((await readdir(before).catch(() => [])).length || (await readdir(after).catch(() => [])).length) {
    throw new Error('BACKUP_TARGET_NOT_EMPTY');
  }
  const previousHash = await download(before);
  const receipt = { previousHash, localHash, localSize, currentDetail, currentRoute,
    inspectedAt: new Date().toISOString() };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: 'ready', function: name, previousHash, localHash,
    localSize, configurationPreserved: true, costGate: 'free-no-overrun' }) + '\n');
} else {
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  if (hash(join(before, 'index.js')) !== receipt.previousHash || localHash !== receipt.localHash
    || !same({ ...currentDetail, installDependency: receipt.currentDetail.installDependency }, receipt.currentDetail)
    || !same(currentRoute, receipt.currentRoute)) {
    throw new Error('VERIFIED_BASELINE_CHANGED');
  }
  if (mode === 'apply') {
    if ((await readdir(after).catch(() => [])).length) throw new Error('READBACK_TARGET_NOT_EMPTY');
    if (!same(currentDetail, receipt.currentDetail)) throw new Error('CONFIG_NOT_RESTORED');
    cliData(['fn', 'code', 'update', name, '--dir', local, '--deployMode', 'zip', '--json']);
    restoreDependencyFlag();
    let readbackHash;
    try { readbackHash = await downloadWithRetry('content-query-after-retry'); } catch { readbackHash = null; }
    const afterDetail = detail();
    const afterRoute = route();
    if (readbackHash !== localHash || !same(afterDetail, currentDetail) || !same(afterRoute, currentRoute)) {
      cliData(['fn', 'code', 'update', name, '--dir', before, '--deployMode', 'zip', '--json']);
      restoreDependencyFlag();
      const rollbackHash = await downloadWithRetry('content-query-rollback-retry');
      if (rollbackHash !== receipt.previousHash) throw new Error('ROLLBACK_UNVERIFIED');
      throw new Error('POSTCHECK_FAILED_ROLLED_BACK');
    }
    process.stdout.write(JSON.stringify({ status: 'deployed', function: name, remoteHash: readbackHash,
      configurationPreserved: true, routePreserved: true }) + '\n');
  } else {
    const remoteHash = await download(resolve(cache, `content-query-current-${Date.now()}`));
    const status = remoteHash === localHash ? 'deployed'
      : remoteHash === receipt.previousHash ? 'rolled-back' : 'unknown-version';
    process.stdout.write(JSON.stringify({ status, function: name, remoteHash,
      configurationPreserved: same(currentDetail, receipt.currentDetail),
      installDependencyChanged: currentDetail.installDependency !== receipt.currentDetail.installDependency }) + '\n');
  }
}
