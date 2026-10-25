// Controlled nonproduction import of six Codex-reviewed storybook questions.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify', 'probe'].includes(mode)) throw new Error('MODE_INVALID');
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = resolve('G:/英语资产');
const pack = join(assetRoot, 'library/derived/production-storybook-exercises-2026-10-11/v3');
const require = createRequire(join(backend, 'package.json'));
const { build } = require('esbuild');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async path => readFile(path);
const [contentBytes, previewBytes, rightsBytes, manifestBytes, reviewBytes, bookBytes, pdfBytes] = await Promise.all([
  read(join(pack, 'questions-v3.json')),
  read(join(pack, 'student-preview-v3.json')),
  read(join(pack, 'source-rights-v3.json')),
  read(join(pack, 'manifest-v3.json')),
  read(join(pack, 'review/codex-content-v1.json')),
  read(join(assetRoot, 'library/books/book-sbc-en-0008/v1/review/approved-content-v1.json')),
  read(join(assetRoot, 'inbox/storybookscanada-english/sbc-en-0008-what-are-you-doing.pdf')),
]);
const content = JSON.parse(contentBytes);
const preview = JSON.parse(previewBytes);
const rights = JSON.parse(rightsBytes);
const manifest = JSON.parse(manifestBytes);
const review = JSON.parse(reviewBytes);
const book = JSON.parse(bookBytes);
if (content.questionCount !== 6 || content.questions.length !== 6
  || preview.questions.length !== 6 || manifest.readyForProductionUpload !== false
  || review.decision !== 'approved_content_for_nonproduction_validation'
  || review.reviewerId !== 'Codex' || review.productionReady !== false
  || review.contentSha256 !== hash(contentBytes)
  || review.studentPreviewSha256 !== hash(previewBytes)
  || review.rightsSha256 !== hash(rightsBytes)
  || review.manifestSha256 !== hash(manifestBytes)
  || review.sourcePdfSha256 !== hash(pdfBytes)
  || review.approvedBookReviewSha256 !== hash(bookBytes)
  || rights.sourceBookReviewSha256 !== hash(bookBytes)
  || book.decision !== 'approved' || book.resourceId !== 'book-sbc-en-0008') {
  throw new Error('CONTENT_REVIEW_GATE');
}
const seen = new Set();
for (let i = 0; i < content.questions.length; i++) {
  const q = content.questions[i];
  const student = preview.questions[i];
  const verdict = review.questions[i];
  const answers = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer];
  if (seen.has(q.id) || !/^res_prod_sbc0008_exercise_0[1-6]_v3$/.test(q.id)
    || student.id !== q.id || verdict.questionId !== q.id || verdict.decision !== 'approved'
    || student.stem !== q.stem || JSON.stringify(student.options) !== JSON.stringify(q.options)
    || 'correctAnswer' in student || 'explanation' in student
    || !q.sourceSentences.every(sentence => sentence && q.stem.includes(sentence))
    || !q.stem.includes('Nina Orange') || !q.stem.includes(rights.licenseUrl)
    || !answers.every(answer => q.options.includes(answer))) throw new Error('QUESTION_GATE');
  seen.add(q.id);
}
function call(args) {
  const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: backend, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const result = JSON.parse(raw.slice(at));
  if (result.error) throw new Error('CLOUD_API_ERROR');
  return result.data;
}
const config = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
const envLine = (await readFile(join(backend, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice(11).trim();
const envs = call(['env', 'list', '--json']);
if (!envId || envId !== config.envId || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no'
  || envs[0].EnableOverrun !== false) throw new Error('NONPRODUCTION_COST_GATE');
const quota = call(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('QUOTA_GATE');
const token = call(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const sdk = require('@cloudbase/js-sdk');
const app = sdk.init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token });
const entry = join(backend, '.runtime/launch-storybook-exercises-20261012/entry.cjs');
await mkdir(dirname(entry), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-public-question-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(entry);
const database = api.createCloudBaseDocumentDatabase(app.database());
const organizations = (await database.find('organizations', { status: 'active', deletedAt: null }))
  .map(row => row._id).sort();
if (JSON.stringify(organizations) !== JSON.stringify(['org_isolation_secondary', 'org_qihang_demo'])) {
  throw new Error('ORGANIZATION_SCOPE_GATE');
}
const inputs = content.questions.map(q => ({
  sourceId: q.id, organizationId: 'org_qihang_demo', title: q.title,
  grade: q.grade, questionType: q.questionType, stem: q.stem,
  options: q.options, correctAnswer: q.correctAnswer, explanation: q.explanation,
  knowledgePoint: q.knowledgePoint, difficulty: q.difficulty,
  contentVersion: q.contentVersion, sourceSha256: hash(pdfBytes), sourceUrl: rights.sourceUrl,
  manifestSha256: hash(manifestBytes), reviewId: `review_${hash(reviewBytes).slice(0, 32)}`,
  copyrightEvidenceId: `rights_${hash(rightsBytes).slice(0, 32)}`,
  copyrightEvidenceSha256: hash(rightsBytes), verifiedAt: review.reviewedAt,
  importedBy: 'codex_launch_review_20261012',
}));
for (const input of inputs) api.buildVerifiedPublicQuestionSource(input);
const before = await Promise.all(inputs.map(async input => ({ id: input.sourceId,
  source: await database.get('learning_resources', input.sourceId),
  projection: await database.get('learning_resources',
    api.publicQuestionProjectionId(input.sourceId, 'org_isolation_secondary')),
})));
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
    reviewedQuestions: inputs.length, newSourceSlots: before.filter(row => !row.source).length,
    newProjectionSlots: before.filter(row => !row.projection).length,
    rights: rights.license, reviewSha256: hash(reviewBytes), cloudWrites: 0 }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  if (before.some(row => row.source || row.projection)) throw new Error('TARGET_NOT_EMPTY');
  const service = new api.PublicQuestionDistributionService(database,
    { nowIso: () => new Date().toISOString() });
  for (const input of inputs) await service.importVerified(input, organizations);
}
const readback = await Promise.all(inputs.map(async input => {
  const source = await database.get('learning_resources', input.sourceId);
  const projection = await database.get('learning_resources',
    api.publicQuestionProjectionId(input.sourceId, 'org_isolation_secondary'));
  const audit = await database.get('operation_logs', `public_question_import_${input.sourceId}`);
  if (!source || !projection || !audit || source.status !== 'published'
    || projection.status !== 'published' || source.stem !== input.stem
    || JSON.stringify(source.correctAnswer) !== JSON.stringify(input.correctAnswer)
    || source.payload?.assetLibrary?.reviewId !== input.reviewId
    || projection.payload?.assetLibrary?.sourcePublicId !== source._id
    || audit.result !== 'succeeded') throw new Error(`READBACK_FAILED_${input.sourceId}`);
  return input.sourceId;
}));
const contentEntry = join(backend, '.runtime/launch-storybook-exercises-20261012/content.cjs');
await build({ entryPoints: [join(backend, 'src/seed/m3-real-sample-entry.ts')],
  outfile: contentEntry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const contentApi = require(contentEntry);
const query = new contentApi.ContentQueryService(
  contentApi.createOrgContentDocumentRepository(database));
const teacher = { requestId: 'launch_storybook_teacher_20261012', sessionId: 'launch-storybook-verify',
  actorUserId: 'usr_teacher_demo_01', actorRole: 'teacher', organizationId: 'org_qihang_demo',
  platformSubjectDigest: 'launch-storybook-verify', permissions: ['content.read', 'task.publish'],
  scopeIds: ['cls_grade3_2'], authzVersion: 1 };
const teacherQuestions = await query.listSchoolQuestions(teacher,
  { keyword: 'What are you doing?', targetClassIds: ['cls_grade3_2'] }, { limit: 50, offset: 0 });
const expected = new Set(readback);
const teacherSeen = new Set(teacherQuestions.items.map(item => item.id));
if ([...expected].some(id => !teacherSeen.has(id))) {
  throw new Error('AUTHORIZED_CATALOG_READBACK_FAILED');
}
if (mode === 'probe') {
  const taskEntry = join(backend, '.runtime/launch-storybook-exercises-20261012/task.cjs');
  await build({ entryPoints: [join(backend, 'src/seed/m2-acceptance-entry.ts')],
    outfile: taskEntry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
  const taskApi = require(taskEntry);
  const nonce = hash(Buffer.from(`${Date.now()}:${Math.random()}`)).slice(0, 24);
  const taskId = `task_launch_storybook_q_${nonce}`;
  let sequence = 0;
  const ids = { next: prefix => prefix === 'task' ? taskId : `${prefix}_launchq_${nonce}_${++sequence}` };
  let requestSequence = 0;
  const requestIds = { next: () => `request_launchq_${nonce}_${++requestSequence}` };
  const clock = { nowIso: () => new Date().toISOString() };
  const [teacherUser, studentUser, roles, grants, memberships] = await Promise.all([
    database.get('users', 'usr_teacher_demo_01'), database.get('users', 'usr_student_g3_01'),
    database.find('role_assignments', { organizationId: 'org_qihang_demo',
      userId: 'usr_teacher_demo_01', status: 'active', deletedAt: null }),
    database.find('teacher_class_grants', { organizationId: 'org_qihang_demo',
      teacherId: 'usr_teacher_demo_01', classId: 'cls_grade3_2', status: 'active', deletedAt: null }),
    database.find('class_memberships', { organizationId: 'org_qihang_demo',
      classId: 'cls_grade3_2', studentId: 'usr_student_g3_01', status: 'active', deletedAt: null }),
  ]);
  const role = roles.find(item => item.role === 'teacher') ?? roles[0];
  if (teacherUser?.status !== 'active' || studentUser?.status !== 'active'
    || !role?.permissions?.includes('task.publish')
    || !role.permissions.includes('submission.review')
    || !grants.some(item => item.permissions?.includes('task.publish')
      && item.permissions.includes('submission.review'))
    || memberships.length !== 1) throw new Error('FICTIONAL_ACTOR_GATE');
  const actor = { requestId: requestIds.next(), sessionId: 'launch-question-probe',
    actorUserId: 'usr_teacher_demo_01', actorRole: 'teacher', organizationId: 'org_qihang_demo',
    platformSubjectDigest: 'launch-question-probe', permissions: role.permissions,
    scopeIds: ['cls_grade3_2'], authzVersion: teacherUser.authzVersion ?? 1 };
  const student = { ...actor, requestId: requestIds.next(),
    actorUserId: 'usr_student_g3_01', actorRole: 'student', permissions: [],
    authzVersion: studentUser.authzVersion ?? 1 };
  const service = new taskApi.TaskCoreService(
    taskApi.createTaskCoreDocumentRepository(database),
    taskApi.createIdentityDocumentRepository(database), clock, ids, requestIds);
  const queryDeps = { repository: taskApi.createTaskQueryDocumentRepository(database),
    clock, requestIds };
  const studentQuery = new taskApi.StudentTaskQueryService(queryDeps);
  const reviewQuery = new taskApi.ReviewQueryService(queryDeps);
  const itemId = `item_launchq_${nonce}`;
  let created = false;
  let recycled = false;
  let stage = 'save';
  try {
    const now = Date.now();
    const draft = await service.saveTaskDraft(actor, {
      title: '绘本修正版单题非生产闭环',
      itemRefs: [{ id: itemId, resourceId: inputs[0].sourceId,
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }],
      targetType: 'students', targetClassIds: [], targetStudentIds: ['usr_student_g3_01'],
      startsAt: new Date(now - 60000).toISOString(),
      dueAt: new Date(now + 86400000).toISOString(),
      latePolicy: { allowLate: true, lateDays: 7 },
      description: '仅非生产虚构学员，提交后软回收。', teacherNote: '',
    }, 0, `operation_launchq_save_${nonce}`);
    if (!draft.ok || draft.data?.taskId !== taskId) throw new Error(`SAVE_${draft.error?.code ?? 'INVALID'}`);
    created = true;
    stage = 'publish';
    const published = await service.publishTask(actor, taskId, draft.data.version,
      `operation_launchq_publish_${nonce}`);
    if (!published.ok) throw new Error(`PUBLISH_${published.error?.code ?? 'INVALID'}`);
    stage = 'student-read';
    const task = await studentQuery.getMyTask(student, taskId);
    if (!task.ok || task.data.items?.[0]?.resourceId !== inputs[0].sourceId) {
      throw new Error(`STUDENT_READ_${task.error?.code ?? 'INVALID'}`);
    }
    stage = 'submit';
    const submitted = await service.submit(student, taskId,
      [{ itemId, value: { kind: 'exercise', questionResponses: [{ questionId: inputs[0].sourceId,
        response: inputs[0].correctAnswer }] } }],
      task.data.assignment.version, undefined, `operation_launchq_submit_${nonce}`);
    if (!submitted.ok || !submitted.data?.submissionId) {
      throw new Error(`SUBMIT_${submitted.error?.code ?? 'INVALID'}`);
    }
    stage = 'teacher-review';
    const view = await reviewQuery.getSubmissionForReview(actor, submitted.data.submissionId);
    if (!view.ok || !JSON.stringify(view.data).includes('"response":"singing"')) {
      throw new Error(`REVIEW_EVIDENCE_${view.error?.code ?? 'INVALID'}`);
    }
    const scored = await service.publishReview(actor, {
      submissionId: submitted.data.submissionId, decision: 'approved', score: 100,
      textComment: '绘本原句与作答已核对。',
      expectedSubmissionVersion: view.data.submissionVersion,
    }, view.data.assignmentVersion, `operation_launchq_review_${nonce}`);
    if (!scored.ok) throw new Error(`REVIEW_${scored.error?.code ?? 'INVALID'}`);
    stage = 'recycle';
    const current = await database.get('tasks', taskId);
    const cleanup = await service.recycleTask(actor, taskId,
      '绘本修正版单题闭环完成后精确软回收。', current.version,
      `operation_launchq_recycle_${nonce}`);
    if (!cleanup.ok) throw new Error(`RECYCLE_${cleanup.error?.code ?? 'INVALID'}`);
    recycled = true;
    process.stdout.write(JSON.stringify({ mode, status: 'passed', taskId,
      teacherPublish: true, studentSubmit: true, teacherReview: true,
      score: 100, recycled: true, historyDeleted: false }) + '\n');
  } catch (error) {
    if (created && !recycled) {
      const current = await database.get('tasks', taskId).catch(() => null);
      if (current?.visibility !== 'recycled' && Number.isSafeInteger(current?.version)) {
        const result = await service.recycleTask(actor, taskId,
          '绘本修正版单题闭环失败后精确软回收。', current.version,
          `operation_launchq_cleanup_${nonce}`).catch(() => null);
        recycled = result?.ok === true;
      }
    }
    process.stdout.write(JSON.stringify({ mode, status: 'failed', stage,
      taskId: created ? taskId : null, recycled,
      reason: String(error?.message ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) }) + '\n');
    process.exitCode = 2;
  }
  process.exit(process.exitCode ?? 0);
}
process.stdout.write(JSON.stringify({ mode, environment: 'verified_nonproduction',
  importedSources: readback.length, organizationProjections: readback.length,
  auditRecords: readback.length, reviewSha256: hash(reviewBytes),
  teacherCatalogItems: readback.length,
  cloudWrites: mode === 'apply' ? readback.length * 4 : 0 }) + '\n');
await new Promise(resolve => setTimeout(resolve, 300));
process.exit(0);
