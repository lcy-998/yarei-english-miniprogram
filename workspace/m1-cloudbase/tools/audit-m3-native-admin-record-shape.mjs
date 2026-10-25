// Read-only diagnostic: print schema shape only, never business text or identifiers.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('D:/app/workspace/m1-cloudbase');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const raw = execFileSync(process.execPath, [cli, 'secrets', 'get', '--json'], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
  maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
const first = raw.indexOf('{');
if (first < 0) throw new Error('TEMPORARY_CREDENTIALS_UNAVAILABLE');
const credentials = JSON.parse(raw.slice(first)).data;
if (credentials?.isTemporary !== true || credentials.envId !== config.envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const require = createRequire(resolve(root, 'package.json'));
const database = require('@cloudbase/node-sdk').init({ env: config.envId,
  secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token }).database();

for (const collection of ['tasks', 'checkin_activities']) {
  const response = await database.collection(collection).where({ organizationId: 'org_qihang_demo',
    deletedAt: null }).limit(5).get();
  const rows = Array.isArray(response.data) ? response.data : [];
  process.stdout.write(JSON.stringify({ collection, sampleCount: rows.length,
    samples: rows.map(row => ({ topLevelKeys: Object.keys(row).sort(),
      directTitle: typeof row.title === 'string' && row.title.trim().length > 0,
      directName: typeof row.name === 'string' && row.name.trim().length > 0,
      directTaskName: typeof row.taskName === 'string' && row.taskName.trim().length > 0,
      payloadKeys: row.payload && typeof row.payload === 'object' ? Object.keys(row.payload).sort() : [],
      snapshotKeys: row.snapshot && typeof row.snapshot === 'object' ? Object.keys(row.snapshot).sort() : [] })) }) + '\n');
}
