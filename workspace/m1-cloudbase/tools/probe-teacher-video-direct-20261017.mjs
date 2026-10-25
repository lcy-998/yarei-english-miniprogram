// Fictional nonproduction video flow through real CloudBase storage and database.
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
if (envId !== 'cloud1-d8ggzrwwedb786e41' || config.envId !== envId) {
  throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');
}
function call(args) {
  let raw;
  try {
    raw = execFileSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { throw new Error('CLOUD_PREFLIGHT_UNAVAILABLE'); }
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_UNAVAILABLE');
  const parsed = JSON.parse(raw.slice(at));
  if (parsed.error) throw new Error(`CLOUD_API_${parsed.error.code ?? 'FAILED'}`);
  return parsed.data;
}
const env = call(['env', 'list', '--json']);
if (!Array.isArray(env) || env.length !== 1 || env[0].EnvId !== envId
  || env[0].Status !== 'NORMAL' || env[0].PackageName !== '个人版'
  || env[0].EnvPaid !== 'no' || env[0].EnvCharged !== 'no'
  || env[0].EnableOverrun !== false) throw new Error('COST_GATE');
const quota = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value >= 190000) throw new Error('DB_QUOTA_GATE');
if (call(['storage', 'rules', 'get', '--json'])?.acl !== 'PRIVATE') throw new Error('STORAGE_GATE');
const credentials = call(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 120000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID');
}
const require = createRequire(resolve(root, 'package.json'));
const app = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token });
const entry = resolve(root, '.runtime/teacher-video-direct-probe-entry.cjs');
await build({ stdin: { contents: `
  export { createCloudBaseDocumentDatabase } from './repositories/cloudbase-document-database';
  export { createOrgContentDocumentRepository } from './repositories/org-content-document-adapter';
  export { TeacherPrivateVideoService } from './teacher-media/private-video';
  export { DirectMp4PrivateVideoProcessor } from './teacher-media/direct-mp4-processor';
  export { TeacherAssetCatalogService } from './teacher-media/asset-catalog-service';
  export { createTaskCoreDocumentRepository } from './repositories/task-core-document-adapter';
  export { createIdentityDocumentRepository } from './repositories/identity-session-document-adapter';
  export { createTaskQueryDocumentRepository } from './repositories/task-query-document-adapter';
  export { TaskCoreService } from './task-core/task-core-service';
  export { StudentTaskQueryService, ReviewQueryService } from './task-query/service';
  export { DocumentTaskMediaPlaybackPort } from './task-media/document-playback-port';
  export { TaskMediaPlaybackService } from './task-media/playback-service';
  export { TaskMediaSubmissionEvidenceService } from './task-media/submission-evidence';
  export { CloudBaseWorkPlayback } from './student-work/cloudbase-playback';
`, resolveDir: resolve(root, 'src'), sourcefile: 'teacher-video-direct-probe-entry.ts', loader: 'ts' },
  outfile: entry, bundle: true, packages: 'external', format: 'cjs', platform: 'node',
  target: 'node20', logLevel: 'silent' });
const probe = require(entry);
const db = probe.createCloudBaseDocumentDatabase(app.database());
const organizationId = 'org_qihang_demo';
const teacherId = 'usr_teacher_demo_01';
const classId = 'cls_grade3_2';
const studentId = 'usr_student_g3_01';
const [user, roleRows, grantRows, student, memberships] = await Promise.all([
  db.get('users', teacherId),
  db.find('role_assignments', { organizationId, userId: teacherId,
    status: 'active', deletedAt: null }),
  db.find('teacher_class_grants', { organizationId, teacherId, classId,
    status: 'active', deletedAt: null }),
  db.get('users', studentId),
  db.find('class_memberships', { organizationId, classId, studentId,
    status: 'active', deletedAt: null }),
]);
const role = roleRows.find(row => row.role === 'teacher');
const parentLinks = await db.find('parent_student_links', { organizationId,
  studentId, status: 'active', deletedAt: null });
const parentId = parentLinks[0]?.parentId;
const parent = parentId ? await db.get('users', parentId) : null;
const parentRoles = parentId ? await db.find('role_assignments', { organizationId,
  userId: parentId, status: 'active', deletedAt: null }) : [];
const parentRole = parentRoles.find(row => row.role === 'parent');
if (user?.status !== 'active' || !role?.permissions?.includes('task.publish')
  || !role.permissions.includes('content.read')
  || !grantRows.some(row => row.permissions?.includes('task.publish')
    && row.permissions?.includes('content.read'))
  || student?.status !== 'active' || memberships.length !== 1
  || parent?.status !== 'active' || !parentRole) {
  throw new Error('FICTIONAL_TEACHER_OR_STUDENT_GRANT_MISSING');
}
const actor = { requestId: `req_video_probe_${randomUUID()}`, sessionId: 'video_probe',
  actorUserId: teacherId, actorRole: 'teacher', organizationId,
  platformSubjectDigest: 'video-probe', permissions: role.permissions,
  scopeIds: [classId], authzVersion: user.authzVersion ?? 1 };
