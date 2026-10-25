import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const cache = 'D:/app-m3-cache/pep-chapter-audio-functions-20261015';
const envId = 'cloud1-d8ggzrwwedb786e41';
const preflight = JSON.parse(await readFile(`${cache}/preflight.json`, 'utf8'));
if (preflight.environment !== envId) throw new Error('ENVIRONMENT_CHANGED');
for (const name of ['content-query', 'teacher-textbook-query']) {
  if (preflight.functions[name]?.signature?.installDependency !== 'FALSE') {
    throw new Error(`BASELINE_CONFIG_MISMATCH_${name}`);
  }
  const body = JSON.stringify({ FunctionName: name, Namespace: envId,
    InstallDependency: 'FALSE' });
  const raw = execFileSync(process.execPath, [cli, 'api', 'scf',
    'UpdateFunctionConfiguration', '--api-version', '2018-04-16',
    '--body', body, '--json'], { encoding: 'utf8', windowsHide: true,
    timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error || !parsed.data?.Response?.RequestId && !parsed.data?.RequestId) {
    throw new Error(`CONFIG_UPDATE_FAILED_${name}`);
  }
  process.stdout.write(JSON.stringify({ function: name, requested: 'InstallDependency=FALSE' }) + '\n');
}
