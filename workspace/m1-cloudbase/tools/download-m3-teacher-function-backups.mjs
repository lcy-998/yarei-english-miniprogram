import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const root = resolve('D:/app-m3-cache/teacher/cloud-backups/2026-10-03');
const names = ['task-query', 'task-command', 'activity-query', 'activity-command'];
await mkdir(root, { recursive: true });
for (const name of names) {
  const destination = resolve(root, name);
  try {
    execFileSync(process.execPath, [cli, 'fn', 'code', 'download', name, destination, '--json'], {
      cwd: resolve('D:/app/workspace/m1-cloudbase'), encoding: 'utf8', windowsHide: true,
      timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (_error) { throw new Error(`Read-only code download failed for ${name}`); }
  if (!(await stat(destination)).isDirectory()) throw new Error(`Missing backup directory for ${name}`);
  const code = await readFile(join(destination, 'index.js'));
  const tree = createHash('sha256');
  let fileCount = 0;
  let totalBytes = 0;
  async function visit(folder) {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { await visit(path); continue; }
      if (!entry.isFile()) throw new Error(`Unsupported backup entry for ${name}`);
      const bytes = await readFile(path);
      fileCount += 1;
      totalBytes += bytes.length;
      tree.update(relative(destination, path).replaceAll('\\', '/')).update('\0').update(bytes);
    }
  }
  await visit(destination);
  process.stdout.write(`${name} ${fileCount} ${totalBytes} ${createHash('sha256').update(code).digest('hex')} ${tree.digest('hex')}\n`);
}
