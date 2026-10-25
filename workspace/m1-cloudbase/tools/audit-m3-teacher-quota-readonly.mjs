import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const root = resolve('D:/app/workspace/m1-cloudbase');
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
if (typeof config.envId !== 'string' || !config.envId) throw new Error('Environment not configured');
const today = new Date().toISOString().slice(0, 10);
const firstDay = `${today.slice(0, 7)}-01`;
let raw;
try {
  raw = execFileSync(process.execPath, [cli, 'api', 'tcb', 'DescribeEnvPackageUsage',
    '--body', JSON.stringify({ EnvId: config.envId, StartDate: firstDay, EndDate: today,
      QueryType: 'monthly' }), '--json'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
    timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  const summary = String(error.stdout ?? error.stderr ?? error.message ?? '').replaceAll(config.envId, '[ENV]')
    .replace(/\b(?:AKID|SK)[A-Za-z0-9]{10,}\b/g, '[REDACTED]').slice(0, 220);
  throw new Error(`Read-only quota request failed: ${summary}`);
}
const first = raw.indexOf('{');
if (first < 0) throw new Error('Legacy quota request did not return JSON');
let parsed;
try { parsed = JSON.parse(raw.slice(first)); }
catch (_error) { throw new Error('Quota response was not JSON'); }
process.stdout.write(`quota field names: ${Object.keys(parsed.data ?? parsed.Response ?? {}).sort().join(', ')}\n`);
const metrics = parsed.data?.MetricData;
process.stdout.write(`metric shape: ${Array.isArray(metrics) ? `array(${metrics.length})` : typeof metrics}; keys: ${Object.keys(Array.isArray(metrics) ? metrics[0] ?? {} : metrics ?? {}).sort().join(', ')}\n`);
