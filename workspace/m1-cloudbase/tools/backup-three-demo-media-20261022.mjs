// Private local backup of the exact media objects selected for the virtual-account cleanup.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const folder = resolve(process.argv[2] ?? '');
if (!folder.includes('three-demo-cleanup-backup-2026-10-22T')) throw new Error('BACKUP_FOLDER_INVALID');
const plan = JSON.parse(readFileSync(join(folder, 'cleanup-plan.json'), 'utf8'));
if (plan.environmentId !== 'cloud1-d8ggzrwwedb786e41' || plan.storageKeys.length !== 69) {
  throw new Error('PLAN_INVALID');
}
const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'cloudbaserc.json'), 'utf8'));
const localEnv = readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (config.envId !== plan.environmentId || localEnv !== plan.environmentId) {
  throw new Error('ENVIRONMENT_MISMATCH');
}
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
function cliJson(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error('CLOUD_CLI_FAILED');
  return parsed.data;
}
const envs = cliJson(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== plan.environmentId
  || envs[0].Status !== 'NORMAL' || envs[0].EnableOverrun !== false
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') throw new Error('ENV_OR_COST_GATE');
const secrets = cliJson(['secrets', 'get', '--json']);
if (secrets?.envId !== plan.environmentId || secrets.isTemporary !== true
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');
const require = createRequire(join(root, 'package.json'));
const app = require('@cloudbase/node-sdk').init({ env: plan.environmentId,
  secretId: secrets.secretId, secretKey: secrets.secretKey, sessionToken: secrets.token });
const storageInventory = JSON.parse(readFileSync(join(folder, 'storage-inventory.json'), 'utf8'));
const inventory = new Map(storageInventory.map(row => [row.key, row]));
const bucket = `${plan.environmentId}.636c-${plan.environmentId}-1486593797`;
const mediaFolder = join(folder, 'media');
mkdirSync(mediaFolder, { recursive: true, mode: 0o700 });
const backed = [];
for (const key of plan.storageKeys) {
  const entry = inventory.get(key);
  if (!entry || !Number.isSafeInteger(Number(entry.size))) throw new Error('INVENTORY_MISSING');
  const fileID = `cloud://${bucket}/${key}`;
  let result;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try { result = await app.downloadFile({ fileID }); break; }
    catch (error) {
      if (attempt === 4) throw new Error(`MEDIA_DOWNLOAD_FAILED:${key}:${error.code ?? 'UNKNOWN'}`);
      await new Promise(done => setTimeout(done, attempt * 750));
    }
  }
  const bytes = Buffer.isBuffer(result.fileContent) ? result.fileContent
    : Buffer.from(result.fileContent ?? '');
  if (bytes.length !== Number(entry.size)) throw new Error(`MEDIA_SIZE_CHANGED:${key}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const file = `${sha256}.bin`;
  const path = join(mediaFolder, file);
  try { writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const localHash = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (localHash !== sha256) throw new Error(`LOCAL_MEDIA_HASH_MISMATCH:${key}`);
  backed.push({ key, bytes: bytes.length, sha256, file });
}
const total = backed.reduce((sum, row) => sum + row.bytes, 0);
if (backed.length !== plan.storageKeys.length || total !== plan.storageBytes) {
  throw new Error('MEDIA_BACKUP_INCOMPLETE');
}
writeFileSync(join(folder, 'media-manifest.json'), JSON.stringify({ environmentId: plan.environmentId,
  capturedAt: new Date().toISOString(), objects: backed }), { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ backedUp: backed.length, bytes: total,
  manifest: join(folder, 'media-manifest.json') }) + '\n');
