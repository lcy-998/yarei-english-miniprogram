// Nonproduction one-audio/four-question teacher-student-review loop with a fictional learner.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['inspect', 'apply'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const { build } = require('esbuild');
const asset = JSON.parse(await readFile(
  'G:/英语资产/library/derived/sbc0008-reading-listening-pair-2026-10-11/v3/listening-activity-v3.json', 'utf8'));
const resourceId = 'res_launch_sbc0008_listening_v2_20261013';
if (asset.questions.length !== 4 || asset.mainAudio.durationMs !== 25011) throw new Error('ASSET_GATE');
function call(args) {
  const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const result = JSON.parse(raw.slice(at));
  if (result.error) throw new Error('CLOUD_API_ERROR');
  return result.data;
}
const cfg = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const line = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
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
const app = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: token.secretId, secretKey: token.secretKey, sessionToken: token.token });
const entry = join(root, '.runtime/launch-listening-loop-20261013/entry.cjs');
await mkdir(dirname(entry), { recursive: true });
await build({ entryPoints: [join(root, 'src/seed/m2-acceptance-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(entry);
const mediaEntry = join(root, '.runtime/launch-listening-loop-20261013/media.cjs');
await build({ entryPoints: [join(root, 'src/seed/m3-real-sample-entry.ts')],
  outfile: mediaEntry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const mediaApi = require(mediaEntry);
const db = api.createCloudBaseDocumentDatabase(app.database());
const orgId = 'org_qihang_demo';
const classId = 'cls_grade3_2';
const teacherId = 'usr_teacher_demo_01';
const studentId = 'usr_student_g3_01';
const [teacher, student, roles, grants, memberships, resource] = await Promise.all([
  db.get('users', teacherId), db.get('users', studentId),
  db.find('role_assignments', { organizationId: orgId, userId: teacherId,
    status: 'active', deletedAt: null }),
  db.find('teacher_class_grants', { organizationId: orgId, teacherId,
    classId, status: 'active', deletedAt: null }),
  db.find('class_memberships', { organizationId: orgId, classId,
    studentId, status: 'active', deletedAt: null }),
  db.get('learning_resources', resourceId),
]);
const role = roles.find(row => row.role === 'teacher') ?? roles[0];
if (teacher?.status !== 'active' || student?.status !== 'active'
  || !role?.permissions?.includes('task.publish')
  || !role.permissions.includes('submission.review')
  || !grants.some(row => row.permissions?.includes('task.publish')
    && row.permissions.includes('submission.review'))
  || memberships.length !== 1 || resource?.status !== 'published'
  || resource.type !== 'listening' || resource.testOnly !== false
  || resource.payload?.teacherMedia?.mediaSha256 !== asset.mainAudio.sha256) {
  throw new Error('ACTOR_OR_RESOURCE_GATE');
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    mediaQuestions: asset.questions.length, fictionalStudent: true,
    teacherAuthorized: true, cloudWrites: 0 }) + '\n');
  process.exit(0);
}
const nonce = randomUUID().replaceAll('-', '');
const taskId = `task_launch_listening_${nonce}`;
const itemId = `item_launch_listening_${nonce}`;
let idCount = 0;
const ids = { next: prefix => prefix === 'task' ? taskId
  : `${prefix}_launchlisten_${nonce}_${++idCount}` };
let requestCount = 0;
const requestIds = { next: () => `request_launchlisten_${nonce}_${++requestCount}` };
let nowMs = Date.now();
const clock = { nowIso: () => new Date(nowMs).toISOString() };
const teacherActor = { requestId: requestIds.next(), sessionId: 'launch-listening-loop',
  actorUserId: teacherId, actorRole: 'teacher', organizationId: orgId,
  platformSubjectDigest: 'launch-listening-loop', permissions: role.permissions,
  scopeIds: [classId], authzVersion: teacher.authzVersion ?? 1 };
const studentActor = { ...teacherActor, requestId: requestIds.next(),
  actorUserId: studentId, actorRole: 'student', permissions: [],
  authzVersion: student.authzVersion ?? 1 };
const taskRepo = api.createTaskCoreDocumentRepository(db);
const playbackPort = new mediaApi.DocumentTaskMediaPlaybackPort(taskRepo, db,
  new mediaApi.CloudBaseWorkPlayback(app), clock);
const playback = new mediaApi.TaskMediaPlaybackService(playbackPort, clock);
const mediaEvidence = new mediaApi.TaskMediaSubmissionEvidenceService(playbackPort,
  { async findTaskDubbingWork() { return null; } });
const service = new api.TaskCoreService(taskRepo,
  api.createIdentityDocumentRepository(db), clock, ids, requestIds,
  undefined, mediaEvidence);
const queryDeps = { repository: api.createTaskQueryDocumentRepository(db),
  clock, requestIds };
const studentQuery = new api.StudentTaskQueryService(queryDeps);
const reviewQuery = new api.ReviewQueryService(queryDeps);
let created = false;
let recycled = false;
let stage = 'save';
try {
  const now = Date.now();
  const draft = await service.saveTaskDraft(teacherActor, {
    title: '一音频四题非生产闭环',
    itemRefs: [{ id: itemId, resourceId,
      completionRule: { kind: 'listening',
        questionIds: asset.questions.map(q => q.id),
        segmentIds: asset.questions.map(q => `${q.id}_segment`) },
      scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }],
    targetType: 'students', targetClassIds: [], targetStudentIds: [studentId],
    startsAt: new Date(now - 60000).toISOString(),
    dueAt: new Date(now + 86400000).toISOString(),
    latePolicy: { allowLate: true, lateDays: 7 },
    description: '仅非生产虚构学员，验证后精确软回收。', teacherNote: '',
  }, 0, `operation_launchlisten_save_${nonce}`);
  if (!draft.ok || draft.data?.taskId !== taskId) throw new Error(`SAVE_${draft.error?.code ?? 'INVALID'}`);
  created = true;
  stage = 'publish';
  const published = await service.publishTask(teacherActor, taskId, draft.data.version,
    `operation_launchlisten_publish_${nonce}`);
  if (!published.ok) throw new Error(`PUBLISH_${published.error?.code ?? 'INVALID'}`);
  stage = 'student-read';
  const task = await studentQuery.getMyTask(studentActor, taskId);
  if (!task.ok || task.data.items?.[0]?.resourceId !== resourceId) {
    throw new Error(`STUDENT_READ_${task.error?.code ?? 'INVALID'}`);
  }
  stage = 'playback';
  const begun = await playback.begin(studentActor, taskId, itemId,
    `operation_launchlisten_begin_${nonce}`);
  if (!begun.ok || begun.data.status !== 'ready' || !begun.data.sessionId
    || !begun.data.temporaryUrl?.startsWith('https://')) {
    throw new Error(`MEDIA_BEGIN_${begun.code ?? 'INVALID'}`);
  }
  const blocked = await playback.heartbeat(studentActor, {
    sessionId: begun.data.sessionId, playedFromMs: 5000, playedToMs: 6000,
    positionMs: 6000, operationId: `operation_launchlisten_seek_${nonce}` });
  if (blocked.ok || blocked.code !== 'SEEK_FORWARD') throw new Error('SEEK_FORWARD_NOT_BLOCKED');
  let through = 0;
  let heartbeatIndex = 0;
  while (through < asset.mainAudio.durationMs) {
    nowMs += 2500;
    const next = Math.min(asset.mainAudio.durationMs, through + 4000);
    const advanced = await playback.heartbeat(studentActor, {
      sessionId: begun.data.sessionId, playedFromMs: through,
      playedToMs: next, positionMs: next,
      operationId: `operation_launchlisten_heartbeat_${heartbeatIndex}_${nonce}` });
    if (!advanced.ok || advanced.data.confirmedThroughMs !== next) {
      throw new Error(`HEARTBEAT_${advanced.code ?? 'INVALID'}`);
    }
    through = next;
    heartbeatIndex++;
  }
  stage = 'submit';
  const submitted = await service.submit(studentActor, taskId,
    [{ itemId, value: { kind: 'listening', mediaSessionId: begun.data.sessionId,
      questionResponses: asset.questions.map(q => ({ questionId: q.id,
        response: q.correctAnswer })) } }],
    task.data.assignment.version, undefined, `operation_launchlisten_submit_${nonce}`);
  if (!submitted.ok || !submitted.data?.submissionId) {
    throw new Error(`SUBMIT_${submitted.error?.code ?? 'INVALID'}`);
  }
  stage = 'review';
  const view = await reviewQuery.getSubmissionForReview(teacherActor, submitted.data.submissionId);
  if (!view.ok || !JSON.stringify(view.data).includes(asset.questions[0].id)) {
    throw new Error(`REVIEW_EVIDENCE_${view.error?.code ?? 'INVALID'}`);
  }
  const scored = await service.publishReview(teacherActor, {
    submissionId: submitted.data.submissionId, decision: 'approved',
    textComment: '四道听力题及连续播放记录已核对。',
    expectedSubmissionVersion: view.data.submissionVersion,
  }, view.data.assignmentVersion, `operation_launchlisten_review_${nonce}`);
  if (!scored.ok) throw new Error(`REVIEW_${scored.error?.code ?? 'INVALID'}`);
  stage = 'recycle';
  const current = await db.get('tasks', taskId);
  const cleaned = await service.recycleTask(teacherActor, taskId,
    '听力闭环完成后精确软回收。', current.version,
    `operation_launchlisten_recycle_${nonce}`);
  if (!cleaned.ok) throw new Error(`RECYCLE_${cleaned.error?.code ?? 'INVALID'}`);
  recycled = true;
  process.stdout.write(JSON.stringify({ mode, status: 'passed', taskId,
    questionCount: 4, confirmedAudioMs: through, forwardSeekBlocked: true,
    studentSubmit: true, teacherReview: true, recycled: true,
    historyDeleted: false }) + '\n');
} catch (error) {
  if (created && !recycled) {
    const current = await db.get('tasks', taskId).catch(() => null);
    if (current?.visibility !== 'recycled' && Number.isSafeInteger(current?.version)) {
      const cleaned = await service.recycleTask(teacherActor, taskId,
        '听力闭环失败后的精确软回收。', current.version,
        `operation_launchlisten_cleanup_${nonce}`).catch(() => null);
      recycled = cleaned?.ok === true;
    }
  }
  process.stdout.write(JSON.stringify({ mode, status: 'failed', stage,
    taskId: created ? taskId : null, recycled,
    reason: String(error?.message ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) }) + '\n');
  process.exitCode = 2;
}
process.exit(process.exitCode ?? 0);
