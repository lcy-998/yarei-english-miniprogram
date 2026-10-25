// Additive nonproduction setup. Inspect before apply; preserve data on rollback.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const envId = 'cloud1-d8ggzrwwedb786e41';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const local = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (local !== envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');

function call(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_UNAVAILABLE');
  const response = JSON.parse(raw.slice(at));
  if (response.error) throw new Error(`CLOUD_API_${response.error.code ?? 'FAILED'}`);
  return response.data;
}
const api = (name, body) => call(['api', 'tcb', name, '--api-version', '2018-06-08',
  '--body', JSON.stringify(body), '--json']);
const env = call(['env', 'list', '--json']);
if (!Array.isArray(env) || env.length !== 1 || env[0].EnvId !== envId
  || env[0].Status !== 'NORMAL' || env[0].PackageName !== '个人版'
  || env[0].EnvPaid !== 'no' || env[0].EnvCharged !== 'no'
  || env[0].EnableOverrun !== false) throw new Error('COST_OR_ENVIRONMENT_GATE');
const quota = api('DescribeQuotaData', { EnvId: envId, MetricName: 'DbWritepkg' });
if (!Number.isFinite(quota.Value) || quota.Value >= 190000) throw new Error('DB_QUOTA_GATE');
const name = 'teacher_private_videos';
const indexName = 'idx_teacher_private_video_owner';
const fields = ['organizationId', 'ownerTeacherId'];
function inspect() {
  const tables = api('DescribeTables', { EnvId: envId, MgoLimit: 100, MgoOffset: 0 });
  if (!Array.isArray(tables.Tables) || tables.Pager?.Total > 100) throw new Error('INVENTORY_INCOMPLETE');
  const row = tables.Tables.find(item => item.TableName === name);
  if (!row) return { exists: false, count: null, protected: false, indexed: false };
  const acl = api('DescribeDatabaseACL', { EnvId: envId, CollectionName: name });
  const detail = api('DescribeTable', { EnvId: envId, TableName: name });
  const index = detail.Indexes?.find(item => item.Name === indexName);
  if (acl.AclTag !== 'ADMINONLY' || !Number.isSafeInteger(row.Count)
    || index && (JSON.stringify(index.Keys?.map(key => key.Name)) !== JSON.stringify(fields)
      || index.Keys?.some(key => String(key.Direction) !== '1'))) {
    throw new Error('COLLECTION_PROTECTION_MISMATCH');
  }
  return { exists: true, count: row.Count, protected: true, indexed: Boolean(index) };
}
const before = inspect();
if (mode === 'apply') {
  if (!before.exists) {
    api('CreateTable', { EnvId: envId, TableName: name,
      PermissionInfo: { AclTag: 'ADMINONLY', EnvId: envId } });
    for (let attempt = 0; attempt < 12 && !inspect().exists; attempt++) {
      await new Promise(resolveWait => setTimeout(resolveWait, 1000));
    }
  }
  const current = inspect();
  if (!current.exists) throw new Error('COLLECTION_NOT_VISIBLE');
  if (!current.indexed) {
    if (current.count !== 0) throw new Error('NONEMPTY_COLLECTION_MISSING_INDEX');
    api('UpdateTable', { EnvId: envId, TableName: name,
      CreateIndexes: [{ IndexName: indexName, MgoKeySchema: {
        MgoIndexKeys: fields.map(field => ({ Name: field, Direction: '1' })),
        MgoIsUnique: false,
      } }] });
  }
}
const after = inspect();
if (mode === 'verify' && (!after.exists || !after.protected || !after.indexed)) {
  throw new Error('COLLECTION_NOT_READY');
}
process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
  before, after, overrunBilling: false }) + '\n');
