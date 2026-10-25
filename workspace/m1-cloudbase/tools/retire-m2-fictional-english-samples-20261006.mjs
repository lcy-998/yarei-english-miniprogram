import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');

const ORG = 'org_qihang_demo';
const CLASSES = ['cls_grade3_2', 'cls_grade4_1'];
const REAL = {
  reading: 'res_m3_sbc0008_review_draft_20261002',
  feelings: 'res_m3_original_feelings_draft_20261003',
  vocabulary: 'res_m3_pep3a_u2_real_vocabulary_20261005',
  exercise: 'res_m3_peter_rabbit_real_question_20261005',
  listening: 'res_m3_peter_rabbit_listening_auto_20261005',
  video: 'res_m3_sbc0008_video_auto_20261005',
  dubbing: 'res_m3_sbc0008_dubbing_auto_20261005',
  recording: 'res_m3_sbc0008_real_recording_20261005',
  sync3: 'res_m2_real_pep3a_unit1_20260930',
  sync4: 'res_m2_real_pep4a_unit1_20260930',
};
const FICTIONAL = [
  'res_m2_accept_dubbing_video_20260929',
  'res_m2_accept_giraffe_question_20260929',
  'res_m2_accept_recording_prompt_20260929',
  'res_m2_accept_sync_zoo_20260929',
  'res_m2_accept_zoo_friends_20260929',
  'res_m2_exercise_animals_choice_demo',
  'res_m2_sync_book_outline_demo',
  'res_reading_zoo_cloud_v2',
  'res_reading_zoo_demo',
  'res_vocabulary_animals_cloud_v1',
];
const AUDIT = 'audit_m3_m2_fictional_english_samples_retired_20261006';
const PACK = 'm3-retire-m2-fictional-english-samples-2026-10-06';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = values => [...values].sort();
const classStudent = { cls_grade3_2: 'usr_student_g3_01', cls_grade4_1: 'usr_student_g4_01' };

function cliJson(cli, args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const result = JSON.parse(raw.slice(start));
  if (result.error) throw new Error('CLOUD_PREFLIGHT_FAILED');
  return result;
}

function student(classId) {
  return { requestId: `m3_fake_retire_student_${classId}`, sessionId: 'server-m3-fiction-retirement',
    actorUserId: classStudent[classId], actorRole: 'student', organizationId: ORG,
    platformSubjectDigest: 'server-m3-fiction-retirement', permissions: ['content.read'],
    scopeIds: [classId], authzVersion: 1 };
}

const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envText = await readFile(resolve(root, '.env.local'), 'utf8');
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const envs = cliJson(cli, ['env', 'list', '--json']).data;
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE');
}
const acl = execFileSync(process.execPath, [cli, 'storage', 'get-acl', '--json'], {
  cwd: root, encoding: 'utf8', windowsHide: true,
});
if (!acl.includes('Only creator and admin can read and write')) throw new Error('STORAGE_NOT_PRIVATE');
const secrets = cliJson(cli, ['secrets', 'get', '--json']).data;
if (secrets?.isTemporary !== true || secrets.envId !== envId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token });
const api = require(resolve(root, '.runtime/m3-real-vocabulary-audio-v2/entry.cjs'));
const database = api.createCloudBaseDocumentDatabase(app.database());
const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(database));
const [classes, resources, tasks, assignments, audit] = await Promise.all([
  database.find('classes', { organizationId: ORG, status: 'active', deletedAt: null }),
  Promise.all([...FICTIONAL, ...Object.values(REAL)].map(id => database.get('learning_resources', id))),
  database.find('tasks', { organizationId: ORG, deletedAt: null }),
  database.find('task_assignments', { organizationId: ORG }),
  database.get('operation_logs', AUDIT),
]);
if (!same(sorted(classes.map(item => item._id)), sorted(CLASSES))) throw new Error('CLASS_SCOPE_CHANGED');
const memberships = await Promise.all(CLASSES.map(async classId => ({ classId,
  rows: await database.find('class_memberships', { organizationId: ORG, classId, status: 'active', deletedAt: null }) })));
const studentsByClass = new Map(memberships.map(item => [item.classId, sorted(item.rows.map(row => row.studentId))]));
const studentIds = sorted(new Set(memberships.flatMap(item => item.rows.map(row => row.studentId))));
if (memberships[0].rows.length !== 36 || memberships[1].rows.length !== 32 || studentIds.length !== 68) {
  throw new Error('ACTIVE_STUDENT_SCOPE_CHANGED');
}
const resourceById = new Map(resources.filter(Boolean).map(item => [item._id, item]));
const currentFictional = FICTIONAL.map(id => resourceById.get(id));
if (currentFictional.some(item => !item || item.organizationId !== ORG || item.deletedAt !== null
  || item.payload?.sourceType === 'user_provided_real' || item.copyrightStatus === 'verified'
    && item.acceptanceStatus === 'pending_user_acceptance')) throw new Error('FICTIONAL_RESOURCE_SCOPE_MISMATCH');
