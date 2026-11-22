import { mkdir, readdir, readFile, writeFile, rename, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

process.umask(0o077);
const data = process.env.YAREI_DATA_DIR ?? '/var/lib/yarei-v0128';
const origin = process.env.YAREI_ORIGIN ?? 'https://video.aimanhua.xin';
const output = join(data, 'healthcheck');
const failures = [];
const checks = {};
try {
  const response = await fetch(origin + '/healthz', { signal: AbortSignal.timeout(10000) });
  const body = await response.json();
  checks.https = response.ok && body.status === 'ok' && body.dataMigration === 'imported';
  if (!checks.https) failures.push('https_health_failed');
} catch { checks.https = false; failures.push('https_health_unreachable'); }
try {
  const { stdout } = await promisify(execFile)('systemctl', ['is-active', 'yarei.service', 'yarei-caddy.service', 'yarei-backup.timer'], { timeout: 10000 });
  checks.services = stdout.trim().split(/\s+/).every(value => value === 'active');
  if (!checks.services) failures.push('service_inactive');
} catch { checks.services = false; failures.push('service_inactive'); }
try {
  const latest = (await readdir(join(data, 'backups'))).filter(name => /^\d{8}T\d{6}Z$/.test(name)).sort().at(-1);
  const match = latest?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const time = match ? Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`) : NaN;
  checks.backupAgeHours = Number.isFinite(time) ? Math.round((Date.now() - time) / 36000) / 100 : null;
  if (checks.backupAgeHours === null || checks.backupAgeHours < 0 || checks.backupAgeHours > 30) failures.push('backup_stale_or_missing');
} catch { failures.push('backup_unreadable'); }
try {
  const fs = await statfs(data);
  checks.freeDiskPercent = Math.round(fs.bavail / fs.blocks * 100);
  checks.freeDiskGiB = Math.round(fs.bavail * fs.bsize / 1073741824 * 100) / 100;
  if (checks.freeDiskPercent < 15 || checks.freeDiskGiB < 3) failures.push('disk_space_low');
} catch { failures.push('disk_check_failed'); }
await mkdir(output, { recursive: true, mode: 0o700 });
const now = new Date().toISOString();
const previous = await readFile(join(output, 'latest.json'), 'utf8').then(JSON.parse).catch(() => ({}));
const result = { checkedAt: now, ok: failures.length === 0, checks, failures,
  lastSuccessAt: failures.length ? previous.lastSuccessAt ?? null : now,
  lastFailureAt: failures.length ? now : previous.lastFailureAt ?? null,
  lastFailures: failures.length ? failures : previous.lastFailures ?? [] };
await writeFile(join(output, 'latest.json.tmp'), JSON.stringify(result, null, 2), { mode: 0o600 });
await rename(join(output, 'latest.json.tmp'), join(output, 'latest.json'));
console.log(JSON.stringify(result));
if (failures.length) process.exitCode = 1;
