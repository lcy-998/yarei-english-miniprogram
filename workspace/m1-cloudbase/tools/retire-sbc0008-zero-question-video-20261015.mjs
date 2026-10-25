// Stop new references to the zero-question storybook video after the reviewed five-question version.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const oldId = 'res_launch_sbc0008_video_credited_v1_20261012';
const nextId = 'res_sbc0008_video_5q_v1_20261015';
const projection = id => `public_media_${createHash('sha256')
  .update(JSON.stringify([id, 'org_isolation_secondary'])).digest('hex').slice(0, 40)}`;
function call(args) {
  const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const value = JSON.parse(raw.slice(at));
  if (value.error) throw new Error('CLOUD_API_ERROR');
  return value.data;
}
const cfg = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const line = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(item => item.startsWith('TCB_ENV_ID='));
const envId = line?.slice(11).trim();
const envs = call(['env', 'list', '--json']);
if (envId !== 'cloud1-d8ggzrwwedb786e41' || envId !== cfg.envId
  || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no'
  || envs[0].EnableOverrun !== false) throw new Error('NONPRODUCTION_COST_GATE');
const quota = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('QUOTA_GATE');
const token = call(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: token.secretId, secretKey: token.secretKey, sessionToken: token.token });
const db = app.database();
const one = result => Array.isArray(result?.data) ? result.data[0] ?? null : result?.data ?? null;
const get = async (collection, id) => one(await db.collection(collection).doc(id).get().catch(() => null));
const [old, oldProjection, next, nextProjection, audit] = await Promise.all([
  get('learning_resources', oldId), get('learning_resources', projection(oldId)),
  get('learning_resources', nextId), get('learning_resources', projection(nextId)),
  get('operation_logs', `audit_sbc0008_superseded_${oldId}`),
]);
if (!old || !oldProjection || !next || !nextProjection
  || old.organizationId !== 'org_qihang_demo' || next.organizationId !== 'org_qihang_demo'
  || old.type !== 'video' || next.type !== 'video'
  || next.status !== 'published' || nextProjection.status !== 'published'
  || next.testOnly !== false
  || next.payload?.teacherMedia?.questions?.length !== 5
  || next.payload?.teacherMedia?.durationMs !== 28032
  || old.payload?.teacherMedia?.mediaSha256 !== '21a62c71386ec798f11e274efa1e56b6c733d27e60f480beb57c9534b889eb5d'
  || next.payload?.teacherMedia?.mediaSha256 !== '21a62c71386ec798f11e274efa1e56b6c733d27e60f480beb57c9534b889eb5d'
  || oldProjection.payload?.assetLibrary?.sourcePublicId !== oldId
  || nextProjection.payload?.assetLibrary?.sourcePublicId !== nextId
  || old.status !== (mode === 'verify' ? 'offline' : 'published')
  || oldProjection.status !== (mode === 'verify' ? 'offline' : 'published')
  || mode === 'verify' && audit?.result !== 'succeeded'
  || mode !== 'verify' && audit) throw new Error('REPLACEMENT_GATE');
const tasks = await db.collection('tasks').limit(1000).get();
if (!Array.isArray(tasks.data) || tasks.data.length === 1000) throw new Error('TASK_SCAN_INCOMPLETE');
const references = tasks.data.filter(task => task.deletedAt === null && task.visibility !== 'recycled'
  && task.status !== 'withdrawn' && task.itemRefs?.some(ref => ref.resourceId === oldId)).length;
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    sourceVersion: old.version, projectionVersion: oldProjection.version,
    newSourceVisible: true, activeTaskSnapshotsPreserved: references,
    cloudWrites: 0 }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  const auditId = `audit_sbc0008_superseded_${oldId}`;
  const now = new Date().toISOString();
  await db.runTransaction(async tx => {
    const current = one(await tx.collection('learning_resources').doc(oldId).get());
    const projected = one(await tx.collection('learning_resources').doc(projection(oldId)).get());
    if (current?.version !== old.version || projected?.version !== oldProjection.version
      || current.status !== 'published' || projected.status !== 'published') {
      throw new Error('VERSION_CONFLICT');
    }
    const { _id: ignoreSource, ...sourceFields } = current;
    const { _id: ignoreProjection, ...projectionFields } = projected;
    void ignoreSource; void ignoreProjection;
    await tx.collection('learning_resources').doc(oldId).set({ ...sourceFields,
      status: 'offline', version: current.version + 1, updatedAt: now });
    await tx.collection('learning_resources').doc(projection(oldId)).set({ ...projectionFields,
      status: 'offline', version: projected.version + 1, updatedAt: now });
    await tx.collection('operation_logs').doc(auditId).set({
      organizationId: 'org_qihang_demo', schemaVersion: 1, version: 1, deletedAt: null,
      requestId: auditId, actorUserId: 'codex_sbc0008_nonproduction_20261015', actorRole: 'system',
      action: 'asset_library.superseded_video_offline', targetType: 'learning_resource',
      targetId: oldId, result: 'succeeded', occurredAt: now,
      metadata: { replacementId: nextId, activeTaskSnapshotsPreserved: references,
        mediaDeleted: false, taskChanged: false },
    });
  });
}
const [finalOld, finalProjection, finalAudit] = await Promise.all([
  get('learning_resources', oldId), get('learning_resources', projection(oldId)),
  get('operation_logs', `audit_sbc0008_superseded_${oldId}`),
]);
if (finalOld?.status !== 'offline' || finalProjection?.status !== 'offline'
  || finalAudit?.result !== 'succeeded') throw new Error('READBACK_FAILED');
process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
  oldSource: 'offline', oldProjection: 'offline', replacement: nextId,
  activeTaskSnapshotsPreserved: references, deletedMedia: 0,
  cloudWrites: mode === 'apply' ? 3 : 0 }) + '\n');
process.exit(0);
