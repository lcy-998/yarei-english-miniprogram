import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify', 'rollback'].includes(mode)) throw new Error('MODE_INVALID');
if (mode === 'apply') throw new Error('DIRECT_ZIP_API_REPLACES_CLI_1_5MB_LIMIT');
const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const cache = 'D:/app-m3-cache/task-publication-hotfix-20261008-rebased';
const configPath = resolve(cache, 'cloudbaserc.json');
const baseline = resolve(cache, 'baseline');
const candidate = resolve(cache, 'candidate');
const artifact = resolve(root, 'dist/m3-task-publication-hotfix-20261008-rebased/task-command/index.js');
const resultPath = resolve(cache, 'deployment-result.json');
const OLD_HASH = 'ad0a4bf3c21dd4ba9e436c108bd3084f1ddd67b6283374a854dc4e9927336bdd';
const NEW_HASH = '6d3283b71c24517222bc19759d0c45392660c134ba19988f2578a931cade4750';
const sha = data => createHash('sha256').update(data).digest('hex');
const fileHash = async path => sha(await readFile(path));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function cliData(args) {
  let raw;
  try {
    raw = execFileSync(process.execPath, [cli, '--config-file', configPath, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true,
      timeout: args[0] === 'fn' && args[1] === 'code' && args[2] === 'update' ? 180000 : 60000,
      maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const output = String(error.stdout ?? error.stderr ?? '');
    let category = 'UNKNOWN';
    try {
      const parsed = JSON.parse(output.slice(output.indexOf('{')));
      category = String(parsed.error?.code ?? parsed.error?.name ?? 'UNKNOWN')
        .replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 70);
      const message = String(parsed.error?.message ?? '')
        .replace(/https?:\/\/\S+/g, '[url]')
        .replace(/[A-Za-z0-9+/_=-]{18,}/g, '[redacted]')
        .replace(/[^\p{L}\p{N} .,;:()\[\]_-]/gu, '_').slice(0, 140);
      if (message) category += `_${message}`;
    } catch { /* Keep cloud error text out of logs. */ }
    const processCode = String(error.code ?? error.status ?? 'UNKNOWN')
      .replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 70);
    throw new Error(`CLOUD_CLI_FAILED_${args.slice(0, 3).join('_')}_${processCode}_${category}`);
  }
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const parsed = JSON.parse(raw.slice(first));
  if (parsed.error) throw new Error(`CLOUD_CLI_REJECTED_${args.slice(0, 3).join('_')}`);
  return parsed.data;
}
function details() { return cliData(['fn', 'detail', 'task-command', '--json']); }
function route() {
  const value = cliData(['fn', 'get-route', 'task-command', '--json']);
  return { functionVersion: value.FunctionVersion ?? value.RoutingConfig?.FunctionVersion ?? null,
    weights: value.RoutingConfig?.AdditionalVersionWeights ?? [],
    matches: value.RoutingConfig?.AdditionVersionMatches ?? [],
    legacyMatches: value.RoutingConfig?.AddtionVersionMatchs ?? [] };
}
function configSignature(value) {
  const variables = Array.isArray(value.Environment?.Variables) ? value.Environment.Variables : [];
  if (!variables.length || variables.some(row => typeof row.Key !== 'string'
    || typeof row.Value !== 'string' || row.Value.length === 0)) throw new Error('FUNCTION_ENV_UNAVAILABLE');
  return {
    runtime: value.Runtime, memory: value.MemorySize, timeout: value.Timeout,
    handler: value.Handler, role: value.Role, installDependency: value.InstallDependency,
    triggers: value.Triggers, vpc: value.VpcConfig,
    publicNet: value.PublicNetConfig, dnsCache: value.DnsCache,
    environmentDigest: sha(JSON.stringify(variables.map(row => [row.Key, row.Value])
      .sort((left, right) => left[0].localeCompare(right[0])))),
    environmentKeys: variables.map(row => row.Key).sort(),
  };
}
function assertBaseline(value, selectedRoute) {
  if (value.FunctionName !== 'task-command' || value.Status !== 'Active'
    || value.Runtime !== 'Nodejs20.19' || value.MemorySize !== 256
    || value.Timeout !== 20 || value.InstallDependency !== 'FALSE'
    || value.Handler !== 'index.main' || value.FunctionVersion !== '$LATEST'
    || !Array.isArray(value.Triggers) || value.Triggers.length !== 0
    || sha(value.CodeInfo ?? '') !== OLD_HASH || selectedRoute.functionVersion !== '$LATEST'
    || selectedRoute.weights.length || selectedRoute.matches.length || selectedRoute.legacyMatches.length) {
    throw new Error('REMOTE_BASELINE_CHANGED');
  }
}
async function pollHash(expected) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = details();
    if (current.Status === 'Active' && sha(current.CodeInfo ?? '') === expected) return current;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('FUNCTION_CODE_READBACK_MISMATCH');
}
async function codeUpdate(directory) {
  cliData(['fn', 'code', 'update', 'task-command', '--dir', directory, '--deployMode', 'zip', '--json']);
}

