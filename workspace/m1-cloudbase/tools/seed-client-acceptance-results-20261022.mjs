// Use the virtual student/teacher service identities to create three real business states.
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
const specs = [
  { name: 'pending', id: 'task_client_accept_20261022_pending', pack: 'b', expected: 'awaiting_review' },
  { name: 'scored', id: 'task_client_accept_20261022_scored', pack: 'a', expected: 'completed' },
  { name: 'returned', id: 'task_client_accept_20261022_returned', pack: 'b', expected: 'redo_required' },
];
function cliJson(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error(`CLOUD_CLI_FAILED:${args[0]}`);
  return parsed.data;
}
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const localEnv = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
const envs = cliJson(['env', 'list', '--json']);
if (config.envId !== envId || localEnv !== envId || !Array.isArray(envs)
  || envs.length !== 1 || envs[0].EnvId !== envId || envs[0].Status !== 'NORMAL'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_GATE');
const quota = cliJson(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 180000) throw new Error('WRITE_QUOTA_GATE');
const token = cliJson(['secrets', 'get', '--json']);
if (token?.envId !== envId || token.isTemporary !== true
  || Date.parse(token.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: token.secretId, secretKey: token.secretKey, sessionToken: token.token });
const entry = join(root, '.runtime/client-acceptance-20261022/entry-results.cjs');
await mkdir(resolve(entry, '..'), { recursive: true });
await build({ entryPoints: [join(root, 'src/seed/m2-acceptance-entry.ts')], outfile: entry,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(entry);
const db = api.createCloudBaseDocumentDatabase(app.database());
const [teacher, student, parent, roles, grants, membership, link] = await Promise.all([
  db.get('users', teacherId), db.get('users', studentId), db.get('users', parentId),
  db.find('role_assignments', { organizationId: orgId, userId: teacherId,
    status: 'active', deletedAt: null }),
  db.find('teacher_class_grants', { organizationId: orgId, teacherId, classId,
    status: 'active', deletedAt: null }),
  db.find('class_memberships', { organizationId: orgId, studentId, classId,
    status: 'active', deletedAt: null }),
  db.find('parent_student_links', { organizationId: orgId, parentId, studentId,
    status: 'active', deletedAt: null }),
]);
const role = roles.find(item => item.role === 'teacher');
if ([teacher, student, parent].some(row => row?.organizationId !== orgId
  || row.status !== 'active' || row.deletedAt !== null)
  || !role?.permissions?.includes('submission.review') || grants.length === 0
  || membership.length !== 1 || link.length !== 1) throw new Error('ACCOUNT_RELATIONSHIP_GATE');
let idSeq = 0;
let requestSeq = 0;
const ids = { next: prefix => `${prefix}_client_results_20261022_${++idSeq}` };
const requestIds = { next: () => `request_client_results_20261022_${++requestSeq}` };
const clock = { nowIso: () => new Date().toISOString() };
const service = new api.TaskCoreService(api.createTaskCoreDocumentRepository(db),
  api.createIdentityDocumentRepository(db), clock, ids, requestIds);
const teacherActor = { requestId: requestIds.next(), sessionId: 'client-results-setup',
  actorUserId: teacherId, actorRole: 'teacher', organizationId: orgId,
  platformSubjectDigest: 'client-results-setup', permissions: role.permissions,
  scopeIds: [classId], authzVersion: teacher.authzVersion ?? 1 };
const studentActor = { ...teacherActor, requestId: requestIds.next(),
  actorUserId: studentId, actorRole: 'student', permissions: [],
  authzVersion: student.authzVersion ?? 1 };
const queryDeps = { repository: api.createTaskQueryDocumentRepository(db), clock, requestIds };
const studentQuery = new api.StudentTaskQueryService(queryDeps);
const reviewQuery = new api.ReviewQueryService(queryDeps);
const exerciseIds = [...new Set(specs.flatMap(spec => ['s1_q1', 's1_q2', 's2_q1', 's2_q2', 's2_q3']
  .map(suffix => `exercise_pack_original_g3_${spec.pack}_20261020_v5_${suffix}`)))];
const exerciseRows = await Promise.all(exerciseIds.map(id => db.get('learning_resources', id)));
const exerciseById = new Map(exerciseRows.map((row, index) => [exerciseIds[index], row]));
if (exerciseRows.some(row => !row || row.status !== 'published' || row.type !== 'exercise')) {
  throw new Error('EXERCISE_SOURCE_GATE');
}
const live = [];
for (const spec of specs) {
  const task = await db.get('tasks', spec.id);
  const studentView = await studentQuery.getMyTask(studentActor, spec.id);
  if (!task || task.creatorTeacherId !== teacherId || task.visibility !== 'visible'
    || !studentView.ok || studentView.data.items?.length !== 5
    || studentView.data.items.some(item => item.type !== 'exercise'
      || item.exerciseQuestion?.exercisePackId
        !== `exercise_pack_original_g3_${spec.pack}_20261020_v5`)) {
    throw new Error(`TASK_SNAPSHOT_GATE:${spec.id}`);
  }
  live.push({ spec, task, view: studentView.data });
}
if (mode === 'inspect') {
  if (live.some(row => row.view.assignment.status !== 'not_started'
    || row.view.assignment.latestSubmissionId)) throw new Error('RESULT_FIXTURE_NOT_FRESH');
  process.stdout.write(JSON.stringify({ status: 'ready', resultStates: specs.map(s => s.expected),
    tasks: specs.map(s => s.id), quotaWrites: quota.Value }) + '\n');
  process.exit(0);
}
function wrongAnswer(question) {
  if (question.questionType === 'multiple_choice') return ['incorrect option'];
  if (Array.isArray(question.options) && question.options.length > 0) {
    return question.options.find(option => JSON.stringify(option)
      !== JSON.stringify(question.correctAnswer)) ?? 'incorrect option';
  }
  return 'I need to try this again.';
}
if (mode === 'apply') {
  for (const { spec, view } of live) {
    if (view.assignment.status !== 'not_started' || view.assignment.latestSubmissionId) {
      process.stdout.write(JSON.stringify({ stage: 'already_started', taskId: spec.id,
        status: view.assignment.status }) + '\n');
      continue;
    }
    const answers = view.items.map((item, index) => {
      const question = exerciseById.get(item.resourceId)?.payload;
      if (!question) throw new Error(`EXERCISE_SOURCE_MISSING:${item.resourceId}`);
      const response = spec.name === 'returned' && (index === 0 || index === 4)
        ? wrongAnswer(question) : question.correctAnswer;
      return { itemId: item.id, value: { kind: 'exercise',
        questionResponses: [{ questionId: item.resourceId, response }] } };
    });
    const submitted = await service.submit(studentActor, spec.id, answers,
      view.assignment.version, undefined, `op_client_results_submit_${spec.name}`);
    if (!submitted.ok || !submitted.data?.submissionId) {
      throw new Error(`SUBMIT_FAILED:${spec.name}:${submitted.error?.code ?? 'UNKNOWN'}`);
    }
    const reviewView = await reviewQuery.getSubmissionForReview(teacherActor,
      submitted.data.submissionId);
    if (!reviewView.ok || reviewView.data?.exerciseEvidence?.length !== 5) {
      throw new Error(`REVIEW_EVIDENCE_FAILED:${spec.name}`);
    }
    if (spec.name === 'pending') {
      process.stdout.write(JSON.stringify({ stage: 'awaiting_review', taskId: spec.id,
        submissionId: submitted.data.submissionId }) + '\n');
      continue;
    }
    const manualRows = view.items.filter(item => exerciseById.get(item.resourceId)?.payload?.questionType === 'subjective');
    if (manualRows.length !== 1) throw new Error(`MANUAL_SCORE_SCOPE:${spec.name}`);
    const reviewed = await service.publishReview(teacherActor, {
      submissionId: submitted.data.submissionId,
      decision: spec.name === 'returned' ? 'returned' : 'approved',
      itemScores: [{ itemId: manualRows[0].id, score: spec.name === 'returned' ? 20 : 85 }],
      textComment: spec.name === 'returned'
        ? '请先核对题目材料，再按题目要求重新作答。'
        : '能根据材料完成客观题，主观表达也比较清楚；继续练习用完整句说明想法。',
      ...(spec.name === 'returned' ? { returnReason: '第一题与最后一题需重新核对并补充完整回答。' } : {}),
      expectedSubmissionVersion: reviewView.data.submissionVersion,
    }, reviewView.data.assignmentVersion, `op_client_results_review_${spec.name}`);
    if (!reviewed.ok) throw new Error(`REVIEW_FAILED:${spec.name}:${reviewed.error?.code ?? 'UNKNOWN'}`);
    process.stdout.write(JSON.stringify({ stage: spec.expected, taskId: spec.id,
      submissionId: submitted.data.submissionId,
      feedbackId: reviewed.data.feedbackId }) + '\n');
  }
  const progressId = 'task_client_accept_20261022_vocab_exercise';
  const progressView = await studentQuery.getMyTask(studentActor, progressId);
  if (!progressView.ok || progressView.data.items?.length !== 6) throw new Error('PROGRESS_TASK_QUERY_FAILED');
  if (progressView.data.assignment.status === 'not_started') {
    const exerciseItem = progressView.data.items.find(item => item.type === 'exercise');
    const source = exerciseById.get(exerciseItem?.resourceId);
    if (!exerciseItem || !source) throw new Error('PROGRESS_EXERCISE_MISSING');
    const draft = await service.saveSubmissionDraft(studentActor, progressId, [{
      itemId: exerciseItem.id, value: { kind: 'exercise', questionResponses: [{
        questionId: exerciseItem.resourceId, response: source.payload.correctAnswer,
      }] },
    }], progressView.data.assignment.version, undefined, 'op_client_results_partial_draft');
    if (!draft.ok) throw new Error(`PROGRESS_DRAFT_FAILED:${draft.error?.code ?? 'UNKNOWN'}`);
    process.stdout.write(JSON.stringify({ stage: 'in_progress', taskId: progressId }) + '\n');
  }
}
const final = [];
for (const spec of specs) {
  const view = await studentQuery.getMyTask(studentActor, spec.id);
  if (!view.ok) throw new Error(`FINAL_STUDENT_QUERY:${spec.name}`);
  const assignment = view.data.assignment;
  const submissions = await db.find('submissions', { organizationId: orgId,
    taskId: spec.id, studentId, deletedAt: null });
  const feedback = await db.find('review_feedback', { organizationId: orgId,
    taskId: spec.id, deletedAt: null });
  if (submissions.length !== 1 || feedback.length !== (spec.name === 'pending' ? 0 : 1)) {
    throw new Error(`FINAL_RESULT_COUNT:${spec.name}`);
  }
  final.push({ name: spec.name, taskId: spec.id, assignmentStatus: assignment.status,
    submissionStatus: submissions[0].status, feedbackDecision: feedback[0]?.decision ?? null,
    score: feedback[0]?.score ?? null, feedbackId: feedback[0]?.id ?? null });
}
if (final[0].assignmentStatus !== 'awaiting_review'
  || final[1].assignmentStatus !== 'completed'
  || final[2].assignmentStatus !== 'redo_required'
  || final[1].feedbackDecision !== 'approved'
  || final[2].feedbackDecision !== 'returned') {
  process.stdout.write(JSON.stringify({ diagnostic: 'final_state', states: final }) + '\n');
  throw new Error('FINAL_STATE_MISMATCH');
}
const progressView = await studentQuery.getMyTask(studentActor,
  'task_client_accept_20261022_vocab_exercise');
const untouchedView = await studentQuery.getMyTask(studentActor,
  'task_client_accept_20261022_read_listen');
if (!progressView.ok || progressView.data.assignment.status !== 'in_progress'
  || !untouchedView.ok || untouchedView.data.assignment.status !== 'not_started') {
  throw new Error('PROGRESS_OR_FRESH_TASK_STATE_MISMATCH');
}
const parentEntry = join(root, '.runtime/client-acceptance-20261022/parent-results.cjs');
await build({ entryPoints: [join(root, 'src/task-query/parent-service.ts')], outfile: parentEntry,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const { ParentTaskQueryService } = require(parentEntry);
const parentRoles = await db.find('role_assignments', { organizationId: orgId,
  userId: parentId, status: 'active', deletedAt: null });
const parentRole = parentRoles.find(item => item.role === 'parent');
const parentActor = { ...teacherActor, requestId: requestIds.next(), actorUserId: parentId,
  actorRole: 'parent', permissions: parentRole?.permissions ?? [], scopeIds: [],
  authzVersion: parent.authzVersion ?? 1 };
const parentQuery = new ParentTaskQueryService({ repository: api.createTaskQueryDocumentRepository(db),
  identities: api.createIdentityDocumentRepository(db), clock, requestIds });
const parentList = await parentQuery.listChildTasks(parentActor, studentId, {}, { limit: 20 });
if (!parentList.ok || !parentList.data.items.some(item => item.taskId === specs[1].id)) {
  throw new Error('PARENT_TASK_LIST_FAILED');
}
const parentFeedback = await parentQuery.getFeedback(parentActor, studentId, final[1].feedbackId);
if (!parentFeedback.ok || parentFeedback.data?.feedback?.score !== final[1].score) {
  throw new Error('PARENT_FEEDBACK_READ_FAILED');
}
process.stdout.write(JSON.stringify({ status: 'verified', states: final,
  inProgressTaskId: 'task_client_accept_20261022_vocab_exercise',
  freshTaskId: 'task_client_accept_20261022_read_listen', parentRead: true }) + '\n');
