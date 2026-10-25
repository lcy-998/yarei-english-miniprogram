import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const bundle = readFileSync('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/dist/standalone/cli.js', 'utf8');
const tempCos = bundle.match(/exports\.SCF_TEMP_COS = \{\s*APPID: '(\d+)'/);
if (!tempCos) throw new Error('Temporary SCF COS bucket owner not found in pinned CLI');
let raw;
try {
  raw = execFileSync(process.execPath, [cli, 'api', 'tcb', 'DescribeTcbAccountInfo', '--json'], {
    cwd: resolve('D:/app/workspace/m1-cloudbase'), encoding: 'utf8', windowsHide: true,
    timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (_error) { throw new Error('Read-only CloudBase account lookup failed'); }
const start = raw.indexOf('{');
if (start < 0) throw new Error('Account lookup did not return JSON');
const response = JSON.parse(raw.slice(start));
const account = response.data ?? response.Response ?? {};
if (typeof account.CloudAppId !== 'string' && typeof account.CloudAppId !== 'number') {
  throw new Error('Account owner ID missing');
}
process.stdout.write(`temporary COS bucket owner differs from account CloudAppId: ${tempCos[1] !== String(account.CloudAppId)}\n`);
