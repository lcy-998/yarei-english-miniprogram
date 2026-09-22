import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const credentials = JSON.parse((await execute(process.execPath, [resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'), 'secrets', 'get', '--json'], { cwd: root, encoding: 'utf8', windowsHide: true })).stdout).data;
const env = Object.fromEntries((await (await import('node:fs/promises')).readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u).flatMap((line) => { const i = line.indexOf('='); return i > 0 ? [[line.slice(0, i), line.slice(i + 1)]] : []; }));
const temporary = await mkdtemp(join(tmpdir(), 'yarei-task-diag-'));
try {
  const output = join(temporary, 'diagnostic.cjs');
  await build({ entryPoints: [join(root, 'tools', 'diagnose-task-core-save.ts')], outfile: output, bundle: true, format: 'cjs', platform: 'node', target: 'node22', external: ['@cloudbase/js-sdk'], logLevel: 'silent' });
  try { require('@cloudbase/adapter-node'); } catch { /* optional */ }
  const app = require('@cloudbase/js-sdk').init({ env: env.TCB_ENV_ID, secretId: credentials.secretId, secretKey: credentials.secretKey, sessionToken: credentials.token });
  const result = await require(output).diagnoseTaskCoreSave(app.database());
  process.stdout.write(`task_core_transaction_probe=${result}\n`);
  process.exit(result === 'idempotency:committed;task:committed;service:succeeded' ? 0 : 2);
} finally { await rm(temporary, { recursive: true, force: true }); }
