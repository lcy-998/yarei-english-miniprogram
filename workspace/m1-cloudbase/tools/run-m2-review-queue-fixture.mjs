import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('Use inspect, apply, or verify.');

const ORG = 'org_qihang_demo';
const CLASS = 'cls_grade3_2';
const TASK = 'tsk_m2_accept_exercise_20260929';
const ITEM = 'item_m2_accept_giraffe';
const QUESTION = 'res_m2_accept_giraffe_question_20260929';
const FIXTURES = [
  { studentId: 'usr_student_g3_02', response: 'giraffe' },
  { studentId: 'usr_student_g3_03', response: 'elephant' },
  { studentId: 'usr_student_g3_04', response: 'giraffe' },
];

const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const envText = await readFile(join(root, '.env.local'), 'utf8');
const privateEnvId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!privateEnvId || privateEnvId !== config.envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const { stdout } = await execute(process.execPath, [cli, 'secrets', 'get', '--json'],
  { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const firstBrace = stdout.indexOf('{');
if (firstBrace < 0) throw new Error('TEMPORARY_CREDENTIALS_UNAVAILABLE');
const credentials = JSON.parse(stdout.slice(firstBrace)).data;
if (credentials?.isTemporary !== true || credentials.envId !== privateEnvId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');

const bundle = join(root, '.runtime', 'm2-predeploy-20260927', 'm2-review-queue-entry.cjs');
await build({ entryPoints: [join(root, 'src', 'seed', 'm2-acceptance-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(bundle);
const sdk = require('@cloudbase/js-sdk');
const app = sdk.init({ env: privateEnvId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const database = api.createCloudBaseDocumentDatabase(app.database());

try {
  const task = await database.get('tasks', TASK);
  const members = await database.find('class_memberships', { organizationId: ORG, classId: CLASS,
    status: 'active', deletedAt: null });
  const assignments = await database.find('task_assignments', { organizationId: ORG, taskId: TASK });
  const item = task?.items?.find(candidate => candidate.id === ITEM);
  const question = item?.resourceSnapshot?.payload;
  if (task?.organizationId !== ORG || task?.visibility !== 'visible'
    || !['active', 'scheduled'].includes(task.status) || task.title !== 'M2验收｜长颈鹿词汇练习'
    || task.targetClassIds?.length !== 1 || task.targetClassIds[0] !== CLASS
    || task.targetStudentIds?.length !== 36 || members.length !== 36 || assignments.length !== 36
    || item?.resourceId !== QUESTION || item.resourceSnapshot.type !== 'exercise'
    || question?.questionType !== 'single_choice' || question?.correctAnswer !== 'giraffe'
    || !Array.isArray(question.options) || !question.options.includes('elephant')) {
    throw new Error('ACCEPTANCE_TASK_PREFLIGHT_FAILED');
  }
  const selected = [];
  for (const fixture of FIXTURES) {
    const user = await database.get('users', fixture.studentId);
    const membership = members.find(entry => entry.studentId === fixture.studentId);
    const assignment = assignments.find(entry => entry.studentId === fixture.studentId);
    if (user?.organizationId !== ORG || user.status !== 'active'
      || !membership || !assignment || assignment.classId !== CLASS
      || !task.targetStudentIds.includes(fixture.studentId)) throw new Error('FIXTURE_STUDENT_PREFLIGHT_FAILED');
    const expectedSubmissionId = `submission_${assignment.id}_1`;
    const submission = await database.get('submissions', `submission:${ORG}:${expectedSubmissionId}`);
    const fresh = assignment.status === 'not_started' && assignment.latestSubmissionId === null
      && assignment.latestSubmissionVersion === 0 && submission === null;
    const seeded = assignment.status === 'awaiting_review'
      && assignment.latestSubmissionId === expectedSubmissionId
      && submission?.studentId === fixture.studentId && submission.status === 'submitted'
      && submission.answers?.some(answer => answer.itemId === ITEM
        && answer.value?.questionResponses?.some(response => response.questionId === QUESTION
          && response.response === fixture.response));
    if (!fresh && !seeded) {
      const answer = submission?.answers?.find(entry => entry.itemId === ITEM)?.value;
      process.stdout.write(`TARGET_STATE=${fixture.studentId};assignment=${assignment.status};submission=${submission?.status ?? 'none'};answerKind=${answer?.kind ?? 'none'};responseCount=${answer?.questionResponses?.length ?? 0}\n`);
      throw new Error('FIXTURE_TARGET_CHANGED');
    }
    selected.push({ ...fixture, user, assignment, expectedSubmissionId, fresh, seeded });
  }
  process.stdout.write(`PREFLIGHT=passed;activeClassMembers=${members.length};taskAssignments=${assignments.length}\n`);
  process.stdout.write(`FIXTURES=fresh:${selected.filter(item => item.fresh).length};seeded:${selected.filter(item => item.seeded).length}\n`);
  if (mode === 'inspect') process.exit(0);

  if (mode === 'apply') {
    const identities = api.createIdentityDocumentRepository(database);
    const clock = { nowIso: () => new Date().toISOString() };
    const ids = { next: prefix => `${prefix}_m2_review_fixture_${randomUUID().replaceAll('-', '')}` };
    const requestIds = { next: () => `request_m2_review_fixture_${randomUUID().replaceAll('-', '')}` };
    const service = new api.TaskCoreService(api.createTaskCoreDocumentRepository(database),
      identities, clock, ids, requestIds);
    for (const fixture of selected.filter(item => item.fresh)) {
      const actor = { requestId: requestIds.next(), sessionId: 'controlled-m2-review-fixture',
        actorUserId: fixture.studentId, actorRole: 'student', organizationId: ORG,
        platformSubjectDigest: 'controlled-m2-review-fixture', permissions: [],
        scopeIds: [CLASS], authzVersion: fixture.user.authzVersion ?? 1 };
      const answer = [{ itemId: ITEM, value: { kind: 'exercise',
        questionResponses: [{ questionId: QUESTION, response: fixture.response }] } }];
      const result = await service.submit(actor, TASK, answer, fixture.assignment.version, undefined,
        `operation_m2_accept_review_queue_20261001_${fixture.studentId}`);
      if (!result.ok || result.data?.submissionId !== fixture.expectedSubmissionId
        || result.data?.status !== 'submitted') throw new Error(`FIXTURE_SUBMIT_FAILED_${result.error?.code ?? 'UNKNOWN'}`);
      process.stdout.write(`SUBMITTED=${fixture.studentId};automatic=${fixture.response === 'giraffe' ? 'correct' : 'incorrect'}\n`);
    }
  }

  const finalAssignments = await database.find('task_assignments', { organizationId: ORG, taskId: TASK });
  for (const fixture of selected) {
    const assignment = finalAssignments.find(entry => entry.studentId === fixture.studentId);
    const submission = await database.get('submissions', `submission:${ORG}:${fixture.expectedSubmissionId}`);
    const response = submission?.answers?.find(answer => answer.itemId === ITEM)?.value?.questionResponses?.[0];
    if (assignment?.status !== 'awaiting_review' || assignment.latestSubmissionId !== fixture.expectedSubmissionId
      || submission?.status !== 'submitted' || response?.questionId !== QUESTION
      || response.response !== fixture.response || response.isCorrect !== (fixture.response === 'giraffe')) {
      throw new Error('FIXTURE_READBACK_FAILED');
    }
  }
  const teacher = await database.get('users', 'usr_teacher_demo_01');
  const role = await database.get('role_assignments', 'rol_teacher_demo_01');
  const grant = await database.get('teacher_class_grants', 'grt_teacher_demo_01_grade3_2');
  if (teacher?.status !== 'active' || role?.status !== 'active' || grant?.status !== 'active'
    || !role.permissions?.includes('submission.review') || !grant.permissions?.includes('submission.review')) {
    throw new Error('TEACHER_REVIEW_AUTHORIZATION_UNAVAILABLE');
  }
  const teacherActor = { requestId: 'm2_review_fixture_readback', sessionId: 'controlled-m2-review-fixture',
    actorUserId: teacher.id, actorRole: 'teacher', organizationId: ORG,
    platformSubjectDigest: 'controlled-m2-review-fixture', permissions: role.permissions,
    scopeIds: [CLASS], authzVersion: teacher.authzVersion ?? 1 };
  const queryDependencies = { repository: api.createTaskQueryDocumentRepository(database),
    clock: { nowIso: () => new Date().toISOString() },
    requestIds: { next: () => `request_m2_review_readback_${randomUUID().replaceAll('-', '')}` } };
  const teacherQuery = new api.TeacherTaskQueryService(queryDependencies);
  const completion = await teacherQuery.getCompletion(teacherActor, TASK, {}, { limit: 100 });
  if (!completion.ok || completion.data.assignments.items.length !== 36
    || completion.data.assignments.items.filter(entry => entry.status === 'awaiting_review').length < 3) {
    throw new Error('TEACHER_COMPLETION_READBACK_FAILED');
  }
  const listed = await teacherQuery.listTeacherTasks(teacherActor, {}, { limit: 100 });
  const listedTask = listed.ok ? listed.data.items.find(entry => entry.taskId === TASK) : null;
  if (!listed.ok || listedTask?.pendingReviewCount !== finalAssignments.filter(entry => entry.status === 'awaiting_review').length) {
    throw new Error('TEACHER_TASK_QUEUE_READBACK_FAILED');
  }
  const reviewService = new api.ReviewQueryService(queryDependencies);
  for (const fixture of selected) {
    const detail = await reviewService.getSubmissionForReview(teacherActor, fixture.expectedSubmissionId);
    const evidence = detail.ok ? detail.data.exerciseEvidence.find(entry => entry.itemId === ITEM) : null;
    if (!detail.ok || !evidence?.recorded || evidence.studentResponse !== fixture.response
      || evidence.isCorrect !== (fixture.response === 'giraffe')
      || !detail.data.taskItems.some(entry => entry.id === ITEM)) {
      throw new Error('TEACHER_REVIEW_DETAIL_READBACK_FAILED');
    }
  }
  process.stdout.write(`VERIFIED=3;pending=${finalAssignments.filter(entry => entry.status === 'awaiting_review').length}\n`);
  process.stdout.write('TEACHER_READBACK=task_option_and_3_submissions_with_item_evidence\n');
  process.exit(0);
} catch (error) {
  process.stdout.write(`FIXTURE_FAILED=${String(error?.message ?? 'UNKNOWN').replace(/[^A-Z0-9_]/gu, '_').slice(0, 90)}\n`);
  process.exit(2);
}
