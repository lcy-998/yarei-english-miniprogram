import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, stat, writeFile, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(root, '..', '..');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
if (mode === 'apply' && !process.argv.includes('--approved')) throw new Error('APPROVAL_FLAG_REQUIRED');

const functionName = 'student-task-query';
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
const cacheRoot = resolve('D:/app-m3-cache/student/media-draft-projection-20261006');
const isolatedConfig = resolve(cacheRoot, 'cloudbaserc.json');
const baselinePath = resolve(cacheRoot, 'deployment-baseline.json');
const beforePath = resolve(cacheRoot, 'student-task-query-before');
const buildRoot = resolve(root, 'dist/m3-student-media-draft-projection-20261006');
const localPackage = resolve(buildRoot, functionName);
const sdkPackage = '@cloudbase/node-sdk';
const sdkVersion = '3.18.3';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function safePath(candidate) {
  const resolved = resolve(candidate);
  const allowedRoot = resolve(root, 'dist');
  const pathFromRoot = relative(allowedRoot, resolved);
  if (pathFromRoot === '' || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new Error('BUILD_PATH_OUTSIDE_DIST');
  }
  return resolved;
}

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/u).flatMap(line => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    return match ? [[match[1], match[2].trim()]] : [];
  }));
}

async function prepareEnvironment() {
  const localEnvironment = parseEnv(await readFile(resolve(root, '.env.local'), 'utf8')).TCB_ENV_ID;
  const localConfig = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
  if (!localEnvironment || localConfig.envId !== localEnvironment) throw new Error('LOCAL_ENVIRONMENT_MISMATCH');
  const config = { envId: localEnvironment };
  await mkdir(cacheRoot, { recursive: true });
  try {
    const existing = JSON.parse(await readFile(isolatedConfig, 'utf8'));
    if (!equal(existing, config)) throw new Error('ISOLATED_CONFIG_MISMATCH');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(isolatedConfig, `${JSON.stringify(config, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
  const environments = cliJson(['env', 'list', '--json']);
  const matching = Array.isArray(environments) ? environments.filter(item => item?.EnvId === localEnvironment) : [];
  if (matching.length !== 1 || matching[0].Status !== 'NORMAL'
    || matching[0].PackageName !== '个人版' || matching[0].EnableOverrun !== false
    || matching[0].EnvPaid !== 'no' || matching[0].EnvCharged !== 'no') {
    throw new Error('NONPRODUCTION_OR_COST_GATE');
  }
  return { localConfig, functionTemplate: localConfig.functions?.find(item => item.name === functionName) };
}

function cliJson(args, configFile = isolatedConfig) {
  let raw;
  try {
    raw = execFileSync(process.execPath, [cli, '--config-file', configFile, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    });
  } catch (_error) { throw new Error('CLOUD_CLI_FAILED'); }
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const parsed = JSON.parse(raw.slice(start));
  if (parsed.error) throw new Error(`CLOUD_API_${parsed.error.code ?? 'FAILED'}`);
  return parsed.data;
}

function functionDetail() {
  const row = cliJson(['fn', 'detail', functionName, '--json']);
  const variables = Array.isArray(row.Environment?.Variables) ? row.Environment.Variables : [];
  return { status: row.Status, runtime: row.Runtime, memorySize: row.MemorySize,
    timeout: row.Timeout, handler: row.Handler,
    triggerCount: Array.isArray(row.Triggers) ? row.Triggers.length : -1,
    installDependency: row.InstallDependency === true || String(row.InstallDependency).toUpperCase() === 'TRUE',
    environmentKeys: variables.map(item => item.Key).sort(),
    environmentValuesPresent: variables.every(item => typeof item.Value === 'string' && item.Value.length > 0) };
}

function functionRoute() {
  const row = cliJson(['fn', 'get-route', functionName, '--json']);
  return { functionVersion: row.FunctionVersion ?? row.RoutingConfig?.FunctionVersion ?? null,
    additionalVersionWeights: row.RoutingConfig?.AdditionalVersionWeights ?? [],
    additionVersionMatches: row.RoutingConfig?.AdditionVersionMatches ?? [],
    addtionVersionMatchs: row.RoutingConfig?.AddtionVersionMatchs ?? [] };
}

function environmentMatchesTemplate(expected) {
  const row = cliJson(['fn', 'detail', functionName, '--json']);
  const actual = new Map((Array.isArray(row.Environment?.Variables) ? row.Environment.Variables : [])
    .map(item => [item.Key, item.Value]));
  const keys = Object.keys(expected ?? {}).sort();
  return actual.size === keys.length && keys.every(key => actual.get(key) === expected[key]);
}

async function download(destination) {
  if ((await readdir(destination).catch(() => [])).length) throw new Error('BACKUP_TARGET_NOT_EMPTY');
  await mkdir(destination, { recursive: true });
  cliJson(['fn', 'code', 'download', functionName, destination, '--json']);
  const indexHash = sha256(await readFile(join(destination, 'index.js')));
  if (!(await stat(join(destination, 'package.json'))).isFile()) throw new Error('REMOTE_PACKAGE_JSON_MISSING');
  return indexHash;
}

async function downloadWithRetry(stem, attempts = 6) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await download(resolve(cacheRoot, `${stem}-${attempt}`)); }
    catch (_error) {
      if (attempt === attempts) break;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 3000));
    }
  }
  throw new Error('REMOTE_CODE_READBACK_FAILED');
}

async function buildLocalPackage() {
  safePath(localPackage);
  if ((await readdir(localPackage).catch(() => [])).length) throw new Error('LOCAL_PACKAGE_NOT_EMPTY');
  await mkdir(localPackage, { recursive: true });
  const require = createRequire(join(root, 'package.json'));
  const esbuild = require('esbuild');
  const source = [
    "import { installCloudBaseNodeDeploymentFromEnvironment } from './functions/shared/cloudbase-node-deployment-entry';",
    `import { main as functionMain } from './functions/${functionName}/index';`,
    'installCloudBaseNodeDeploymentFromEnvironment();',
    'export const main = functionMain;',
  ].join('\n');
  await esbuild.build({ stdin: { contents: source, loader: 'ts', resolveDir: root,
    sourcefile: `deployment/${functionName}.ts` }, outfile: join(localPackage, 'index.js'),
    bundle: true, platform: 'node', target: 'node20.19', format: 'cjs',
    external: [sdkPackage, 'node:*'], sourcemap: false, legalComments: 'none',
    charset: 'utf8', treeShaking: true, logLevel: 'silent' });
  await writeFile(join(localPackage, 'package.json'), `${JSON.stringify({
    name: `yarei-cloud-function-${functionName}`, version: '0.1.0', private: true,
    main: 'index.js', engines: { node: '20.19.x' }, dependencies: { [sdkPackage]: sdkVersion },
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  const entries = (await readdir(localPackage)).sort();
  if (!equal(entries, ['index.js', 'package.json'])) throw new Error('LOCAL_PACKAGE_SCOPE_INVALID');
  const bundle = await readFile(join(localPackage, 'index.js'), 'utf8');
  if (!bundle.includes(sdkPackage) || !bundle.includes('bootstrapCloudBaseNodeDeployment')
    || /require\(["']\.{1,2}[\\/]/u.test(bundle)) throw new Error('LOCAL_PACKAGE_INVALID');
  return sha256(Buffer.from(bundle));
}

async function deploy(directory, localConfig, functionTemplate) {
  const temporaryRoot = await mkdtemp(join(cacheRoot, 'deploy-config-'));
  const temporaryConfig = join(temporaryRoot, 'cloudbaserc.json');
  const functionRoot = relative(root, buildRoot).replaceAll('\\', '/');
  const config = { $schema: localConfig.$schema, version: '2.0', envId: localConfig.envId,
    region: localConfig.region, functionRoot, functions: [{
      name: functionName, runtime: 'Nodejs20.19', handler: 'index.main',
      timeout: 10, memorySize: 256, installDependency: false,
      envVariables: functionTemplate.envVariables,
    }] };
  try {
    await writeFile(temporaryConfig, `${JSON.stringify(config, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    cliJson(['fn', 'deploy', functionName, '--dir', directory,
      '--deployMode', 'zip', '--force', '--install-dependency', 'false', '--json'], temporaryConfig);
  } finally {
    await unlink(temporaryConfig).catch(() => undefined);
    const resolvedRoot = resolve(temporaryRoot), resolvedCache = resolve(cacheRoot);
    if (!resolvedRoot.startsWith(`${resolvedCache}\\`) && !resolvedRoot.startsWith(`${resolvedCache}/`)) {
      throw new Error('TEMP_CONFIG_PATH_UNSAFE');
    }
    await rmdir(temporaryRoot).catch(() => undefined);
  }
}

const { localConfig, functionTemplate } = await prepareEnvironment();
const expectedEnvironmentKeys = Object.keys(functionTemplate?.envVariables ?? {}).sort();
if (expectedEnvironmentKeys.length === 0) throw new Error('LOCAL_FUNCTION_ENV_TEMPLATE_MISSING');
if (!environmentMatchesTemplate(functionTemplate.envVariables)) throw new Error('FUNCTION_ENVIRONMENT_VALUES_MISMATCH');

if (mode === 'inspect') {
  const existingBaseline = await readFile(baselinePath, 'utf8').catch(error => {
    if (error?.code !== 'ENOENT') throw error;
    return null;
  });
  if (existingBaseline !== null) throw new Error('BASELINE_ALREADY_EXISTS');
  const localHash = await buildLocalPackage();
  const beforeDetail = functionDetail();
  const beforeRoute = functionRoute();
  if (beforeDetail.status !== 'Active' || beforeDetail.runtime !== 'Nodejs20.19'
    || !beforeDetail.environmentValuesPresent || !equal(beforeDetail.environmentKeys, expectedEnvironmentKeys)
    || beforeRoute.functionVersion !== '$LATEST' || beforeRoute.additionalVersionWeights.length !== 0
    || beforeRoute.additionVersionMatches.length !== 0 || beforeRoute.addtionVersionMatchs.length !== 0) {
    throw new Error('FUNCTION_BASELINE_CHANGED');
  }
  const beforeHash = await download(beforePath);
  const sourceBytes = (await stat(join(localPackage, 'index.js'))).size
    + (await stat(join(localPackage, 'package.json'))).size;
  if (sourceBytes > 1_500_000) throw new Error('DIRECT_ZIP_LIMIT_RISK');
  const baseline = { functionName, beforeHash, localHash, detail: beforeDetail, route: beforeRoute };
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ status: 'ready', functionName,
    beforeCodeHash: beforeHash, newCodeHash: localHash, packageSizeBytes: sourceBytes,
    environment: 'verified-existing-nonproduction-free-personal', deploymentMode: 'code-only direct ZIP',
    runtime: beforeDetail.runtime, memorySize: beforeDetail.memorySize,
    timeout: beforeDetail.timeout, environmentKeyCount: beforeDetail.environmentKeys.length,
    route: beforeRoute }) + '\n');
} else {
  if (mode === 'apply') {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    const localHash = sha256(await readFile(join(localPackage, 'index.js')));
    if (baseline.functionName !== functionName || localHash !== baseline.localHash) throw new Error('BASELINE_OR_BUNDLE_MISMATCH');
    const beforeDetail = functionDetail();
    const beforeRoute = functionRoute();
    const expectedRollbackState = baseline.detail.installDependency === false
      && beforeDetail.installDependency === true
      && equal({ ...beforeDetail, installDependency: false }, baseline.detail);
    if ((!equal(beforeDetail, baseline.detail) && !expectedRollbackState)
      || !equal(beforeRoute, baseline.route)) throw new Error('FUNCTION_CHANGED_AFTER_INSPECT');
    const currentHash = await downloadWithRetry('student-task-query-before-apply');
    if (currentHash !== baseline.beforeHash) throw new Error('REMOTE_CODE_CHANGED_AFTER_INSPECT');
    try {
      await deploy(localPackage, localConfig, functionTemplate);
      const afterHash = await downloadWithRetry('student-task-query-after');
      const afterDetail = functionDetail();
      const afterRoute = functionRoute();
      if (afterHash !== baseline.localHash || !equal(afterDetail, baseline.detail)
        || !equal(afterRoute, baseline.route)) throw new Error('DEPLOYMENT_POSTCHECK_FAILED');
      process.stdout.write(JSON.stringify({ status: 'deployed', functionName,
        beforeCodeHash: baseline.beforeHash, remoteCodeHash: afterHash,
        runtimeConfigurationUnchanged: true, environmentVariableKeysUnchanged: true,
        routeUnchanged: true }) + '\n');
    } catch (_error) {
      await deploy(beforePath, localConfig, functionTemplate);
      const rollbackHash = await downloadWithRetry('student-task-query-rollback-readback');
      const rollbackDetail = functionDetail();
      const rollbackRoute = functionRoute();
      if (rollbackHash !== baseline.beforeHash || !equal(rollbackDetail, baseline.detail)
        || !equal(rollbackRoute, baseline.route)) throw new Error('DEPLOYMENT_FAILED_ROLLBACK_UNVERIFIED');
      throw new Error('DEPLOYMENT_FAILED_ROLLED_BACK');
    }
  } else {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    const afterHash = await downloadWithRetry('student-task-query-verify-readback');
    if (afterHash !== baseline.localHash || !equal(functionDetail(), baseline.detail)
      || !equal(functionRoute(), baseline.route)) throw new Error('DEPLOYMENT_VERIFY_FAILED');
    process.stdout.write(JSON.stringify({ status: 'verified', functionName,
      remoteCodeHash: afterHash, runtimeConfigurationUnchanged: true,
      environmentVariableKeysUnchanged: true, routeUnchanged: true }) + '\n');
  }
}
