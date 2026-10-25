// A single fictional learner receives all seven reviewed teaching content types, then task is recycled.
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
const content = [
  { type: 'reading', id: 'res_formal_sbc0008_v1_20261007',
    rule: { kind: 'reading_pages', requiredPageCount: 10 }, score: { kind: 'manual', maxScore: 100 } },
  { type: 'vocabulary', id: 'res_launch_pep3a_u2_vocabulary_v1_20261012',
    rule: { kind: 'vocabulary_words', requiredWordCount: 3 }, score: { kind: 'manual', maxScore: 100 } },
  { type: 'exercise', id: 'res_prod_sbc0008_exercise_01_v3',
    rule: { kind: 'exercise_questions', requiredQuestionCount: 1 }, score: { kind: 'automatic', maxScore: 100 } },
  { type: 'recording', id: 'res_launch_sbc0008_recording_v1_20261012',
    rule: { kind: 'recording_upload' }, score: { kind: 'manual', maxScore: 100 } },
  { type: 'listening', id: 'res_launch_sbc0008_listening_v2_20261013',
    rule: { kind: 'listening',
      questionIds: [1, 2, 3, 4].map(n => `sbc0008-listening-q${n}-v3`),
      segmentIds: [1, 2, 3, 4].map(n => `sbc0008-listening-q${n}-v3_segment`) },
    score: { kind: 'automatic', maxScore: 100 } },
  { type: 'video', id: 'res_launch_sbc0008_video_credited_v1_20261012',
    rule: { kind: 'video', durationMs: 28032, questionIds: [] },
    score: { kind: 'completion_only' } },
  { type: 'dubbing', id: 'res_launch_sbc0008_dubbing_credited_v1_20261012',
    rule: { kind: 'dubbing' }, score: { kind: 'manual', maxScore: 100 } },
];
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
const sdk = require('@cloudbase/node-sdk');
const app = sdk.init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token });
const entry = join(root, '.runtime/launch-seven-content-probe-20261013/entry.cjs');
await mkdir(dirname(entry), { recursive: true });
await build({ entryPoints: [join(root, 'src/seed/m2-acceptance-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(entry);
const db = api.createCloudBaseDocumentDatabase(app.database());
const mediaEntry = join(root, '.runtime/launch-seven-content-probe-20261013/media.cjs');
await build({ entryPoints: [join(root, 'src/seed/m3-real-sample-entry.ts')],
  outfile: mediaEntry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const mediaApi = require(mediaEntry);
const [teacher, student, roleRows, grantRows, membershipRows, resourceRows] = await Promise.all([
  db.get('users', teacherId), db.get('users', studentId),
  db.find('role_assignments', { organizationId: orgId, userId: teacherId,
    status: 'active', deletedAt: null }),
  db.find('teacher_class_grants', { organizationId: orgId, teacherId,
    classId, status: 'active', deletedAt: null }),
  db.find('class_memberships', { organizationId: orgId, classId,
    studentId, status: 'active', deletedAt: null }),
  Promise.all(content.map(item => db.get('learning_resources', item.id))),
]);
const role = roleRows.find(row => row.role === 'teacher') ?? roleRows[0];
const grant = grantRows[0];
if (teacher?.status !== 'active' || student?.status !== 'active'
  || !role?.permissions?.includes('task.publish') || !role.permissions.includes('content.read')
  || !grant?.permissions?.includes('task.publish') || !grant.permissions.includes('content.read')
  || membershipRows.length !== 1
  || resourceRows.some((row, i) => !row || row.status !== 'published'
    || row.type !== content[i].type || row.copyrightStatus !== 'verified'
    || row.testOnly === true)) throw new Error('ACTOR_OR_CONTENT_PREFLIGHT');
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    contentTypes: content.map(item => item.type), oneFictionalStudent: true,
    teacherAuthorized: true, cloudWrites: 0 }) + '\n');
  process.exit(0);
}
const nonce = randomUUID().replaceAll('-', '');
const taskId = `task_launch_seven_${nonce}`;
let idSequence = 0;
const ids = { next: prefix => prefix === 'task' ? taskId
  : `${prefix}_launch7_${nonce}_${++idSequence}` };
let requestSequence = 0;
const requestIds = { next: () => `request_launch7_${nonce}_${++requestSequence}` };
const teacherActor = { requestId: requestIds.next(), sessionId: 'launch-seven-probe',
  actorUserId: teacherId, actorRole: 'teacher', organizationId: orgId,
  platformSubjectDigest: 'launch-seven-probe', permissions: role.permissions,
  scopeIds: [classId], authzVersion: teacher.authzVersion ?? 1 };
const studentActor = { ...teacherActor, requestId: requestIds.next(),
  actorUserId: studentId, actorRole: 'student', permissions: [],
  authzVersion: student.authzVersion ?? 1 };
let probeNowMs = Date.now();
const clock = { nowIso: () => new Date(probeNowMs).toISOString() };
const service = new api.TaskCoreService(api.createTaskCoreDocumentRepository(db),
  api.createIdentityDocumentRepository(db), clock, ids, requestIds);
const queryDependencies = { repository: api.createTaskQueryDocumentRepository(db),
  clock, requestIds };
const studentQuery = new api.StudentTaskQueryService(queryDependencies);
const teacherQuery = new api.TeacherTaskQueryService(queryDependencies);
const now = Date.now();
const input = { title: '七类正式来源素材非生产验证',
  itemRefs: content.map((item, index) => ({ id: `item_launch7_${index + 1}`,
    resourceId: item.id, completionRule: item.rule,
    scoringRule: item.score, order: index + 1 })),
  targetType: 'students', targetClassIds: [], targetStudentIds: [studentId],
  startsAt: new Date(now - 60000).toISOString(),
  dueAt: new Date(now + 86400000).toISOString(),
  latePolicy: { allowLate: true, lateDays: 7 },
  description: '仅非生产虚构学生，发布与只读查询后立即软回收。', teacherNote: '' };
let stage = 'save';
let created = false;
let recycled = false;
try {
  const saved = await service.saveTaskDraft(teacherActor, input, 0,
    `operation_launch7_save_${nonce}`);
  if (!saved.ok || saved.data?.taskId !== taskId || saved.data?.version !== 1) {
    throw new Error(`SAVE_${saved.error?.code ?? 'INVALID_RECEIPT'}`);
  }
  created = true;
  stage = 'publish';
  const published = await service.publishTask(teacherActor, taskId, 1,
    `operation_launch7_publish_${nonce}`);
  if (!published.ok || !['active', 'scheduled'].includes(published.data?.status)) {
    throw new Error(`PUBLISH_${published.error?.code ?? 'INVALID_RECEIPT'}`);
  }
  stage = 'student-read';
  const task = await studentQuery.getMyTask(studentActor, taskId);
  if (!task.ok || task.data.items?.length !== content.length
    || content.some((item, index) => task.data.items[index]?.resourceId !== item.id)) {
    throw new Error(`STUDENT_READ_${task.error?.code ?? 'INVALID_ITEMS'}`);
  }
  stage = 'media-playback';
  const media = new mediaApi.TaskMediaPlaybackService(
    new mediaApi.DocumentTaskMediaPlaybackPort(
      mediaApi.createTaskCoreDocumentRepository(db), db,
      new mediaApi.CloudBaseWorkPlayback(app), clock), clock);
  const mediaResults = [];
  for (const index of [4, 5, 6]) {
    const item = content[index];
    const itemId = `item_launch7_${index + 1}`;
    const begun = await media.begin(studentActor, taskId, itemId,
      `operation_launch7_media_begin_${index}_${nonce}`);
    if (!begun.ok || begun.data.status !== 'ready'
      || !begun.data.temporaryUrl?.startsWith('https://') || !begun.data.sessionId) {
      throw new Error(`MEDIA_BEGIN_${item.type}_${begun.code ?? 'INVALID_RECEIPT'}`);
    }
    const jumped = await media.heartbeat(studentActor, {
      sessionId: begun.data.sessionId, playedFromMs: 5000,
      playedToMs: 6000, positionMs: 6000,
      operationId: `operation_launch7_jump_${index}_${nonce}` });
    if (jumped.ok || jumped.code !== 'SEEK_FORWARD') {
      throw new Error(`MEDIA_SEEK_FORWARD_NOT_BLOCKED_${item.type}`);
    }
    const duration = index === 4 ? 25011 : 28032;
    let through = 0;
    let heartbeatIndex = 0;
    while (through < duration) {
      probeNowMs += 2500;
      const next = Math.min(duration, through + 4000);
      const advanced = await media.heartbeat(studentActor, {
        sessionId: begun.data.sessionId, playedFromMs: through,
        playedToMs: next, positionMs: next,
        operationId: `operation_launch7_heartbeat_${index}_${heartbeatIndex}_${nonce}` });
      if (!advanced.ok || advanced.data.confirmedThroughMs !== next) {
        throw new Error(`MEDIA_HEARTBEAT_${item.type}_${advanced.code ?? 'INVALID_RECEIPT'}`);
      }
      through = next;
      heartbeatIndex++;
    }
    mediaResults.push({ type: item.type, confirmedThroughMs: through,
      completed: true, blockedForwardSeek: true });
  }
  stage = 'teacher-read';
  const completion = await teacherQuery.getCompletion(teacherActor, taskId, {}, { limit: 20 });
  if (!completion.ok || completion.data.assignments.items.length !== 1) {
    throw new Error(`TEACHER_READ_${completion.error?.code ?? 'INVALID_ASSIGNMENTS'}`);
  }
  const frozen = await db.get('tasks', taskId);
  if (frozen?.items?.length !== 7
    || frozen.items.find(item => item.resourceSnapshot?.type === 'listening')?.mediaSnapshot?.questionIds?.length !== 4
    || frozen.items.find(item => item.resourceSnapshot?.type === 'video')?.mediaSnapshot?.durationMs !== 28032
    || frozen.items.find(item => item.resourceSnapshot?.type === 'dubbing')?.mediaSnapshot?.durationMs !== 28032) {
    throw new Error('FROZEN_CONTENT_MISMATCH');
  }
  stage = 'recycle';
  const cleaned = await service.recycleTask(teacherActor, taskId,
    '七类资料非生产发布验证完成，保留历史关系与审计。', frozen.version,
    `operation_launch7_recycle_${nonce}`);
  if (!cleaned.ok) throw new Error(`RECYCLE_${cleaned.error?.code ?? 'INVALID_RECEIPT'}`);
  recycled = true;
  process.stdout.write(JSON.stringify({ status: 'passed', taskId,
    publishedItems: 7, studentRead: true, teacherRead: true,
    mediaQuestionCount: 4, creditedVideoDurationMs: 28032,
    mediaResults,
    recycled: true, historyDeleted: false }) + '\n');
} catch (error) {
  if (created && !recycled) {
    const current = await db.get('tasks', taskId).catch(() => null);
    if (current?.visibility !== 'recycled' && Number.isSafeInteger(current?.version)) {
      const cleanup = await service.recycleTask(teacherActor, taskId,
        '七类资料验证失败后的精确软回收。', current.version,
        `operation_launch7_cleanup_${nonce}`).catch(() => null);
      recycled = cleanup?.ok === true;
    }
  }
  process.stdout.write(JSON.stringify({ status: 'failed', stage,
    taskId: created ? taskId : null, recycled,
    reason: String(error?.message ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) }) + '\n');
  process.exitCode = 2;
}
process.exit(process.exitCode ?? 0);
