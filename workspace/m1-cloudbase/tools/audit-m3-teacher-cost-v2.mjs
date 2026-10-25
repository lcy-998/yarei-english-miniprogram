import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const project = resolve('D:/app/workspace/m1-cloudbase');
const config = JSON.parse(readFileSync(resolve(project, 'cloudbaserc.json'), 'utf8'));
if (typeof config.envId !== 'string' || !config.envId) throw new Error('Environment not configured');

function call(action, body) {
  let raw;
  try {
    raw = execFileSync(process.execPath, [cli, 'api', 'tcb', action,
      '--body', JSON.stringify(body), '--json'], { cwd: project, encoding: 'utf8',
      windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { throw new Error(`Read-only ${action} failed`); }
  const first = raw.indexOf('{');
  if (first < 0) throw new Error(`${action} did not return JSON`);
  const parsed = JSON.parse(raw.slice(first));
  return parsed.data ?? parsed.Response ?? {};
}

const credits = call('DescribeCreditsUsage', { EnvId: config.envId,
  StartDate: '2026-09-12', EndDate: '2026-10-03' });
process.stdout.write(`credits ReportValue=${typeof credits.ReportValue === 'number' ? credits.ReportValue : 'unavailable'}\n`);
for (const metric of ['FunctionInvocation', 'FunctionGBs', 'FunctionFlux']) {
  const data = call('DescribeCurveData', { EnvId: config.envId, MetricName: metric,
    StartTime: '2026-09-12 00:00:00', EndTime: '2026-10-03 23:59:59' });
  const points = Array.isArray(data.NewValues) ? data.NewValues : data.Values;
  if (!Array.isArray(points) || points.some(value => typeof value !== 'number')) {
    throw new Error(`${metric} usage unavailable`);
  }
  const total = points.reduce((sum, value) => sum + value, 0);
  process.stdout.write(`${metric} points=${points.length} total=${total}\n`);
}
for (const metric of ['DbReadpkg', 'DbWritepkg', 'DbSizepkg',
  'StorageSizepkg', 'StorageReadpkg', 'StorageWritepkg']) {
  const data = call('DescribeQuotaData', { EnvId: config.envId, MetricName: metric });
  process.stdout.write(`${metric} value=${typeof data.Value === 'number' ? data.Value : 'unavailable'} `
    + `subValue=${typeof data.SubValue === 'string' ? data.SubValue : 'unavailable'}\n`);
}
