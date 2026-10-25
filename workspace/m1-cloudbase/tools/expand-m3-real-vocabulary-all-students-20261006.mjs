import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');

const ORG = 'org_qihang_demo';
const CLASSES = ['cls_grade3_2', 'cls_grade4_1'];
const RESOURCE = 'res_m3_pep3a_u2_real_vocabulary_20261005';
const AUDIT = 'audit_m3_real_vocabulary_all_students_20261006';
const PACK = 'm3-real-vocabulary-all-students-2026-10-06';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = values => [...values].sort();

function cliJson(cli, args) {
  const raw = require('node:child_process').execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const result = JSON.parse(raw.slice(start));
  if (result.error) throw new Error('CLOUD_PREFLIGHT_FAILED');
  return result;
}

function student(userId, classId) {
  return { requestId: `m3_vocab_all_students_${classId}`, sessionId: 'server-m3-vocab-scope',
    actorUserId: userId, actorRole: 'student', organizationId: ORG,
    platformSubjectDigest: 'server-m3-vocab-scope', permissions: ['content.read'],
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
const secrets = cliJson(cli, ['secrets', 'get', '--json']).data;
if (secrets?.isTemporary !== true || secrets.envId !== envId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token });
const api = require(resolve(root, '.runtime/m3-real-vocabulary-audio-v2/entry.cjs'));
const database = api.createCloudBaseDocumentDatabase(app.database());
const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(database));
const [resource, audit, classes] = await Promise.all([
  database.get('learning_resources', RESOURCE), database.get('operation_logs', AUDIT),
  database.find('classes', { organizationId: ORG, status: 'active', deletedAt: null }),
]);
if (!same(sorted(classes.map(item => item._id)), sorted(CLASSES))) throw new Error('CLASS_SCOPE_CHANGED');
const members = await Promise.all(CLASSES.map(async classId => ({ classId,
  rows: await database.find('class_memberships', { organizationId: ORG, classId, status: 'active', deletedAt: null }) })));
const studentIdsByClass = new Map(members.map(item => [item.classId, sorted(item.rows.map(row => row.studentId))]));
const allStudentIds = sorted(new Set(members.flatMap(item => item.rows.map(row => row.studentId))));
if (members[0].rows.length !== 36 || members[1].rows.length !== 32 || allStudentIds.length !== 68) {
  throw new Error('ACTIVE_STUDENT_SCOPE_CHANGED');
}
if (resource?.organizationId !== ORG || resource.type !== 'vocabulary' || resource.status !== 'published'
  || resource.acceptanceStatus !== 'pending_user_acceptance' || resource.testOnly !== true
  || resource.grade !== '三年级' || resource.unit !== 'Unit 2'
  || !same(sorted(resource.words.map(word => word.word)), ['grandma', 'grandpa', 'mum'])
  || resource.copyrightStatus !== 'verified') throw new Error('REAL_RESOURCE_SOURCE_GATE');
const versionIsInitial = resource.version === 3 && resource.visibility?.type === 'classes'
  && same(sorted(resource.visibility.classIds ?? []), [CLASSES[0]]) && !audit;
const versionIsApplied = resource.version === 4 && resource.visibility?.type === 'classes'
  && same(sorted(resource.visibility.classIds ?? []), sorted(CLASSES))
  && audit?.targetId === RESOURCE && audit.metadata?.packId === PACK;
if (mode === 'inspect' && !versionIsInitial) throw new Error('INITIAL_SCOPE_CHANGED');
if (mode === 'apply' && !versionIsInitial) throw new Error('INITIAL_SCOPE_CHANGED');
if (mode === 'verify' && !versionIsApplied) throw new Error('UPDATED_SCOPE_MISMATCH');

const catalogResults = [];
for (const classId of CLASSES) {
  const actor = student(studentIdsByClass.get(classId)[0], classId);
  const packs = await content.listVocabularyPacks(actor);
  const visible = packs.some(item => item.id === RESOURCE && item.words.length === 3);
  catalogResults.push({ classId, visible });
  if (mode === 'inspect' && visible !== (classId === CLASSES[0])) throw new Error('INITIAL_CATALOG_SCOPE_MISMATCH');
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ status: 'ready', resourceId: RESOURCE,
    currentVersion: resource.version, currentClasses: resource.visibility.classIds,
    proposedClasses: CLASSES, students: 68, sampleWords: ['mum', 'grandma', 'grandpa'],
    titleRetainsGradeLabel: resource.title.includes('三年级'), noTasksCreated: true }) + '\n');
} else if (mode === 'apply') {
  const now = new Date().toISOString();
  const next = { ...resource, visibility: { ...resource.visibility, classIds: CLASSES },
    version: resource.version + 1, updatedAt: now };
  const log = { _id: AUDIT, id: AUDIT, organizationId: ORG, schemaVersion: 1, version: 1,
    deletedAt: null, requestId: PACK, actorUserId: null, actorRole: null,
    action: 'content.realVocabularyExpandedToAcceptanceStudents', targetType: 'learning_resources',
    targetId: RESOURCE, result: 'succeeded', errorCode: null, occurredAt: now,
    metadata: { packId: PACK, previousVersion: resource.version, nextVersion: next.version,
      previousClassIds: resource.visibility.classIds, nextClassIds: CLASSES,
      studentCount: allStudentIds.length, sourceType: 'PEP3A Unit 2 official word list and audio',
      gradeLabelRetained: true, testOnly: true, acceptanceStatus: 'pending_user_acceptance' } };
  await database.runTransaction(async tx => {
    const current = await tx.get('learning_resources', RESOURCE);
    if (current?.version !== resource.version || !same(current.visibility?.classIds, resource.visibility.classIds)
      || await tx.get('operation_logs', AUDIT)) throw new Error('RESOURCE_VERSION_CHANGED');
    if (!await tx.replace('learning_resources', RESOURCE, resource.version, next)
      || !await tx.create('operation_logs', log)) throw new Error('CLOUD_TRANSACTION_FAILED');
  });
  process.stdout.write(JSON.stringify({ status: 'updated', fromVersion: resource.version,
    toVersion: next.version, students: allStudentIds.length, functionsDeployed: 0 }) + '\n');
} else {
  if (catalogResults.some(item => !item.visible)) throw new Error('STUDENT_CATALOG_VISIBILITY_FAILED');
  const teachers = [];
  for (const classId of CLASSES) {
    const actor = { requestId: `m3_vocab_teacher_all_${classId}`, sessionId: 'server-m3-vocab-scope',
      actorUserId: 'usr_teacher_demo_01', actorRole: 'teacher', organizationId: ORG,
      platformSubjectDigest: 'server-m3-vocab-scope', permissions: ['content.read', 'task.publish'],
      scopeIds: [classId], authzVersion: 1 };
    const row = await content.getTaskCatalogResource(actor, RESOURCE, [classId]);
    if (row.id !== RESOURCE) throw new Error('TEACHER_CATALOG_VISIBILITY_FAILED');
    teachers.push({ classId, visible: true });
  }
  process.stdout.write(JSON.stringify({ status: 'verified', resourceVersion: resource.version,
    studentCatalog: catalogResults, teacherCatalog: teachers, students: 68,
    gradeLabelRetained: true, acceptanceStatus: resource.acceptanceStatus }) + '\n');
}