const currentReal = Object.entries(REAL).map(([kind, id]) => ({ kind, item: resourceById.get(id) }));
if (currentReal.some(({ item }) => !item || item.organizationId !== ORG || item.status !== 'published')) {
  throw new Error('REAL_REPLACEMENT_NOT_STAGED');
}
const realVocab = resourceById.get(REAL.vocabulary);
if (!same(sorted(realVocab.visibility?.classIds ?? []), sorted(CLASSES))) throw new Error('REAL_WORD_PACK_NOT_ALL_STUDENTS');
for (const classId of CLASSES) {
  const actor = student(classId);
  const bookRows = await content.listStudentCatalog(actor, { type: 'reading' }, { limit: 50, offset: 0 });
  const vocabRows = await content.listStudentCatalog(actor, { type: 'vocabulary' }, { limit: 50, offset: 0 });
  if (!bookRows.items.some(item => item.id === REAL.reading)
    || !vocabRows.items.some(item => item.id === REAL.vocabulary)) throw new Error('REAL_STUDENT_REPLACEMENT_NOT_VISIBLE');
  if (!await database.get('teacher_class_grants', `grant_demo_teacher_${classId}`).catch(() => null)) {
    const grants = await database.find('teacher_class_grants', { organizationId: ORG, classId, status: 'active', deletedAt: null });
    if (!grants.some(grant => grant.teacherId === 'usr_teacher_demo_01'
      && grant.permissions?.includes('content.read'))) throw new Error('TEACHER_SCOPE_UNAVAILABLE');
  }
}
const fakeSet = new Set(FICTIONAL);
const affectedTasks = tasks.filter(task => task.visibility !== 'recycled' && task.status !== 'withdrawn'
  && (task.itemRefs?.some(ref => fakeSet.has(ref.resourceId))
    || task.items?.some(item => fakeSet.has(item.resourceId) || fakeSet.has(item.resourceSnapshot?.id))
    || task.id === 'tsk_animals_classroom_demo'));
