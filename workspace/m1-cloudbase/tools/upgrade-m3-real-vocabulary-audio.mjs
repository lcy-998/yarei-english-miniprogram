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
const FIRST_AUDIT = 'audit_m3_pep3a_u2_real_vocabulary_20261005';
const AUDIT = 'audit_m3_pep3a_u2_real_vocabulary_audio_v2_20261005';
const PACK = 'm3-real-vocabulary-2026-10-05';
const SOURCES = [
  { key: 'candidateV4', relativePath: 'library/derived/m3-pep3a-unit2-vocabulary/v4/word-pack-source-v4.json',
    cloudPath: `${PACK}/v4/provenance/word-pack-source-v4.json`,
    sha256: 'c515c0291f5a51a05309e8eab194b5eab8934ed5a8b8adcfae2502e60d11e6a9' },
  { key: 'provenanceV4', relativePath: 'library/derived/m3-pep3a-unit2-vocabulary/v4/source-provenance-v4.json',
    cloudPath: `${PACK}/v4/provenance/source-provenance-v4.json`,
    sha256: 'c2f9bd90f7f23d24f10b056b5434b5628456b8455243c895dc5634c59b268d5a' },
  { key: 'audio_mum', relativePath: 'library/derived/m3-pep3a-unit2-vocabulary/v4/audio/word-mum-v4.mp3',
    cloudPath: `${PACK}/v4/audio/word-mum.mp3`,
    sha256: '864aedf0dd67f22efc57daca58734fd667cf2befa5de8820b001542c6aec052b', durationMs: 784 },
  { key: 'audio_grandma', relativePath: 'library/derived/m3-pep3a-unit2-vocabulary/v4/audio/word-grandma-v4.mp3',
    cloudPath: `${PACK}/v4/audio/word-grandma.mp3`,
    sha256: '58f2d4a43ca325d3c09c3f93677eb91d1bad64bd3970427911142a274dd0ec05', durationMs: 914 },
  { key: 'audio_grandpa', relativePath: 'library/derived/m3-pep3a-unit2-vocabulary/v4/audio/word-grandpa-v4.mp3',
    cloudPath: `${PACK}/v4/audio/word-grandpa.mp3`,
    sha256: '06f8aa189dc07284e6aee232be92c62266f62cf853187b403307ea36a6163ffb', durationMs: 1019 },
];
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envText = await readFile(resolve(root, '.env.local'), 'utf8');
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');

const localFiles = new Map();
for (const file of SOURCES) {
  const bytes = await readFile(resolve(assetRoot, ...file.relativePath.split('/')));
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`SOURCE_HASH_MISMATCH_${file.key}`);
  localFiles.set(file.key, bytes);
}
const candidate = JSON.parse(localFiles.get('candidateV4').toString('utf8'));
if (candidate.contentType !== 'vocabulary' || candidate.unit !== 'Unit 2'
  || candidate.words.map(word => word.word).join('|') !== 'mum|grandma|grandpa'
  || candidate.words.some(word => !word.audioSha256 || word.syllables.join('') !== word.word)) {
  throw new Error('VOCABULARY_V4_INVALID');
}

