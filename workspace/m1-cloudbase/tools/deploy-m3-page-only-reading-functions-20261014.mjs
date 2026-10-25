import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const cache = 'D:/app-m3-cache/pep-page-only-reading-functions-20261014';
const configPath = resolve(cache, 'cloudbaserc.json');
const candidate = resolve(root, 'dist/pep-page-only-reading-20261014-candidate');
const baseline = resolve(cache, 'baseline');
const results = resolve(cache, 'deployment-result.json');
const envId = 'cloud1-d8ggzrwwedb786e41';
const names = ['content-query', 'teacher-textbook-query'];
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function cliData(args, timeout = 60000) {
  const raw = execFileSync(process.execPath, [cli, '--config-file', configPath, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout,
    maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const at = raw.indexOf('{');
  if (at < 0) throw new Error(`CLOUD_JSON_MISSING_${args.slice(0, 3).join('_')}`);
  const parsed = JSON.parse(raw.slice(at));
  if (parsed.error) throw new Error(`CLOUD_API_REJECTED_${args.slice(0, 3).join('_')}`);
  return parsed.data;
}
function detail(name) { return cliData(['fn', 'detail', name, '--json']); }
function route(name) {
  const value = cliData(['fn', 'get-route', name, '--json']);
  return { functionVersion: value.FunctionVersion ?? value.RoutingConfig?.FunctionVersion ?? null,
    weights: value.RoutingConfig?.AdditionalVersionWeights ?? [],
    matches: value.RoutingConfig?.AdditionVersionMatches ?? [],
    legacyMatches: value.RoutingConfig?.AddtionVersionMatchs ?? [] };
}
function configSignature(value) {
  const variables = Array.isArray(value.Environment?.Variables) ? value.Environment.Variables : [];
  if (variables.some(row => typeof row.Key !== 'string' || typeof row.Value !== 'string')) {
    throw new Error('FUNCTION_ENV_INVALID');
  }
  return { runtime: value.Runtime, memory: value.MemorySize, timeout: value.Timeout,
    handler: value.Handler, role: value.Role, installDependency: value.InstallDependency,
    triggers: value.Triggers, vpc: value.VpcConfig, publicNet: value.PublicNetConfig,
    environmentDigest: sha(Buffer.from(JSON.stringify(variables.map(row => [row.Key, row.Value])
      .sort((left, right) => left[0].localeCompare(right[0]))))),
    environmentKeys: variables.map(row => row.Key).sort() };
}
async function pollChanged(name, oldHash) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const value = detail(name);
    const current = sha(Buffer.from(value.CodeInfo ?? ''));
    if (value.Status === 'Active' && current !== oldHash) return { value, hash: current };
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`FUNCTION_CODE_NOT_UPDATED_${name}`);
}
function update(name, directory) {
  return cliData(['fn', 'code', 'update', name, '--dir', directory,
    '--deployMode', 'zip', '--json'], 180000);
}

await mkdir(cache, { recursive: true });
await writeFile(configPath, `${JSON.stringify({ envId }, null, 2)}\n`, { flag: 'wx' }).catch(error => {
  if (error?.code !== 'EEXIST') throw error;
});
if (!same(JSON.parse(await readFile(configPath, 'utf8')), { envId })) throw new Error('ENV_CONFIG_MISMATCH');
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_COST_GATE');
}
const quota = {};
for (const metric of ['FunctionInvocation', 'DbWritepkg', 'DbReadpkg']) {
  const value = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
    '--body', JSON.stringify({ EnvId: envId, MetricName: metric }), '--json']);
  if (!Number.isFinite(value?.Value) || value.Value >= 190000) throw new Error(`QUOTA_GATE_${metric}`);
  quota[metric] = value.Value;
}
const before = {};
for (const name of names) {
  const value = detail(name);
  if (value.FunctionName !== name || value.Status !== 'Active') throw new Error(`FUNCTION_NOT_ACTIVE_${name}`);
  before[name] = { hash: sha(Buffer.from(value.CodeInfo ?? '')),
    signature: configSignature(value), route: route(name) };
}

