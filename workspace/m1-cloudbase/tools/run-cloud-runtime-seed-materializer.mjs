import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArguments(process.argv.slice(2));
const cliLaunch = resolveCliLaunch(args.tcbCli);
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const environment = parseEnvironment(await readFile(join(root, '.env.local'), 'utf8'));
const envId = requirePrivateValue(config.envId);
const pepper = requirePrivateValue(environment.YAREI_SUBJECT_PEPPER);
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'yarei-runtime-seed-'));
const bundlePath = join(temporaryDirectory, 'materializer.cjs');
const require = createRequire(import.meta.url);

try {
  await build({
    entryPoints: [join(root, 'src', 'seed', 'cloudbase-account-materializer.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  });
  const materializer = require(bundlePath);
  const accounts = [];
  for (const name of materializer.CLOUD_INTEGRATION_ACCOUNT_NAMES) {
    accounts.push(await readAccount(cliLaunch, envId, name));
  }
  const result = materializer.materializeCloudRuntimeSeedPackages(accounts, pepper);
  if (!result.ok) {
    for (const issue of result.issues) {
      process.stderr.write(`${issue.code}${issue.accountName === undefined ? '' : `:${issue.accountName}`}\n`);
    }
    process.exitCode = 2;
  } else {
    const outputDirectory = join(root, '.runtime', 'cloud-integration');
    await mkdir(outputDirectory, { recursive: true });
    await writePrivateJson(join(outputDirectory, 'primary.runtime-seed.json'), result.primarySeed);
    await writePrivateJson(join(outputDirectory, 'secondary.runtime-seed.json'), result.secondarySeed);
    process.stdout.write(`ACCOUNTS_VERIFIED=${result.accountNames.length}\n`);
    process.stdout.write(`PRIMARY_DOCUMENTS=${documentCount(result.primarySeed)}\n`);
    process.stdout.write(`SECONDARY_DOCUMENTS=${documentCount(result.secondarySeed)}\n`);
    process.stdout.write('RUNTIME_SEEDS_MATERIALIZED=true\n');
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function parseArguments(values) {
  if (values.length !== 2 || values[0] !== '--tcb-cli' || values[1].trim().length === 0) {
    throw new Error('A local CloudBase CLI path is required.');
  }
  return { tcbCli: resolve(values[1]) };
}

async function readAccount(cliLaunch, envId, name) {
  let stdout;
  try {
    ({ stdout } = await execute(cliLaunch.command, [...cliLaunch.arguments, 'user', 'list', '-e', envId, '--name', name, '--json'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }));
  } catch {
    throw new Error(`CloudBase account lookup failed for synthetic alias ${name}.`);
  }
  const parsed = parseCliJson(stdout);
  const matches = Array.isArray(parsed.data) ? parsed.data.filter((candidate) => candidate?.Name === name) : [];
  if (matches.length !== 1) throw new Error(`CloudBase account lookup was not unique for synthetic alias ${name}.`);
  const account = matches[0];
  return { name, uid: account.Uid, type: account.Type, status: account.UserStatus };
}

function resolveCliLaunch(tcbCli) {
  if (!tcbCli.toLowerCase().endsWith('.cmd')) return { command: tcbCli, arguments: [] };
  return {
    command: process.execPath,
    arguments: [resolve(dirname(tcbCli), '..', '@cloudbase', 'cli', 'bin', 'tcb')],
  };
}

function parseCliJson(output) {
  const objectStart = output.indexOf('{');
  const arrayStart = output.indexOf('[');
  const starts = [objectStart, arrayStart].filter((value) => value >= 0);
  if (starts.length === 0) throw new Error('CloudBase CLI returned no JSON payload.');
  return JSON.parse(output.slice(Math.min(...starts)));
}

function parseEnvironment(text) {
  const result = {};
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (match === null) continue;
    result[match[1]] = match[2];
  }
  return result;
}

function requirePrivateValue(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('Required private local configuration is unavailable.');
  return value.trim();
}

async function writePrivateJson(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

function documentCount(seed) {
  return Object.values(seed.collections).reduce((total, documents) => total + documents.length, 0);
}
