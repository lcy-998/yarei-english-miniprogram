// Deploys only the protected T-02 import function to the verified non-production environment.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const functionName = 'teacher-student-import-command';
const packageDirectory = resolve(root, 'dist/functions-m3-teacher-student-import-20261022');
const candidatePath = resolve(packageDirectory, functionName, 'index.js');
const local = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envId = (await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!envId || local.envId !== envId) throw new Error('ENVIRONMENT_MISMATCH');
const template = local.functions.find(row => row.name === 'task-query');
if (!template?.envVariables || Object.keys(template.envVariables).length !== 6) {
  throw new Error('RUNTIME_SECRET_TEMPLATE_INVALID');
}
const candidate = await readFile(candidatePath);
const candidateHash = createHash('sha256').update(candidate).digest('hex');
const candidateStat = await stat(candidatePath);
if (candidateStat.size < 1000 || candidateStat.size > 4 * 1024 * 1024) throw new Error('CANDIDATE_SIZE_INVALID');

function cliData(args, configFile) {
  const fullArgs = configFile ? ['--config-file', configFile, ...args] : args;
  const raw = execFileSync(process.execPath, [cli, ...fullArgs], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 90000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error(`CLOUD_CLI_RESPONSE_INVALID_${args.slice(0, 2).join('_')}`);
  const result = JSON.parse(raw.slice(start));
  if (result.error) throw new Error(`CLOUD_API_${result.error.code ?? 'FAILED'}`);
  return result.data;
}
function downloadRemoteCode(destination) {
  try {
    execFileSync(process.execPath, [cli, 'fn', 'code', 'download', functionName, destination, '--json'], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180000,
      maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS,
        `--require=${resolve(root, 'tools/cloudbase-code-dns-fallback.cjs')}`].filter(Boolean).join(' ') },
    });
  } catch (error) {
    const output = `${String(error?.stdout ?? '')}\n${String(error?.stderr ?? '')}`;
    const category = /ENOTFOUND|EAI_AGAIN/.test(output) ? 'DNS'
      : /AccessDenied|Forbidden|403/.test(output) ? 'ACCESS'
        : /timeout|ETIMEDOUT/.test(output) ? 'TIMEOUT' : 'OTHER';
    throw new Error(`CODE_READBACK_FAILED_${category}`);
  }
}
function functionRows() {
  const rows = cliData(['fn', 'list', '--limit', '100', '--offset', '0', '--json'])?.Functions;
  if (!Array.isArray(rows) || rows.length > 100) throw new Error('FUNCTION_LIST_INCOMPLETE');
  return rows;
}
function currentDetail() {
  const rows = functionRows();
  if (!rows.some(row => row.FunctionName === functionName)) return null;
  return cliData(['fn', 'detail', functionName, '--json']);
}
function currentRoute() {
  const route = cliData(['fn', 'get-route', functionName, '--json']);
  return { version: route.FunctionVersion ?? route.RoutingConfig?.FunctionVersion ?? null,
    weights: route.RoutingConfig?.AdditionalVersionWeights ?? [],
    matches: route.RoutingConfig?.AdditionalVersionMatches ?? [],
    legacyMatches: route.RoutingConfig?.AddtionVersionMatchs ?? [] };
}
function versionRows() {
  const result = cliData(['fn', 'list-function-versions', functionName, '--json']);
  const rows = result.Versions ?? result.FunctionVersions;
  if (!Array.isArray(rows)) throw new Error('FUNCTION_VERSION_LIST_UNAVAILABLE');
  return rows;
}
function assertEnvironment() {
  const rows = cliData(['env', 'list', '--json']);
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].EnvId !== envId
    || rows[0].Status !== 'NORMAL' || rows[0].PackageName !== '个人版'
    || rows[0].EnableOverrun !== false || rows[0].EnvPaid !== 'no' || rows[0].EnvCharged !== 'no') {
    throw new Error('ENVIRONMENT_OR_COST_GATE');
  }
  const credentials = cliData(['secrets', 'get', '--json']);
  if (credentials?.isTemporary !== true || credentials.envId !== envId
    || Date.parse(credentials.expiredAt) <= Date.now() + 300000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
}
async function readRemoteCodeHash() {
  const destination = await mkdtemp(join(tmpdir(), 'yarei-t02-code-readback-'));
  try {
    downloadRemoteCode(destination);
    return createHash('sha256').update(await readFile(join(destination, 'index.js'))).digest('hex');
  } finally {
    const path = resolve(destination), base = resolve(tmpdir());
    if (!path.startsWith(`${base}\\`) && !path.startsWith(`${base}/`)) throw new Error('READBACK_PATH_UNSAFE');
    await rm(destination, { recursive: true, force: true });
  }
}
function functionMismatches(detail, route) {
  const keys = Array.isArray(detail?.Environment?.Variables)
    ? detail.Environment.Variables.map(item => item.Key).sort() : [];
  const mismatches = [];
  if (detail?.Status !== 'Active') mismatches.push('STATUS');
  if (detail.Runtime !== 'Nodejs20.19' || detail.Handler !== 'index.main') mismatches.push('RUNTIME');
  if (detail.Timeout !== 300 || detail.MemorySize !== 512) mismatches.push('RESOURCES');
  if (String(detail.InstallDependency).toUpperCase() !== 'TRUE') mismatches.push('DEPENDENCIES');
  if ((detail.Triggers?.length ?? -1) !== 0) mismatches.push('TRIGGERS');
  if (JSON.stringify(keys) !== JSON.stringify(Object.keys(template.envVariables).sort())) mismatches.push('ENVIRONMENT_KEYS');
  if (route.version !== '$LATEST' || route.weights.length !== 0
    || route.matches.length !== 0 || route.legacyMatches.length !== 0) mismatches.push('ROUTE');
  return mismatches;
}
function assertFunction(detail, route, remoteHash) {
  const mismatches = functionMismatches(detail, route);
  if (remoteHash !== candidateHash) mismatches.push(`CODE_HASH_${candidateHash.slice(0, 8)}_${remoteHash.slice(0, 8)}`);
  if (mismatches.length) throw new Error(`DEPLOYED_FUNCTION_MISMATCH_${mismatches.join('_')}`);
}
function assertUnauthenticatedFailure() {
  const event = { apiVersion: 'm1.v1', action: 'importTeacherStudents', operationId: 'probe_no_session',
    payload: { csvBase64: Buffer.from('student_number,display_name,mobile,class_id\r\n').toString('base64') } };
  const response = cliData(['fn', 'invoke', functionName, '--params', JSON.stringify(event), '--json']);
  let result;
  try { result = JSON.parse(String(response.RetMsg ?? '')); }
  catch { throw new Error('UNAUTHENTICATED_PROBE_RESPONSE_INVALID'); }
  if (typeof result !== 'object' || result === null || Array.isArray(result)
    || !('error' in result) || typeof result.error !== 'object' || result.error === null
    || !('code' in result.error) || result.error.code !== 'UNAUTHENTICATED') {
    throw new Error('UNAUTHENTICATED_PROBE_DID_NOT_FAIL_CLOSED');
  }
}
async function waitForUpdated(beforeModTime) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const detail = currentDetail();
    if (detail?.Status === 'Active' && Date.parse(detail.ModTime) >= Date.parse(beforeModTime)) return;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 2500));
  }
  throw new Error('FUNCTION_UPDATE_NOT_ACTIVE');
}

