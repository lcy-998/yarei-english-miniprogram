// Soft-offline superseded acceptance materials in verified nonproduction only.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(backend, 'package.json'));
const hash = text => createHash('sha256').update(text).digest('hex');
const old = [
  { id: 'res_m3_real_sbc0008_reading_20260930', version: 3, replacement: 'res_formal_sbc0008_v1_20261007' },
  { id: 'res_m3_sbc0008_review_draft_20261002', version: 8, replacement: 'res_formal_sbc0008_v1_20261007' },
  { id: 'res_m3_original_feelings_draft_20261003', version: 3, replacement: null },
  { id: 'res_m3_pep3a_u2_real_vocabulary_20261005', version: 6, replacement: 'res_launch_pep3a_u2_vocabulary_v1_20261012' },
  { id: 'res_m3_peter_rabbit_real_question_20261005', version: 3, replacement: 'res_prod_sbc0008_exercise_01_v3' },
  { id: 'res_m3_sbc0008_video_auto_20261005', version: 6, replacement: 'res_launch_sbc0008_video_credited_v1_20261012' },
  { id: 'res_m3_sbc0008_dubbing_auto_20261005', version: 6, replacement: 'res_launch_sbc0008_dubbing_credited_v1_20261012' },
  { id: 'res_m3_sbc0008_real_recording_20261005', version: 4, replacement: 'res_launch_sbc0008_recording_v1_20261012' },
];
function call(args) {
  const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: backend,
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const result = JSON.parse(raw.slice(at));
  if (result.error) throw new Error('CLOUD_API_ERROR');
  return result.data;
}
const cfg = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
const line = (await readFile(join(backend, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(item => item.startsWith('TCB_ENV_ID='));
const envId = line?.slice(11).trim();
const envs = call(['env', 'list', '--json']);
if (!envId || envId !== cfg.envId || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no'
  || envs[0].EnableOverrun !== false) throw new Error('NONPRODUCTION_COST_GATE');
const quota = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('QUOTA_GATE');
const token = call(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const sdk = require('@cloudbase/node-sdk');
const app = sdk.init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token });
const db = app.database();
const get = async (collection, id) => {
  const result = await db.collection(collection).doc(id).get().catch(() => null);
  const data = result?.data;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
};
const one = result => Array.isArray(result?.data)
  ? result.data[0] ?? null : result?.data ?? null;
const rows = await Promise.all(old.map(async entry => {
  const source = await get('learning_resources', entry.id);
  const projectionId = `global_asset_${hash(JSON.stringify([entry.id, 'org_isolation_secondary'])).slice(0, 40)}`;
  const projection = await get('learning_resources', projectionId);
  const replacement = entry.replacement ? await get('learning_resources', entry.replacement) : null;
  const auditId = `audit_launch_superseded_${entry.id}`;
  const audit = await get('operation_logs', auditId);
  if (!source || source.organizationId !== 'org_qihang_demo' || source.deletedAt !== null
    || source.version !== (mode === 'verify' ? entry.version + 1 : entry.version)
    || source.status !== (mode === 'verify' ? 'offline' : 'published')
    || entry.replacement && (!replacement || replacement.status !== 'published'
      || replacement.testOnly !== false || replacement.copyrightStatus !== 'verified')
    || mode === 'verify' && (!audit || audit.result !== 'succeeded')
    || mode !== 'verify' && audit) throw new Error(`SOURCE_GATE_${entry.id}`);
  if (projection && (projection.organizationId !== 'org_isolation_secondary'
    || projection.globalSourceId !== entry.id
    || !Number.isSafeInteger(projection.version) || projection.version < (mode === 'verify' ? 2 : 1)
    || projection.status !== (mode === 'verify' ? 'offline' : 'published'))) {
    throw new Error(`PROJECTION_GATE_${entry.id}_${projection.version}_${projection.status}`);
  }
  return { ...entry, source, projection, projectionId, auditId };
}));
const tasks = await db.collection('tasks').limit(1000).get();
const activeReferences = Object.fromEntries(rows.map(row => [row.id,
  tasks.data.filter(task => task.deletedAt === null && task.visibility !== 'recycled'
    && task.status !== 'withdrawn'
    && (task.itemRefs?.some(item => item.resourceId === row.id)
      || task.items?.some(item => item.resourceId === row.id || item.resourceSnapshot?.id === row.id))).length]));
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    sources: rows.length, activeProjections: rows.filter(row => row.projection).length,
    activeTaskSnapshotsPreserved: activeReferences, deletion: false, cloudWrites: 0 }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  for (const row of rows) {
    const now = new Date().toISOString();
    await db.runTransaction(async tx => {
      const current = one(await tx.collection('learning_resources').doc(row.id).get());
      const projected = row.projection
        ? one(await tx.collection('learning_resources').doc(row.projectionId).get()) : null;
      if (!current || current.version !== row.version || current.status !== 'published'
        || row.projection && (!projected || projected.version !== row.projection.version
          || projected.status !== 'published')) throw new Error(`VERSION_CONFLICT_${row.id}`);
      const { _id: ignoredSource, ...sourceFields } = current;
      void ignoredSource;
      await tx.collection('learning_resources').doc(row.id).set({ ...sourceFields,
        status: 'offline', version: current.version + 1, updatedAt: now });
      if (projected) {
        const { _id: ignoredProjection, ...projectionFields } = projected;
        void ignoredProjection;
        await tx.collection('learning_resources').doc(row.projectionId).set({ ...projectionFields,
          status: 'offline', version: projected.version + 1, updatedAt: now });
      }
      await tx.collection('operation_logs').doc(row.auditId).set({
        organizationId: 'org_qihang_demo', schemaVersion: 1,
        version: 1, deletedAt: null, requestId: row.auditId,
        actorUserId: 'codex_launch_review_20261013', actorRole: 'system',
        action: 'asset_library.superseded_acceptance_offline',
        targetType: 'learning_resource', targetId: row.id, result: 'succeeded',
        occurredAt: now, metadata: { previousVersion: current.version,
          replacementId: row.replacement, projectionId: projected ? row.projectionId : null,
          activeTaskSnapshotsPreserved: activeReferences[row.id], mediaDeleted: false,
          taskChanged: false } });
    });
  }
}
const finalRows = await Promise.all(rows.map(async row => ({
  id: row.id, source: await get('learning_resources', row.id),
  projection: row.projection ? await get('learning_resources', row.projectionId) : null,
  audit: await get('operation_logs', row.auditId),
})));
if (finalRows.some(row => row.source?.status !== 'offline'
  || row.projection && row.projection.status !== 'offline'
  || row.audit?.result !== 'succeeded')) throw new Error('OFFLINE_READBACK_FAILED');
process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
  offlinedSources: finalRows.length,
  offlinedProjections: finalRows.filter(row => row.projection).length,
  activeTaskSnapshotsPreserved: activeReferences,
  deletedMedia: 0, modifiedTasks: 0,
  cloudWrites: mode === 'apply' ? finalRows.length * 2
    + finalRows.filter(row => row.projection).length : 0 }) + '\n');
process.exit(0);