if (mode === 'inspect') {
  const build = resolve(root, 'tools/build-cloud-functions.mjs');
  execFileSync(process.execPath, [build, '--outdir', candidate,
    '--function', names[0], '--function', names[1]], { cwd: root,
      windowsHide: true, stdio: 'inherit', timeout: 180000 });
  for (const name of names) {
    const directory = resolve(candidate, name);
    if (!(await readdir(directory)).includes('index.js')) throw new Error(`CANDIDATE_INVALID_${name}`);
    await mkdir(resolve(baseline, name), { recursive: true });
    cliData(['fn', 'code', 'download', name, resolve(baseline, name), '--json'], 180000);
    if (!(await readdir(resolve(baseline, name))).length) throw new Error(`BASELINE_DOWNLOAD_EMPTY_${name}`);
  }
  await writeFile(resolve(cache, 'preflight.json'), JSON.stringify({ environment: envId,
    functions: before, quota, candidateFunctions: names, preparedAt: new Date().toISOString() }, null, 2) + '\n',
  { flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: 'ready', environment: envId,
    functions: names, quota, configAndRoutesCaptured: true, rollbackPackages: names.length }) + '\n');
  process.exit(0);
}

if (mode === 'verify') {
  const receipt = JSON.parse(await readFile(results, 'utf8'));
  const readback = Object.fromEntries(names.map(name => [name, detail(name)]));
  if (receipt.environment !== envId || names.some(name => readback[name].Status !== 'Active'
    || sha(Buffer.from(readback[name].CodeInfo ?? '')) !== receipt.functions[name].newHash
    || !same(configSignature(readback[name]), receipt.functions[name].signature)
    || !same(route(name), receipt.functions[name].route))) throw new Error('DEPLOYMENT_READBACK_MISMATCH');
  process.stdout.write(JSON.stringify({ status: 'verified', functions: names,
    environment: envId, configurationAndRoutesUnchanged: true }) + '\n');
  process.exit(0);
}

const preflight = JSON.parse(await readFile(resolve(cache, 'preflight.json'), 'utf8'));
if (preflight.environment !== envId || !same(preflight.functions, before)) {
  throw new Error('INSPECT_OR_REMOTE_BASELINE_CHANGED');
}
for (const name of names) {
  if (!(await readdir(resolve(candidate, name))).includes('index.js')
    || !(await readdir(resolve(baseline, name))).length) throw new Error(`INSPECT_PACKAGE_MISSING_${name}`);
}
const completed = {};
try {
  for (const name of names) {
    update(name, resolve(candidate, name));
    const updated = await pollChanged(name, before[name].hash);
    if (!same(configSignature(updated.value), before[name].signature)
      || !same(route(name), before[name].route)) throw new Error(`CONFIG_OR_ROUTE_CHANGED_${name}`);
    completed[name] = { newHash: updated.hash, signature: before[name].signature,
      route: before[name].route, status: updated.value.Status };
  }
  const receipt = { environment: envId, functions: completed,
    deployedAt: new Date().toISOString(), nonproduction: true };
  await writeFile(results, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: 'deployed', functions: names,
    environment: envId, configurationAndRoutesUnchanged: true }) + '\n');
} catch (error) {
  for (const name of [...names].reverse()) {
    const current = detail(name);
    if (sha(Buffer.from(current.CodeInfo ?? '')) === before[name].hash) continue;
    update(name, resolve(baseline, name));
    const rolledBack = await pollChanged(name, completed[name]?.newHash ?? before[name].hash);
    if (!same(configSignature(rolledBack.value), before[name].signature)
      || !same(route(name), before[name].route)) throw new Error(`ROLLBACK_NOT_VERIFIED_${name}`);
  }
  throw new Error(`DEPLOYMENT_FAILED_RESTORED_${error.message}`);
}
