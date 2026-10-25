import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(root, '..', '..');
const assetRoot = 'F:/英语资产';
const outputRoot = resolve(projectRoot, 'workspace/m3-real-samples/2026-10-05-vocabulary');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('Use inspect, apply, or verify.');

const ORG = 'org_qihang_demo';
const CLASS = 'cls_grade3_2';
const RESOURCE = 'res_m3_pep3a_u2_real_vocabulary_20261005';
const AUDIT = 'audit_m3_pep3a_u2_real_vocabulary_20261005';
const PACK = 'm3-real-vocabulary-2026-10-05';
const PREFIX = `${PACK}/`;
const SOURCES = [
  {
    key: 'wordPage', relativePath: 'library/books/book-unknown-3a/v1/pages/page-0083.jpg',
    cloudPath: `${PREFIX}source/pep3a-unit2-word-list-page-83.jpg`,
    sha256: 'e3733ec0a99d6dc6effe62740c9f25c51a66a9430379429a236970f69a92cb04',
  },
  {
    key: 'wordAudio', relativePath: 'inbox/pep-3s-official/149_Words in each unit Unit 2.mp3',
    cloudPath: `${PREFIX}source/pep3a-unit2-word-list-audio.mp3`,
    sha256: '3a3ca484baf84180b00c736a70dc9dc180b3fb6ce1a5e0b5c0d1b6ce5ec7449b',
  },
  {
    key: 'candidate', relativePath: 'library/derived/m3-pep3a-unit2-vocabulary/v1/word-pack-source-v1.json',
    cloudPath: `${PREFIX}provenance/word-pack-source-v1.json`,
    sha256: '3255018d0a80b553b6e4a3c5bfb6238aa3aa29077889ad06c064dedeefc8709d',
  },
  {
    key: 'provenance', relativePath: 'library/derived/m3-pep3a-unit2-vocabulary/v1/source-provenance-v1.json',
    cloudPath: `${PREFIX}provenance/source-provenance-v1.json`,
    sha256: '9690333141c31dc98ef8f2761902930dab998bb768337753d939f120baedd897',
  },
];

const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envText = await readFile(resolve(root, '.env.local'), 'utf8');
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');

const localFiles = new Map();
for (const file of SOURCES) {
  const bytes = await readFile(resolve(assetRoot, ...file.relativePath.split('/')));
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error(`SOURCE_HASH_MISMATCH_${file.key}`);
  }
  localFiles.set(file.key, bytes);
}
const candidate = JSON.parse(localFiles.get('candidate').toString('utf8'));
if (candidate.contentType !== 'vocabulary' || candidate.grade !== '三年级'
  || candidate.unit !== 'Unit 2' || candidate.words.length !== 3
  || candidate.words.map(word => word.word).join('|') !== 'grandma|grandpa|family'
  || candidate.words.some(word => !Array.isArray(word.syllablesCandidate)
    || word.syllablesCandidate.join('') !== word.word)) {
  throw new Error('VOCABULARY_CANDIDATE_INVALID');
}

