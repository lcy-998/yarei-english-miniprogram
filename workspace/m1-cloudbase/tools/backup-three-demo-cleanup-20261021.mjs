// Local, read-only export before the explicitly requested test-data cleanup.
// Store the output under the current Windows user's private profile, outside Git.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const localEnv = readFileSync(resolve(root, '.env.local'), 'utf8')
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!localEnv || localEnv !== config.envId) throw new Error('ENVIRONMENT_MISMATCH');

function call(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLI_RESPONSE_UNAVAILABLE');
  const parsed = JSON.parse(raw.slice(first));
  if (parsed.error) throw new Error(`CLI_${String(parsed.error.code ?? 'FAILED')}`);
  return parsed.data;
}
const envs = call(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== localEnv
  || envs[0].Status !== 'NORMAL' || envs[0].EnableOverrun !== false) {
  throw new Error('TARGET_ENVIRONMENT_UNCONFIRMED');
}
const credentials = call(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== localEnv
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID');
}
const list = call(['api', 'tcb', 'ListTables', '--region', 'ap-shanghai',
  '--body', JSON.stringify({ EnvId: localEnv, MgoLimit: 1000, MgoOffset: 0 }), '--json']);
const tables = list?.Tables;
if (!Array.isArray(tables) || list?.Pager?.Total !== tables.length
  || tables.length < 50 || tables.some(row => !/^[a-z][a-z0-9_]*$/u.test(row.TableName))) {
  throw new Error('COLLECTION_INVENTORY_INCOMPLETE');
}
const authUsers = call(['user', 'list', '-e', localEnv, '--offset', '0',
  '--limit', '100', '--json']);
if (!Array.isArray(authUsers) || authUsers.length < 3 || authUsers.length >= 100) {
  throw new Error('AUTH_ACCOUNT_SET_CHANGED');
}
const storage = call(['storage', 'list', '--json']);
if (!Array.isArray(storage) || storage.length < 270) {
  throw new Error('STORAGE_INVENTORY_INCOMPLETE');
}
const require = createRequire(resolve(root, 'package.json'));
const db = require('@cloudbase/node-sdk').init({ env: localEnv,
  secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token }).database();
const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
const folder = join(homedir(), 'AppData', 'Local', 'Yarei',
  `three-demo-cleanup-backup-${stamp}`);
mkdirSync(join(folder, 'database'), { recursive: true, mode: 0o700 });
function save(name, value) {
  const content = JSON.stringify(value);
  const file = join(folder, name);
  writeFileSync(file, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return { sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content) };
}
const manifest = { capturedAt: new Date().toISOString(), environmentId: localEnv,
  auth: save('auth-users.json', authUsers),
  storageInventory: save('storage-inventory.json', storage), collections: {} };
for (const table of tables) {
  const name = table.TableName;
  const count = await db.collection(name).count();
  const expected = count.total;
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error(`COUNT_UNAVAILABLE_${name}`);
  const rows = [];
  for (let offset = 0; offset < expected; offset += 100) {
    const result = await db.collection(name).skip(offset).limit(100).get();
    const batch = Array.isArray(result.data) ? result.data : [];
    if (batch.length === 0) throw new Error(`EXPORT_INCOMPLETE_${name}`);
    rows.push(...batch);
  }
  if (rows.length !== expected || new Set(rows.map(row => row._id)).size !== expected) {
    throw new Error(`EXPORT_INCOMPLETE_${name}`);
  }
  manifest.collections[name] = { count: expected,
    ...save(join('database', `${name}.json`), rows) };
  process.stdout.write(JSON.stringify({ collection: name, count: expected }) + '\n');
}
save('manifest.json', manifest);
process.stdout.write(JSON.stringify({ backupFolder: folder, collectionCount: tables.length,
  authCount: authUsers.length, storageObjects: storage.length }) + '\n');
