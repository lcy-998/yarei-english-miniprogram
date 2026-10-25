import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Read-only cloud audit plus local full-package staging after the base changed. */
const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const cache = 'D:/app-m3-cache/task-publication-hotfix-20261008-rebased';
const oldFullBackup = 'D:/app-m3-cache/formal-web-media-20261008/task-command-before-verify-1791470450691-19764';
const newIndex = resolve(root, 'dist/m3-task-publication-hotfix-20261008-rebased/task-command/index.js');
const expectedBase = 'ad0a4bf3c21dd4ba9e436c108bd3084f1ddd67b6283374a854dc4e9927336bdd';
const expectedNew = '6d3283b71c24517222bc19759d0c45392660c134ba19988f2578a931cade4750';
const hash = value => createHash('sha256').update(value).digest('hex');
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  return JSON.parse(raw.slice(first)).data;
}
const originalConfig = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envLine = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice('TCB_ENV_ID='.length).trim();
if (!envId || originalConfig.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_GATE');
const detail = cliData(['fn', 'detail', 'task-command', '--json']);
if (detail.Status !== 'Active' || detail.Runtime !== 'Nodejs20.19'
  || detail.Timeout !== 20 || detail.MemorySize !== 256
  || detail.InstallDependency !== 'FALSE' || hash(detail.CodeInfo ?? '') !== expectedBase) {
  throw new Error('REBASED_FUNCTION_BASELINE_CHANGED');
}
const artifact = await readFile(newIndex);
if (hash(artifact) !== expectedNew || hash(await readFile(resolve(oldFullBackup, 'index.js')))
  !== '373a5b8b8ed5c5845ba0694947fd4e3e67bf012ea3533acdcd26b288b1f24806') {
  throw new Error('FULL_PACKAGE_OR_PATCH_HASH_CHANGED');
}
const sdk = JSON.parse(await readFile(resolve(oldFullBackup,
  'node_modules/@cloudbase/node-sdk/package.json'), 'utf8'));
if (sdk.version !== '3.18.3') throw new Error('SDK_VERSION_CHANGED');
await mkdir(cache, { recursive: true });
const configPath = resolve(cache, 'cloudbaserc.json');
const isolatedConfig = { envId, functions: [{ name: 'task-command', installDependency: false }] };
try {
  const existing = JSON.parse(await readFile(configPath, 'utf8'));
  if (JSON.stringify(existing) !== JSON.stringify(isolatedConfig)) throw new Error('ISOLATED_CONFIG_CHANGED');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  await writeFile(configPath, `${JSON.stringify(isolatedConfig, null, 2)}\n`, { flag: 'wx' });
}
for (const [name, code, expected] of [
  ['baseline', detail.CodeInfo, expectedBase], ['candidate', artifact, expectedNew],
]) {
  const target = resolve(cache, name);
  const entries = await readdir(target).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error));
  if (entries.length === 0) {
    await cp(oldFullBackup, target, { recursive: true, errorOnExist: true });
    await writeFile(resolve(target, 'index.js'), code);
  }
  if (hash(await readFile(resolve(target, 'index.js'))) !== expected
    || (await readdir(target)).sort().join(',') !== 'index.js,node_modules,package.json') {
    throw new Error(`REBASED_${name.toUpperCase()}_INVALID`);
  }
}
process.stdout.write(JSON.stringify({ status: 'prepared', baselineHash: expectedBase,
  candidateHash: expectedNew, sdkVersion: sdk.version,
  packageEntries: ['index.js', 'node_modules', 'package.json'],
  installDependencyConfiguredFalse: true }) + '\n');
