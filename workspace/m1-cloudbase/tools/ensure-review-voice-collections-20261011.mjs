// Additive, idempotent nonproduction repair for the two T-08 voice-comment collections.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envId = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!envId || envId !== config.envId || envId !== 'cloud1-d8ggzrwwedb786e41') {
  throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');
}
const definitions = [
  { name: 'review_voice_drafts', index: { name: 'idx_review_voice_submission',
    fields: ['organizationId', 'teacherId', 'submissionId'] } },
  { name: 'review_voice_operations', index: null },
];
function call(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLOUD_JSON_UNAVAILABLE');
  const result = JSON.parse(raw.slice(first));
  if (result.error) throw new Error(`CLOUD_API_${result.error.code ?? 'FAILED'}`);
  return result.data;
}
const api = (action, body) => call(['api', 'tcb', action, '--api-version', '2018-06-08',
  '--body', JSON.stringify(body), '--json']);
const environments = call(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE');
}
const quota = api('DescribeQuotaData', { EnvId: envId, MetricName: 'DbWritepkg' });
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('DB_QUOTA_GATE');
function tables() {
  const value = api('DescribeTables', { EnvId: envId, MgoLimit: 100, MgoOffset: 0 });
  if (!Array.isArray(value.Tables) || !Number.isSafeInteger(value.Pager?.Total)
    || value.Pager.Total > 100) throw new Error('TABLE_LIST_INCOMPLETE');
  return value.Tables;
}
function verify(definition, row, requireComplete) {
  if (!row) return { name: definition.name, exists: false };
  const acl = api('DescribeDatabaseACL', { EnvId: envId, CollectionName: definition.name });
  const detail = api('DescribeTable', { EnvId: envId, TableName: definition.name });
  const indexes = detail.Indexes ?? [];
  const id = indexes.find(index => index.Name === '_id_');
  if (acl.AclTag !== 'ADMINONLY' || !Number.isSafeInteger(row.Count) || row.Count < 0
    || !id || JSON.stringify(id.Keys?.map(key => key.Name)) !== JSON.stringify(['_id'])) {
    throw new Error(`COLLECTION_PROTECTION_MISMATCH_${definition.name}`);
  }
  const expected = definition.index;
  const actual = expected ? indexes.find(index => index.Name === expected.name) : null;
  if (actual && (JSON.stringify(actual.Keys?.map(key => key.Name)) !== JSON.stringify(expected.fields)
    || actual.Keys?.some(key => String(key.Direction) !== '1')
    || actual.MgoIsUnique === true || actual.Unique === true)) {
    throw new Error(`COLLECTION_INDEX_MISMATCH_${definition.name}`);
  }
  if (requireComplete && expected && !actual) throw new Error(`COLLECTION_INDEX_MISSING_${definition.name}`);
  return { name: definition.name, exists: true, acl: 'ADMINONLY', empty: row.Count === 0,
    documentCount: row.Count,
    defaultIdIndex: true, submissionIndex: Boolean(actual) };
}
const before = tables();
const inspected = definitions.map(definition => verify(definition,
  before.find(row => row.TableName === definition.name), false));
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    collections: inspected, dbWriteQuotaMetric: quota.Value, overrunBilling: false }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  for (const definition of definitions) {
    let row = tables().find(item => item.TableName === definition.name);
    if (!row) {
      api('CreateTable', { EnvId: envId, TableName: definition.name,
        PermissionInfo: { AclTag: 'ADMINONLY', EnvId: envId } });
      for (let attempt = 0; !row && attempt < 12; attempt++) {
        await new Promise(resolveWait => setTimeout(resolveWait, 1000));
        row = tables().find(item => item.TableName === definition.name);
      }
      if (!row) throw new Error(`COLLECTION_NOT_VISIBLE_${definition.name}`);
    }
    const state = verify(definition, row, false);
    if (!state.empty && definition.index && !state.submissionIndex) {
      throw new Error(`COLLECTION_NOT_EMPTY_FOR_INDEX_${definition.name}`);
    }
    if (definition.index && !state.submissionIndex) {
      api('UpdateTable', { EnvId: envId, TableName: definition.name,
        CreateIndexes: [{ IndexName: definition.index.name, MgoKeySchema: {
          MgoIndexKeys: definition.index.fields.map(name => ({ Name: name, Direction: '1' })),
          MgoIsUnique: false,
        } }] });
    }
  }
}
const after = tables();
const verified = definitions.map(definition => verify(definition,
  after.find(row => row.TableName === definition.name), true));
if (verified.some(item => !item.exists)) throw new Error('COLLECTION_REPAIR_INCOMPLETE');
process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
  collections: verified, originalTableCount: before.length, finalTableCount: after.length,
  overrunBilling: false, rollback: 'preserve_protected_collections_and_audit' }) + '\n');
