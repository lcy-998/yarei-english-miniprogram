// Redacted read-only count gate for finding a safe cross-organization public media test source.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envId = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!envId || envId !== config.envId) throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');
const raw = execFileSync(process.execPath, [cli, 'secrets', 'get', '--json'], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
  maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
const credentials = JSON.parse(raw.slice(raw.indexOf('{'))).data;
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const database = createRequire(resolve(root, 'package.json'))('@cloudbase/node-sdk').init({
  env: envId, secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token,
}).database();
const [publicMedia, publicSources, activeProjections] = await Promise.all([
  database.collection('learning_resources').where({ publicCatalogSource: true,
    type: 'media', status: 'published', deletedAt: null }).count(),
  database.collection('learning_resources').where({ publicCatalogSource: true,
    type: 'media', deletedAt: null }).count(),
  database.collection('learning_resources').where({ publicLearningProjection: true,
    type: 'media', status: 'published', deletedAt: null }).count(),
]);
const value = result => Number(result.total ?? result.count);
const publishedSources = value(publicMedia);
const totalSources = value(publicSources);
const projections = value(activeProjections);
if (![publishedSources, totalSources, projections].every(Number.isSafeInteger)) {
  throw new Error('MEDIA_SOURCE_COUNTS_UNAVAILABLE');
}
process.stdout.write(JSON.stringify({ environment: 'verified_nonproduction',
  publishedPublicMediaSources: publishedSources, allPublicMediaSources: totalSources,
  activePublishedMediaProjections: projections,
  safeCrossOrganizationOfflineTestAvailable: publishedSources > 0 && projections > 0 }) + '\n');
