import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const names = ['task-query', 'task-command', 'activity-query', 'activity-command'];
if (!existsSync(cli) || !existsSync(resolve(root, 'cloudbaserc.json'))) {
  throw new Error('Read-only CloudBase CLI or local config unavailable');
}

function cliJson(args) {
  let raw;
  try {
    raw = execFileSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (_error) {
    throw new Error(`Read-only CLI action failed: ${args.slice(0, 2).join(' ')}`);
  }
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLI did not return JSON');
  try { return JSON.parse(raw.slice(first)); }
  catch (_error) { throw new Error('CLI returned unparseable JSON'); }
}

for (const name of names) {
  const result = cliJson(['fn', 'detail', name, '--json']);
  const data = result.data ?? {};
  const environment = data.Environment ?? {};
  const variables = Array.isArray(environment.Variables) ? environment.Variables : [];
  const keys = variables.map(item => item.Key).filter(key => typeof key === 'string').sort();
  process.stdout.write(JSON.stringify({ name, status: data.Status, runtime: data.Runtime,
    handler: data.Handler, timeout: data.Timeout, memorySize: data.MemorySize,
    codeSize: data.CodeSize, functionVersion: data.FunctionVersion,
    installDependency: data.InstallDependency, triggerCount: Array.isArray(data.Triggers) ? data.Triggers.length : null,
    environmentFieldNames: Object.keys(environment).sort(), environmentKeys: keys,
  }) + '\n');
  for (const [label, command] of [
    ['version', ['fn', 'list-function-versions', name, '--json']],
    ['route', ['fn', 'get-route', name, '--json']],
  ]) {
    try {
      const payload = cliJson(command);
      const detail = payload.data ?? {};
      process.stdout.write(`${name} ${label} field names: ${Object.keys(detail).sort().join(', ')}\n`);
      if (label === 'version') {
        process.stdout.write(`${name} versions: ${Array.isArray(detail.Versions) ? detail.Versions.map(item => item.Version).join(', ') : 'unavailable'}\n`);
      } else {
        const route = detail.RoutingConfig ?? {};
        process.stdout.write(`${name} route primary: ${detail.FunctionVersion}; weighted count: ${Array.isArray(route.AdditionalVersionWeights) ? route.AdditionalVersionWeights.length : 'unknown'}\n`);
      }
    } catch (_error) {
      process.stdout.write(`${name} ${label}: unavailable\n`);
    }
  }
}
