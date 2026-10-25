// Code-only nonproduction update for the CloudBase Auth UID canonicalization in A-03.
// Publishes the existing native-admin-management-command $LATEST first as an immutable rollback target.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const cache = resolve(root, '.runtime/m3-identity-runtime-deploy-20261010');
const configPath = resolve(cache, 'cloudbaserc.json');
const packagePath = resolve(root, 'dist/functions-m3-identity-fix-20261010/native-admin-management-command');
const functionName = 'native-admin-management-command';
const localConfig = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envId = readFileSyncEnv(await readFile(resolve(root, '.env.local'), 'utf8'));
if (!envId || localConfig.envId !== envId) throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');
const sha = value => createHash('sha256').update(value).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

await mkdir(cache, { recursive: true });
const isolatedConfig = { envId };
try {
  const existing = JSON.parse(await readFile(configPath, 'utf8'));
  if (!same(existing, isolatedConfig)) throw new Error('ISOLATED_CONFIG_MISMATCH');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  await writeFile(configPath, `${JSON.stringify(isolatedConfig, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, '--config-file', configPath, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 90000,
    maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const parsed = JSON.parse(raw.slice(start));
  if (parsed.error) throw new Error('CLOUD_API_FAILED');
  return parsed.data;
}

function currentDetail() { return cliData(['fn', 'detail', functionName, '--json']); }
function currentRoute() {
  const row = cliData(['fn', 'get-route', functionName, '--json']);
  return { version: row.FunctionVersion ?? row.RoutingConfig?.FunctionVersion ?? null,
    weights: row.RoutingConfig?.AdditionalVersionWeights ?? [],
    matches: row.RoutingConfig?.AdditionVersionMatches ?? [],
    legacyMatches: row.RoutingConfig?.AddtionVersionMatchs ?? [] };
}
function currentVersions() {
  const result = cliData(['fn', 'list-function-versions', functionName, '--json']);
  const rows = result.Versions ?? result.FunctionVersions;
  if (!Array.isArray(rows)) throw new Error('FUNCTION_VERSION_LIST_UNAVAILABLE');
  return rows.map(row => String(row.FunctionVersion ?? row.Version ?? '')).sort();
}
function configurationSignature(detail) {
  const variables = Array.isArray(detail.Environment?.Variables) ? detail.Environment.Variables : [];
  return { status: detail.Status, runtime: detail.Runtime, handler: detail.Handler,
    timeout: detail.Timeout, memorySize: detail.MemorySize,
    installDependency: detail.InstallDependency, triggerCount: Array.isArray(detail.Triggers)
      ? detail.Triggers.length : -1,
    environmentDigest: sha(JSON.stringify(variables.map(row => [row.Key, row.Value])
      .sort((a, b) => a[0].localeCompare(b[0])))) };
}
function assertExpectedConfig(detail, template) {
  const variables = Array.isArray(detail.Environment?.Variables) ? detail.Environment.Variables : [];
  const actual = new Map(variables.map(row => [row.Key, row.Value]));
  const keys = Object.keys(template.envVariables ?? {}).sort();
  if (detail.FunctionName !== functionName || detail.Status !== 'Active'
    || detail.Runtime !== 'Nodejs20.19' || detail.Handler !== 'index.main'
    || detail.Timeout !== 20 || detail.MemorySize !== 256
    || String(detail.InstallDependency).toUpperCase() !== 'TRUE'
    || !Array.isArray(detail.Triggers) || detail.Triggers.length !== 0
    || actual.size !== keys.length || !keys.every(key => actual.get(key) === template.envVariables[key])) {
    throw new Error('FUNCTION_BASELINE_MISMATCH');
  }
}
function assertLatestRoute(route) {
  if (route.version !== '$LATEST' || route.weights.length !== 0
    || route.matches.length !== 0 || route.legacyMatches.length !== 0) {
    throw new Error('FUNCTION_ROUTE_MISMATCH');
  }
}
function rollbackVersion(versionsBefore, versionsAfter) {
  const added = versionsAfter.filter(value => !versionsBefore.includes(value) && value !== '$LATEST');
  if (added.length !== 1 || !/^\d+$/u.test(added[0])) throw new Error('ROLLBACK_VERSION_NOT_UNIQUE');
  return added[0];
}
async function pollUpdated(beforeTime) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const detail = currentDetail();
    if (detail.Status === 'Active' && Number.isFinite(Date.parse(detail.ModTime))
      && Date.parse(detail.ModTime) >= Date.parse(beforeTime)) return detail;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 2500));
  }
  throw new Error('FUNCTION_UPDATE_NOT_ACTIVE');
}
function readFileSyncEnv(contents) {
  return contents.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))
    ?.slice('TCB_ENV_ID='.length).trim();
}

const template = localConfig.functions.find(row => row.name === 'task-query');
if (!template?.envVariables) throw new Error('FUNCTION_ENV_TEMPLATE_MISSING');
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1 || environments[0].EnvId !== envId
  || environments[0].Status !== 'NORMAL' || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_OR_COST_GATE');
const temporary = cliData(['secrets', 'get', '--json']);
if (temporary?.isTemporary !== true || temporary.envId !== envId
  || Date.parse(temporary.expiredAt) <= Date.now() + 300_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const today = new Date().toISOString().slice(0, 10);
const credits = cliData(['api', 'tcb', 'DescribeCreditsUsage', '--body', JSON.stringify({
  EnvId: envId, StartDate: `${today.slice(0, 7)}-01`, EndDate: today }), '--json']);
if (credits?.ReportValue !== 0) throw new Error('NONZERO_OR_UNKNOWN_BILLING');

const detail = currentDetail();
assertExpectedConfig(detail, template);
const route = currentRoute();
assertLatestRoute(route);
const baselineSignature = configurationSignature(detail);
const versionsBefore = currentVersions();
const entryPath = resolve(packagePath, 'index.js');
const packageBytes = await readFile(entryPath);
const packageJson = JSON.parse(await readFile(resolve(packagePath, 'package.json'), 'utf8'));
if (packageJson.name !== `yarei-cloud-function-${functionName}`
  || packageJson.dependencies?.['@cloudbase/node-sdk'] !== '3.18.3'
  || !packageBytes.toString('utf8').includes('cloudbase:username:')) {
  throw new Error('LOCAL_FUNCTION_PACKAGE_MISMATCH');
}
const baseline = { environmentId: envId, function: functionName, codeFileSha256: sha(packageBytes),
  configurationSignature: baselineSignature, route, versionsBefore, codeSize: detail.CodeSize,
  modTime: detail.ModTime };
const statePath = resolve(cache, 'baseline.json');
if (mode === 'inspect') {
  await writeFile(statePath, `${JSON.stringify(baseline, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ mode, ready: true, environment: 'verified_nonproduction',
    function: functionName, packageSha256: baseline.codeFileSha256, versionCount: versionsBefore.length,
    routeVersion: route.version, environmentValuesMatch: true, billingCreditReportValue: 0 }) + '\n');
  process.exit(0);
}
const prior = JSON.parse(await readFile(statePath, 'utf8'));
if (prior.environmentId !== envId || prior.function !== functionName
  || prior.codeFileSha256 !== baseline.codeFileSha256
  || !same(prior.configurationSignature, baselineSignature)
  || !same(prior.route, route)
  || mode === 'apply' && !same(prior.versionsBefore, versionsBefore)
  || mode === 'verify' && (!prior.rollbackVersion
    || versionsBefore.filter(value => !prior.versionsBefore.includes(value)).join() !== prior.rollbackVersion)) {
  throw new Error('INSPECT_BASELINE_CHANGED');
}
if (mode === 'verify') {
  const receipt = JSON.parse(await readFile(resolve(cache, 'deployment-receipt.json'), 'utf8'));
  if (detail.Status !== 'Active' || !same(configurationSignature(detail), baselineSignature)
    || !same(route, prior.route) || !versionsBefore.includes(prior.rollbackVersion)) {
    throw new Error('VERIFY_STATE_MISMATCH');
  }
  if (receipt.status !== 'code_updated' || receipt.packageSha256 !== baseline.codeFileSha256
    || !Number.isSafeInteger(detail.CodeSize) || detail.CodeSize <= 0
    || !Number.isFinite(Date.parse(receipt.updatedAt))
    || Date.parse(detail.ModTime) < Date.parse(prior.modTime)) {
    throw new Error('DEPLOYMENT_RECEIPT_MISMATCH');
  }
  process.stdout.write(JSON.stringify({ mode, function: functionName, status: detail.Status,
    configurationPreserved: true, routePreserved: true, rollbackVersionAvailable: true,
    codeSize: detail.CodeSize, codeUpdatedAt: detail.ModTime,
    deploymentCodeReadback: 'CodeInfo unavailable for this function; verify by package fingerprint and operation test' }) + '\n');
  process.exit(0);
}

