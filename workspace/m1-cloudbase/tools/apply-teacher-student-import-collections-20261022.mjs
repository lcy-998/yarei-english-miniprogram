// Additive, idempotent non-production schema setup for the protected T-02 import flow.
// Refuses environment/cost mismatches, non-empty partial targets, ACL drift and index conflicts.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve('D:/app/workspace/m1-cloudbase');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const tables = [
  { name: 'teacher_student_import_operations', indexes: [
    { name: 'uq_student_import_actor_operation', fields: ['organizationId', 'teacherId', 'operationId'], unique: true },
  ] },
  { name: 'teacher_student_import_rows', indexes: [
    { name: 'uq_student_import_row', fields: ['organizationId', 'teacherId', 'operationId', 'lineNumber'], unique: true },
  ] },
  { name: 'teacher_student_import_commits', indexes: [
    { name: 'uq_student_import_commit', fields: ['organizationId', 'rowOperationId'], unique: true },
  ] },
  { name: 'student_number_reservations', indexes: [
    { name: 'uq_student_number_reservation', fields: ['organizationId', 'studentNumber'], unique: true },
  ] },
];
const expectedEnv = readFileSync(resolve(root, '.env.local'), 'utf8')
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));

function call(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
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
function describeAcl(name) { return api('DescribeDatabaseACL', { EnvId: expectedEnv, CollectionName: name }); }
function describeTable(name) { return api('DescribeTable', { EnvId: expectedEnv, TableName: name }); }
function indexesFor(name) {
  const detail = describeTable(name);
  if (!Array.isArray(detail.Indexes)) throw new Error(`TABLE_INDEX_READ_FAILED_${name}`);
  return detail.Indexes.map(row => ({ name: row.Name, fields: row.Keys?.map(key => key.Name) ?? [],
    directions: row.Keys?.map(key => String(key.Direction)) ?? [],
    unique: row.MgoIsUnique === true || row.Unique === true
      || row.Name === '_id_' && JSON.stringify(row.Keys?.map(key => key.Name) ?? []) === '["_id"]' }));
}
function verify(definition, table) {
  if (!table || describeAcl(definition.name).AclTag !== 'ADMINONLY') throw new Error(`TABLE_OR_ACL_INVALID_${definition.name}`);
  const indexes = indexesFor(definition.name);
  for (const expected of definition.indexes) {
    const actual = indexes.find(item => item.name === expected.name);
    if (!actual || JSON.stringify(actual.fields) !== JSON.stringify(expected.fields)
      || actual.directions.some(direction => direction !== '1') || actual.unique !== expected.unique) {
      throw new Error(`TABLE_INDEX_MISMATCH_${definition.name}`);
    }
  }
  if (typeof table.Count !== 'number' || table.Count < 0) throw new Error(`TABLE_COUNT_UNAVAILABLE_${definition.name}`);
  return { name: definition.name, acl: 'ADMINONLY', count: table.Count,
    indexes: definition.indexes.map(index => index.name) };
}
function verifySafeToApply(definition, table) {
  if (!table) return;
  if (table.Count !== 0 || describeAcl(definition.name).AclTag !== 'ADMINONLY') {
    throw new Error(`PARTIAL_TABLE_UNSAFE_${definition.name}`);
  }
  for (const expected of definition.indexes) {
    const actual = indexesFor(definition.name).find(item => item.name === expected.name);
    if (actual && (JSON.stringify(actual.fields) !== JSON.stringify(expected.fields)
      || actual.directions.some(direction => direction !== '1') || actual.unique !== expected.unique)) {
      throw new Error(`TABLE_INDEX_MISMATCH_${definition.name}`);
    }
  }
}
async function waitForTable(name) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const row = listTables().Tables.find(item => item.TableName === name);
    if (row) return row;
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  throw new Error(`TABLE_NOT_VISIBLE_${name}`);
}

const before = listTables();
const beforeByName = new Map(before.Tables.map(row => [row.TableName, row]));
const present = tables.filter(table => beforeByName.has(table.name));
if (mode === 'inspect' || mode === 'apply') {
  for (const definition of present) verifySafeToApply(definition, beforeByName.get(definition.name));
  const quota = api('DescribeQuotaData', { EnvId: expectedEnv, MetricName: 'DbWritepkg' });
  if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('DB_QUOTA_GATE');
  if (mode === 'inspect') {
    process.stdout.write(JSON.stringify({ status: present.length === 0 ? 'ready' : 'resume-ready',
      targetCollectionsPresent: present.length, targetCollectionsRemaining: tables.length - present.length,
      writeQuotaMetric: quota.Value, overrunBilling: false, access: 'ADMINONLY' }) + '\n');
    process.exit(0);
  }
}

if (mode === 'apply') {
  for (const definition of tables) {
    let table = listTables().Tables.find(item => item.TableName === definition.name);
    if (!table) {
      api('CreateTable', { EnvId: expectedEnv, TableName: definition.name,
        PermissionInfo: { AclTag: 'ADMINONLY', EnvId: expectedEnv } });
      table = await waitForTable(definition.name);
    }
    if (describeAcl(definition.name).AclTag !== 'ADMINONLY') throw new Error(`TABLE_ACL_MISMATCH_${definition.name}`);
    for (const index of definition.indexes) {
      const actual = indexesFor(definition.name).find(item => item.name === index.name);
      if (actual) {
        if (JSON.stringify(actual.fields) !== JSON.stringify(index.fields)
          || actual.directions.some(direction => direction !== '1') || actual.unique !== index.unique) {
          throw new Error(`TABLE_INDEX_MISMATCH_${definition.name}`);
        }
        continue;
      }
      api('UpdateTable', { EnvId: expectedEnv, TableName: definition.name, CreateIndexes: [{
        IndexName: index.name, MgoKeySchema: { MgoIndexKeys: index.fields.map(name => ({ Name: name, Direction: '1' })),
          MgoIsUnique: index.unique },
      }] });
    }
  }
}

const after = listTables();
const results = tables.map(table => verify(table, after.Tables.find(row => row.TableName === table.name)));
process.stdout.write(JSON.stringify({ status: mode === 'apply' ? 'applied' : 'verified',
  collections: results, allClientAccessAdminOnly: results.every(row => row.acl === 'ADMINONLY') }) + '\n');
