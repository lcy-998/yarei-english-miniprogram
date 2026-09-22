import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArguments(process.argv.slice(2));
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const configuredEnvId = requireValue(config.envId, 'Configured environment is unavailable.');
const runtimeDirectory = join(root, '.runtime', 'cloud-integration');
const seeds = {
  primary: JSON.parse(await readFile(join(runtimeDirectory, 'primary.runtime-seed.json'), 'utf8')),
  secondary: JSON.parse(await readFile(join(runtimeDirectory, 'secondary.runtime-seed.json'), 'utf8')),
};
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'yarei-cloud-seed-operator-'));
const bundlePath = join(temporaryDirectory, 'operator.cjs');

try {
  await build({
    entryPoints: [join(root, 'src', 'seed', 'cloudbase-controlled-operator.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    external: ['@cloudbase/js-sdk'],
    logLevel: 'silent',
  });
  const credentials = await readTemporaryCredentials(resolveCliLaunch(args.tcbCli));
  if (credentials.envId !== configuredEnvId) throw new Error('Temporary credentials target a different environment.');
  const sdk = require('@cloudbase/js-sdk');
  const app = sdk.init({
    env: configuredEnvId,
    secretId: credentials.secretId,
    secretKey: credentials.secretKey,
    sessionToken: credentials.token,
  });
  const nativeDatabase = app.database();
  const module = require(bundlePath);
  const operator = module.createCloudBaseControlledSeedOperator(
    nativeDatabase,
    seeds,
    () => new Date().toISOString(),
  );
  const seed = seeds[args.packageName];
  const result = await operator.execute(args.packageName, {
    command: args.command,
    guard: {
      environmentPurpose: 'm1-non-production',
      dataClassification: 'synthetic-only',
      identityProfile: 'runtime',
    },
    expectedSeedRunId: args.targetSeedRunId ?? seed.manifest.seedRunId,
    requestId: deterministicRequestId(seed.manifest.contentHash),
    executedBy: 'm1_local_controlled_seed_operator',
    batchSize: 25,
  });
  process.stdout.write(`PACKAGE=${args.packageName}\n`);
  process.stdout.write(`COMMAND=${result.command}\n`);
  process.stdout.write(`STATUS=${result.state.status}\n`);
  process.stdout.write(`NEXT_BATCH=${result.state.nextBatchIndex}/${result.state.totalBatches}\n`);
  process.stdout.write(`VERIFIED_BATCHES=${result.state.verifiedBatchCount}/${result.state.totalBatches}\n`);
  process.stdout.write(`ROLLBACK_CURSOR=${result.state.rollbackCursor}\n`);
  process.stdout.write(`CREATED_COUNT=${result.state.createdCount}\n`);
} catch (error) {
  process.stderr.write(`SEED_OPERATOR_ERROR=${safeErrorCode(error)}\n`);
  process.exitCode = 2;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
  process.stdout.write('SEED_OPERATOR_COMPLETE=1\n');
}

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (value === undefined || !['--tcb-cli', '--package', '--command', '--target-seed-run'].includes(key)) {
      throw new Error('Invalid cloud seed operator arguments.');
    }
    parsed[key.slice(2)] = value;
  }
  if (Object.keys(parsed).length < 3 || Object.keys(parsed).length > 4) throw new Error('Cloud seed operator requires exact arguments.');
  if (!['primary', 'secondary'].includes(parsed.package)) throw new Error('Unknown cloud seed package.');
  if (!['status', 'plan', 'advance', 'resume', 'begin_rollback', 'advance_rollback'].includes(parsed.command)) {
    throw new Error('Unknown cloud seed command.');
  }
  if (parsed['target-seed-run'] !== undefined && !['begin_rollback', 'advance_rollback'].includes(parsed.command)) {
    throw new Error('A target seed run is only valid for rollback commands.');
  }
  return {
    tcbCli: resolve(parsed['tcb-cli']),
    packageName: parsed.package,
    command: parsed.command,
    ...(parsed['target-seed-run'] === undefined ? {} : { targetSeedRunId: parsed['target-seed-run'] }),
  };
}