assertEnvironment();
const before = mode === 'apply' ? currentDetail() : null;
if (mode === 'inspect') {
  const detail = currentDetail();
  const route = detail === null ? null : currentRoute();
  const remoteHash = detail === null ? null : await readRemoteCodeHash();
  process.stdout.write(JSON.stringify({ functionName, environment: 'verified_nonproduction',
    exists: detail !== null, status: detail?.Status ?? 'absent', candidateSha256: candidateHash,
    deployedCodeSha256: remoteHash, candidateMatchesDeployment: remoteHash === candidateHash,
    route: route?.version ?? 'absent', candidateBytes: candidateStat.size,
    timeoutSeconds: 300, memoryMiB: 512 }) + '\n');
  process.exit(0);
}

let rollbackVersion = null;
if (mode === 'apply') {
  if (before === null) {
    const relativeFunctionRoot = relative(root, packageDirectory).replaceAll('\\', '/');
    const config = { $schema: local.$schema, version: '2.0', envId, region: local.region,
      functionRoot: relativeFunctionRoot, functions: [{ name: functionName, runtime: 'Nodejs20.19',
        handler: 'index.main', timeout: 300, memorySize: 512, installDependency: true,
        envVariables: template.envVariables }] };
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'yarei-t02-deploy-'));
    const configFile = join(temporaryRoot, 'cloudbaserc.json');
    try {
      await (await import('node:fs/promises')).writeFile(configFile, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
      cliData(['fn', 'deploy', functionName, '--dir', resolve(packageDirectory, functionName),
        '--deployMode', 'zip', '--force', '--install-dependency', 'true', '--json'], configFile);
    } finally {
      const tempPath = resolve(temporaryRoot), tempBase = resolve(tmpdir());
      if (!tempPath.startsWith(`${tempBase}\\`) && !tempPath.startsWith(`${tempBase}/`)) {
        throw new Error('TEMP_CONFIG_PATH_UNSAFE');
      }
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  } else {
    const routeBefore = currentRoute();
    const codeBefore = await readRemoteCodeHash();
    const mismatches = functionMismatches(before, routeBefore);
    if (mismatches.length) throw new Error(`EXISTING_FUNCTION_BASELINE_MISMATCH_${mismatches.join('_')}`);
    if (codeBefore !== candidateHash) {
      const rollbackDescription = 'T-02 protected import update; rollback to prior verified code';
      const versionsBefore = versionRows();
      const versionsBeforeIds = new Set(versionsBefore.map(row => String(row.FunctionVersion ?? row.Version ?? '')));
      cliData(['fn', 'publish-version', functionName, rollbackDescription, '--json']);
      const versionsAfter = versionRows();
      const newlyPublished = versionsAfter.filter(row => {
        const version = String(row.FunctionVersion ?? row.Version ?? '');
        return /^\d+$/u.test(version) && !versionsBeforeIds.has(version);
      });
      const matchingPublished = versionsAfter.filter(row => row.Description === rollbackDescription
        && /^\d+$/u.test(String(row.FunctionVersion ?? row.Version ?? '')));
      const rollback = newlyPublished.length === 1 ? newlyPublished[0] : matchingPublished.at(-1);
      rollbackVersion = rollback === undefined ? null
        : String(rollback.FunctionVersion ?? rollback.Version ?? '');
      if (!rollbackVersion || !/^\d+$/u.test(rollbackVersion)) throw new Error('ROLLBACK_VERSION_NOT_PUBLISHED');
      cliData(['fn', 'code', 'update', functionName, '--dir', resolve(packageDirectory, functionName),
        '--deployMode', 'zip', '--json']);
      await waitForUpdated(before.ModTime);
    }
  }
}

const detail = currentDetail();
if (detail === null) throw new Error('FUNCTION_MISSING_AFTER_DEPLOY');
const route = currentRoute();
const remoteHash = await readRemoteCodeHash();
assertFunction(detail, route, remoteHash);
assertUnauthenticatedFailure();
process.stdout.write(JSON.stringify({ status: mode === 'apply' ? 'deployed' : 'verified', functionName,
  environment: 'verified_nonproduction', codeSha256: remoteHash, runtime: detail.Runtime,
  timeoutSeconds: detail.Timeout, memoryMiB: detail.MemorySize, triggerCount: 0,
  route: route.version, environmentKeyCount: detail.Environment.Variables.length,
  unauthenticatedRequest: 'rejected', rollbackVersion }) + '\n');
