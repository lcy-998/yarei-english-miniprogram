import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const root = 'G:/英语资产';
const backend = resolve('D:/app/workspace/m1-cloudbase');
const require = createRequire(join(backend, 'package.json'));
const envId = 'cloud1-d8ggzrwwedb786e41';
const names = ['pep3a-u1', 'pep3a-u2', 'pep3a-u3', 'pep3a-u4', 'pep3a-u5', 'pep3a-u6',
  'pep4a-u1', 'pep4a-u2', 'pep4a-u3', 'pep4a-u4', 'pep4a-u5', 'pep4a-u6',
  'pep7a-starter2', 'pep8a-u1-core'];
const receipts = await Promise.all(names.map(async name => JSON.parse(await readFile(
  join(root, `reports/${name}-wordpack-nonproduction-2026-10-17.json`), 'utf8'))));
if (receipts.some((row, index) => row.environment !== envId
  || row.files?.length !== [15, 19, 22, 18, 17, 16, 19, 14, 18, 14, 24, 21, 6, 15][index])) {
  throw new Error('RECEIPT_GATE');
}
const raw = execFileSync(process.execPath,
  ['D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb', 'secrets', 'get', '--json'],
  { cwd: backend, encoding: 'utf8', windowsHide: true, timeout: 30000 });
const token = JSON.parse(raw.slice(raw.indexOf('{'))).data;
if (token?.isTemporary !== true || token.envId !== envId) throw new Error('TOKEN_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token });
const samples = receipts.flatMap(receipt => [receipt.files[0], receipt.files.at(-1)]);
const signed = await app.getTempFileURL({ fileList: samples.map(file => ({ fileID: file.fileID, maxAge: 60 })) });
const urls = new Map(signed.fileList?.map(row => [row.fileID, row.tempFileURL]));
for (const sample of samples) {
  const url = urls.get(sample.fileID);
  if (!url?.startsWith('https://')) throw new Error('SIGNED_URL_GATE');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('AUDIO_FETCH_GATE');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== sample.bytes
    || createHash('sha256').update(bytes).digest('hex') !== sample.sha256) {
    throw new Error('AUDIO_HASH_GATE');
  }
}
process.stdout.write(JSON.stringify({ environment: envId, packs: receipts.length,
  signedAudioSamples: samples.length, verifiedHashes: samples.length }) + '\n');
