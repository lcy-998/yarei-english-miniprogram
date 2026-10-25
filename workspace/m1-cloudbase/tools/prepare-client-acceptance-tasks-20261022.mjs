// Publish varied classroom tasks for the three retained virtual acceptance accounts.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'package.json'));
const { build } = require('esbuild');
const envId = 'cloud1-d8ggzrwwedb786e41';
const orgId = 'org_qihang_demo';
const teacherId = 'usr_teacher_demo_01';
const studentId = 'usr_student_g3_01';
const parentId = 'usr_parent_demo_01';
const classId = 'cls_grade3_2';
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const pack = label => ['s1_q1', 's1_q2', 's2_q1', 's2_q2', 's2_q3']
  .map(suffix => `exercise_pack_original_g3_${label}_20261020_v5_${suffix}`);
const a = pack('a');
const b = pack('b');
const IDs = {
  readingListening: 'task_client_accept_20261022_read_listen',
  videoExercise: 'task_client_accept_20261022_video_exercise',
  speaking: 'task_client_accept_20261022_speaking',
  vocabularyExercise: 'task_client_accept_20261022_vocab_exercise',
  textbook: 'task_client_accept_20261022_textbook',
  pending: 'task_client_accept_20261022_pending',
  scored: 'task_client_accept_20261022_scored',
  returned: 'task_client_accept_20261022_returned',
};
const resourceIds = [
  'res_formal_sbc0008_v1_20261007',
  'res_launch_sbc0008_listening_v2_20261013',
  'res_sbc0008_video_5q_v1_20261015',
  'res_launch_sbc0008_recording_v1_20261012',
  'res_launch_sbc0008_dubbing_credited_v1_20261012',
  'supplement-pep3a-u2-complete-v1',
  'book-unknown-3a',
  'supplement-pep3a-u1-complete-v1', ...a, ...b,
];
function cliJson(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error(`CLOUD_CLI_FAILED:${args[0]}`);
  return parsed.data;
}
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const localEnv = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
const envs = cliJson(['env', 'list', '--json']);
if (localEnv !== envId || config.envId !== envId || !Array.isArray(envs)
  || envs.length !== 1 || envs[0].EnvId !== envId || envs[0].Status !== 'NORMAL'
  || envs[0].PackageName !== '个人版' || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no' || envs[0].EnableOverrun !== false) {
  throw new Error('NONPRODUCTION_COST_GATE');
}
const quota = cliJson(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 180000) throw new Error('WRITE_QUOTA_GATE');
const token = cliJson(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token });
const entry = join(root, '.runtime/client-acceptance-20261022/entry-publish.cjs');
await mkdir(resolve(entry, '..'), { recursive: true });
await build({ entryPoints: [join(root, 'src/seed/m2-acceptance-entry.ts')], outfile: entry,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(entry);
const db = api.createCloudBaseDocumentDatabase(app.database());
const [teacher, student, parent, roles, grants, memberships, links, resources] = await Promise.all([
  db.get('users', teacherId), db.get('users', studentId), db.get('users', parentId),
  db.find('role_assignments', { organizationId: orgId, userId: teacherId,
    status: 'active', deletedAt: null }),
  db.find('teacher_class_grants', { organizationId: orgId, teacherId, classId,
    status: 'active', deletedAt: null }),
  db.find('class_memberships', { organizationId: orgId, studentId, classId,
    status: 'active', deletedAt: null }),
  db.find('parent_student_links', { organizationId: orgId, parentId, studentId,
    status: 'active', deletedAt: null }),
  Promise.all(resourceIds.map(id => db.get('learning_resources', id))),
]);
const role = roles.find(item => item.role === 'teacher');
if ([teacher, student, parent].some(user => user?.organizationId !== orgId
  || user.status !== 'active' || user.deletedAt !== null)
  || !role?.permissions?.includes('task.publish')
  || !grants.some(row => row.permissions?.includes('task.publish'))
  || memberships.length !== 1 || links.length !== 1) throw new Error('ACCOUNT_PERMISSION_GATE');
const byId = new Map(resources.map((row, index) => [resourceIds[index], row]));
if (resources.some((row, index) => row?._id !== resourceIds[index]
  || row.organizationId !== orgId || row.status !== 'published'
  || row.copyrightStatus !== 'verified' || row.deletedAt !== null
  || row.testOnly === true)) throw new Error('RESOURCE_PUBLICATION_GATE');
for (const [label, ids] of [['a', a], ['b', b]]) {
  const rows = ids.map(id => byId.get(id));
  if (rows.length !== 5 || rows.some(row => row.type !== 'exercise'
    || row.payload?.assetLibrary?.exercisePackId
      !== `exercise_pack_original_g3_${label}_20261020_v5`)
    || new Set(rows.map(row => row.payload?.exerciseSection?.id)).size !== 2) {
    throw new Error(`EXERCISE_PACK_GATE:${label}`);
  }
}
const book = byId.get('book-unknown-3a');
const bookPages = book?.payload?.chapters?.find(chapter => chapter.id === 'book-unknown-3a-chapter-02')
  ?.pages?.slice(0, 3).map(page => page.id);
if (book?.type !== 'reading' || bookPages?.length !== 3
  || byId.get('res_formal_sbc0008_v1_20261007')?.payload?.chapters
    ?.reduce((sum, chapter) => sum + (chapter.pages?.length ?? 0), 0) !== 10
  || byId.get('res_sbc0008_video_5q_v1_20261015')?.payload?.teacherMedia?.questionIds?.length !== 5
  || byId.get('res_launch_sbc0008_listening_v2_20261013')?.payload?.teacherMedia?.questionIds?.length !== 4) {
  throw new Error('CONTENT_COMPLETENESS_GATE');
}
const exerciseRefs = ids => ids.map(resourceId => ({ resourceId,
  completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
  scoringRule: { kind: byId.get(resourceId).payload.questionType === 'subjective'
    ? 'manual' : 'automatic', maxScore: 100 } }));
const specs = [
  { id: IDs.readingListening, title: '甲方验收 01｜绘本阅读与动作听力',
    description: '阅读绘本、体验点读与跟读，再听完整音频并完成四题。',
    refs: [
      { resourceId: resourceIds[0], completionRule: { kind: 'reading_pages', requiredPageCount: 10 },
        scoringRule: { kind: 'manual', maxScore: 100 } },
      { resourceId: resourceIds[1], completionRule: { kind: 'listening',
        questionIds: [1, 2, 3, 4].map(n => `sbc0008-listening-q${n}-v3`),
        segmentIds: [1, 2, 3, 4].map(n => `sbc0008-listening-q${n}-v3_segment`) },
        scoringRule: { kind: 'automatic', maxScore: 100 } },
    ] },
  { id: IDs.videoExercise, title: '甲方验收 02｜视频理解与班级花园',
    description: '观看完整视频并完成五题，再完成两道大题、五道小题的分层习题。',
    refs: [
      { resourceId: resourceIds[2], completionRule: { kind: 'video', durationMs: 28032,
        questionIds: byId.get(resourceIds[2]).payload.teacherMedia.questionIds },
        scoringRule: { kind: 'automatic', maxScore: 100 } }, ...exerciseRefs(a),
    ] },
  { id: IDs.speaking, title: '甲方验收 03｜朗读录音与视频配音',
    description: '朗读绘本原句并录音，再观看示范视频、录制和提交配音作品。',
    refs: [
      { resourceId: resourceIds[3], completionRule: { kind: 'recording_upload' },
        scoringRule: { kind: 'manual', maxScore: 100 } },
      { resourceId: resourceIds[4], completionRule: { kind: 'dubbing' },
        scoringRule: { kind: 'manual', maxScore: 100 } },
    ] },
  { id: IDs.vocabularyExercise, title: '甲方验收 04｜家人单词与周末计划',
    description: '练习三上 Unit 2 家人词汇，并完成另一份两道大题的习题组。',
    refs: [
      { resourceId: resourceIds[5], completionRule: { kind: 'vocabulary_words', requiredWordCount: 5 },
        scoringRule: { kind: 'automatic', maxScore: 100 } }, ...exerciseRefs(b),
    ] },
  { id: IDs.textbook, title: '甲方验收 05｜同步课本与单词',
    description: '阅读三上 Unit 1 指定三页，练习同单元五个单词。',
    refs: [
      { resourceId: resourceIds[6], completionRule: { kind: 'reading_pages',
        requiredPageCount: 3, pageIds: bookPages }, scoringRule: { kind: 'manual', maxScore: 100 } },
      { resourceId: resourceIds[7], completionRule: { kind: 'vocabulary_words', requiredWordCount: 5 },
        scoringRule: { kind: 'automatic', maxScore: 100 } },
    ] },
  { id: IDs.pending, title: '甲方验收 06｜待检查作业示例',
    description: '两道大题、五道小题；由虚构学生正式提交后供教师逐题检查。',
    refs: exerciseRefs(b), resultFixture: 'awaiting_review' },
  { id: IDs.scored, title: '甲方验收 07｜已评分反馈示例',
    description: '客观题自动分与主观题人工分合成，供家长只读查看反馈。',
    refs: exerciseRefs(a), resultFixture: 'reviewed' },
  { id: IDs.returned, title: '甲方验收 08｜退回重做示例',
    description: '首次提交含错误答案，教师给出原因后退回重做。',
    refs: exerciseRefs(b), resultFixture: 'returned' },
];
const existing = await Promise.all(specs.map(spec => db.get('tasks', spec.id)));
if (mode === 'inspect') {
  if (existing.some(Boolean)) throw new Error('TASK_ID_NOT_EMPTY');
  process.stdout.write(JSON.stringify({ status: 'ready', environment: 'verified_nonproduction',
    titles: specs.map(spec => spec.title), teacherAuthorized: true,
    parentStudentLinked: true, newAssignments: specs.length,
    resourceTypes: [...new Set(resourceIds.map(id => byId.get(id).type))],
    quotaWrites: quota.Value }) + '\n');
  process.exit(0);
}
let requestSeq = 0;
let idSeq = 0;
let currentTaskId = '';
const ids = { next: prefix => prefix === 'task' ? currentTaskId
  : `${prefix}_client_accept_20261022_${++idSeq}` };
const requestIds = { next: () => `request_client_accept_20261022_${++requestSeq}` };
const clock = { nowIso: () => new Date().toISOString() };
const service = new api.TaskCoreService(api.createTaskCoreDocumentRepository(db),
  api.createIdentityDocumentRepository(db), clock, ids, requestIds);
const teacherActor = { requestId: requestIds.next(), sessionId: 'client-acceptance-setup',
  actorUserId: teacherId, actorRole: 'teacher', organizationId: orgId,
  platformSubjectDigest: 'client-acceptance-setup', permissions: role.permissions,
  scopeIds: [classId], authzVersion: teacher.authzVersion ?? 1 };
const studentActor = { ...teacherActor, requestId: requestIds.next(),
  actorUserId: studentId, actorRole: 'student', permissions: [],
  authzVersion: student.authzVersion ?? 1 };
const queryDeps = { repository: api.createTaskQueryDocumentRepository(db), clock, requestIds };
const studentQuery = new api.StudentTaskQueryService(queryDeps);
const teacherQuery = new api.TeacherTaskQueryService(queryDeps);
if (mode === 'apply') {
  for (const [index, spec] of specs.entries()) {
    if (existing[index]) {
      if (existing[index].title !== spec.title || existing[index].creatorTeacherId !== teacherId
        || existing[index].visibility !== 'visible') throw new Error(`EXISTING_TASK_CONFLICT:${spec.id}`);
      process.stdout.write(JSON.stringify({ stage: 'already_published', id: spec.id }) + '\n');
      continue;
    }
    currentTaskId = spec.id;
    const now = Date.now();
    const saved = await service.saveTaskDraft(teacherActor, {
      title: spec.title, description: spec.description,
      teacherNote: '仅用于甲方在非生产环境验收；学员与作答均为虚构。',
      itemRefs: spec.refs.map((ref, itemIndex) => ({ id: `item_client_accept_${index + 1}_${itemIndex + 1}`,
        resourceId: ref.resourceId, completionRule: ref.completionRule,
        scoringRule: ref.scoringRule, order: itemIndex + 1 })),
      targetType: 'students', targetClassIds: [], targetStudentIds: [studentId],
      startsAt: new Date(now - 60_000).toISOString(),
      dueAt: new Date(now + 30 * 86400_000).toISOString(),
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, `op_client_accept_save_${index + 1}`);
    if (!saved.ok || saved.data?.taskId !== spec.id) {
      throw new Error(`TASK_SAVE_FAILED:${spec.id}:${saved.error?.code ?? 'UNKNOWN'}`);
    }
    const published = await service.publishTask(teacherActor, spec.id, saved.data.version,
      `op_client_accept_publish_${index + 1}`);
    if (!published.ok || published.data?.status !== 'active') {
      throw new Error(`TASK_PUBLISH_FAILED:${spec.id}:${published.error?.code ?? 'UNKNOWN'}`);
    }
    const studentView = await studentQuery.getMyTask(studentActor, spec.id);
    const teacherView = await teacherQuery.getCompletion(teacherActor, spec.id, {}, { limit: 20 });
    if (!studentView.ok || studentView.data.items?.length !== spec.refs.length
      || !teacherView.ok || teacherView.data.assignments.items.length !== 1) {
      throw new Error(`TASK_READBACK_FAILED:${spec.id}`);
    }
    process.stdout.write(JSON.stringify({ stage: 'published', id: spec.id,
      title: spec.title, itemCount: spec.refs.length,
      studentReadable: true, teacherReadable: true }) + '\n');
  }
}
const final = await Promise.all(specs.map(spec => db.get('tasks', spec.id)));
if (final.some((row, index) => !row || row.creatorTeacherId !== teacherId
  || row.visibility !== 'visible' || row.title !== specs[index].title
  || row.targetStudentIds?.length !== 1 || row.targetStudentIds[0] !== studentId)) {
  throw new Error('FINAL_TASK_READBACK_FAILED');
}
const assignmentRows = await db.find('task_assignments', { organizationId: orgId,
  studentId, deletedAt: null });
if (specs.some(spec => !assignmentRows.some(row => row.taskId === spec.id))) {
  throw new Error('FINAL_ASSIGNMENT_READBACK_FAILED');
}
process.stdout.write(JSON.stringify({ status: 'verified', tasks: final.length,
  studentAssignments: specs.length,
  dueAtRange: [final.map(row => row.dueAt).sort()[0], final.map(row => row.dueAt).sort().at(-1)],
  titles: final.map(row => row.title) }) + '\n');
