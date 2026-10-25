// Use after a controlled nonproduction material import. Complete published teaching assets go global.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const mode = process.argv[2];
if (!['inspect','apply'].includes(mode)) throw new Error('MODE_INVALID');
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(backend, 'package.json'));
const { build } = require('esbuild');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
function call(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: backend,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const result = JSON.parse(raw.slice(at));
  if (result.error) throw new Error('CLOUD_API_ERROR');
  return result.data;
}
const envLine = (await readFile(join(backend, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice(11).trim();
const envs = call(['env', 'list', '--json']);
if (!envId || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no') {
  throw new Error('NONPRODUCTION_COST_GATE');
}
const usage = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(usage.Value) || usage.Value > 190000) throw new Error('QUOTA_GATE');
const temporary = call(['secrets', 'get', '--json']);
if (!temporary?.isTemporary || temporary.envId !== envId
  || Date.parse(temporary.expiredAt) < Date.now() + 60000) throw new Error('CREDENTIAL_GATE');
const sdk = require('@cloudbase/js-sdk');
const app = sdk.init({ env: envId, secretId: temporary.secretId,
  secretKey: temporary.secretKey, sessionToken: temporary.token });
const entry = join(backend, '.runtime/global-material-sync/entry.cjs');
await mkdir(dirname(entry), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-global-asset-audit-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(entry);
const db = api.createCloudBaseDocumentDatabase(app.database());
const organizations = (await db.find('organizations', { status: 'active', deletedAt: null }))
  .map(row => row._id).sort();
if (JSON.stringify(organizations) !== JSON.stringify(['org_isolation_secondary','org_qihang_demo'])) {
  throw new Error('ORGANIZATION_SCOPE_GATE');
}
const service = new api.LegacyGlobalDistributionService(db,
  { nowIso: () => new Date().toISOString() });
if (mode === 'inspect') {
  const pending = [];
  const deferred = [];
  let offset = 0;
  while (offset <= 10000) {
    const page = await db.findPage('learning_resources',
      { status: 'published', deletedAt: null }, { limit: 50, offset });
    for (const row of page.items) {
      const origin = row.payload?.assetLibrary;
      if (row.globalCatalogSource || row.globalCatalogProjection || row.publicCatalogSource
        || row.publicQuestionProjection || row.publicLearningProjection
        || origin?.sourcePublicId !== undefined
        || !['reading','vocabulary','exercise','recording','listening','video','dubbing']
          .includes(String(row.type))) continue;
      try { api.makeLegacyGlobalSource(row); pending.push(row._id); }
      catch { deferred.push(row._id); }
    }
    if (!page.hasMore) break;
    offset += page.items.length;
  }
  process.stdout.write(JSON.stringify({ mode, status: 'ready', pending,
    deferred, cloudWrites: 0, overrunBilling: false }) + '\n');
  process.exit(0);
}
const result = await service.syncPublishedReady(organizations);
process.stdout.write(JSON.stringify({ mode, status: 'completed',
  globallySynced: result.migrated, deferred: result.deferred,
  overrunBilling: false }) + '\n');
await new Promise(resolve => setTimeout(resolve, 500));
process.exit(0);
