// One-function nonproduction code rollout with immutable baseline and config/route guards.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify', 'diagnose'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const cache = 'D:/app-m3-cache/teacher-video-direct-20261017-v4';
const configPath = resolve(cache, 'cloudbaserc.json');
const candidate = resolve(root, 'dist/teacher-video-direct-20261017-candidate/task-command');
const baseline = resolve(cache, 'baseline/task-command');
const preflightPath = resolve(cache, 'preflight.json');
const receiptPath = resolve(cache, 'deployment-result.json');
const envId = 'cloud1-d8ggzrwwedb786e41';
const name = 'task-command';
const hash = value => createHash('sha256').update(value).digest('hex');

function call(args, timeout = 60000) {
  let raw;
  try {
    raw = execFileSync(process.execPath, [cli, '--config-file', configPath, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout,
      maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      env: args[0] === 'fn' && args[1] === 'code' && args[2] === 'download'
        ? { ...process.env, NODE_OPTIONS: `--require=${resolve(root, 'tools/cloudbase-code-dns-fallback.cjs')}` }
        : process.env,
    });
  } catch (error) {
    const response = String(error?.stdout ?? '');
    let cloudCode = 'UNKNOWN';
    try { cloudCode = JSON.parse(response.slice(response.indexOf('{')))?.error?.code ?? 'UNKNOWN'; }
    catch { /* Keep the response private. */ }
    const category = /ENOTFOUND|EAI_AGAIN/.test(response) ? 'DNS'
      : /403|AccessDenied|Forbidden/.test(response) ? 'ACCESS'
        : /EEXIST|already exists/.test(response) ? 'EXISTS'
          : /timeout|ETIMEDOUT/.test(response) ? 'TIMEOUT' : 'OTHER';
    throw new Error(`CLOUD_COMMAND_FAILED_${args.slice(0, 3).join('_')}_${category}_${String(cloudCode).replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 30)}`);
  }
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_UNAVAILABLE');
  const result = JSON.parse(raw.slice(at));
  if (result.error) throw new Error(`CLOUD_API_${result.error.code ?? 'FAILED'}`);
  return result.data;
}
const api = (action, body) => call(['api', 'tcb', action, '--api-version', '2018-06-08',
  '--body', JSON.stringify(body), '--json']);
const detail = () => call(['fn', 'detail', name, '--json']);
function route() {
  const value = call(['fn', 'get-route', name, '--json']);
  return { functionVersion: value.FunctionVersion ?? value.RoutingConfig?.FunctionVersion ?? null,
    weights: value.RoutingConfig?.AdditionalVersionWeights ?? [],
    matches: value.RoutingConfig?.AdditionVersionMatches ?? [],
    legacyMatches: value.RoutingConfig?.AddtionVersionMatchs ?? [] };
}
function signature(value) {
  const variables = Array.isArray(value.Environment?.Variables) ? value.Environment.Variables : [];
  return hash(Buffer.from(JSON.stringify({ Runtime: value.Runtime,
    Handler: value.Handler, Role: value.Role, InstallDependency: value.InstallDependency,
    Triggers: value.Triggers, VpcConfig: value.VpcConfig,
    PublicNetConfig: value.PublicNetConfig,
    environmentVariables: variables.map(row => [row.Key, row.Value])
      .sort((left, right) => left[0].localeCompare(right[0])) })));
}
function snapshot(value) {
  return { codeHash: hash(Buffer.from(value.CodeInfo ?? '')),
    configHash: signature(value), routeHash: hash(Buffer.from(JSON.stringify(route()))),
    memoryMb: value.MemorySize, timeoutSeconds: value.Timeout, status: value.Status };
}
async function pollChanged(priorHash) {
  for (let attempt = 0; attempt < 18; attempt++) {
    const value = detail();
    if (value.Status === 'Active' && snapshot(value).codeHash !== priorHash) return value;
    await new Promise(resolveWait => setTimeout(resolveWait, 3000));
  }
  throw new Error('FUNCTION_CODE_NOT_ACTIVE');
}
async function remoteIndexHash(directoryName) {
  const directory = resolve(cache, `${directoryName}-${Date.now()}`);
  await mkdir(directory, { recursive: true });
  call(['fn', 'code', 'download', name, directory, '--json'], 180000);
  return hash(await readFile(resolve(directory, 'index.js')));
}
async function pollRemote(expectedHash, directoryName) {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (detail().Status === 'Active'
      && await remoteIndexHash(directoryName) === expectedHash) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 3000));
  }
  throw new Error('FUNCTION_CODE_READBACK_MISMATCH');
}
async function pollConfiguration(memoryMb, timeoutSeconds) {
  for (let attempt = 0; attempt < 18; attempt++) {
    const value = detail();
    if (value.Status === 'Active' && value.MemorySize === memoryMb
      && value.Timeout === timeoutSeconds) return value;
    await new Promise(resolveWait => setTimeout(resolveWait, 3000));
  }
  throw new Error('FUNCTION_CONFIG_NOT_ACTIVE');
}
function configure(memoryMb, timeoutSeconds) {
  api('UpdateFunctionConfiguration', { EnvId: envId, FunctionName: name,
    MemorySize: memoryMb, Timeout: timeoutSeconds });
}

