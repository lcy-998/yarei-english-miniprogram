// Fictional nonproduction video task; test clock drives playback, then task is recycled.
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
const orgId = 'org_qihang_demo';
const classId = 'cls_grade3_2';
const teacherId = 'usr_teacher_demo_01';
const studentId = 'usr_student_g3_01';
const resourceId = 'res_cip50055_pangu_silent_video_v1_20261013';
const durationMs = 47480;

function call(args) {
  let raw;
  try {
    raw = execFileSync(process.execPath,
      ['D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb', ...args],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
        maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { throw new Error('CLOUD_CLI_FAILED'); }
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const response = JSON.parse(raw.slice(at));
  if (response.error) throw new Error('CLOUD_API_ERROR');
  return response.data;
}

const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const envId = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
const envs = call(['env', 'list', '--json']);
if (envId !== 'cloud1-d8ggzrwwedb786e41' || config.envId !== envId
  || envs.length !== 1 || envs[0].EnvId !== envId || envs[0].Status !== 'NORMAL'
  || envs[0].PackageName !== '个人版' || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no' || envs[0].EnableOverrun !== false) {
  throw new Error('NONPRODUCTION_COST_GATE');
}
const quota = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('QUOTA_GATE');
const credentials = call(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const sdk = require('@cloudbase/node-sdk');
const app = sdk.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const entry = join(root, '.runtime/cip-50055-pangu-task-20261013/core.cjs');
await mkdir(dirname(entry), { recursive: true });
await build({ entryPoints: [join(root, 'src/seed/m2-acceptance-entry.ts')], outfile: entry,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(entry);
const db = api.createCloudBaseDocumentDatabase(app.database());
const mediaEntry = join(root, '.runtime/cip-50055-pangu-task-20261013/media.cjs');
await build({ entryPoints: [join(root, 'src/seed/m3-real-sample-entry.ts')], outfile: mediaEntry,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const mediaApi = require(mediaEntry);
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
  || !role?.permissions?.includes('task.publish') || !role.permissions.includes('content.read')
  || !grants[0]?.permissions?.includes('task.publish')
  || !grants[0]?.permissions?.includes('content.read') || memberships.length !== 1
  || resource?.status !== 'published' || resource?.type !== 'video'
  || resource.testOnly !== true || resource.acceptanceStatus !== 'pending_user_acceptance'
  || resource.payload?.teacherMedia?.durationMs !== durationMs) {
  throw new Error('ACTOR_OR_CONTENT_PREFLIGHT');
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    teacherAuthorized: true, oneFictionalStudent: true,
    videoDurationMs: durationMs, cloudWrites: 0 }) + '\n');
  process.exit(0);
}
const nonce = randomUUID().replaceAll('-', '');
const taskId = `task_cip50055_pangu_${nonce}`;
let idSequence = 0;
const ids = { next: prefix => prefix === 'task' ? taskId : `${prefix}_cip50055_${nonce}_${++idSequence}` };
let requestSequence = 0;
const requestIds = { next: () => `request_cip50055_${nonce}_${++requestSequence}` };
const teacherActor = { requestId: requestIds.next(), sessionId: 'cip50055-pangu-probe',
  actorUserId: teacherId, actorRole: 'teacher', organizationId: orgId,
  platformSubjectDigest: 'cip50055-pangu-probe', permissions: role.permissions,
  scopeIds: [classId], authzVersion: teacher.authzVersion ?? 1 };
const studentActor = { ...teacherActor, requestId: requestIds.next(), actorUserId: studentId,
  actorRole: 'student', permissions: [], authzVersion: student.authzVersion ?? 1 };
let probeNowMs = Date.now();
const clock = { nowIso: () => new Date(probeNowMs).toISOString() };
const service = new api.TaskCoreService(api.createTaskCoreDocumentRepository(db),
  api.createIdentityDocumentRepository(db), clock, ids, requestIds);
const queryDependencies = { repository: api.createTaskQueryDocumentRepository(db), clock, requestIds };
const studentQuery = new api.StudentTaskQueryService(queryDependencies);
const teacherQuery = new api.TeacherTaskQueryService(queryDependencies);
const now = Date.now();
const input = { title: '盘古开天字幕阅读动画非生产验证',
  itemRefs: [{ id: 'item_cip50055_video_1', resourceId,
    completionRule: { kind: 'video', durationMs, questionIds: [] },
    scoringRule: { kind: 'completion_only' }, order: 1 }],
  targetType: 'students', targetClassIds: [], targetStudentIds: [studentId],
  startsAt: new Date(now - 60000).toISOString(), dueAt: new Date(now + 86400000).toISOString(),
  latePolicy: { allowLate: true, lateDays: 7 },
  description: '仅虚构学生，验证后立即软回收。', teacherNote: '' };
let stage = 'save';
let created = false;
let recycled = false;
try {
  const saved = await service.saveTaskDraft(teacherActor, input, 0,
    `operation_cip50055_save_${nonce}`);
  if (!saved.ok || saved.data?.taskId !== taskId || saved.data?.version !== 1) {
    throw new Error(`SAVE_${saved.error?.code ?? 'INVALID_RECEIPT'}`);
  }
  created = true;
  stage = 'publish';
  const published = await service.publishTask(teacherActor, taskId, 1,
    `operation_cip50055_publish_${nonce}`);
  if (!published.ok || !['active', 'scheduled'].includes(published.data?.status)) {
    throw new Error(`PUBLISH_${published.error?.code ?? 'INVALID_RECEIPT'}`);
  }
  stage = 'student-read';
  const task = await studentQuery.getMyTask(studentActor, taskId);
  if (!task.ok || task.data.items?.length !== 1 || task.data.items[0]?.resourceId !== resourceId) {
    throw new Error(`STUDENT_READ_${task.error?.code ?? 'INVALID_ITEM'}`);
  }
  stage = 'media-playback';
  const media = new mediaApi.TaskMediaPlaybackService(
    new mediaApi.DocumentTaskMediaPlaybackPort(
      mediaApi.createTaskCoreDocumentRepository(db), db,
      new mediaApi.CloudBaseWorkPlayback(app), clock), clock);
  const begun = await media.begin(studentActor, taskId, 'item_cip50055_video_1',
    `operation_cip50055_begin_${nonce}`);
  if (!begun.ok || begun.data.status !== 'ready'
    || !begun.data.temporaryUrl?.startsWith('https://') || !begun.data.sessionId) {
    throw new Error(`MEDIA_BEGIN_${begun.code ?? 'INVALID_RECEIPT'}`);
  }
  const jumped = await media.heartbeat(studentActor, {
    sessionId: begun.data.sessionId, playedFromMs: 5000, playedToMs: 6000, positionMs: 6000,
    operationId: `operation_cip50055_jump_${nonce}` });
  if (jumped.ok || jumped.code !== 'SEEK_FORWARD') throw new Error('SEEK_FORWARD_NOT_BLOCKED');
  let through = 0;
  let heartbeatIndex = 0;
  while (through < durationMs) {
    probeNowMs += 2500;
    const next = Math.min(durationMs, through + 4000);
    const advanced = await media.heartbeat(studentActor, {
      sessionId: begun.data.sessionId, playedFromMs: through,
      playedToMs: next, positionMs: next,
      operationId: `operation_cip50055_heartbeat_${heartbeatIndex}_${nonce}` });
    if (!advanced.ok || advanced.data.confirmedThroughMs !== next) {
      throw new Error(`MEDIA_HEARTBEAT_${advanced.code ?? 'INVALID_RECEIPT'}`);
    }
    through = next;
    heartbeatIndex++;
  }
  stage = 'teacher-read';
  const completion = await teacherQuery.getCompletion(teacherActor, taskId, {}, { limit: 20 });
  const frozen = await db.get('tasks', taskId);
  if (!completion.ok || completion.data.assignments.items.length !== 1
    || frozen?.items?.[0]?.mediaSnapshot?.durationMs !== durationMs) {
    throw new Error('TEACHER_OR_SNAPSHOT_READBACK_FAILED');
  }
  stage = 'recycle';
  const cleaned = await service.recycleTask(teacherActor, taskId,
    '盘古开天视频非生产验证完成，保留历史关系和审计。', frozen.version,
    `operation_cip50055_recycle_${nonce}`);
  if (!cleaned.ok) throw new Error(`RECYCLE_${cleaned.error?.code ?? 'INVALID_RECEIPT'}`);
  recycled = true;
  process.stdout.write(JSON.stringify({ status: 'passed', taskId,
    studentRead: true, signedPlayback: true, blockedForwardSeek: true,
    confirmedThroughMs: through, frozenSnapshot: true,
    recycled: true, historyDeleted: false }) + '\n');
} catch (error) {
  if (created && !recycled) {
    const current = await db.get('tasks', taskId).catch(() => null);
    if (current?.visibility !== 'recycled' && Number.isSafeInteger(current?.version)) {
      const cleanup = await service.recycleTask(teacherActor, taskId,
        '盘古开天视频验证失败后的精确软回收。', current.version,
        `operation_cip50055_cleanup_${nonce}`);
      recycled = cleanup.ok;
    }
  }
  process.stdout.write(JSON.stringify({ status: 'failed', stage,
    code: String(error?.message ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80),
    recycled }) + '\n');
  process.exit(2);
}