const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
async function cliJson(args) {
  const { stdout } = await execute(process.execPath, [cli, ...args],
    { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const first = Math.min(...[stdout.indexOf('{'), stdout.indexOf('[')].filter(index => index >= 0));
  if (!Number.isFinite(first)) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  return JSON.parse(stdout.slice(first));
}
const environments = await cliJson(['env', 'list', '--json']);
const envRows = environments.data ?? environments.Response?.EnvList ?? environments.Response?.EnvSet;
if (!Array.isArray(envRows) || envRows.length !== 1 || envRows[0].EnvId !== envId
  || envRows[0].Status !== 'NORMAL' || envRows[0].PackageName !== '个人版'
  || envRows[0].EnableOverrun !== false || envRows[0].EnvPaid !== 'no' || envRows[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_COST_PREFLIGHT_FAILED');
}
let acl = '';
try {
  const response = await execute(process.execPath, [cli, 'storage', 'get-acl'],
    { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  acl = response.stdout;
} catch { throw new Error('STORAGE_ACL_READ_FAILED'); }
if (!acl.includes('Only creator and admin can read and write')) throw new Error('STORAGE_NOT_PRIVATE');
let storagePrefixEntries;
try {
  const listing = await cliJson(['storage', 'list', `${PACK}/v4/`, '--json']);
  if (!Array.isArray(listing.data)) throw new Error('V4_STORAGE_PREFIX_READ_FAILED');
  storagePrefixEntries = listing.data;
  const expectedPaths = new Set(SOURCES.map(file => file.cloudPath));
  if (storagePrefixEntries.some(item => !expectedPaths.has(item.key))
    || storagePrefixEntries.some(item => !SOURCES.some(file => file.cloudPath === item.key
      && Number(item.size) === localFiles.get(file.key).length))) throw new Error('V4_STORAGE_PREFIX_CONTENT_MISMATCH');
} catch (error) {
  if (String(error?.message ?? '').includes('V4_STORAGE_PREFIX')) throw error;
  throw new Error('V4_STORAGE_PREFIX_READ_FAILED');
}

const secretsResult = await execute(process.execPath, [cli, 'secrets', 'get', '--json'],
  { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const secretStart = secretsResult.stdout.indexOf('{');
if (secretStart < 0) throw new Error('TEMPORARY_CREDENTIALS_UNAVAILABLE');
const credentials = JSON.parse(secretsResult.stdout.slice(secretStart)).data;
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const database = app.database();
const now = new Date().toISOString();
const [organizationResult, classResult, membershipsResult, resourceResult, firstAuditResult, auditResult] = await Promise.all([
  database.collection('organizations').doc(ORG).get().catch(() => null),
  database.collection('classes').doc(CLASS).get().catch(() => null),
  database.collection('class_memberships').where({ organizationId: ORG, classId: CLASS,
    status: 'active', deletedAt: null }).get(),
  database.collection('learning_resources').doc(RESOURCE).get().catch(() => null),
  database.collection('operation_logs').doc(FIRST_AUDIT).get().catch(() => null),
  database.collection('operation_logs').doc(AUDIT).get().catch(() => null),
]);
const organization = dataOne(organizationResult);
const classroom = dataOne(classResult);
const members = dataList(membershipsResult);
const resource = dataOne(resourceResult);
const firstAudit = dataOne(firstAuditResult);
const priorAudit = dataOne(auditResult);
if (organization?.status !== 'active' || classroom?.status !== 'active' || members.length !== 36
  || members.some(row => row.organizationId !== ORG || row.classId !== CLASS)) throw new Error('TARGET_CLASS_SCOPE_MISMATCH');
const expectedV1 = mode !== 'verify';
const validVersion = expectedV1
  ? resource?.version === 1 && !priorAudit && resource?.words?.map(word => word.word).join('|') === 'grandma|grandpa|family'
    && (storagePrefixEntries.length === 0 || storagePrefixEntries.length === SOURCES.length)
  : resource?.version === 2 && priorAudit?.targetId === RESOURCE && priorAudit?.result === 'succeeded'
    && resource?.words?.map(word => word.word).join('|') === 'mum|grandma|grandpa'
    && storagePrefixEntries.length === SOURCES.length;
if (!resource || resource.organizationId !== ORG || !validVersion
  || resource.status !== 'published' || resource.acceptanceStatus !== 'pending_user_acceptance'
  || resource.testOnly !== true || resource.sourceBookEdition !== 'unconfirmed'
  || resource.visibility?.type !== 'classes' || resource.visibility.classIds?.join('|') !== CLASS
  || firstAudit?.targetId !== RESOURCE) {
  throw new Error('RESOURCE_V1_SCOPE_OR_VERSION_MISMATCH');
}

const wordById = new Map(candidate.words.map(word => [word.id, word]));
const v2Words = candidate.words.map(word => ({
  id: word.id, word: word.word, meaning: word.meaning, example: word.example,
  syllables: word.syllables, audioAssetKey: null,
}));
if (mode === 'inspect') {
  process.stdout.write(`PREFLIGHT=passed;classMembers=${members.length};existingVersion=${resource.version};newAudit=empty;files=${SOURCES.length};existingPrivateFiles=${storagePrefixEntries.length};bytes=${[...localFiles.values()].reduce((n, value) => n + value.length, 0)};storage=private;overrun=false;paid=no\n`);
  process.exit(0);
}

if (mode === 'apply') {
  const uploaded = {};
  const priorFileId = resource.sourceEvidence?.wordAudio?.fileID;
  const marker = `${PACK}/`;
  const markerAt = typeof priorFileId === 'string' ? priorFileId.indexOf(marker) : -1;
  if (markerAt < 0) throw new Error('EXISTING_CLOUD_FILE_PREFIX_UNAVAILABLE');
  const cloudFilePrefix = priorFileId.slice(0, markerAt);
  for (const file of SOURCES) {
    const exists = storagePrefixEntries.some(item => item.key === file.cloudPath);
    if (exists) {
      const expectedFileId = `${cloudFilePrefix}${file.cloudPath}`;
      const downloaded = await app.downloadFile({ fileID: expectedFileId });
      const bytes = Buffer.isBuffer(downloaded.fileContent) ? downloaded.fileContent : Buffer.from(downloaded.fileContent ?? '');
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`EXISTING_CLOUD_FILE_HASH_MISMATCH_${file.key}`);
      uploaded[file.key] = expectedFileId;
      continue;
    }
    const result = await app.uploadFile({ cloudPath: file.cloudPath, fileContent: localFiles.get(file.key) });
    if (typeof result?.fileID !== 'string' || !result.fileID.startsWith('cloud://')) throw new Error(`UPLOAD_FAILED_${file.key}`);
    uploaded[file.key] = result.fileID;
  }
  const sourceEvidence = { ...resource.sourceEvidence };
  for (const file of SOURCES) sourceEvidence[file.key] = {
    cloudPath: file.cloudPath, fileID: uploaded[file.key], sha256: file.sha256,
    bytes: localFiles.get(file.key).length, ...(file.durationMs ? { durationMs: file.durationMs } : {}),
  };
  for (const word of v2Words) {
    const sourceWord = wordById.get(word.id);
    const key = `audio_${word.word}`;
    if (!uploaded[key]) throw new Error(`AUDIO_FILE_REFERENCE_MISSING_${word.word}`);
    word.audioAssetKey = uploaded[key];
    word.audioDurationMs = sourceWord.audioDurationMs;
    word.sourceTrackStartMs = sourceWord.sourceTrackStartMs;
    word.sourceTrackEndMs = sourceWord.sourceTrackEndMs;
  }
  const previousVersion = {
    version: resource.version, contentVersion: resource.contentVersion, title: resource.title,
    words: resource.words, acceptanceStatus: resource.acceptanceStatus, sourceEvidence: resource.sourceEvidence,
    archivedAt: now,
  };
  const next = {
    ...resource, version: 2, contentVersion: 2, updatedAt: now,
    title: '人教版三年级上册 Unit 2 词包｜真实词音逐词对位·待用户验收',
    words: v2Words, sourceEvidence, sourceBookEdition: 'unconfirmed',
    unresolvedFields: ['textbook_edition_confirmation', 'human_listening_review_for_user_acceptance'],
    audioMappingStatus: 'machine_aligned_pending_user_acceptance',
    sourceHistory: [...(Array.isArray(resource.sourceHistory) ? resource.sourceHistory : []), previousVersion],
  };
  const audit = {
    organizationId: ORG, requestId: AUDIT, actorId: 'system:m3-real-asset-import', actorType: 'system',
    action: 'content.realVocabularyAudioAlignedAndVersioned', targetType: 'learning_resources',
    targetId: RESOURCE, result: 'succeeded', createdAt: now, operationId: `op_${AUDIT}`,
    metadata: { acceptanceStatus: 'pending_user_acceptance', visibility: resource.visibility,
      previousVersion: 1, version: 2, words: v2Words.map(word => word.word), sourceEvidence },
  };
  await database.runTransaction(async transaction => {
    const latest = dataOne(await transaction.collection('learning_resources').doc(RESOURCE).get().catch(() => null));
    const auditExists = dataOne(await transaction.collection('operation_logs').doc(AUDIT).get().catch(() => null));
    if (!latest || latest.version !== 1 || auditExists) throw new Error('RESOURCE_VERSION_OR_AUDIT_CONFLICT');
    const { _id: _resourceId, ...resourceFields } = next;
    await transaction.collection('learning_resources').doc(RESOURCE).set(resourceFields);
    await transaction.collection('operation_logs').doc(AUDIT).set(audit);
  });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(resolve(outputRoot, 'cloud-audio-v2-manifest.json'), JSON.stringify({
    schemaVersion: 1, packId: PACK, organizationId: ORG, classIds: [CLASS], resourceId: RESOURCE,
    auditId: AUDIT, version: 2, acceptanceStatus: 'pending_user_acceptance', words: v2Words.map(word => word.word),
    sourceEvidence, unresolvedFields: next.unresolvedFields, importedAt: now,
  }, null, 2) + '\n', 'utf8');
  process.stdout.write(`APPLY=versioned;resource=${RESOURCE};version=2;newAudit=${AUDIT};files=${SOURCES.length};words=${v2Words.length};acceptance=pending_user_acceptance\n`);
  process.exit(0);
}

const updated = dataOne(await database.collection('learning_resources').doc(RESOURCE).get());
const audit = dataOne(await database.collection('operation_logs').doc(AUDIT).get());
if (!updated || updated.version !== 2 || updated.contentVersion !== 2
  || updated.acceptanceStatus !== 'pending_user_acceptance' || updated.words?.length !== 3
  || updated.words.map(word => word.word).join('|') !== 'mum|grandma|grandpa'
  || updated.words.some(word => typeof word.audioAssetKey !== 'string' || !word.audioAssetKey.startsWith('cloud://'))
  || !Array.isArray(updated.sourceHistory) || updated.sourceHistory.at(-1)?.version !== 1
  || audit?.targetId !== RESOURCE || audit?.result !== 'succeeded') throw new Error('V2_CLOUD_DOCUMENT_VERIFY_FAILED');
const apiBundle = resolve(root, '.runtime/m3-real-vocabulary-audio-v2/entry.cjs');
await mkdir(dirname(apiBundle), { recursive: true });
await build({ entryPoints: [resolve(root, 'src/seed/m3-real-sample-entry.ts')], outfile: apiBundle,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(apiBundle);
const rawDatabase = api.createCloudBaseDocumentDatabase(database);
const repository = api.createOrgContentDocumentRepository(rawDatabase);
const decodedResource = await repository.findLearningResource(ORG, RESOURCE);
if (!decodedResource) throw new Error(`V2_RESOURCE_DECODE_FAILED_${JSON.stringify({
  type: updated.type, status: updated.status, organizationMatches: updated.organizationId === ORG,
  titlePresent: typeof updated.title === 'string', grade: updated.grade, unit: updated.unit,
  contentVersionType: typeof updated.contentVersion, wordCount: updated.words?.length,
  copyrightStatus: updated.copyrightStatus, termType: typeof updated.term, textbookType: typeof updated.textbook,
  words: updated.words?.map(word => ({ id: word.id, word: word.word, meaningType: typeof word.meaning,
    exampleType: typeof word.example, syllablesValid: Array.isArray(word.syllables),
    audioAssetValid: typeof word.audioAssetKey === 'string' && word.audioAssetKey.startsWith('cloud://'),
    durationType: typeof word.audioDurationMs })),
  visibilityType: updated.visibility?.type, classScopeMatches: updated.visibility?.classIds?.join('|') === CLASS,
})}`);
const content = new api.ContentQueryService(repository);
const studentActor = { requestId: 'm3_vocab_audio_v2_student', sessionId: 'm3-vocab-audio-v2-verify',
  actorUserId: 'usr_student_g3_01', actorRole: 'student', organizationId: ORG,
  platformSubjectDigest: 'm3-vocab-audio-v2-verify', permissions: ['content.read'], scopeIds: [CLASS], authzVersion: 1 };
const pack = await content.getVocabularyPack(studentActor, RESOURCE);
const studentCatalog = await content.listStudentCatalog(studentActor,
  { type: 'vocabulary', grade: '三年级', unit: 'Unit 2' }, { limit: 20, offset: 0 });
const teacherActor = { ...studentActor, requestId: 'm3_vocab_audio_v2_teacher', actorUserId: 'usr_teacher_demo_01',
  actorRole: 'teacher', permissions: ['content.read', 'task.publish'] };
const teacherCatalog = await content.listTaskCatalogResources(teacherActor,
  { type: 'vocabulary', targetClassIds: [CLASS], keyword: 'Unit 2' }, { limit: 20, offset: 0 });
if (!studentCatalog.items.some(item => item.id === RESOURCE) || !teacherCatalog.items.some(item => item.id === RESOURCE)
  || pack.words.length !== 3 || pack.words.some(word => !word.audioAssetKey?.startsWith('cloud://')))
  throw new Error('AUTHORIZED_V2_CONTENT_SERVICE_VERIFY_FAILED');
for (const file of SOURCES) {
  const id = updated.sourceEvidence?.[file.key]?.fileID;
  if (typeof id !== 'string') throw new Error(`V2_FILE_ID_MISSING_${file.key}`);
  const downloaded = await app.downloadFile({ fileID: id });
  const bytes = Buffer.isBuffer(downloaded.fileContent) ? downloaded.fileContent : Buffer.from(downloaded.fileContent ?? '');
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`V2_CLOUD_FILE_HASH_MISMATCH_${file.key}`);
}
process.stdout.write(`VERIFY=passed;resourceVersion=2;audit=1;privateFiles=${SOURCES.length}/${SOURCES.length};studentCatalog=visible;teacherTaskCatalog=visible;perWordAudio=3/3;editionStillUnconfirmed=true\n`);

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