await mkdir(cache, { recursive: true });
await writeFile(configPath, JSON.stringify({ envId }) + '\n', { flag: 'wx' }).catch(error => {
  if (error?.code !== 'EEXIST') throw error;
});
if (JSON.parse(await readFile(configPath, 'utf8')).envId !== envId) throw new Error('ENV_CONFIG_MISMATCH');
const local = (await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
const env = call(['env', 'list', '--json']);
if (local !== envId || !Array.isArray(env) || env.length !== 1 || env[0].EnvId !== envId
  || env[0].Status !== 'NORMAL' || env[0].PackageName !== '个人版'
  || env[0].EnvPaid !== 'no' || env[0].EnvCharged !== 'no'
  || env[0].EnableOverrun !== false) throw new Error('NONPRODUCTION_COST_GATE');
for (const metric of ['FunctionInvocation', 'DbWritepkg', 'DbReadpkg']) {
  const quota = api('DescribeQuotaData', { EnvId: envId, MetricName: metric });
  if (!Number.isFinite(quota.Value) || quota.Value >= 190000) throw new Error(`QUOTA_GATE_${metric}`);
}
const acl = api('DescribeDatabaseACL', { EnvId: envId, CollectionName: 'teacher_private_videos' });
if (acl.AclTag !== 'ADMINONLY') throw new Error('PRIVATE_COLLECTION_GATE');
const before = snapshot(detail());
if (mode === 'diagnose') {
  const prior = JSON.parse(await readFile(preflightPath, 'utf8')).before;
  const currentDetail = detail();
  const configured = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'))
    .functions.find(row => row.name === name);
  const actualVariables = Object.fromEntries((currentDetail.Environment?.Variables ?? [])
    .map(row => [row.Key, row.Value]));
  process.stdout.write(JSON.stringify({ mode, status: before.status,
    changed: Object.keys(before).filter(key => prior[key] !== before[key]),
    memoryMb: before.memoryMb, timeoutSeconds: before.timeoutSeconds,
    environmentKeys: (currentDetail.Environment?.Variables ?? []).map(row => row.Key).sort(),
    environmentMatchesLocalConfig: JSON.stringify(Object.entries(actualVariables).sort())
      === JSON.stringify(Object.entries(configured?.envVariables ?? {}).sort()),
    runtime: currentDetail.Runtime, handler: currentDetail.Handler,
    installDependency: currentDetail.InstallDependency }) + '\n');
  process.exit(0);
}
if (before.status !== 'Active' || !Number.isSafeInteger(before.memoryMb)
  || !Number.isSafeInteger(before.timeoutSeconds)) {
  throw new Error(`FUNCTION_RUNTIME_GATE_${before.status}_${before.memoryMb}MB_${before.timeoutSeconds}S`);
}

if (mode === 'inspect') {
  execFileSync(process.execPath, [resolve(root, 'tools/build-cloud-functions.mjs'),
    '--outdir', resolve(root, 'dist/teacher-video-direct-20261017-candidate'),
    '--function', name], { cwd: root, windowsHide: true, stdio: 'inherit', timeout: 180000 });
  if (!(await readdir(candidate)).includes('index.js')) throw new Error('CANDIDATE_MISSING');
  await mkdir(baseline, { recursive: true });
  call(['fn', 'code', 'download', name, baseline, '--json'], 180000);
  if (!(await readdir(baseline)).length) throw new Error('BASELINE_MISSING');
  await writeFile(preflightPath, JSON.stringify({ envId, before,
    preparedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    function: name, baselineSaved: true, runtime: { memoryMb: before.memoryMb,
      timeoutSeconds: before.timeoutSeconds }, overrunBilling: false }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  const preflight = JSON.parse(await readFile(preflightPath, 'utf8'));
  if (preflight.envId !== envId || JSON.stringify(preflight.before) !== JSON.stringify(before)) {
    const changed = Object.keys(before).filter(key => preflight.before?.[key] !== before[key]);
    throw new Error(`REMOTE_BASELINE_CHANGED_${changed.join('_')}`);
  }
  if (!(await readdir(candidate)).includes('index.js') || !(await readdir(baseline)).length) {
    throw new Error('ROLLBACK_OR_CANDIDATE_MISSING');
  }
  const candidateIndexHash = hash(await readFile(resolve(candidate, 'index.js')));
  const baselineIndexHash = hash(await readFile(resolve(baseline, 'index.js')));
  try {
    configure(1024, 120);
    const configured = snapshot(await pollConfiguration(1024, 120));
    if (configured.configHash !== before.configHash || configured.routeHash !== before.routeHash) {
      throw new Error('UNRELATED_FUNCTION_CONFIG_CHANGED');
    }
    const currentIndexHash = await remoteIndexHash('code-before-apply');
    if (currentIndexHash !== candidateIndexHash && currentIndexHash !== baselineIndexHash) {
      throw new Error('REMOTE_CODE_DRIFT');
    }
    if (currentIndexHash !== candidateIndexHash) {
      call(['fn', 'code', 'update', name, '--dir', candidate, '--deployMode', 'zip', '--json'], 180000);
      await pollRemote(candidateIndexHash, 'code-after-apply');
    }
    const after = snapshot(detail());
    if (after.configHash !== before.configHash || after.routeHash !== before.routeHash
      || after.memoryMb !== 1024 || after.timeoutSeconds !== 120) {
      throw new Error('FUNCTION_CONFIG_OR_ROUTE_CHANGED');
    }
    await writeFile(receiptPath, JSON.stringify({ envId, before, after,
      deployedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
  } catch (error) {
    const current = snapshot(detail());
    if (await remoteIndexHash('code-on-error') !== baselineIndexHash) {
      call(['fn', 'code', 'update', name, '--dir', baseline, '--deployMode', 'zip', '--json'], 180000);
      await pollRemote(baselineIndexHash, 'code-after-rollback');
      const restored = snapshot(detail());
      if (restored.configHash !== before.configHash || restored.routeHash !== before.routeHash) {
        throw new Error('ROLLBACK_CONFIG_MISMATCH');
      }
    }
    if (current.memoryMb !== before.memoryMb || current.timeoutSeconds !== before.timeoutSeconds) {
      configure(before.memoryMb, before.timeoutSeconds);
      const restoredConfig = snapshot(await pollConfiguration(before.memoryMb, before.timeoutSeconds));
      if (restoredConfig.configHash !== before.configHash
        || restoredConfig.routeHash !== before.routeHash) throw new Error('ROLLBACK_CONFIG_MISMATCH');
    }
    throw error;
  }
}
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
const after = snapshot(detail());
const remoteHash = await remoteIndexHash('code-verify');
const candidateHash = hash(await readFile(resolve(candidate, 'index.js')));
if (receipt.envId !== envId || after.status !== 'Active'
  || after.codeHash !== receipt.after.codeHash
  || remoteHash !== candidateHash
  || after.configHash !== receipt.before.configHash
  || after.routeHash !== receipt.before.routeHash
  || after.memoryMb !== 1024 || after.timeoutSeconds !== 120) {
  throw new Error('DEPLOYMENT_READBACK_MISMATCH');
}
process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
  function: name, status: 'Active', configAndRouteUnchanged: true,
  baselineSaved: true, overrunBilling: false }) + '\n');
