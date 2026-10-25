// Read-only, redacted final-state check for A-06 and A-08 nonproduction audit targets.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envId = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!envId || envId !== config.envId || envId !== 'cloud1-d8ggzrwwedb786e41') {
  throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');
}
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
const organizationId = 'org_qihang_demo';

async function auditTargets(action, kind) {
  const filter = { organizationId, action, targetType: 'learning_resource',
    result: 'succeeded', deletedAt: null };
  const [countResult, logResult] = await Promise.all([
    database.collection('operation_logs').where(filter).count(),
    database.collection('operation_logs').where(filter).limit(100).get(),
  ]);
  const expectedCount = Number(countResult.total ?? countResult.count);
  const logs = Array.isArray(logResult.data) ? logResult.data : [];
  if (!Number.isSafeInteger(expectedCount) || expectedCount !== logs.length) {
    throw new Error(`AUDIT_SET_INCOMPLETE:${kind}`);
  }
  const targetIds = [...new Set(logs.map(row => row.targetId).filter(id => typeof id === 'string'))];
  const targets = await Promise.all(targetIds.map(async id => {
    const response = await database.collection('learning_resources').doc(id).get();
    const rows = Array.isArray(response.data) ? response.data : [response.data];
    const row = rows.find(item => item?._id === id && item.organizationId === organizationId
      && item.deletedAt === null);
    if (!row) return { found: false };
    const media = row.payload?.teacherMedia && typeof row.payload.teacherMedia === 'object'
      ? row.payload.teacherMedia : null;
    return { found: true, resourceStatus: row.status ?? null,
      teacherMediaStatus: media?.status ?? null,
      unpublishReasonPresent: typeof media?.unpublishReason === 'string' && media.unpublishReason.trim().length > 0 };
  }));
  if (targets.some(row => !row.found)) throw new Error(`AUDIT_RESOURCE_MISSING:${kind}`);
  const targetsById = new Map(targetIds.map((id, index) => [id, targets[index]]));
  return { auditCount: logs.length, targetCount: targetIds.length,
    allHaveReasonEvidence: logs.every(log => kind === 'issue'
      ? typeof log.metadata?.issueReason === 'string' && log.metadata.issueReason.trim().length > 0
      : log.metadata?.reasonProvided === true),
    resourceStatuses: countBy(targets, row => row.resourceStatus),
    mediaStatuses: kind === 'question' ? {} : countBy(targets, row => row.teacherMediaStatus),
    allUnpublishedTargetsHaveReason: kind !== 'unpublish'
      || targets.every(row => row.resourceStatus === 'offline' && row.teacherMediaStatus === 'offline'
        && row.unpublishReasonPresent),
    allAuditTargetsResolved: logs.every(log => targetsById.has(log.targetId)) };
}

function countBy(rows, select) {
  const counts = {};
  for (const row of rows) {
    const value = select(row);
    const key = typeof value === 'string' ? value : 'missing';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const [questions, mediaUnpublish, mediaIssues] = await Promise.all([
  auditTargets('native_admin.question.status_changed', 'question'),
  auditTargets('asset_library.media.unpublish', 'unpublish'),
  auditTargets('asset_library.media.issue', 'issue'),
]);
process.stdout.write(JSON.stringify({ environment: 'verified_nonproduction',
  questions, mediaUnpublish, mediaIssues, rawIdentifiersPrinted: false }) + '\n');