const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
const { stdout } = await execute(process.execPath, [cli, 'secrets', 'get', '--json'],
  { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const first = stdout.indexOf('{');
if (first < 0) throw new Error('TEMPORARY_CREDENTIALS_UNAVAILABLE');
const credentials = JSON.parse(stdout.slice(first)).data;
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID');
}

const nodeCloudbase = require('@cloudbase/node-sdk');
const app = nodeCloudbase.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const database = app.database();
const now = new Date().toISOString();
const [organization, classroom, memberDocs, priorResource, priorAudit] = await Promise.all([
  database.collection('organizations').doc(ORG).get().catch(() => null),
  database.collection('classes').doc(CLASS).get().catch(() => null),
  database.collection('class_memberships').where({ organizationId: ORG, classId: CLASS,
    status: 'active', deletedAt: null }).get(),
  database.collection('learning_resources').doc(RESOURCE).get().catch(() => null),
  database.collection('operation_logs').doc(AUDIT).get().catch(() => null),
]);
const orgRow = dataOne(organization);
const classRow = dataOne(classroom);
const members = dataList(memberDocs);
if (orgRow?.status !== 'active' || classRow?.status !== 'active' || members.length !== 36
  || members.some(row => row.organizationId !== ORG || row.classId !== CLASS)) {
  throw new Error('TARGET_NONPRODUCTION_SCOPE_MISMATCH');
}
if (mode === 'inspect' && (dataOne(priorResource) || dataOne(priorAudit))) {
  throw new Error('RESOURCE_OR_AUDIT_ID_NOT_EMPTY');
}
if (mode === 'verify' && (!dataOne(priorResource) || !dataOne(priorAudit))) {
  throw new Error('RESOURCE_OR_AUDIT_MISSING');
}

const visibility = { type: 'classes', classIds: [CLASS] };
const words = candidate.words.map(word => ({
  id: word.id,
  word: word.word,
  meaning: word.meaningCandidate,
  example: word.exampleFromBook,
  syllables: word.syllablesCandidate,
}));
const evidence = Object.fromEntries(SOURCES.map(file => [file.key, {
  cloudPath: file.cloudPath, sha256: file.sha256, bytes: localFiles.get(file.key).length,
}]));
const resource = {
  _id: RESOURCE, organizationId: ORG, schemaVersion: 1, version: 1, deletedAt: null,
  seedRunId: PACK, seedVersion: 'unit2-words-v1', createdAt: now, updatedAt: now,
  type: 'vocabulary', title: '人教版三年级上册 Unit 2 词包｜真实来源·待用户验收',
  contentVersion: 1, status: 'published', copyrightStatus: 'verified', visibility,
  grade: '三年级', term: '上册', textbook: '人教版三年级上册（版次待核）', unit: 'Unit 2', words,
  acceptanceStatus: 'pending_user_acceptance', testOnly: true,
  sourceRightsStatus: 'user_confirmed_cleared', sourceAssetLibrary: 'F:/英语资产',
  sourceBookResourceId: 'book-unknown-3a', sourceBookEdition: 'unconfirmed',
  sourcePageNumber: 83, sourceAudioResourceId: 'audio-3a3ca484baf8',
  sourceEvidence: evidence,
  unresolvedFields: ['edition_confirmation', 'per_word_audio_start_end_ms'],
  audioMappingStatus: 'not_mapped',
};
const audit = {
  _id: AUDIT, organizationId: ORG, actorId: 'system:m3-real-asset-import',
  actorType: 'system', action: 'content.realVocabularyUserAcceptanceImported',
  targetType: 'learning_resources', targetId: RESOURCE, result: 'succeeded',
  createdAt: now, operationId: `op_${AUDIT}`, metadata: {
    sourceAssetLibrary: 'F:/英语资产', acceptanceStatus: 'pending_user_acceptance',
    visibility, wordCount: words.length, sourceEvidence: evidence,
    unresolvedFields: resource.unresolvedFields,
  },
};

if (mode === 'inspect') {
  process.stdout.write(`PREFLIGHT=passed;classMembers=${members.length};sourceFiles=${SOURCES.length};sourceBytes=${[...localFiles.values()].reduce((sum, item) => sum + item.length, 0)};targetIds=empty\n`);
  process.exit(0);
}

if (mode === 'apply') {
  const uploaded = {};
  for (const file of SOURCES) {
    const result = await app.uploadFile({ cloudPath: file.cloudPath, fileContent: localFiles.get(file.key) });
    if (typeof result?.fileID !== 'string' || !result.fileID.startsWith('cloud://')) {
      throw new Error(`UPLOAD_FAILED_${file.key}`);
    }
    uploaded[file.key] = result.fileID;
  }
  const finalEvidence = Object.fromEntries(SOURCES.map(file => [file.key, {
    cloudPath: file.cloudPath, fileID: uploaded[file.key], sha256: file.sha256,
    bytes: localFiles.get(file.key).length,
  }]));
  resource.sourceEvidence = finalEvidence;
  audit.metadata.sourceEvidence = finalEvidence;
  await database.runTransaction(async transaction => {
    if (dataOne(await transaction.collection('learning_resources').doc(RESOURCE).get().catch(() => null))
      || dataOne(await transaction.collection('operation_logs').doc(AUDIT).get().catch(() => null))) {
      throw new Error('RESOURCE_OR_AUDIT_ID_COLLISION');
    }
    const { _id: resourceId, ...resourceFields } = resource;
    const { _id: auditId, ...auditFields } = audit;
    await transaction.collection('learning_resources').doc(resourceId).set(resourceFields);
    await transaction.collection('operation_logs').doc(auditId).set(auditFields);
  });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(resolve(outputRoot, 'cloud-import-manifest.json'), JSON.stringify({
    schemaVersion: 1, packId: PACK, organizationId: ORG, classIds: [CLASS], resourceId: RESOURCE,
    auditId: AUDIT, status: resource.status, acceptanceStatus: resource.acceptanceStatus,
    title: resource.title, words: words.map(item => item.word), sourceEvidence: finalEvidence,
    unresolvedFields: resource.unresolvedFields, importedAt: now,
  }, null, 2) + '\n', 'utf8');
  process.stdout.write(`APPLY=created;resource=${RESOURCE};audit=${AUDIT};files=${SOURCES.length};words=${words.length};classMembers=${members.length};acceptance=pending_user_acceptance\n`);
  process.exit(0);
}

const storedResource = dataOne(priorResource);
const storedAudit = dataOne(priorAudit);
if (storedResource.type !== 'vocabulary' || storedResource.status !== 'published'
  || storedResource.acceptanceStatus !== 'pending_user_acceptance' || storedResource.testOnly !== true
  || storedResource.visibility?.type !== 'classes' || storedResource.visibility.classIds?.length !== 1
  || storedResource.visibility.classIds[0] !== CLASS || storedResource.words?.length !== 3
  || storedAudit.targetId !== RESOURCE || storedAudit.result !== 'succeeded') {
  throw new Error('CLOUD_DOCUMENT_VERIFICATION_FAILED');
}
const bundle = resolve(root, '.runtime/m3-real-vocabulary-20261005/entry.cjs');
await mkdir(dirname(bundle), { recursive: true });
await build({ entryPoints: [resolve(root, 'src/seed/m3-real-sample-entry.ts')], outfile: bundle,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(bundle);
const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(
  api.createCloudBaseDocumentDatabase(database)));
const studentActor = {
  requestId: 'm3_real_vocabulary_student_verify', sessionId: 'm3-real-vocabulary-verify',
  actorUserId: 'usr_student_g3_01', actorRole: 'student', organizationId: ORG,
  platformSubjectDigest: 'm3-real-vocabulary-verify', permissions: ['content.read'],
  scopeIds: [CLASS], authzVersion: 1,
};
const studentPacks = await content.listVocabularyPacks(studentActor);
const studentPack = await content.getVocabularyPack(studentActor, RESOURCE);
const studentCatalog = await content.listStudentCatalog(studentActor,
  { type: 'vocabulary', grade: '三年级', unit: 'Unit 2' }, { limit: 20, offset: 0 });
const teacherActor = {
  requestId: 'm3_real_vocabulary_teacher_verify', sessionId: 'm3-real-vocabulary-verify',
  actorUserId: 'usr_teacher_demo_01', actorRole: 'teacher', organizationId: ORG,
  platformSubjectDigest: 'm3-real-vocabulary-verify', permissions: ['content.read', 'task.publish'],
  scopeIds: [CLASS], authzVersion: 1,
};
const teacherCatalog = await content.listTaskCatalogResources(teacherActor,
  { type: 'vocabulary', targetClassIds: [CLASS], keyword: 'Unit 2' }, { limit: 20, offset: 0 });
const otherStudentActor = { ...studentActor, requestId: 'm3_real_vocabulary_scope_verify',
  actorUserId: 'usr_student_g4_01', scopeIds: ['cls_grade4_1'] };
const otherStudentPacks = await content.listVocabularyPacks(otherStudentActor);
if (!studentPacks.some(item => item.id === RESOURCE) || studentPack.words.length !== 3
  || !studentCatalog.items.some(item => item.id === RESOURCE)
  || !teacherCatalog.items.some(item => item.id === RESOURCE)
  || otherStudentPacks.some(item => item.id === RESOURCE)) {
  throw new Error('STUDENT_OR_TEACHER_CONTENT_SERVICE_VERIFICATION_FAILED');
}
const readbacks = {};
for (const file of SOURCES) {
  const row = storedResource.sourceEvidence?.[file.key];
  if (!row?.fileID || row.cloudPath !== file.cloudPath || row.sha256 !== file.sha256) {
    throw new Error(`CLOUD_EVIDENCE_REFERENCE_INVALID_${file.key}`);
  }
  const downloaded = await app.downloadFile({ fileID: row.fileID });
  const bytes = Buffer.isBuffer(downloaded.fileContent) ? downloaded.fileContent
    : Buffer.from(downloaded.fileContent ?? '');
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error(`CLOUD_FILE_HASH_MISMATCH_${file.key}`);
  }
  readbacks[file.key] = file.sha256;
}
process.stdout.write(`VERIFY=passed;resourceAndAudit=2/2;privateFiles=${SOURCES.length}/${SOURCES.length};studentCatalog=visible;teacherTaskCatalog=visible;crossClass=denied;studentScope=${CLASS};words=${studentPack.words.length};hashes=${Object.keys(readbacks).length}/${SOURCES.length}\n`);

function dataOne(result) {
  const value = result?.data;
  if (Array.isArray(value)) return value[0] ?? null;
  if (Array.isArray(value?.list)) return value.list[0] ?? null;
  return value && typeof value === 'object' ? value : null;
}
function dataList(result) {
  const value = result?.data;
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.list) ? value.list : [];
}