const freshActor = () => ({ ...actor, requestId: `req_video_probe_${randomUUID()}` });
const storage = { downloadFile: input => app.downloadFile(input),
  uploadFile: input => app.uploadFile(input) };
let probeNowMs = Date.now();
const clock = { nowIso: () => new Date(probeNowMs).toISOString() };
const grants = probe.createOrgContentDocumentRepository(db);
const service = new probe.TeacherPrivateVideoService(db,
  new probe.DirectMp4PrivateVideoProcessor(storage, envId), clock, grants,
  { getTempFileURL: input => app.getTempFileURL(input) });
const question = { questionId: 'q_1', questionType: 'single_choice',
  stem: '虚构短片出现了什么动物？', options: ['长颈鹿', '鲸鱼'],
  correctAnswer: '长颈鹿', explanation: '虚构测试题。' };
const bytes = readFileSync(resolve(root, '../m2-acceptance/2026-09-29/assets/zoo-friends-demo.mp4'));
if (bytes.length < 1000 || bytes.length > 200 * 1024 * 1024) throw new Error('VIDEO_SIZE_GATE');
let draftId = '';
let taskId = '';
let taskCreated = false;
let taskRecycled = false;
let taskService = null;
let stage = 'save';
try {
  if (!await service.available(actor)) throw new Error('AVAILABILITY_FALSE');
  const draft = (await service.list(actor)).find(item => item.title === '虚构教师直传视频验收'
    && item.status === 'draft')
    ?? await service.save(freshActor(), { title: '虚构教师直传视频验收', questions: [question] });
  draftId = draft.id;
  stage = 'ownership';
  try {
    await service.get({ ...actor, actorUserId: 'usr_other_virtual_teacher' }, draft.id);
    throw new Error('OWNER_GUARD_MISSING');
  } catch (error) {
    if (error.code !== 'FORBIDDEN') throw error;
  }
  stage = 'invalidUpload';
  const invalidBegin = await service.beginUpload(freshActor(), draft.id, draft.version);
  const invalidFile = await app.uploadFile({ cloudPath: invalidBegin.stagingPath,
    fileContent: Buffer.from('not-an-mp4') });
  const rejected = await service.seal(freshActor(), draft.id,
    invalidBegin.version, invalidFile.fileID);
  if (rejected.status !== 'failed') throw new Error('INVALID_FILE_ACCEPTED');
  stage = 'invalidRetry';
  const retried = await service.retryProcessing(freshActor(), draft.id, rejected.version);
  if (retried.status !== 'failed') throw new Error('INVALID_RETRY_ACCEPTED');
  stage = 'beginUpload';
  const begun = await service.beginUpload(freshActor(), draft.id, retried.version);
  stage = 'upload';
  const uploaded = await app.uploadFile({ cloudPath: begun.stagingPath, fileContent: bytes });
  stage = 'seal';
  const ready = await service.seal(freshActor(), draft.id, begun.version, uploaded.fileID);
  if (ready.status !== 'ready') throw new Error(`SEAL_${ready.status}`);
  stage = 'publish';
  const published = await service.publish(freshActor(), draft.id, ready.version);
  if (published.status !== 'published') throw new Error('PUBLISH_FAILED');
  const catalog = new probe.TeacherAssetCatalogService(db, grants,
    { getTempFileURL: input => app.getTempFileURL(input) }, clock);
  const mine = await catalog.list(actor, { kind: 'video', scope: 'mine' }, { limit: 20, offset: 0 });
  if (!mine.items.some(item => item.id === draft.id && item.privateToTeacher)) {
    throw new Error('PRIVATE_CATALOG_MISSING');
  }
  stage = 'taskSave';
  const nonce = randomUUID().replace(/-/g, '');
  taskId = `task_teacher_video_probe_${nonce}`;
  let sequence = 0;
  const ids = { next: prefix => prefix === 'task' ? taskId
    : `${prefix}_teacher_video_${nonce}_${++sequence}` };
  const requestIds = { next: () => `request_teacher_video_${nonce}_${++sequence}` };
  const studentActor = { ...actor, actorUserId: studentId, actorRole: 'student',
    permissions: [], authzVersion: student.authzVersion ?? 1 };
  const taskRepository = probe.createTaskCoreDocumentRepository(db);
  const playbackPort = new probe.DocumentTaskMediaPlaybackPort(taskRepository, db,
    new probe.CloudBaseWorkPlayback(app), clock);
  const mediaEvidence = new probe.TaskMediaSubmissionEvidenceService(playbackPort,
    { async findTaskDubbingWork() { return null; } });
  taskService = new probe.TaskCoreService(taskRepository,
    probe.createIdentityDocumentRepository(db), clock, ids, requestIds,
    undefined, mediaEvidence);
  const taskInput = { title: '虚构教师视频配题验收任务',
    itemRefs: [{ id: 'item_private_video', resourceId: draft.id,
      completionRule: { kind: 'video', durationMs: ready.durationMs, questionIds: ['q_1'] },
      scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }],
    targetType: 'students', targetClassIds: [], targetStudentIds: [studentId],
    startsAt: new Date(probeNowMs - 60_000).toISOString(),
    dueAt: new Date(probeNowMs + 86_400_000).toISOString(),
    latePolicy: { allowLate: true, lateDays: 7 }, description: '仅虚构学员验收。', teacherNote: '' };
  const savedTask = await taskService.saveTaskDraft(freshActor(), taskInput, 0,
    `operation_teacher_video_save_${nonce}`);
  if (!savedTask.ok || savedTask.data?.taskId !== taskId) throw new Error(`TASK_SAVE_${savedTask.error?.code ?? 'INVALID'}`);
  taskCreated = true;
  stage = 'taskPublish';
  const publishedTask = await taskService.publishTask(freshActor(), taskId, 1,
    `operation_teacher_video_publish_${nonce}`);
  if (!publishedTask.ok) throw new Error(`TASK_PUBLISH_${publishedTask.error?.code ?? 'INVALID'}`);
  stage = 'studentRead';
  const studentQuery = new probe.StudentTaskQueryService({ repository:
    probe.createTaskQueryDocumentRepository(db), clock, requestIds });
  const studentTask = await studentQuery.getMyTask(studentActor, taskId);
  if (!studentTask.ok || studentTask.data.items?.[0]?.resourceId !== draft.id) {
    throw new Error(`STUDENT_READ_${studentTask.error?.code ?? 'INVALID'}`);
  }
  stage = 'watch';
  const media = new probe.TaskMediaPlaybackService(playbackPort, clock);
  const begunMedia = await media.begin(studentActor, taskId, 'item_private_video',
    `operation_teacher_video_begin_${nonce}`);
  if (!begunMedia.ok || begunMedia.data.status !== 'ready'
    || !begunMedia.data.temporaryUrl?.startsWith('https://')) {
    throw new Error(`MEDIA_BEGIN_${begunMedia.code ?? 'INVALID'}`);
  }
  const jumped = await media.heartbeat(studentActor, { sessionId: begunMedia.data.sessionId,
    playedFromMs: 5000, playedToMs: 6000, positionMs: 6000,
    operationId: `operation_teacher_video_jump_${nonce}` });
  if (jumped.ok || jumped.code !== 'SEEK_FORWARD') throw new Error('FORWARD_SEEK_NOT_REJECTED');
  let through = 0;
  let heartbeatIndex = 0;
  const threshold = Math.ceil(ready.durationMs * 0.9);
  while (through < threshold) {
    probeNowMs += 2500;
    const next = Math.min(ready.durationMs, through + 4000);
    const heartbeat = await media.heartbeat(studentActor, { sessionId: begunMedia.data.sessionId,
      playedFromMs: through, playedToMs: next, positionMs: next,
      operationId: `operation_teacher_video_heartbeat_${heartbeatIndex++}_${nonce}` });
    if (!heartbeat.ok || heartbeat.data.confirmedThroughMs !== next) {
      throw new Error(`MEDIA_HEARTBEAT_${heartbeat.code ?? 'INVALID'}`);
    }
    through = next;
  }
  stage = 'studentSubmit';
  const missingAnswer = await taskService.submit(studentActor, taskId,
    [{ itemId: 'item_private_video', value: { kind: 'video',
      mediaSessionId: begunMedia.data.sessionId } }],
    studentTask.data.assignment.version, undefined,
    `operation_teacher_video_missing_answer_${nonce}`);
  if (missingAnswer.ok) throw new Error('MISSING_ANSWER_ACCEPTED');
  const submitted = await taskService.submit(studentActor, taskId,
    [{ itemId: 'item_private_video', value: { kind: 'video',
      mediaSessionId: begunMedia.data.sessionId,
      questionResponses: [{ questionId: 'q_1', response: '长颈鹿' }] } }],
    studentTask.data.assignment.version, undefined,
    `operation_teacher_video_submit_${nonce}`);
  if (!submitted.ok || !submitted.data?.submissionId) {
    throw new Error(`SUBMIT_${submitted.error?.code ?? 'INVALID'}`);
  }
  stage = 'review';
  const reviewQuery = new probe.ReviewQueryService({ repository:
    probe.createTaskQueryDocumentRepository(db), clock, requestIds });
  const review = await reviewQuery.getSubmissionForReview(freshActor(), submitted.data.submissionId);
  if (!review.ok || !JSON.stringify(review.data).includes('q_1')) {
    throw new Error(`REVIEW_READ_${review.error?.code ?? 'INVALID'}`);
  }
  const reviewed = await taskService.publishReview(freshActor(), {
    submissionId: submitted.data.submissionId, decision: 'approved',
    textComment: '虚构视频作业已核对。', expectedSubmissionVersion: review.data.submissionVersion,
  }, review.data.assignmentVersion, `operation_teacher_video_review_${nonce}`);
  if (!reviewed.ok) throw new Error(`REVIEW_${reviewed.error?.code ?? 'INVALID'}`);
  stage = 'parentFeedback';
  const parentActor = { ...actor, requestId: `req_parent_video_${randomUUID()}`,
    actorUserId: parentId, actorRole: 'parent', permissions: parentRole.permissions,
    scopeIds: [], authzVersion: parent.authzVersion ?? 1 };
  const parentResult = await taskService.getParentTaskResult(parentActor, studentId, taskId);
  if (!parentResult.ok || !parentResult.data.feedback?.textComment?.includes('虚构视频作业')) {
    throw new Error(`PARENT_FEEDBACK_${parentResult.error?.code ?? 'INVALID'}`);
  }
  stage = 'taskRecycle';
  const frozen = await db.get('tasks', taskId);
  if (frozen?.items?.[0]?.mediaSnapshot?.questionIds?.[0] !== 'q_1') {
    throw new Error('TASK_SNAPSHOT_MISSING');
  }
  const recycledTask = await taskService.recycleTask(freshActor(), taskId,
    '虚构教师视频验收完成，保留快照和审计。', frozen.version,
    `operation_teacher_video_recycle_${nonce}`);
  if (!recycledTask.ok) throw new Error(`TASK_RECYCLE_${recycledTask.error?.code ?? 'INVALID'}`);
  taskRecycled = true;
  stage = 'withdraw';
  const offline = await service.withdraw(freshActor(), draft.id, published.version);
  if (offline.status !== 'offline') throw new Error('WITHDRAW_FAILED');
  process.stdout.write(JSON.stringify({ status: 'passed', environment: 'verified_nonproduction',
    fictionalTeacher: true, directMp4Sealed: true, privateCatalogVisible: true,
    otherTeacherRejected: true, invalidFileRejected: true, retryRejected: true,
    validReplacementAccepted: true, studentTaskRead: true, forwardSeekRejected: true,
    watchedAtLeast90Percent: through >= threshold, missingAnswerRejected: true,
    formallySubmitted: true, teacherReviewed: true, parentFeedbackVisible: true,
    taskRecycled: true,
    withdrawnAfterTest: true, bytes: bytes.length,
    paid: false, overrunBilling: false }) + '\n');
} catch (error) {
  if (taskCreated && !taskRecycled && taskService) {
    try {
      const current = await db.get('tasks', taskId);
      if (current?.visibility !== 'recycled' && Number.isSafeInteger(current?.version)) {
        const cleaned = await taskService.recycleTask(freshActor(), taskId,
          '虚构教师视频验收失败后精确回收。', current.version,
          `operation_teacher_video_cleanup_${randomUUID().replace(/-/g, '')}`);
        taskRecycled = cleaned.ok;
      }
    } catch { /* Failure is reported; keep the exact task ID in the local audit. */ }
  }
  if (draftId) {
    try {
      const current = await service.get(freshActor(), draftId);
      if (current.status === 'published') await service.withdraw(freshActor(), draftId, current.version);
    } catch { /* Preserve the draft for inspection on failure. */ }
  }
  process.stdout.write(JSON.stringify({ status: 'failed', stage, draftCreated: Boolean(draftId),
    taskCreated, taskRecycled,
    code: String(error?.code ?? error?.message ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80),
    kind: String(error?.kind ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 30),
    causeCode: String(error?.cause?.code ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 30),
    causeKeys: Object.keys(error?.cause ?? {}).filter(key => !/token|secret|key|credential/i.test(key)),
    causeCategory: /duplicate|already exist/i.test(String(error?.cause?.message ?? '')) ? 'duplicate'
      : /transaction/i.test(String(error?.cause?.message ?? '')) ? 'transaction'
        : /timeout/i.test(String(error?.cause?.message ?? '')) ? 'timeout'
          : /permission|forbidden/i.test(String(error?.cause?.message ?? '')) ? 'permission'
            : /size|large/i.test(String(error?.cause?.message ?? '')) ? 'size' : 'other',
    causeSummary: String(error?.cause?.message ?? '').replace(/[A-Za-z0-9_-]{16,}/gu, '[redacted]')
      .replace(/[\r\n]/gu, ' ').slice(0, 220) }) + '\n');
  process.exitCode = 2;
}