const affectedTaskIds = new Set(affectedTasks.map(task => task._id));
const relatedAssignments = assignments.filter(item => affectedTaskIds.has(item.taskId));
const alreadyRetired = audit?.metadata?.packId === PACK && audit.result === 'succeeded';
if (mode === 'inspect') {
  if (alreadyRetired || currentFictional.some(item => item.status === 'offline')) throw new Error('INITIAL_STATE_CHANGED');
  process.stdout.write(JSON.stringify({ status: 'ready', fictionalResources: FICTIONAL.length,
    visibleFictionalTasks: affectedTasks.length, relatedAssignmentsPreserved: relatedAssignments.length,
    realResourcesStaged: currentReal.length, students: 68, studentReplacement: 'reading+vocabulary',
    allOperationsVersioned: true, historyDeletion: false }) + '\n');
} else if (mode === 'apply') {
  if (alreadyRetired || currentFictional.some(item => item.status === 'offline')) throw new Error('INITIAL_STATE_CHANGED');
  const now = new Date().toISOString();
  const recoverableUntil = new Date(Date.now() + 7 * 86400_000).toISOString();
  const nextResources = currentFictional.map(item => ({ ...item, status: 'offline',
    version: item.version + 1, updatedAt: now }));
  const nextTasks = affectedTasks.map(task => ({ ...task,
    status: ['active', 'scheduled', 'expired'].includes(task.status) ? 'withdrawn' : task.status,
    visibility: 'recycled', recycledAt: now, recycledBy: 'system_m3_english_asset_retirement',
    recycleReason: 'fictional_english_acceptance_content_retired', recoverableUntil,
    ...(task.status === 'draft' ? {} : { withdrawnAt: now,
      withdrawnBy: 'system_m3_english_asset_retirement',
      withdrawReason: 'fictional_english_acceptance_content_retired' }),
    version: task.version + 1 }));
  const auditRecord = { _id: AUDIT, id: AUDIT, organizationId: ORG, schemaVersion: 1,
    version: 1, deletedAt: null, requestId: PACK, actorUserId: null, actorRole: null,
    action: 'content.m2FictionalEnglishSamplesRetired', targetType: 'english_acceptance_pack',
    targetId: PACK, result: 'succeeded', errorCode: null, occurredAt: now,
    metadata: { packId: PACK, fictionalResourceIds: FICTIONAL,
      fictionalResourceVersions: currentFictional.map(item => ({ id: item._id, from: item.version, to: item.version + 1 })),
      recycledTaskIds: affectedTasks.map(item => item._id),
      taskVersions: affectedTasks.map(item => ({ id: item._id, from: item.version, to: item.version + 1 })),
      assignmentCountPreserved: relatedAssignments.length, students: 68,
      replacements: Object.values(REAL), noMediaDeleted: true, noStudentHistoryDeleted: true,
      physicalTaskDeletion: false } };
  await database.runTransaction(async tx => {
    if (await tx.get('operation_logs', AUDIT)) throw new Error('AUDIT_ALREADY_EXISTS');
    for (let index = 0; index < currentFictional.length; index += 1) {
      const before = currentFictional[index];
      if ((await tx.get('learning_resources', before._id))?.version !== before.version
        || !await tx.replace('learning_resources', before._id, before.version, nextResources[index])) {
        throw new Error('RESOURCE_VERSION_CHANGED');
      }
    }
    for (let index = 0; index < affectedTasks.length; index += 1) {
      const before = affectedTasks[index];
      if ((await tx.get('tasks', before._id))?.version !== before.version
        || !await tx.replace('tasks', before._id, before.version, nextTasks[index])) {
        throw new Error('TASK_VERSION_CHANGED');
      }
    }
    if (!await tx.create('operation_logs', auditRecord)) throw new Error('AUDIT_CREATE_FAILED');
  });
  process.stdout.write(JSON.stringify({ status: 'retired', fictionalResources: nextResources.length,
    recycledTasks: nextTasks.length, preservedAssignments: relatedAssignments.length,
    students: 68, historyDeleted: false, mediaDeleted: false }) + '\n');
} else {
  const [updatedResources, updatedTasks, finalAudit, finalAssignments] = await Promise.all([
    Promise.all(FICTIONAL.map(id => database.get('learning_resources', id))),
    database.find('tasks', { organizationId: ORG, deletedAt: null }),
    database.get('operation_logs', AUDIT), database.find('task_assignments', { organizationId: ORG }),
  ]);
  const retiredTaskIds = finalAudit?.metadata?.recycledTaskIds;
  if (!Array.isArray(retiredTaskIds) || retiredTaskIds.length !== 43) throw new Error('RETIRED_TASK_AUDIT_MISMATCH');
  const retiredTaskIdSet = new Set(retiredTaskIds);
  const retiredTaskRows = updatedTasks.filter(item => retiredTaskIdSet.has(item._id));
  const retiredAssignmentCount = finalAssignments.filter(item => retiredTaskIdSet.has(item.taskId)).length;
  const remainingFakeTasks = updatedTasks.filter(task => task.visibility !== 'recycled'
    && !['withdrawn', 'closed', 'completed'].includes(task.status)
    && (task.itemRefs?.some(ref => fakeSet.has(ref.resourceId))
      || task.items?.some(item => fakeSet.has(item.resourceId) || fakeSet.has(item.resourceSnapshot?.id))
      || task.id === 'tsk_animals_classroom_demo'));
  if (updatedResources.some(item => item?.status !== 'offline')) throw new Error('RESOURCE_RETIREMENT_VERIFY_FAILED');
  if (retiredTaskRows.length !== retiredTaskIds.length
    || retiredTaskRows.some(task => task.visibility !== 'recycled')
    || remainingFakeTasks.length !== 0 || retiredAssignmentCount !== finalAudit.metadata.assignmentCountPreserved) {
    throw new Error('TASK_RECYCLE_VERIFY_FAILED');
  }
  if (finalAssignments.length !== assignments.length || finalAudit?.metadata?.packId !== PACK) {
    throw new Error('HISTORY_OR_AUDIT_VERIFY_FAILED');
  }
  for (const classId of CLASSES) {
    const actor = student(classId);
    const reading = await content.listStudentCatalog(actor, { type: 'reading' }, { limit: 50, offset: 0 });
    const vocabulary = await content.listStudentCatalog(actor, { type: 'vocabulary' }, { limit: 50, offset: 0 });
    if (FICTIONAL.includes(REAL.reading) || !reading.items.some(item => item.id === REAL.reading)
      || !vocabulary.items.some(item => item.id === REAL.vocabulary)
      || FICTIONAL.some(id => reading.items.some(item => item.id === id)
        || vocabulary.items.some(item => item.id === id))) throw new Error('STUDENT_DIRECTORY_VERIFY_FAILED');
  }
  process.stdout.write(JSON.stringify({ status: 'verified', offlineResources: updatedResources.length,
    recycledTasks: retiredTaskRows.length, preservedAssignments: retiredAssignmentCount,
    students: 68, realReadingAndVocabularyVisible: '2/2 classes', audit: true }) + '\n');
}
