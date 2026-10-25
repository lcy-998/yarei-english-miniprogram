// Read-only post-deploy projection check for A-01—A-08; never emits private fields.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve('D:/app/workspace/m1-cloudbase');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envLine = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice('TCB_ENV_ID='.length).trim();
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const raw = execFileSync(process.execPath, [cli, 'secrets', 'get', '--json'], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
  maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
const first = raw.indexOf('{');
if (first < 0) throw new Error('TEMPORARY_CREDENTIALS_UNAVAILABLE');
const credentials = JSON.parse(raw.slice(first)).data;
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');

const runtime = resolve(root, '.runtime/m3-native-admin-readonly-audit');
await mkdir(runtime, { recursive: true });
const entry = resolve(runtime, 'entry.cjs');
await build({ entryPoints: [resolve(root, 'src/seed/m3-native-admin-readonly-audit-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const require = createRequire(resolve(root, 'package.json'));
const api = require(entry);
const cloudbase = require('@cloudbase/node-sdk');
const database = api.createCloudBaseDocumentDatabase(cloudbase.init({ env: envId,
  secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token }).database());
const grants = new api.DocumentNativeAdminGrantRepository(database);
const organizationId = 'org_qihang_demo';
const teacherId = 'usr_teacher_demo_01';
const user = await database.get('users', teacherId);
const grant = await grants.findGrant(organizationId, teacherId);
if (!user || !grant || grant.status !== 'active'
  || grant.version !== 1 || user.authorizationVersion !== 7) throw new Error('AUTHORIZED_TEACHER_PRECONDITION');
const actor = { requestId: 'm3_native_admin_projection_audit', sessionId: 'm3_native_admin_projection_audit',
  actorUserId: teacherId, actorRole: 'teacher', organizationId, platformSubjectDigest: 'audit_only',
  permissions: [...grant.permissions], scopeIds: [organizationId], authzVersion: user.authorizationVersion };
const query = new api.NativeAdminQueryService(grants);
const data = new api.NativeAdminDataService(grants, database);
const restore = new api.NativeAdminWorkRestoreService(database, grants,
  { nowIso: () => new Date().toISOString() });
const access = await query.getAccess(actor);
const overview = await data.getOverview(actor);
const classes = await data.listClasses(actor, 20, 0);
const users = await data.listUsers(actor, '', 20, 0);
const grantRows = await data.listGrants(actor, 20, 0);
const textbooks = await data.listRecords(actor, 'textbooks', 20, 0);
const questions = await data.listRecords(actor, 'questions', 20, 0);
const tasks = await data.listRecords(actor, 'tasks', 20, 0);
const media = await data.listRecords(actor, 'media', 20, 0);
const deletedWorks = await restore.listDeleted(actor, 'usr_student_g3_01', 20, 0);
const mediaSummaries = [];
for (const row of media.items) {
  try {
    const result = await data.getMediaReviewSummary(actor, row.id);
    mediaSummaries.push({ id: row.id, status: result.status, statusLabel: result.statusLabel,
      approvalEvidencePresent: result.sourceScanEvidencePresent && result.outputScanEvidencePresent
        && result.transcodeEvidencePresent && result.copyrightEvidencePresent });
  } catch { mediaSummaries.push({ id: row.id, summaryAvailable: false }); }
}
const result = { status: 'passed', pageStates: {
  A01: { classCount: overview.classCount, permissionCount: access.permissions.length },
  A02: { items: classes.items.length }, A03: { items: users.items.length },
  A04: { grants: grantRows.items.length },
  A05: { items: textbooks.items.length, titles: textbooks.items.map(row => row.title) },
  A06: { items: questions.items.length, titles: questions.items.map(row => row.title) },
  A07: { items: tasks.items.length, rows: tasks.items.map(row => ({ kind: row.kind,
    title: row.title, statusLabel: row.statusLabel })) },
  A08: { items: media.items.length, rows: media.items.map(row => ({ title: row.title,
    statusLabel: row.statusLabel })), summaries: mediaSummaries },
  A03DeletedWorks: { items: deletedWorks.items.length },
}, writesPerformed: false };
process.stdout.write(JSON.stringify(result) + '\n');
