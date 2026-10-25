// Download the storage objects listed by the latest local cleanup backup.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const exec = promisify(execFile);
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const backupsRoot = join(homedir(), 'AppData', 'Local', 'Yarei');
const latest = readdirSync(backupsRoot).filter(name =>
  /^production-reuse-backup-\d{4}-\d{2}-\d{2}T/u.test(name)).sort().at(-1);
if (!latest) throw new Error('BACKUP_FOLDER_MISSING');
const folder = join(backupsRoot, latest);
const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
if (manifest.environmentId !== config.envId || manifest.storageObjects !== undefined) {
  throw new Error('BACKUP_ENVIRONMENT_MISMATCH');
}
const objects = JSON.parse(readFileSync(join(folder, 'storage-inventory.json'), 'utf8'));
if (!Array.isArray(objects) || objects.length < 270) throw new Error('STORAGE_INVENTORY_INCOMPLETE');
const storageFolder = join(folder, 'storage');
mkdirSync(storageFolder, { recursive: true, mode: 0o700 });
let totalCount = 0;
let totalBytes = 0;
let verifiedEtags = 0;
let cursor = 0;
async function worker() {
  while (cursor < objects.length) {
    const index = cursor++;
    const object = objects[index];
    const segments = String(object.key).split('/');
    const size = Number(object.size);
    if (segments.some(part => !part || part === '.' || part === '..' || part.includes('\\'))
      || !Number.isSafeInteger(size) || size < 0) throw new Error('INVALID_STORAGE_OBJECT');
    const target = join(storageFolder, ...segments);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    if (!existsSync(target) || statSync(target).size !== size) {
      try {
        await exec(process.execPath, [cli, 'storage', 'download', object.key,
          target, '--json'], { cwd: root, windowsHide: true, timeout: 60000,
          maxBuffer: 8 * 1024 * 1024 });
      } catch { throw new Error(`STORAGE_DOWNLOAD_FAILED_AT_${index}`); }
    }
    if (!existsSync(target) || statSync(target).size !== size) {
      throw new Error(`STORAGE_BACKUP_MISMATCH_AT_${index}`);
    }
    const etag = String(object.eTag ?? '').replace(/^"|"$/gu, '');
    if (/^[a-f0-9]{32}$/iu.test(etag)) {
      const localMd5 = createHash('md5').update(readFileSync(target)).digest('hex');
      if (localMd5.toLowerCase() !== etag.toLowerCase()) {
        throw new Error(`STORAGE_BACKUP_HASH_MISMATCH_AT_${index}`);
      }
      verifiedEtags++;
    }
    totalCount++;
    totalBytes += size;
    if (totalCount % 25 === 0) process.stdout.write(JSON.stringify({ downloaded: totalCount }) + '\n');
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
process.stdout.write(JSON.stringify({ backupFolder: folder,
  downloadedObjects: totalCount, downloadedBytes: totalBytes,
  verifiedEtags }) + '\n');
