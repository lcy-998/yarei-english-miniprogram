// Additive, idempotent M3 native-admin schema operation. Never drops data or collections.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve('D:/app/workspace/m1-cloudbase');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const tables = [
  { name: 'native_admin_grants', indexes: [
    { name: 'uq_native_grant_org_teacher', fields: ['organizationId', 'teacherId'], unique: true },
    { name: 'idx_native_grant_org_status', fields: ['organizationId', 'status'], unique: false },
  ] },
  { name: 'native_admin_operations', indexes: [
    { name: 'uq_native_operation_actor_id', fields: ['organizationId', 'actorId', 'operationId'], unique: true },
  ] },
  { name: 'native_admin_management_operations', indexes: [
    { name: '_id_', fields: ['_id'], unique: true },
    { name: 'idx_native_management_actor', fields: ['organizationId', 'actorUserId', 'operationId'], unique: false },
  ] },
  { name: 'native_admin_content_operations', indexes: [
    { name: '_id_', fields: ['_id'], unique: true },
    { name: 'idx_native_content_actor', fields: ['organizationId', 'actorUserId', 'operationId'], unique: false },
  ] },
  { name: 'teacher_media_records', indexes: [
    { name: '_id_', fields: ['_id'], unique: true },
    { name: 'idx_teacher_media_owner_status', fields: ['organizationId', 'ownerTeacherId', 'status'], unique: false },
  ] },
  { name: 'teacher_media_operations', indexes: [
    { name: '_id_', fields: ['_id'], unique: true },
  ] },
];
const expectedEnv = readFileSync(resolve(root, '.env.local'), 'utf8')
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));

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
if (!expectedEnv || config.envId !== expectedEnv || !Array.isArray(environments)
  || environments.length !== 1 || environments[0].EnvId !== expectedEnv
  || environments[0].Status !== 'NORMAL' || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('ENVIRONMENT_OR_COST_GATE');

function listTables() {
  const data = api('DescribeTables', { EnvId: expectedEnv, MgoLimit: 100, MgoOffset: 0 });
  if (!Array.isArray(data.Tables) || !Number.isSafeInteger(data.Pager?.Total) || data.Pager.Total > 100) {
    throw new Error('TABLE_LIST_INCOMPLETE');
  }
  return data;
}
function describeAcl(name) {
  return api('DescribeDatabaseACL', { EnvId: expectedEnv, CollectionName: name });
}
function describeTable(name) {
  return api('DescribeTable', { EnvId: expectedEnv, TableName: name });
}
function normalizedIndexes(detail) {
  if (!Array.isArray(detail.Indexes)) throw new Error('TABLE_INDEX_READ_FAILED');
  return detail.Indexes.map(row => ({ name: row.Name,
    fields: row.Keys?.map(key => key.Name) ?? [],
    directions: row.Keys?.map(key => String(key.Direction)) ?? [],
    unique: row.MgoIsUnique === true || row.Unique === true
      || row.Name === '_id_' && JSON.stringify(row.Keys?.map(key => key.Name) ?? []) === JSON.stringify(['_id']) }));
}
function verifyTable(definition, row) {
  if (!row) throw new Error(`TABLE_MISSING_${definition.name}`);
  const acl = describeAcl(definition.name);
  const detail = describeTable(definition.name);
  if (acl.AclTag !== 'ADMINONLY') throw new Error(`TABLE_ACL_MISMATCH_${definition.name}`);
  const indexes = normalizedIndexes(detail);
  for (const expected of definition.indexes) {
    const actual = indexes.find(index => index.name === expected.name);
    if (!actual || JSON.stringify(actual.fields) !== JSON.stringify(expected.fields)
      || actual.directions.some(direction => direction !== '1') || actual.unique !== expected.unique) {
      throw new Error(`TABLE_INDEX_MISMATCH_${definition.name}`);
    }
  }
  if (typeof row.Count === 'number' && row.Count !== 0) throw new Error(`TABLE_NOT_EMPTY_${definition.name}`);
  return { name: definition.name, acl: acl.AclTag, indexCount: indexes.length,
    empty: row.Count === 0 };
}
function verifySafeToContinue(definition, row) {
  if (!row) return;
  const acl = describeAcl(definition.name);
  const indexes = normalizedIndexes(describeTable(definition.name));
  if (acl.AclTag !== 'ADMINONLY' || row.Count !== 0) {
    throw new Error(`PARTIAL_TABLE_UNSAFE_${definition.name}`);
  }
  for (const expected of definition.indexes) {
    const actual = indexes.find(index => index.name === expected.name);
    if (actual && (JSON.stringify(actual.fields) !== JSON.stringify(expected.fields)
      || actual.directions.some(direction => direction !== '1') || actual.unique !== expected.unique)) {
      throw new Error(`TABLE_INDEX_MISMATCH_${definition.name}`);
    }
  }
}
async function waitForTable(name) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const found = listTables().Tables.find(row => row.TableName === name);
    if (found) return found;
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  throw new Error(`TABLE_NOT_VISIBLE_${name}`);
}

