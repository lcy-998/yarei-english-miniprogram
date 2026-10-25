/** Read-only inventory for two similarly named student books. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const envLine = readFileSync(resolve(root, '.env.local'), 'utf8')
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice('TCB_ENV_ID='.length).trim();
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const raw = execFileSync(process.execPath, [cli, 'secrets', 'get', '--json'], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
  maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
const credentials = JSON.parse(raw.slice(raw.indexOf('{'))).data;
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const require = createRequire(resolve(root, 'package.json'));
const app = require('@cloudbase/js-sdk').init({ env: envId,
  secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token });
const ids = ['res_m3_real_sbc0008_reading_20260930', 'res_m3_sbc0008_review_draft_20261002'];
const output = [];
for (const id of ids) {
  const response = await app.database().collection('learning_resources').doc(id).get();
  const rows = Array.isArray(response?.data) ? response.data : response?.data?.list ?? [response?.data];
  const document = rows.find(item => item?._id === id);
  if (!document) throw new Error('READING_RESOURCE_NOT_FOUND');
  const payload = document.payload ?? {};
  const chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
  output.push({ id, title: document.title, status: document.status,
    version: document.version, contentVersion: document.contentVersion,
    pageCount: chapters.reduce((sum, chapter) => sum + (chapter.pages?.length ?? 0), 0),
    approvedAudio: payload.readingAudio?.reviewStatus === 'approved',
    mappedSentences: payload.readingAudio?.chapters?.flatMap(chapter => chapter.segments ?? []).length ?? 0 });
}
process.stdout.write(JSON.stringify(output) + '\n');
await new Promise(resolve => setTimeout(resolve, 1000));
process.exit(0);
