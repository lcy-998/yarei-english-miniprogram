// Read-only inventory, reversible nonproduction downlisting, and readback for 3–10 question rule.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const sourceIds = [4, 5, 6, 8, 9, 10, 11, 12, 13]
  .map(number => `res_voa_lle1_l${number}_listening_formal_v1`)
  .concat('res_pep4a_u1_project_listening_2q_v1_20261015');
const projectionId = id => `public_media_${createHash('sha256')
  .update(JSON.stringify([id, 'org_isolation_secondary'])).digest('hex').slice(0, 40)}`;
const auditId = id => `audit_listening_range_20261016_${id}`;
const backupPath = join(root, '.runtime/listening-range-20261016/backup-before-downlist.json');
const one = result => Array.isArray(result?.data) ? result.data[0] ?? null : result?.data ?? null;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const payload = JSON.parse(raw.slice(at));
  if (payload.error) throw new Error('CLOUD_API_ERROR');
  return payload.data;
}

const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const configuredEnvId = (await readFile(join(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
const environments = cliData(['env', 'list', '--json']);
if (!configuredEnvId || configuredEnvId !== config.envId || environments.length !== 1
  || environments[0].EnvId !== configuredEnvId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no' || environments[0].EnableOverrun !== false
  || environments[0].UsageStatus !== 'normal') throw new Error('NONPRODUCTION_COST_GATE');
const quota = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: configuredEnvId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('WRITE_QUOTA_GATE');
const token = cliData(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== configuredEnvId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const app = require('@cloudbase/node-sdk').init({ env: configuredEnvId,
  secretId: token.secretId, secretKey: token.secretKey, sessionToken: token.token });
const db = app.database();
const get = async (collection, id) => one(await db.collection(collection).doc(id).get().catch(() => null));
const rows = [];
for (const id of sourceIds) {
  const [source, projection, audit] = await Promise.all([
    get('learning_resources', id), get('learning_resources', projectionId(id)),
    get('operation_logs', auditId(id)),
  ]);
  const sourceCount = source?.payload?.teacherMedia?.questions?.length;
  const projectionCount = projection?.payload?.teacherMedia?.questions?.length;
  if (!source || !projection || source.type !== 'listening' || projection.type !== 'listening'
    || source.organizationId !== 'org_qihang_demo'
    || projection.organizationId !== 'org_isolation_secondary'
    || projection.payload?.assetLibrary?.sourcePublicId !== id
    || source.testOnly === true || projection.testOnly === true
    || sourceCount !== projectionCount || !Number.isInteger(sourceCount)
    || sourceCount >= 3 && sourceCount <= 10
    || !Number.isSafeInteger(source.version) || !Number.isSafeInteger(projection.version)
    || source.deletedAt !== null || projection.deletedAt !== null) {
    throw new Error(`RESOURCE_SCOPE_OR_QUESTION_COUNT_GATE:${id}`);
  }
  const pending = source.status === 'published' && projection.status === 'published' && !audit;
  const done = source.status === 'offline' && projection.status === 'offline'
    && audit?.result === 'succeeded';
  if (!pending && !done) throw new Error(`MIXED_RECONCILIATION_STATE:${id}`);
  rows.push({ id, source, projection, audit, questionCount: sourceCount, pending, done });
}
const tasks = (await db.collection('tasks').limit(1000).get()).data;
if (tasks.length >= 1000) throw new Error('TASK_AUDIT_LIMIT');
const taskSnapshots = tasks.filter(task => task.deletedAt === null
  && task.visibility !== 'recycled' && task.status !== 'withdrawn'
  && (task.itemRefs?.some(ref => sourceIds.includes(ref.resourceId))
    || task.items?.some(item => sourceIds.includes(item.resourceId)
      || sourceIds.includes(item.resourceSnapshot?.id))));
const taskHashes = Object.fromEntries(taskSnapshots.map(task => [task._id, sha(task)]));
let postApplyTaskRowChanges = 0;
if (mode === 'verify') {
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  if (backup.environment !== 'verified_nonproduction'
    || JSON.stringify(backup.sourceIds) !== JSON.stringify(sourceIds)) {
    throw new Error('BACKUP_SCOPE_MISMATCH');
  }
  const changedTaskIds = [...new Set([
    ...Object.keys(backup.taskHashes), ...Object.keys(taskHashes),
  ])].filter(id => backup.taskHashes[id] !== taskHashes[id]);
  postApplyTaskRowChanges = changedTaskIds.length;
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    uniqueNoncompliantSources: rows.length, publishedPairs: rows.filter(row => row.pending).length,
    alreadyDownlistedPairs: rows.filter(row => row.done).length,
    questionCounts: rows.map(row => ({ id: row.id, count: row.questionCount })),
    activeTaskSnapshots: taskSnapshots.length, writeQuotaUsed: quota.Value, cloudWrites: 0 }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  await mkdir(dirname(backupPath), { recursive: true });
  const backup = { schemaVersion: 1, environment: 'verified_nonproduction',
    createdAt: new Date().toISOString(), sourceIds, rows: rows.map(row => ({
      id: row.id, source: row.source, projection: row.projection })), taskHashes };
  await writeFile(backupPath, JSON.stringify(backup, null, 2) + '\n', { flag: 'wx' });
  for (const row of rows.filter(item => item.pending)) {
    const now = new Date().toISOString();
    await db.runTransaction(async tx => {
      const current = await tx.collection('learning_resources').doc(row.id).get();
      const projected = await tx.collection('learning_resources').doc(projectionId(row.id)).get();
      const audit = await tx.collection('operation_logs').doc(auditId(row.id)).get().catch(() => null);
      const source = one(current);
      const projection = one(projected);
      if (source?.version !== row.source.version || projection?.version !== row.projection.version
        || source.status !== 'published' || projection.status !== 'published' || one(audit)) {
        throw new Error(`VERSION_CONFLICT:${row.id}`);
      }
      const { _id: ignoredSource, ...sourceFields } = source;
      const { _id: ignoredProjection, ...projectionFields } = projection;
      void ignoredSource; void ignoredProjection;
      const withOffline = (fields, currentRow) => ({ ...fields, status: 'offline',
        version: currentRow.version + 1, updatedAt: now,
        payload: { ...currentRow.payload, teacherMedia: {
          ...currentRow.payload.teacherMedia, status: 'offline',
          unpublishReason: '听力题量不符合现行 3—10 题要求；待新版本逐题审核',
        } },
      });
      await tx.collection('learning_resources').doc(row.id).set(withOffline(sourceFields, source));
      await tx.collection('learning_resources').doc(projectionId(row.id))
        .set(withOffline(projectionFields, projection));
      await tx.collection('operation_logs').doc(auditId(row.id)).set({
        organizationId: 'org_qihang_demo', schemaVersion: 1, version: 1, deletedAt: null,
        requestId: auditId(row.id), actorUserId: 'codex_listening_range_20261016',
        actorRole: 'system', action: 'asset_library.listening_question_range_offline',
        targetType: 'learning_resource', targetId: row.id,
        result: 'succeeded', occurredAt: now,
        metadata: { questionCount: row.questionCount, minimum: 3, maximum: 10,
          projectionId: projectionId(row.id), mediaDeleted: false,
          taskChanged: false, activeTaskSnapshots: taskSnapshots.length },
      });
    });
  }
}
const latest = await Promise.all(rows.map(async row => ({
  source: await get('learning_resources', row.id),
  projection: await get('learning_resources', projectionId(row.id)),
  audit: await get('operation_logs', auditId(row.id)),
})));
if (latest.some(item => item.source?.status !== 'offline'
  || item.projection?.status !== 'offline'
  || item.source?.payload?.teacherMedia?.status !== 'offline'
  || item.projection?.payload?.teacherMedia?.status !== 'offline'
  || item.audit?.result !== 'succeeded')) throw new Error('READBACK_FAILED');
for (const [taskId, expectedSha] of Object.entries(taskHashes)) {
  const task = await get('tasks', taskId);
  if (!task || sha(task) !== expectedSha) throw new Error(`HISTORICAL_TASK_CHANGED:${taskId}`);
}
process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
  offlineSources: latest.length, offlineProjections: latest.length,
  auditRecords: latest.length, activeTaskRowsUnchangedSinceApply:
    taskSnapshots.length - postApplyTaskRowChanges,
  postApplyTaskRowChanges,
  cloudWrites: mode === 'apply' ? rows.filter(row => row.pending).length * 3 : 0,
  backupPath: mode === 'apply' ? backupPath : undefined }) + '\n');
