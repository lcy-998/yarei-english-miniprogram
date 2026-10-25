// Read-only preflight for the teacher-owned video rollout. No credentials are printed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const localEnv = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!localEnv || localEnv !== config.envId) throw new Error('TARGET_ENVIRONMENT_MISMATCH');

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
const environment = Array.isArray(environments)
  ? environments.find(row => row.EnvId === localEnv) : null;
if (!environment || environment.Status !== 'NORMAL') throw new Error('ENVIRONMENT_NOT_NORMAL');
const tables = api('DescribeTables', { EnvId: localEnv, MgoLimit: 100, MgoOffset: 0 });
if (!Array.isArray(tables.Tables) || !Number.isSafeInteger(tables.Pager?.Total)
  || tables.Pager.Total > 100) throw new Error('COLLECTION_INVENTORY_INCOMPLETE');
const functions = call(['fn', 'list', '--limit', '100', '--json']);
if (!Array.isArray(functions?.Functions) || !Number.isSafeInteger(functions.TotalCount)
  || functions.TotalCount !== functions.Functions.length) throw new Error('FUNCTION_INVENTORY_INCOMPLETE');
const collection = tables.Tables.find(row => row.TableName === 'teacher_private_videos');
const acl = collection ? api('DescribeDatabaseACL', {
  EnvId: localEnv, CollectionName: 'teacher_private_videos',
}) : null;
const detail = collection ? api('DescribeTable', {
  EnvId: localEnv, TableName: 'teacher_private_videos',
}) : null;
const ownerIndex = detail?.Indexes?.find(index => index.Name === 'idx_teacher_private_video_owner');
const taskCommand = functions.Functions.find(row => row.FunctionName === 'task-command');
const taskCommandDetail = taskCommand ? call(['fn', 'detail', 'task-command', '--json']) : null;
const worker = functions.Functions.find(row => row.FunctionName === 'teacher-private-video-worker');
const report = {
  environment: localEnv,
  status: environment.Status,
  packageName: environment.PackageName,
  paid: environment.EnvPaid,
  charged: environment.EnvCharged,
  overrunEnabled: environment.EnableOverrun,
  functionCount: functions.TotalCount,
  collectionCount: tables.Pager.Total,
  taskCommandActive: taskCommand?.Status === 'Active',
  taskCommandMemoryMb: taskCommandDetail?.MemorySize ?? null,
  taskCommandTimeoutSeconds: taskCommandDetail?.Timeout ?? null,
  workerPresent: Boolean(worker),
  workerActive: worker?.Status === 'Active',
  privateCollectionPresent: Boolean(collection),
  privateCollectionCount: collection?.Count ?? null,
  privateCollectionAdminOnly: acl?.AclTag === 'ADMINONLY',
  privateOwnerIndexPresent: Boolean(ownerIndex),
  functionSlotAvailableAtDefaultQuota: functions.TotalCount < 50,
  directUploadInfrastructureReady: Boolean(collection && acl?.AclTag === 'ADMINONLY'
    && ownerIndex && taskCommand?.Status === 'Active'
    && taskCommandDetail?.MemorySize >= 1024 && taskCommandDetail?.Timeout >= 120),
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
