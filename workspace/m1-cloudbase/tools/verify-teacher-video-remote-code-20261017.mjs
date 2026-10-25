import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const cache = 'D:/app-m3-cache/teacher-video-direct-20261017-v4';
const destination = resolve(cache, 'remote-readback');
await mkdir(destination, { recursive: true });
try {
  execFileSync(process.execPath, [cli, '--config-file', resolve(cache, 'cloudbaserc.json'),
    'fn', 'code', 'download', 'task-command', destination, '--json'], {
    cwd: root, windowsHide: true, timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env,
      NODE_OPTIONS: `--require=${resolve(root, 'tools/cloudbase-code-dns-fallback.cjs')}` },
  });
} catch { throw new Error('REMOTE_CODE_READBACK_FAILED'); }
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const remote = await digest(resolve(destination, 'index.js'));
const original = await digest(resolve(cache, 'baseline/task-command/index.js'));
const candidate = await digest(resolve(root, 'dist/teacher-video-direct-20261017-candidate/task-command/index.js'));
process.stdout.write(JSON.stringify({ remoteMatchesOriginal: remote === original,
  remoteMatchesCandidate: remote === candidate }) + '\n');
