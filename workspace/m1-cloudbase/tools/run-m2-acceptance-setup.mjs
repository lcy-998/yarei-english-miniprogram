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
const assets = resolve(root, '..', 'm2-acceptance', '2026-09-29', 'assets');
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('Use inspect, apply, or verify.');

const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const envText = await readFile(join(root, '.env.local'), 'utf8');
const privateEnvId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!privateEnvId || config.envId !== privateEnvId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const { stdout } = await execute(process.execPath, [cli, 'secrets', 'get', '--json'],
  { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const firstBrace = stdout.indexOf('{');
if (firstBrace < 0) throw new Error('TEMPORARY_CREDENTIALS_UNAVAILABLE');
const credentials = JSON.parse(stdout.slice(firstBrace)).data;
if (credentials?.isTemporary !== true || credentials.envId !== privateEnvId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');

const bundle = join(root, '.runtime', 'm2-predeploy-20260927', 'm2-acceptance-entry.cjs');
await build({ entryPoints: [join(root, 'src', 'seed', 'm2-acceptance-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(bundle);
const sdk = require('@cloudbase/js-sdk');
const app = sdk.init({ env: privateEnvId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const database = api.createCloudBaseDocumentDatabase(app.database());

const ORG = 'org_qihang_demo';
const CLASS = 'cls_grade3_2';
const TEACHER = 'usr_teacher_demo_01';
const STUDENT = 'usr_student_g3_01';
const PACK = 'm2-acceptance-2026-09-29';
const IDS = {
  reading: 'res_m2_accept_zoo_friends_20260929',
  textbook: 'res_m2_accept_sync_zoo_20260929',
  exercise: 'res_m2_accept_giraffe_question_20260929',
  recording: 'res_m2_accept_recording_prompt_20260929',
  work: 'res_m2_accept_dubbing_video_20260929',
  phonics: 'phonics_m2_accept_short_a_20260929',
  classTask: 'tsk_m2_accept_exercise_20260929',
  readingTask: 'tsk_m2_accept_read_word_20260929',
  recordingTask: 'tsk_m2_accept_recording_20260929',
  activity: 'activity_m2_accept_week_20260929',
  submittedWork: 'student_work_m2_accept_submitted_20260929',
  recoveryDraft: 'student_work_m2_accept_recovery_20260929',
  deletedDraft: 'student_work_m2_accept_deleted_20260929',
};
const resourceIds = [IDS.reading, IDS.textbook, IDS.exercise, IDS.recording, IDS.work];
const taskIds = [IDS.classTask, IDS.readingTask, IDS.recordingTask];

try {
  const organization = await database.get('organizations', ORG);
  const classroom = await database.get('classes', CLASS);
  const teacher = await database.get('users', TEACHER);
  const student = await database.get('users', STUDENT);
  const role = await database.get('role_assignments', 'rol_teacher_demo_01');
  const grant = await database.get('teacher_class_grants', 'grt_teacher_demo_01_grade3_2');
  const membership = await database.get('class_memberships', 'mem_grade3_2_g3_01');
  const existingPack = await database.get('migration_runs', 'seed_m2_local_addon_v1');
  const activeMembers = await database.find('class_memberships',
    { organizationId: ORG, classId: CLASS, status: 'active', deletedAt: null });
  if (organization?.status !== 'active' || classroom?.status !== 'active' || teacher?.status !== 'active'
    || student?.status !== 'active' || role?.status !== 'active' || grant?.status !== 'active'
    || membership?.status !== 'active' || existingPack?.status !== 'succeeded'
    || activeMembers.length !== 36 || !role.permissions?.includes('task.publish')
    || !role.permissions?.includes('content.read') || !grant.permissions?.includes('task.publish')
    || !grant.permissions?.includes('content.read')) throw new Error('ACCEPTANCE_PREFLIGHT_FAILED');

  const counts = { resources: 0, phonics: 0, tasks: 0, activity: 0 };
  for (const id of resourceIds) if (await database.get('learning_resources', id)) counts.resources += 1;
  if (await database.get('phonics_courses', IDS.phonics)) counts.phonics += 1;
  for (const id of taskIds) if (await database.get('tasks', id)) counts.tasks += 1;
  if (await database.get('checkin_activities', IDS.activity)) counts.activity += 1;
  process.stdout.write(`PREFLIGHT=passed;activeClassMembers=${activeMembers.length}\n`);
  process.stdout.write(`EXISTING=resources:${counts.resources}/5,phonics:${counts.phonics}/1,tasks:${counts.tasks}/3,activity:${counts.activity}/1\n`);
  if (mode === 'inspect') process.exit(0);
  if (mode === 'verify') {
    await verifyReadPaths(api, database, require('@cloudbase/node-sdk').init({ env: privateEnvId,
      secretId: credentials.secretId, secretKey: credentials.secretKey, sessionToken: credentials.token }));
    process.exit(0);
  }

  if (counts.resources !== 0 && counts.resources !== 5
    || counts.phonics !== 0 && counts.phonics !== 1) throw new Error('PARTIAL_RESOURCE_PACK_REQUIRES_REVIEW');
  if (counts.resources === 0) {
    const cloudbase = require('@cloudbase/node-sdk');
    const nodeApp = cloudbase.init({ env: privateEnvId, secretId: credentials.secretId,
      secretKey: credentials.secretKey, sessionToken: credentials.token });
    const video = await nodeApp.uploadFile({
      cloudPath: 'm2-acceptance/2026-09-29/zoo-friends-demo.mp4',
      fileContent: await readFile(join(assets, 'zoo-friends-demo.mp4')),
    });
    const phonicsAudio = await nodeApp.uploadFile({
      cloudPath: 'm2-acceptance/2026-09-29/phonics-short-a.mp3',
      fileContent: await readFile(join(assets, 'phonics-short-a.mp3')),
    });
    if (typeof video.fileID !== 'string' || !video.fileID.startsWith('cloud://')
      || typeof phonicsAudio.fileID !== 'string' || !phonicsAudio.fileID.startsWith('cloud://')) {
      throw new Error('MEDIA_UPLOAD_INVALID_RESPONSE');
    }
    const now = new Date().toISOString();
    const documents = resourceDocuments(now, video.fileID);
    const phonics = phonicsDocument(now, phonicsAudio.fileID);
    await database.runTransaction(async transaction => {
      for (const row of documents) {
        if (await transaction.get('learning_resources', row._id)) throw new Error('RESOURCE_ID_COLLISION');
      }
      if (await transaction.get('phonics_courses', phonics._id)) throw new Error('PHONICS_ID_COLLISION');
      for (const row of documents) await transaction.create('learning_resources', row);
      await transaction.create('phonics_courses', phonics);
    });
    process.stdout.write('MEDIA_AND_RESOURCES=created\n');
  } else process.stdout.write('MEDIA_AND_RESOURCES=existing\n');

  const acceptanceTextbook = await database.get('learning_resources', IDS.textbook);
  if (acceptanceTextbook?.acceptancePackId !== PACK) throw new Error('TEXTBOOK_PACK_OWNERSHIP_MISMATCH');
  if (acceptanceTextbook.grade === '三年级') {
    const next = { ...acceptanceTextbook, grade: '3',
      payload: { ...acceptanceTextbook.payload, grade: '3' },
      version: acceptanceTextbook.version + 1, updatedAt: new Date().toISOString() };
    const changed = await database.runTransaction(transaction => transaction.replace(
      'learning_resources', IDS.textbook, acceptanceTextbook.version, next));
    if (!changed) throw new Error('TEXTBOOK_GRADE_UPDATE_CONFLICT');
    process.stdout.write('TEXTBOOK_GRADE=normalized_from_M1_class\n');
  }

  const resources = api.createOrgContentDocumentRepository(database);
  const pictureBook = await resources.findLearningResource(ORG, IDS.reading);
  const exercise = await resources.findLearningResource(ORG, IDS.exercise);
  const recording = await database.get('learning_resources', IDS.recording);
  const work = await database.get('learning_resources', IDS.work);
  const phonics = await database.get('phonics_courses', IDS.phonics);
  if (pictureBook?.type !== 'reading' || exercise?.type !== 'exercise'
    || recording?.status !== 'published' || work?.status !== 'published'
    || phonics?.status !== 'published') throw new Error('RESOURCE_READBACK_FAILED');
  process.stdout.write('RESOURCE_READBACK=passed\n');

  const identities = api.createIdentityDocumentRepository(database);
  const actor = {
    requestId: 'm2_acceptance_setup', sessionId: 'server-acceptance-setup', actorUserId: TEACHER,
    actorRole: 'teacher', organizationId: ORG, platformSubjectDigest: 'server-acceptance-setup',
    permissions: role.permissions, scopeIds: [CLASS], authzVersion: teacher.authzVersion ?? 1,
  };
  const ids = { next: prefix => `${prefix}_m2_accept_${randomUUID().replaceAll('-', '')}` };
  const clock = { nowIso: () => new Date().toISOString() };
  const requestIds = { next: () => `request_m2_accept_${randomUUID().replaceAll('-', '')}` };
  const taskService = new api.TaskCoreService(
    api.createTaskCoreDocumentRepository(database), identities, clock, ids, requestIds);
  const now = Date.now();
  const startsAt = new Date(now - 5 * 60_000).toISOString();
  const dueAt = new Date(now + 7 * 86_400_000).toISOString();
  const common = { startsAt, dueAt, latePolicy: { allowLate: true, lateDays: 7 } };
  const tasks = [
    { id: IDS.classTask, title: 'M2验收｜长颈鹿词汇练习', targetType: 'classes', targetClassIds: [CLASS],
      itemRefs: [{ id: 'item_m2_accept_giraffe', resourceId: IDS.exercise, order: 1,
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'automatic', maxScore: 100 } }],
      description: '虚构三年级2班任务；用于逐题作答、检查、通知和打卡证据。' },
    { id: IDS.readingTask, title: 'M2验收｜Zoo Friends 阅读与单词', targetType: 'students',
      targetClassIds: [], targetStudentIds: [STUDENT],
      itemRefs: [
        { id: 'item_m2_accept_reading', resourceId: IDS.reading, order: 1,
          completionRule: { kind: 'reading_pages', requiredPageCount: 2,
            pageIds: ['page_m2_accept_elephant', 'page_m2_accept_giraffe'] },
          scoringRule: { kind: 'completion_only' } },
        { id: 'item_m2_accept_words', resourceId: 'res_vocabulary_animals_cloud_v1', order: 2,
          completionRule: { kind: 'vocabulary_words', requiredWordCount: 1 },
          scoringRule: { kind: 'completion_only' } },
      ], description: '虚构小宇个人任务；用于指定两页阅读和逐词证据。' },
    { id: IDS.recordingTask, title: 'M2验收｜朗读录音', targetType: 'students',
      targetClassIds: [], targetStudentIds: [STUDENT],
      itemRefs: [{ id: 'item_m2_accept_recording', resourceId: IDS.recording, order: 1,
        completionRule: { kind: 'recording_upload' },
        scoringRule: { kind: 'manual', maxScore: 100 } }],
      description: '虚构小宇个人任务；请朗读原创提示并由教师人工评分。' },
  ];
  for (const task of tasks) {
    let current = await database.get('tasks', task.id);
    if (!current) {
      const taskIds = { next: prefix => prefix === 'task' ? task.id : ids.next(prefix) };
      const creator = new api.TaskCoreService(api.createTaskCoreDocumentRepository(database),
        identities, clock, taskIds, requestIds);
      const draft = await creator.saveTaskDraft(actor, { ...common, ...task }, 0,
        `operation_m2_accept_draft_${task.id}`);
      if (!draft.ok || draft.data?.taskId !== task.id) throw new Error(`TASK_DRAFT_FAILED_${task.id}_${draft.error?.code}`);
      current = await database.get('tasks', task.id);
    }
    if (current?.status === 'draft') {
      const published = await taskService.publishTask(actor, task.id, current.version,
        `operation_m2_accept_publish_${task.id}`);
      if (!published.ok) throw new Error(`TASK_PUBLISH_FAILED_${task.id}_${published.error?.code}`);
    }
    const readback = await database.get('tasks', task.id);
    if (!readback || !['active', 'scheduled'].includes(readback.status)
      || readback.visibility !== 'visible') throw new Error(`TASK_READBACK_FAILED_${task.id}`);
    process.stdout.write(`TASK=${task.id};status=${readback.status};students=${readback.targetStudentIds.length}\n`);
  }

  let activity = await database.get('checkin_activities', IDS.activity);
  if (!activity) {
    const activityIds = { next: prefix => prefix === 'activity' ? IDS.activity : ids.next(prefix) };
    const activityService = new api.ActivityService(new api.DocumentActivityRepository(database), clock, activityIds);
    const date = new Date(Date.now() + 8 * 60 * 60_000);
    const schoolDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = offset => new Date(schoolDay.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const draft = await activityService.saveDraft(actor, {
      title: 'M2验收｜7天动物词汇打卡', classId: CLASS, startsOn: day(0), endsOn: day(6),
      restDates: [day(3)], conditions: [{ kind: 'exercise', resourceId: IDS.exercise, minimumScore: 60 }],
    }, 0, 'operation_m2_accept_activity_draft_20260929');
    if (draft.id !== IDS.activity || draft.status !== 'draft') throw new Error('ACTIVITY_DRAFT_FAILED');
    activity = await database.get('checkin_activities', IDS.activity);
  }
  if (activity?.status === 'draft') {
    const activityService = new api.ActivityService(new api.DocumentActivityRepository(database), clock, ids);
    const published = await activityService.publish(actor, IDS.activity, activity.version,
      'operation_m2_accept_activity_publish_20260929');
    if (published.status !== 'published' || published.participants.length !== 36) {
      throw new Error('ACTIVITY_PUBLISH_FAILED');
    }
  }
  activity = await database.get('checkin_activities', IDS.activity);
  if (activity?.status !== 'published') throw new Error('ACTIVITY_READBACK_FAILED');
  process.stdout.write(`ACTIVITY=${IDS.activity};status=published;participants=${activity.payload?.participants?.length ?? 0}\n`);
  const workStorage = require('@cloudbase/node-sdk').init({ env: privateEnvId,
    secretId: credentials.secretId, secretKey: credentials.secretKey, sessionToken: credentials.token });
  const studentActor = { ...actor, actorRole: 'student', actorUserId: STUDENT,
    permissions: [], scopeIds: [CLASS] };
  const workRepository = new api.DocumentStudentWorkRepository(database);
  for (const [id, operation] of [
    [IDS.recoveryDraft, 'operation_m2_accept_recovery_draft_20260929'],
    [IDS.submittedWork, 'operation_m2_accept_submitted_draft_20260929'],
    [IDS.deletedDraft, 'operation_m2_accept_deleted_draft_20260929'],
  ]) {
    if (await database.get('student_works', id)) continue;
    const service = new api.StudentWorkService(workRepository, null, clock,
      { next: prefix => prefix === 'student_work' ? id : ids.next(prefix) });
    const created = await service.beginDraft(studentActor, IDS.work, operation);
    if (created.id !== id || created.status !== 'draft') throw new Error(`WORK_DRAFT_FAILED_${id}`);
  }
  let example = await database.get('student_works', IDS.submittedWork);
  if (example?.status === 'draft') {
    const staging = await workStorage.uploadFile({ cloudPath: example.stagingPath,
      fileContent: await readFile(join(assets, 'recording-example.mp3')) });
    const service = new api.StudentWorkService(workRepository,
      new api.CloudBaseRecordingSeal(workStorage, privateEnvId), clock, ids,
      new api.CloudBaseWorkPlayback(workStorage));
    const submitted = await service.submit(studentActor, { workId: IDS.submittedWork,
      stagingFileId: staging.fileID, note: '原创虚构语音示例，仅供 M2 非生产验收。' },
    example.version, 'operation_m2_accept_work_submit_20260929');
    if (submitted.status !== 'submitted' || !submitted.fileId) throw new Error('WORK_SUBMIT_FAILED');
  }
  example = await database.get('student_works', IDS.submittedWork);
  let deleted = await database.get('student_works', IDS.deletedDraft);
  if (deleted?.status === 'draft' && deleted.deletedAt === null) {
    const service = new api.StudentWorkService(workRepository, null, clock, ids);
    const result = await service.deleteDraft(studentActor, IDS.deletedDraft, deleted.version,
      'operation_m2_accept_delete_draft_20260929');
    if (result.recoveryState !== 'deleted') throw new Error('WORK_DELETE_FAILED');
  }
  const recovery = await database.get('student_works', IDS.recoveryDraft);
  deleted = await database.get('student_works', IDS.deletedDraft);
  if (example?.status !== 'submitted' || recovery?.status !== 'draft'
    || deleted?.recoveryState !== 'deleted') throw new Error('WORK_READBACK_FAILED');
  process.stdout.write('STUDENT_WORK=submitted_example_active_draft_deleted_draft_created\n');
  await verifyReadPaths(api, database, workStorage);
  process.stdout.write('M2_ACCEPTANCE_SETUP=passed\n');
} catch (error) {
  const safe = String(error?.message ?? 'UNKNOWN').replace(/[^A-Za-z0-9_:-]/g, '_').slice(0, 180);
  process.stderr.write(`M2_ACCEPTANCE_SETUP=failed:${safe}\n`);
  process.exitCode = 2;
}
process.exit(process.exitCode ?? 0);

function resourceDocuments(now, videoFileId) {
  const base = (id, type, title, status, payload) => ({
    _id: id, id, organizationId: ORG, schemaVersion: 1, version: 1, deletedAt: null,
    acceptancePackId: PACK, createdAt: now, updatedAt: now, type, title, contentVersion: 1,
    status, copyrightStatus: 'demo',
    visibility: { type: 'classes', classIds: [CLASS] }, allowedClassIds: [CLASS], payload,
  });
  const pages = [
    { id: 'page_m2_accept_cover', pageNumber: 1, order: 1,
      thumbnailAssetKey: '/assets/content/m2-zoo-friends-cover-v1.jpg',
      imageAssetKey: '/assets/content/m2-zoo-friends-cover-v1.jpg',
      width: 600, height: 900, assetVersion: 'acceptance-v1' },
    { id: 'page_m2_accept_elephant', pageNumber: 2, order: 2,
      thumbnailAssetKey: '/assets/content/m2-zoo-elephant-page-v1.jpg',
      imageAssetKey: '/assets/content/m2-zoo-elephant-page-v1.jpg',
      width: 1200, height: 800, assetVersion: 'acceptance-v1', ocrText: 'I see an elephant.' },
    { id: 'page_m2_accept_giraffe', pageNumber: 3, order: 3,
      thumbnailAssetKey: '/assets/content/m2-zoo-giraffe-page-v1.jpg',
      imageAssetKey: '/assets/content/m2-zoo-giraffe-page-v1.jpg',
      width: 1200, height: 800, assetVersion: 'acceptance-v1', ocrText: 'The giraffe is tall.' },
  ];
  const readingPayload = {
    category: 'picture_book', grade: '三年级', term: '2026 秋季演示',
    textbook: '原创虚构读物', unit: '动物朋友', difficulty: '基础', theme: '动物',
    chapters: [{ id: 'chapter_m2_accept_zoo', title: 'Zoo Friends', order: 1, pages }],
  };
  const reading = { ...base(IDS.reading, 'reading', 'Zoo Friends（原创虚构绘本）', 'published', readingPayload),
    category: 'picture_book', grade: '三年级', term: '2026 秋季演示', textbook: '原创虚构读物',
    unit: '动物朋友', difficulty: '基础', theme: '动物' };
  const textbookPayload = {
    category: 'synchronized', grade: '3', term: '2026 秋季演示', textbook: '原创虚构教材',
    unit: '动物朋友', difficulty: '基础',
    textbookChapters: [{ id: 'chapter_m2_accept_textbook', title: 'Unit 1 Zoo Friends',
      lessons: [{ id: 'lesson_m2_accept_textbook', title: 'Lesson 1 Animals' }] }],
    chapters: [{ id: 'chapter_m2_accept_textbook', title: 'Unit 1 Zoo Friends', order: 1, pages }],
  };
  const textbook = { ...base(IDS.textbook, 'reading', '原创虚构同步课本：Zoo Friends', 'draft', textbookPayload),
    category: 'synchronized', grade: '3', term: '2026 秋季演示', textbook: '原创虚构教材',
    unit: '动物朋友', difficulty: '基础' };
  const questionPayload = {
    grade: '三年级', textbook: '原创虚构教材', unit: '动物朋友', knowledgePoint: '动物词汇',
    difficulty: '基础', questionType: 'single_choice', questionIds: [IDS.exercise],
    stem: 'Which animal has a long neck?', options: ['giraffe', 'elephant', 'cat'],
    correctAnswer: 'giraffe', explanation: 'A giraffe has a long neck.',
  };
  const exercise = { ...base(IDS.exercise, 'exercise', '虚构习题：长颈鹿的长脖子', 'published', questionPayload),
    ...questionPayload };
  const recording = base(IDS.recording, 'recording', '虚构录音提示：友善的大象', 'published', {
    promptKind: 'text', promptText: 'I see an elephant. It is big and kind.', requiresVideo: false,
  });
  const work = base(IDS.work, 'work', 'Zoo Friends（原创虚构配音片段）', 'published', {
    demonstrationFileId: videoFileId,
    subtitle: 'I see an elephant. The elephant is big. I see a giraffe. The giraffe is tall.',
  });
  return [reading, textbook, exercise, recording, work];
}

function phonicsDocument(now, audioFileId) {
  return {
    _id: IDS.phonics, id: IDS.phonics, organizationId: ORG, schemaVersion: 1, version: 1,
    deletedAt: null, acceptancePackId: PACK, createdAt: now, updatedAt: now,
    title: '虚构短元音 a｜cat 和 hat', grade: '三年级', unit: '动物朋友',
    contentVersion: 'acceptance-v1', status: 'published',
    visibility: { type: 'classes', classIds: [CLASS] },
    phonemes: [{ id: 'phoneme_m2_accept_short_a', label: '/æ/', examples: ['cat', 'hat'], audioFileId }],
    questions: [{ id: 'question_m2_accept_short_a', stem: 'Which word has the short a sound?',
      options: [{ id: 'option_m2_accept_cat', text: 'cat' }, { id: 'option_m2_accept_sun', text: 'sun' }],
      correctOptionId: 'option_m2_accept_cat', explanation: 'The a in cat has the short a sound.' }],
  };
}

async function verifyReadPaths(api, database, nodeApp) {
  const clock = { nowIso: () => new Date().toISOString() };
  const requestIds = { next: () => `request_m2_accept_verify_${randomUUID().replaceAll('-', '')}` };
  const actor = { requestId: 'm2_acceptance_verify', sessionId: 'server-acceptance-verify',
    actorUserId: STUDENT, actorRole: 'student', organizationId: ORG,
    platformSubjectDigest: 'server-acceptance-verify', permissions: [], scopeIds: [CLASS],
    authzVersion: 1 };
  const studentTasks = new api.StudentTaskQueryService({
    repository: api.createTaskQueryDocumentRepository(database), clock, requestIds,
  });
  for (const taskId of taskIds) {
    const detail = await studentTasks.getMyTask(actor, taskId);
    if (!detail.ok || detail.data?.taskId !== taskId) throw new Error(`STUDENT_TASK_INVISIBLE_${taskId}`);
    const assignments = await database.find('task_assignments',
      { organizationId: ORG, taskId, deletedAt: null });
    const expected = taskId === IDS.classTask ? 36 : 1;
    if (assignments.length !== expected) throw new Error(`TASK_ROSTER_MISMATCH_${taskId}`);
  }
  const exerciseView = await studentTasks.getMyTask(actor, IDS.classTask);
  if (JSON.stringify(exerciseView.data).includes('correctAnswer')) throw new Error('ANSWER_LEAK');
  const activity = await database.get('checkin_activities', IDS.activity);
  if (activity?.status !== 'published' || activity.payload?.participants?.length !== 36) {
    throw new Error('ACTIVITY_ROSTER_MISMATCH');
  }
  const phonics = await database.get('phonics_courses', IDS.phonics);
  const work = await database.get('learning_resources', IDS.work);
  const fileIds = [phonics?.phonemes?.[0]?.audioFileId, work?.payload?.demonstrationFileId];
  if (fileIds.some(value => typeof value !== 'string' || !value.startsWith('cloud://'))) {
    throw new Error('MEDIA_REFERENCE_MISSING');
  }
  const urls = await nodeApp.getTempFileURL({ fileList: fileIds.map(fileID => ({ fileID, maxAge: 60 })) });
  if (urls.fileList?.length !== 2 || urls.fileList.some(item =>
    typeof item.tempFileURL !== 'string' || !item.tempFileURL.startsWith('https://'))) {
    throw new Error('MEDIA_SIGNED_URL_FAILED');
  }
  const submittedWork = await database.get('student_works', IDS.submittedWork);
  const recoveryDraft = await database.get('student_works', IDS.recoveryDraft);
  const deletedDraft = await database.get('student_works', IDS.deletedDraft);
  if (submittedWork?.status !== 'submitted' || !submittedWork.fileId
    || recoveryDraft?.status !== 'draft' || recoveryDraft.studentId !== STUDENT
    || deletedDraft?.recoveryState !== 'deleted') {
    throw new Error('STUDENT_WORK_READBACK_FAILED');
  }
  const workPlayback = await nodeApp.getTempFileURL({ fileList: [
    { fileID: submittedWork.fileId, maxAge: 60 },
  ] });
  if (typeof workPlayback.fileList?.[0]?.tempFileURL !== 'string') {
    throw new Error('SUBMITTED_WORK_MEDIA_UNAVAILABLE');
  }
  const workService = new api.StudentWorkService(new api.DocumentStudentWorkRepository(database),
    null, clock, { next: prefix => `${prefix}_unused` }, new api.CloudBaseWorkPlayback(nodeApp));
  const materials = await workService.listMaterials(actor);
  const visibleWorks = await workService.listMine(actor);
  const playback = await workService.getPlayback(actor, IDS.submittedWork);
  if (!materials.some(item => item.id === IDS.work)
    || !visibleWorks.some(item => item.id === IDS.submittedWork && item.status === 'submitted')
    || !visibleWorks.some(item => item.id === IDS.recoveryDraft && item.status === 'draft')
    || visibleWorks.some(item => item.id === IDS.deletedDraft)
    || !playback.temporaryUrl.startsWith('https://')) throw new Error('STUDENT_WORK_ROLE_VIEW_FAILED');
  const phonicsService = new api.PhonicsService(new api.DocumentPhonicsRepository(database),
    clock, { next: prefix => `${prefix}_unused` }, new api.CloudBaseWorkPlayback(nodeApp));
  const courses = await phonicsService.listCourses(actor);
  const course = await phonicsService.getCourse(actor, IDS.phonics);
  const phonicsPlayback = await phonicsService.getAudio(actor, IDS.phonics, 'phoneme_m2_accept_short_a');
  if (!courses.some(item => item.id === IDS.phonics)
    || !course.phonemes[0]?.audioAvailable || !phonicsPlayback.temporaryUrl.startsWith('https://')) {
    throw new Error('PHONICS_ROLE_VIEW_FAILED');
  }
  const adminService = new api.TextbookAdminService(database, clock);
  const adminOverview = await adminService.overview({ ...actor, actorRole: 'admin',
    actorUserId: 'usr_admin_demo_01', permissions: ['organization.manage'], scopeIds: [ORG] });
  if (!adminOverview.classes.some(item => item.id === CLASS && item.grade === '3')
    || !adminOverview.books.some(item => item.id === IDS.textbook && item.status === 'draft')) {
    throw new Error('ADMIN_TEXTBOOK_CATALOG_INVISIBLE');
  }
  const recoveryService = new api.StudentWorkAdminService(database, clock);
  const deletedPage = await recoveryService.listDeletedDrafts({ ...actor, actorRole: 'admin',
    actorUserId: 'usr_admin_demo_01', permissions: ['student_work.restore'], scopeIds: [ORG] },
  STUDENT, { limit: 10, offset: 0 });
  if (!deletedPage.items.some(item => item.id === IDS.deletedDraft && item.restorable)) {
    throw new Error('ADMIN_RECOVERY_DRAFT_INVISIBLE');
  }
  process.stdout.write('ROLE_READBACK=student_3_tasks_visible;rosters_36_1_1;answers_hidden\n');
  process.stdout.write('ACTIVITY_READBACK=36_participants\n');
  process.stdout.write('MEDIA_READBACK=2_signed_urls\n');
  process.stdout.write('PHONICS_READBACK=course_visible_audio_playable\n');
  process.stdout.write('STUDENT_WORK_READBACK=material_visible_submitted_playable_active_draft_visible_deleted_hidden\n');
  process.stdout.write('ADMIN_TEXTBOOK_READBACK=draft_and_numeric_class_visible\n');
  process.stdout.write('ADMIN_RECOVERY_READBACK=deleted_draft_restorable\n');
}
