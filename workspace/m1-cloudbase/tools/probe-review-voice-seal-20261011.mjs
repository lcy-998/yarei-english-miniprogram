// Nonproduction functional probe: one fictional teacher draft and one bundled synthetic MP3.
// The probe never publishes feedback, changes a submission, or prints media/credential values.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envId = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!envId || envId !== config.envId || envId !== 'cloud1-d8ggzrwwedb786e41') {
  throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');
}
function call(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = JSON.parse(raw.slice(raw.indexOf('{')));
  if (result.error) throw new Error(`CLOUD_API_${result.error.code ?? 'FAILED'}`);
  return result.data;
}
const environments = call(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE');
}
const quota = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('DB_QUOTA_GATE');
const credentials = call(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 120000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID');
}
const require = createRequire(resolve(root, 'package.json'));
const app = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token });
const entry = resolve(root, '.runtime/review-voice-probe-entry.cjs');
await build({ stdin: { contents: `
  export { createCloudBaseDocumentDatabase } from './repositories/cloudbase-document-database';
  export { createTaskCoreDocumentRepository } from './repositories/task-core-document-adapter';
  export { DocumentReviewVoicePort } from './review-voice/document-port';
  export { ReviewVoiceCommentService } from './review-voice/service';
  export { CloudBaseReviewVoiceSeal } from './review-voice/cloudbase-seal';
`, resolveDir: resolve(root, 'src'), sourcefile: 'review-voice-probe-entry.ts', loader: 'ts' },
  outfile: entry, bundle: true, packages: 'external', format: 'cjs', platform: 'node',
  target: 'node20', logLevel: 'silent' });
const probe = require(entry);
const database = probe.createCloudBaseDocumentDatabase(app.database());
const organizationId = 'org_qihang_demo';
const teacherId = 'usr_teacher_demo_01';
const classId = 'cls_grade3_2';
const [teacher, roles, grants, assignments] = await Promise.all([
  database.get('users', teacherId),
  database.find('role_assignments', { organizationId, userId: teacherId,
    status: 'active', deletedAt: null }),
  database.find('teacher_class_grants', { organizationId, teacherId, classId,
    status: 'active', deletedAt: null }),
  database.find('task_assignments', { organizationId, classId,
    status: 'awaiting_review', deletedAt: null }),
]);
const role = roles.find(row => row.role === 'teacher');
if (teacher?.status !== 'active' || !role?.permissions?.includes('submission.review')
  || !grants.some(row => row.permissions?.includes('submission.review'))) {
  throw new Error('VIRTUAL_TEACHER_REVIEW_PERMISSION_MISSING');
}
const tasks = probe.createTaskCoreDocumentRepository(database);
const candidate = (await Promise.all(assignments.slice(0, 20).map(async assignment => {
  const submission = assignment.latestSubmissionId
    ? await tasks.findSubmission(organizationId, assignment.latestSubmissionId) : null;
  return submission?.status === 'submitted' && submission.submissionVersion === assignment.latestSubmissionVersion
    ? submission : null;
}))).find(Boolean);
if (!candidate) throw new Error('NO_VIRTUAL_PENDING_SUBMISSION');
const actor = { requestId: 'req_review_voice_probe', sessionId: 'session_review_voice_probe',
  actorUserId: teacherId, actorRole: 'teacher', organizationId,
  platformSubjectDigest: 'review-voice-probe', permissions: role.permissions,
  scopeIds: [classId], authzVersion: teacher.authzVersion ?? 1 };
const storage = { downloadFile: input => app.downloadFile(input),
  uploadFile: input => app.uploadFile(input) };
const port = new probe.DocumentReviewVoicePort(tasks, database,
  new probe.CloudBaseReviewVoiceSeal(storage, envId,
    { maxDurationMs: 300000, maxBytes: 20 * 1024 * 1024 }));
const voice = new probe.ReviewVoiceCommentService(port,
  { nowIso: () => new Date().toISOString() },
  { maxDurationMs: 300000, maxBytes: 20 * 1024 * 1024 });
const nonce = randomUUID().replaceAll('-', '');
let stage = 'begin';
let created = false;
let sealed = false;
try {
  const begun = await voice.begin(actor, candidate.id, `operation_voice_probe_begin_${nonce}`);
  if (!begun.ok || begun.data.status !== 'draft') throw new Error(`BEGIN_${begun.code ?? 'INVALID'}`);
  created = true;
  const audio = readFileSync(resolve(root, '../m2-acceptance/2026-09-29/assets/recording-example.mp3'));
  if (audio.length < 1000 || audio.length > 20 * 1024 * 1024) throw new Error('SYNTHETIC_MEDIA_INVALID');
  stage = 'upload';
  const uploaded = await app.uploadFile({ cloudPath: begun.data.stagingPath, fileContent: audio });
  if (typeof uploaded.fileID !== 'string' || !uploaded.fileID.startsWith('cloud://')) {
    throw new Error('STAGING_UPLOAD_INVALID');
  }
  stage = 'seal';
  const result = await voice.seal(actor, begun.data.recordingId, uploaded.fileID,
    begun.data.version, `operation_voice_probe_seal_${nonce}`);
  if (!result.ok || result.data.status !== 'sealed') throw new Error(`SEAL_${result.code ?? 'INVALID'}`);
  sealed = true;
  stage = 'resolve';
  const resolved = await voice.resolveForFeedback(actor, candidate.id,
    candidate.submissionVersion, result.data.recordingId);
  if (!resolved || resolved.durationMs < 1000) throw new Error('SEALED_VOICE_NOT_RESOLVABLE');
  const assignment = await tasks.findAssignmentById(organizationId, candidate.assignmentId);
  if (assignment?.status !== 'awaiting_review') throw new Error('SUBMISSION_STATUS_CHANGED');
  process.stdout.write(JSON.stringify({ status: 'passed', environment: 'verified_nonproduction',
    fictionalSubmission: true, draftCreated: true, stagedSyntheticAudio: true,
    sealed, formalFeedbackPublished: false, assignmentUnchanged: true,
    durationMs: resolved.durationMs, credentialsOrMediaPrinted: false }) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 'failed', stage, created, sealed,
    code: String(error?.message ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 100),
    credentialsOrMediaPrinted: false }) + '\n');
  process.exitCode = 2;
}