const before = listTables();
const beforeByName = new Map(before.Tables.map(row => [row.TableName, row]));
const present = tables.filter(table => beforeByName.has(table.name));
if (mode === 'inspect') {
  for (const table of present) verifySafeToContinue(table, beforeByName.get(table.name));
  const quota = api('DescribeQuotaData', { EnvId: expectedEnv, MetricName: 'DbWritepkg' });
  if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('DB_QUOTA_GATE');
  process.stdout.write(JSON.stringify({ status: present.length === 0 ? 'ready' : 'resume-ready',
    existingTables: before.Pager.Total, existingTargetTables: present.length,
    newTablesRemaining: tables.length - present.length,
    manifestIndexes: tables.reduce((sum, table) => sum + table.indexes.length, 0),
    customIndexesToCreate: tables.flatMap(table => table.indexes)
      .filter(index => index.name !== '_id_').length,
    access: 'ADMINONLY', dbWriteQuotaMetric: quota.Value, overrunBilling: false }) + '\n');
  process.exit(0);
}

// Partial state is resumable only when every present target is empty, protected, and nonconflicting.
if (mode === 'apply') {
  for (const table of present) verifySafeToContinue(table, beforeByName.get(table.name));
  const quota = api('DescribeQuotaData', { EnvId: expectedEnv, MetricName: 'DbWritepkg' });
  if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('DB_QUOTA_GATE');
}

if (mode === 'apply') {
  for (const definition of tables) {
    let row = listTables().Tables.find(item => item.TableName === definition.name);
    if (!row) {
      api('CreateTable', { EnvId: expectedEnv, TableName: definition.name,
        PermissionInfo: { AclTag: 'ADMINONLY', EnvId: expectedEnv } });
      row = await waitForTable(definition.name);
      if (describeAcl(definition.name).AclTag !== 'ADMINONLY') {
        throw new Error(`TABLE_ACL_MISMATCH_${definition.name}`);
      }
    }
    let actualIndexes = normalizedIndexes(describeTable(definition.name));
    for (const index of definition.indexes) {
      if (index.name === '_id_') {
        if (!actualIndexes.some(item => item.name === '_id_' && item.unique
          && JSON.stringify(item.fields) === JSON.stringify(['_id']))) {
          throw new Error(`DEFAULT_ID_INDEX_MISSING_${definition.name}`);
        }
        continue;
      }
      const existing = actualIndexes.find(item => item.name === index.name);
      if (existing) {
        if (JSON.stringify(existing.fields) !== JSON.stringify(index.fields)
          || existing.directions.some(direction => direction !== '1')
          || existing.unique !== index.unique) throw new Error(`TABLE_INDEX_MISMATCH_${definition.name}`);
        continue;
      }
      api('UpdateTable', { EnvId: expectedEnv, TableName: definition.name,
        CreateIndexes: [{ IndexName: index.name, MgoKeySchema: {
          MgoIndexKeys: index.fields.map(name => ({ Name: name, Direction: '1' })),
          MgoIsUnique: index.unique,
        } }] });
      actualIndexes = normalizedIndexes(describeTable(definition.name));
      if (!actualIndexes.some(item => item.name === index.name)) throw new Error(`TABLE_INDEX_NOT_VISIBLE_${definition.name}`);
    }
  }
}

const after = listTables();
const results = tables.map(table => verifyTable(table,
  after.Tables.find(row => row.TableName === table.name)));
process.stdout.write(JSON.stringify({ status: mode === 'apply' ? 'applied' : 'verified',
  existingTablesPreserved: before.Pager.Total, collections: results,
  totalIndexes: results.reduce((sum, result) => sum + result.indexCount, 0), allEmpty: results.every(result => result.empty) }) + '\n');