function resolveCliLaunch(tcbCli) {
  if (!tcbCli.toLowerCase().endsWith('.cmd')) return { command: tcbCli, arguments: [] };
  const executableDirectory = dirname(tcbCli);
  const candidates = [
    // Project-local npm bin: node_modules/.bin/tcb.cmd
    resolve(executableDirectory, '..', '@cloudbase', 'cli', 'bin', 'tcb'),
    // npm --global --prefix <directory>: <directory>/tcb.cmd
    resolve(executableDirectory, 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
  ];
  return {
    command: process.execPath,
    arguments: [candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]],
  };
}

async function readTemporaryCredentials(cliLaunch) {
  let stdout;
  try {
    ({ stdout } = await execute(cliLaunch.command, [...cliLaunch.arguments, 'secrets', 'get', '--json'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }));
  } catch {
    throw new Error('Temporary credentials are unavailable.');
  }
  const payload = parseCliJson(stdout)?.data;
  if (payload?.isTemporary !== true
    || typeof payload.expiredAt !== 'string'
    || !Number.isFinite(Date.parse(payload.expiredAt))
    || Date.parse(payload.expiredAt) <= Date.now() + 60_000) {
    throw new Error('Temporary credentials are expired or invalid.');
  }
  return {
    envId: requireValue(payload.envId, 'Credential environment is unavailable.'),
    secretId: requireValue(payload.secretId, 'Temporary secret id is unavailable.'),
    secretKey: requireValue(payload.secretKey, 'Temporary secret key is unavailable.'),
    token: requireValue(payload.token, 'Temporary session token is unavailable.'),
  };
}

function parseCliJson(output) {
  const starts = [output.indexOf('{'), output.indexOf('[')].filter((value) => value >= 0);
  if (starts.length === 0) throw new Error('CloudBase CLI returned no JSON payload.');
  return JSON.parse(output.slice(Math.min(...starts)));
}

function requireValue(value, message) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(message);
  return value.trim();
}

function deterministicRequestId(contentHash) {
  if (typeof contentHash !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(contentHash)) {
    throw new Error('Seed content hash is invalid.');
  }
  return `req_seed_${contentHash.slice(7, 39)}`;
}

function safeErrorCode(error) {
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string') {
      const knownMessages = new Map([
        ['Cloud seed package failed runtime validation.', 'SEED_RUNTIME_VALIDATION_FAILED'],
        ['Cloud seed package must contain exactly one organization.', 'SEED_RUNTIME_ORGANIZATION_INVALID'],
        ['Cloud seed organization boundary is unavailable.', 'SEED_RUNTIME_ORGANIZATION_UNAVAILABLE'],
        ['Temporary credentials are unavailable.', 'TEMPORARY_CREDENTIALS_UNAVAILABLE'],
        ['Temporary credentials are expired or invalid.', 'TEMPORARY_CREDENTIALS_INVALID'],
        ['Temporary secret id is unavailable.', 'TEMPORARY_CREDENTIALS_INVALID'],
        ['Temporary secret key is unavailable.', 'TEMPORARY_CREDENTIALS_INVALID'],
        ['Temporary session token is unavailable.', 'TEMPORARY_CREDENTIALS_INVALID'],
        ['Credential environment is unavailable.', 'TEMPORARY_CREDENTIALS_INVALID'],
        ['Temporary credentials target a different environment.', 'ENVIRONMENT_MISMATCH'],
      ]);
      const known = knownMessages.get(error.message);
      if (known !== undefined) return known;
      const match = /^CloudBase [a-z]+ failed \(([A-Za-z0-9_.:-]{1,80})\)\.$/u.exec(error.message);
      if (match !== null) return match[1];
    }
    for (const key of ['code', 'name']) {
      const value = error[key];
      if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/u.test(value)) return value;
    }
    if (typeof error.kind === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/u.test(error.kind)) return error.kind;
  }
  return 'UNAVAILABLE';
}