if (process.argv.includes('--approved') !== true) throw new Error('APPLY_FLAG_REQUIRED');
const published = cliData(['fn', 'publish-version', functionName,
  'M3 identity mapping rollback before 2026-10-10 code update', '--json']);
const versionsAfterPublish = currentVersions();
const rollback = rollbackVersion(versionsBefore, versionsAfterPublish);
if (published?.FunctionVersion && String(published.FunctionVersion) !== rollback) {
  throw new Error('PUBLISHED_ROLLBACK_VERSION_MISMATCH');
}
prior.rollbackVersion = rollback;
await writeFile(statePath, `${JSON.stringify(prior, null, 2)}\n`, 'utf8');
const beforeUpdateTime = detail.ModTime;
try {
  cliData(['fn', 'code', 'update', functionName, '--dir', packagePath, '--deployMode', 'zip', '--json']);
  const after = await pollUpdated(beforeUpdateTime);
  if (!same(configurationSignature(after), baselineSignature)
    || !same(currentRoute(), prior.route)
    || !currentVersions().includes(rollback)) throw new Error('POST_UPDATE_STATE_MISMATCH');
  const entryDigest = sha(packageBytes);
  const receipt = { ...prior, updatedAt: new Date().toISOString(), packageSha256: entryDigest,
    status: 'code_updated', codeInfoReadback: typeof after.CodeInfo === 'string' && after.CodeInfo.length > 0,
    codeSizeAfter: after.CodeSize, modTimeAfter: after.ModTime };
  await writeFile(resolve(cache, 'deployment-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ mode, function: functionName, status: after.Status,
    packageSha256: entryDigest, codeInfoReadback: receipt.codeInfoReadback,
    configurationPreserved: true, routePreserved: true, rollbackVersion: rollback }) + '\n');
} catch (error) {
  const currentVersionsAfter = currentVersions();
  if (!currentVersionsAfter.includes(rollback)) throw new Error('UPDATE_FAILED_ROLLBACK_VERSION_MISSING');
  cliData(['fn', 'config-route', functionName, rollback, '100', '--json']);
  const restoredRoute = currentRoute();
  if (restoredRoute.version !== rollback) throw new Error('UPDATE_FAILED_ROUTE_ROLLBACK_UNVERIFIED');
  throw new Error(`UPDATE_FAILED_ROLLED_BACK_TO_VERSION_${rollback}:${error?.message ?? 'UNKNOWN'}`);
}