const projectConfig = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envLine = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice('TCB_ENV_ID='.length).trim();
if (!envId || projectConfig.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
await mkdir(cache, { recursive: true });
const isolatedConfig = { envId, functions: [{ name: 'task-command', installDependency: false }] };
try {
  const existing = JSON.parse(await readFile(configPath, 'utf8'));
  if (!same(existing, isolatedConfig)) throw new Error('ISOLATED_CONFIG_MISMATCH');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  await writeFile(configPath, `${JSON.stringify(isolatedConfig, null, 2)}\n`, { flag: 'wx' });
}
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_OR_COST_GATE');
const quotas = {};
for (const name of ['FunctionInvocation', 'DbWritepkg', 'DbReadpkg']) {
  const value = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
    '--body', JSON.stringify({ EnvId: envId, MetricName: name }), '--json']);
  if (!Number.isFinite(value?.Value) || value.Value >= 190000) throw new Error(`QUOTA_GATE_${name}`);
  quotas[name] = value.Value;
}
if (await fileHash(resolve(baseline, 'index.js')) !== OLD_HASH
  || await fileHash(artifact) !== NEW_HASH
  || JSON.parse(await readFile(resolve(baseline, 'node_modules/@cloudbase/node-sdk/package.json'), 'utf8')).version !== '3.18.3') {
  throw new Error('FROZEN_PACKAGE_MISMATCH');
}
if ((await readdir(baseline)).sort().join(',') !== 'index.js,node_modules,package.json') {
  throw new Error('BASELINE_PACKAGE_INCOMPLETE');
}
const initial = details();
const initialRoute = route();
if (mode === 'inspect' || mode === 'apply') assertBaseline(initial, initialRoute);
if (mode === 'inspect') {
  const candidateEntries = await readdir(candidate).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error));
  if (candidateEntries.length === 0) throw new Error('PREPARE_REBASED_FULL_PACKAGE_FIRST');
  if (await fileHash(resolve(candidate, 'index.js')) !== NEW_HASH
    || JSON.parse(await readFile(resolve(candidate, 'node_modules/@cloudbase/node-sdk/package.json'), 'utf8')).version !== '3.18.3'
    || (await readdir(candidate)).sort().join(',') !== 'index.js,node_modules,package.json') {
    throw new Error('CANDIDATE_PACKAGE_INVALID');
  }
  process.stdout.write(JSON.stringify({ status: 'ready', oldHash: OLD_HASH,
    newHash: NEW_HASH, candidateBytes: (await stat(resolve(candidate, 'index.js'))).size,
    sdkVersion: '3.18.3', quotas, route: initialRoute,
    environmentKeyCount: configSignature(initial).environmentKeys.length }) + '\n');
  process.exit(0);
}
if (mode === 'verify') {
  if (initial.Status !== 'Active' || sha(initial.CodeInfo ?? '') !== NEW_HASH
    || initial.InstallDependency !== 'FALSE') throw new Error('NEW_CODE_NOT_ACTIVE');
  process.stdout.write(JSON.stringify({ status: 'verified', codeSha256: NEW_HASH,
    functionStatus: initial.Status, quotas }) + '\n');
  process.exit(0);
}
if (mode === 'rollback') {
  if (initial.Status !== 'Active' || sha(initial.CodeInfo ?? '') !== NEW_HASH
    || initial.InstallDependency !== 'FALSE' || initialRoute.functionVersion !== '$LATEST'
    || initialRoute.weights.length || initialRoute.matches.length || initialRoute.legacyMatches.length) {
    throw new Error('ROLLBACK_BASELINE_CHANGED');
  }
  const beforeConfig = configSignature(initial);
  await codeUpdate(baseline);
  const restored = await pollHash(OLD_HASH);
  if (!same(beforeConfig, configSignature(restored)) || !same(initialRoute, route())) {
    throw new Error('ROLLBACK_CONFIG_OR_ROUTE_MISMATCH');
  }
  process.stdout.write(JSON.stringify({ status: 'rolled-back', codeSha256: OLD_HASH,
    configUnchanged: true, routeUnchanged: true }) + '\n');
  process.exit(0);
}
if (await fileHash(resolve(candidate, 'index.js')) !== NEW_HASH) throw new Error('INSPECT_CANDIDATE_FIRST');
const beforeConfig = configSignature(initial);
try {
  await codeUpdate(candidate);
  const after = await pollHash(NEW_HASH);
  const afterRoute = route();
  if (!same(beforeConfig, configSignature(after)) || !same(initialRoute, afterRoute)) {
    throw new Error('POSTDEPLOY_CONFIG_OR_ROUTE_CHANGED');
  }
  await writeFile(resultPath, `${JSON.stringify({ codeSha256: NEW_HASH,
    baselineSha256: OLD_HASH, configUnchanged: true, routeUnchanged: true,
    quotasBefore: quotas, deployedAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: 'deployed', codeSha256: NEW_HASH,
    functionStatus: after.Status, configUnchanged: true, routeUnchanged: true }) + '\n');
} catch (error) {
  const current = details();
  const currentHash = sha(current.CodeInfo ?? '');
  if (currentHash !== OLD_HASH && currentHash !== NEW_HASH) {
    throw new Error(`DEPLOYMENT_STOPPED_CONCURRENT_CODE_CHANGE_${error.message}`);
  }
  if (currentHash === NEW_HASH) {
    try {
      await codeUpdate(baseline);
      const restored = await pollHash(OLD_HASH);
      if (!same(beforeConfig, configSignature(restored)) || !same(initialRoute, route())) {
        throw new Error('ROLLBACK_CONFIG_MISMATCH');
      }
      throw new Error(`DEPLOYMENT_FAILED_ROLLED_BACK_${error.message}`);
    } catch (rollbackError) {
      if (String(rollbackError.message).startsWith('DEPLOYMENT_FAILED_ROLLED_BACK_')) throw rollbackError;
      throw new Error(`DEPLOYMENT_FAILED_ROLLBACK_UNVERIFIED_${error.message}`);
    }
  }
  throw new Error(`DEPLOYMENT_FAILED_BASELINE_UNCHANGED_${error.message}`);
}
