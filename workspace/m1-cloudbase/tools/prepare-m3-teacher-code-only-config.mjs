import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const outputRoot = resolve('D:/app-m3-cache/teacher/code-only-configs/2026-10-03');
const functionRoot = resolve('D:/app-m3-cache/teacher/full-bundles/2026-10-03');
const functions = [
  { name: 'task-query', timeout: 10 },
  { name: 'task-command', timeout: 20 },
  { name: 'activity-query', timeout: 10 },
  { name: 'activity-command', timeout: 20 },
];
let raw;
try {
  raw = execFileSync(process.execPath, [cli, 'env', 'list', '--json'], {
    cwd: resolve('D:/app/workspace/m1-cloudbase'), encoding: 'utf8', windowsHide: true,
    timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (_error) { throw new Error('Read-only environment listing failed'); }
const first = raw.indexOf('{');
if (first < 0) throw new Error('Environment listing was not JSON');
const listed = JSON.parse(raw.slice(first));
const environments = Array.isArray(listed.data) ? listed.data : [];
const eligible = environments.filter(item => item.Status === 'NORMAL'
  && item.PackageName === '个人版' && item.EnableOverrun === false
  && item.EnvCharged === 'no' && typeof item.EnvId === 'string');
if (eligible.length !== 1) throw new Error('Expected exactly one eligible nonproduction environment');
await mkdir(outputRoot, { recursive: true });
for (const definition of functions) {
  const config = { version: '2.0', envId: eligible[0].EnvId, region: 'ap-shanghai',
    functionRoot, functions: [{ ...definition, runtime: 'Nodejs20.19', handler: 'index.main',
      memorySize: 256, installDependency: false }] };
  if ('envVariables' in config.functions[0] || config.functions.length !== 1) throw new Error('Unsafe config');
  const path = resolve(outputRoot, `${definition.name}.json`);
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  process.stdout.write(`${definition.name} isolated config ready; one function, no envVariables\n`);
}
