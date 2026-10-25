import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(backend, 'package.json'));
const envId = 'cloud1-d8ggzrwwedb786e41';
const receipt = JSON.parse(await readFile('G:/英语资产/reports/pep-chapter-audio-private-staging-2026-10-15.json', 'utf8'));
if (receipt.environment !== envId || receipt.fileCount !== 39) throw new Error('STAGING_RECEIPT_GATE');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const raw = execFileSync(process.execPath, [cli, 'secrets', 'get', '--json'], {
  cwd: backend, encoding: 'utf8', windowsHide: true, timeout: 30000,
});
const token = JSON.parse(raw.slice(raw.indexOf('{'))).data;
if (token?.isTemporary !== true || token.envId !== envId) throw new Error('CREDENTIAL_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token });
const chosen = [receipt.files[0], receipt.files.at(-1)];
const signed = await app.getTempFileURL({ fileList: chosen.map(file => ({ fileID: file.fileID, maxAge: 60 })) });
const urls = new Map(signed.fileList?.map(file => [file.fileID, file]));
let verified = 0;
for (const file of chosen) {
  const url = urls.get(file.fileID)?.tempFileURL;
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('SIGNED_URL_GATE');
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error('SIGNED_FETCH_GATE');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error('SIGNED_AUDIO_HASH_GATE');
  }
  verified += 1;
}
process.stdout.write(JSON.stringify({ environment: envId, signedUrls: chosen.length,
  fetchedHashes: verified, playbackTransportReady: true }) + '\n');
