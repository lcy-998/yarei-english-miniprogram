// Read-only, redacted comparison of the two CloudBase functions used by account identity flows.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envId = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const result = JSON.parse(raw.slice(start));
  if (result.error) throw new Error('CLOUD_CLI_FAILED');
  return result.data;
}
const hash = value => createHash('sha256').update(value).digest('hex');
for (const name of ['auth-session', 'native-admin-management-command']) {
  const remote = cliData(['fn', 'detail', name, '--json']);
  const route = cliData(['fn', 'get-route', name, '--json']);
  const versions = cliData(['fn', 'list-function-versions', name, '--json']);
  const localPath = resolve(root, 'dist/functions-m3-identity-fix-20261010', name, 'index.js');
  const local = readFileSync(localPath);
  const template = config.functions.find(row => row.name === name)
    ?? (name === 'native-admin-management-command'
      ? config.functions.find(row => row.name === 'task-query') : undefined);
  const remoteVariables = Array.isArray(remote.Environment?.Variables) ? remote.Environment.Variables : [];
  const expectedVariables = template?.envVariables ?? {};
  const remoteEnvironmentDigest = hash(JSON.stringify(remoteVariables.map(row => [row.Key, row.Value])
    .sort((a, b) => a[0].localeCompare(b[0]))));
  const expectedEnvironmentDigest = hash(JSON.stringify(Object.entries(expectedVariables)
    .sort((a, b) => a[0].localeCompare(b[0]))));
  process.stdout.write(JSON.stringify({ function: name, status: remote.Status,
    runtime: remote.Runtime, handler: remote.Handler, timeout: remote.Timeout,
    memorySize: remote.MemorySize, installDependency: remote.InstallDependency,
    triggerCount: Array.isArray(remote.Triggers) ? remote.Triggers.length : null,
    environmentKeysMatch: JSON.stringify(remoteVariables.map(row => row.Key).sort())
      === JSON.stringify(Object.keys(expectedVariables).sort()),
    environmentValuesMatch: remoteEnvironmentDigest === expectedEnvironmentDigest,
    routeVersion: route.FunctionVersion ?? route.RoutingConfig?.FunctionVersion ?? null,
    weightedRouteCount: route.RoutingConfig?.AdditionalVersionWeights?.length ?? 0,
    immutableVersionCount: Array.isArray(versions.Versions) ? versions.Versions.length
      : Array.isArray(versions.FunctionVersions) ? versions.FunctionVersions.length : null,
    immutableVersions: (versions.Versions ?? versions.FunctionVersions ?? []).map(row => ({
      version: row.FunctionVersion ?? row.Version ?? null, status: row.Status ?? null,
      codeSize: row.CodeSize ?? null,
    })),
    detailKeys: Object.keys(remote).sort(), codeInfoType: typeof remote.CodeInfo,
    codeInfoLength: typeof remote.CodeInfo === 'string' ? remote.CodeInfo.length : null,
    remoteCodeSha256: hash(remote.CodeInfo ?? ''), localCodeSha256: hash(local),
    codeMatches: hash(remote.CodeInfo ?? '') === hash(local) }) + '\n');
}
