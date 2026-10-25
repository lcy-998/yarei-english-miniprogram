import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(root, '..', '..');
const manifestPath = resolve(projectRoot, 'workspace', 'm3-real-samples', '2026-09-30', 'manifest.json');
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
const mode = process.argv[2];
if (!['inspect', 'apply', 'repair', 'verify'].includes(mode)) throw new Error('Use inspect, apply, repair, or verify.');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const PREFIX = 'm3-real-samples/2026-09-30/';
const PACK = 'm3-real-samples-2026-09-30';
const ORG = 'org_qihang_demo';
const CLASS = 'cls_grade3_2';
const STUDENT = 'usr_student_g3_01';
const OTHER_STUDENT = 'usr_student_g4_01';
const READING = 'res_m3_real_sbc0008_reading_20260930';
const WORK = 'res_m3_real_sbc0008_work_20260930';
const AUDIT = 'audit_m3_real_sample_20260930';
if (manifest.packId !== PACK || manifest.organizationId !== ORG || manifest.classId !== CLASS
  || manifest.readingResourceId !== READING || manifest.workResourceId !== WORK
  || manifest.auditId !== AUDIT || !Array.isArray(manifest.files)
  || manifest.files.length !== 32 || manifest.totalBytes > 5 * 1024 * 1024
  || manifest.files.some(file => typeof file.key !== 'string'
    || typeof file.cloudPath !== 'string' || !file.cloudPath.startsWith(PREFIX)
    || !/^[a-f0-9]{64}$/u.test(file.sha256))) throw new Error('SAMPLE_MANIFEST_INVALID');
const fileKeys = new Set(manifest.files.map(file => file.key));
const cloudPaths = new Set(manifest.files.map(file => file.cloudPath));
if (fileKeys.size !== 32 || cloudPaths.size !== 32) throw new Error('SAMPLE_MANIFEST_DUPLICATE');

const assetRoot = resolve(manifest.assetRoot);
const localContent = new Map();
let byteCount = 0;
for (const file of manifest.files) {
  const path = resolve(assetRoot, ...file.assetRootRelativePath.split('/'));
  if (!path.startsWith(`${assetRoot}\\`) && !path.startsWith(`${assetRoot}/`)) {
    throw new Error('SOURCE_PATH_OUTSIDE_ASSET_LIBRARY');
  }
  const content = await readFile(path);
  byteCount += content.length;
  if (content.length !== file.bytes
    || createHash('sha256').update(content).digest('hex') !== file.sha256) {
    throw new Error(`SOURCE_HASH_MISMATCH_${file.key}`);
  }
  localContent.set(file.key, content);
}
if (byteCount !== manifest.totalBytes) throw new Error('SOURCE_TOTAL_MISMATCH');

const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const envText = await readFile(join(root, '.env.local'), 'utf8');
const privateEnvId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!privateEnvId || config.envId !== privateEnvId) throw new Error('NONPRODUCTION_ENV_MISMATCH');

async function cliOutput(args) {
  const { stdout } = await execute(process.execPath, [cli, ...args],
    { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

function parseJsonOutput(output) {
  const first = output.indexOf('{');
  if (first < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  return JSON.parse(output.slice(first));
}

const environments = parseJsonOutput(await cliOutput(['env', 'list', '--json'])).data;
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== privateEnvId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_COST_PREFLIGHT_FAILED');
}
const acl = await cliOutput(['storage', 'get-acl', '--json']);
if (!acl.includes('Only creator and admin can read and write')) throw new Error('STORAGE_NOT_PRIVATE');
const prefixContents = parseJsonOutput(await cliOutput(['storage', 'list', PREFIX, '--json'])).data;
if (!Array.isArray(prefixContents)) throw new Error('STORAGE_PREFIX_READ_FAILED');

const secrets = parseJsonOutput(await cliOutput(['secrets', 'get', '--json'])).data;
if (secrets?.isTemporary !== true || secrets.envId !== privateEnvId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const sdk = require('@cloudbase/js-sdk');
const app = sdk.init({ env: privateEnvId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token });
const nodeApp = require('@cloudbase/node-sdk').init({ env: privateEnvId,
  secretId: secrets.secretId, secretKey: secrets.secretKey, sessionToken: secrets.token });
const bundle = join(root, '.runtime', 'm3-real-samples-20260930', 'entry.cjs');
await mkdir(dirname(bundle), { recursive: true });
await build({ entryPoints: [join(root, 'src', 'seed', 'm3-real-sample-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(bundle);
const database = api.createCloudBaseDocumentDatabase(app.database());

const organization = await database.get('organizations', ORG);
const classroom = await database.get('classes', CLASS);
const student = await database.get('users', STUDENT);
const membership = await database.get('class_memberships', 'mem_grade3_2_g3_01');
const seed = await database.get('migration_runs', 'seed_m2_local_addon_v1');
const members = await database.find('class_memberships',
  { organizationId: ORG, classId: CLASS, status: 'active', deletedAt: null });
if (organization?.status !== 'active' || classroom?.status !== 'active'
  || student?.status !== 'active' || membership?.status !== 'active'
  || seed?.status !== 'succeeded' || members.length !== 36) {
  throw new Error('DEMO_ORGANIZATION_PREFLIGHT_FAILED');
}
const priorReading = await database.get('learning_resources', READING);
const priorWork = await database.get('learning_resources', WORK);
const priorAudit = await database.get('operation_logs', AUDIT);
const existing = [priorReading, priorWork, priorAudit].filter(Boolean).length;
if (existing !== 0 && existing !== 3) throw new Error('PARTIAL_SAMPLE_PACK_REQUIRES_REVIEW');
if (existing === 3 && (priorReading.acceptancePackId !== PACK
  || priorWork.acceptancePackId !== PACK || priorAudit.metadata?.packId !== PACK)) {
  throw new Error('SAMPLE_PACK_OWNERSHIP_MISMATCH');
}

function expectedProgressAccess(reading) {
  const studentIds = members.map(member => member.studentId);
  if (studentIds.length !== 36 || new Set(studentIds).size !== 36
    || studentIds.some(id => typeof id !== 'string' || !id.startsWith('usr_student_'))
    || !studentIds.includes(STUDENT)) throw new Error('CLASS_STUDENT_MEMBERSHIP_INVALID');
  const chapters = reading?.payload?.chapters;
  if (!Array.isArray(chapters) || chapters.length !== 1
    || chapters[0].id !== 'chapter_m3_real_sbc0008'
    || !Array.isArray(chapters[0].pages) || chapters[0].pages.length !== 9) {
    throw new Error('SAMPLE_READING_PAGES_INVALID');
  }
  const pages = chapters[0].pages.map((page, index) => {
    if (page.id !== `page_m3_real_sbc0008_${String(index + 1).padStart(2, '0')}`
      || page.pageNumber !== index + 1) throw new Error('SAMPLE_READING_PAGE_MISMATCH');
    return { id: page.id, chapterId: chapters[0].id, pageNumber: page.pageNumber };
  });
  return { allowedStudentIds: studentIds.sort(), pages, wordIds: [] };
}

function progressAccessMatches(reading, expected) {
  return JSON.stringify([...(reading.allowedStudentIds ?? [])].sort()) === JSON.stringify(expected.allowedStudentIds)
    && JSON.stringify(reading.pages) === JSON.stringify(expected.pages)
    && JSON.stringify(reading.wordIds) === JSON.stringify(expected.wordIds);
}

if (mode === 'inspect') {
  process.stdout.write(`PREFLIGHT=passed;files=${manifest.files.length};bytes=${byteCount};existing=${existing}/3;prefixEntries=${prefixContents.length}\n`);
  process.exit(0);
}

if (mode === 'repair') {
  if (existing !== 3 || priorReading.type !== 'reading' || priorReading.status !== 'published'
    || priorReading.organizationId !== ORG || priorReading.visibility?.classIds?.length !== 1
    || priorReading.visibility.classIds[0] !== CLASS) throw new Error('SAMPLE_REPAIR_PREFLIGHT_FAILED');
  const expected = expectedProgressAccess(priorReading);
  if (progressAccessMatches(priorReading, expected)) {
    process.stdout.write('REPAIR=already_complete\n');
  } else {
    if (priorReading.allowedStudentIds !== undefined || priorReading.pages !== undefined
      || priorReading.wordIds !== undefined) throw new Error('SAMPLE_ACCESS_FIELDS_CONFLICT');
    await database.runTransaction(async transaction => {
      const current = await transaction.get('learning_resources', READING);
      if (current?.version !== priorReading.version
        || current.acceptancePackId !== PACK) throw new Error('SAMPLE_REPAIR_VERSION_CHANGED');
      const updated = { ...current, ...expected, version: current.version + 1,
        updatedAt: new Date().toISOString() };
      if (!await transaction.replace('learning_resources', READING, current.version, updated)) {
        throw new Error('SAMPLE_REPAIR_REPLACE_FAILED');
      }
    });
    process.stdout.write('REPAIR=progress_access_added;students=36;pages=9\n');
  }
  await verifyPack();
  process.exit(0);
}

function storedFileId(receipt, key) {
  const value = receipt[key];
  if (typeof value !== 'string' || !value.startsWith('cloud://')) {
    throw new Error(`STORED_MEDIA_REFERENCE_MISSING_${key}`);
  }
  return value;
}

async function verifyCloudFiles(receipt) {
  for (const file of manifest.files) {
    const fileID = storedFileId(receipt, file.key);
    const downloaded = await nodeApp.downloadFile({ fileID });
    const content = downloaded.fileContent;
    if (!Buffer.isBuffer(content) && !(content instanceof Uint8Array)) {
      throw new Error(`MEDIA_READBACK_INVALID_${file.key}`);
    }
    const actual = Buffer.from(content);
    if (actual.length !== file.bytes
      || createHash('sha256').update(actual).digest('hex') !== file.sha256) {
      throw new Error(`MEDIA_READBACK_HASH_MISMATCH_${file.key}`);
    }
  }
}

function studentActor(userId, classId) {
  return { requestId: `m3_real_verify_${userId}`, sessionId: 'server-m3-sample-verify',
    actorUserId: userId, actorRole: 'student', organizationId: ORG,
    platformSubjectDigest: 'server-m3-sample-verify', permissions: ['content.read'],
    scopeIds: [classId], authzVersion: 1 };
}

async function verifyPack() {
  const reading = await database.get('learning_resources', READING);
  const work = await database.get('learning_resources', WORK);
  const audit = await database.get('operation_logs', AUDIT);
  if (reading?.acceptancePackId !== PACK || reading.status !== 'published'
    || work?.acceptancePackId !== PACK || work.status !== 'published'
    || audit?.metadata?.packId !== PACK || audit.result !== 'succeeded') {
    throw new Error('SAMPLE_PACK_READBACK_FAILED');
  }
  const receipt = audit.metadata.assetFileIds;
  if (!receipt || Object.keys(receipt).length !== manifest.files.length) {
    throw new Error('SAMPLE_AUDIT_RECEIPT_INCOMPLETE');
  }
  await verifyCloudFiles(receipt);
  const contentService = new api.ContentQueryService(api.createOrgContentDocumentRepository(database));
  const actor = studentActor(STUDENT, CLASS);
  const books = await contentService.listReadingResources(actor);
  const catalog = await contentService.listStudentCatalog(actor,
    { type: 'reading', category: 'picture_book' }, { limit: 20, offset: 0 });
  const book = await contentService.getReadingResource(actor, READING);
  const expected = expectedProgressAccess(reading);
  if (!progressAccessMatches(reading, expected)) throw new Error('SAMPLE_READING_PROGRESS_ACCESS_MISSING');
  const progressService = new api.LearningProgressService(
    api.createLearningProgressDocumentRepository(database),
    { nowIso: () => new Date().toISOString() }, { next: () => 'unused_m3_real' });
  const progress = await progressService.getReadingProgress(actor, READING);
  if (progress !== null && progress.resourceId !== READING) throw new Error('SAMPLE_READING_PROGRESS_INVALID');
  if (!books.some(item => item.id === READING)
    || !catalog.items.some(item => item.id === READING)
    || book.chapters[0]?.pages.length !== 9
    || !book.chapters[0].pages.every(page => page.imageAssetKey.startsWith('cloud://'))) {
    throw new Error('STUDENT_READING_VIEW_FAILED');
  }
  const workService = new api.StudentWorkService(new api.DocumentStudentWorkRepository(database),
    null, { nowIso: () => new Date().toISOString() }, { next: () => 'unused_m3_real' },
    new api.CloudBaseWorkPlayback(nodeApp));
  const materials = await workService.listMaterials(actor);
  const playback = await workService.getMaterialPlayback(actor, WORK);
  if (!materials.some(item => item.id === WORK)
    || !playback.temporaryUrl.startsWith('https://')) throw new Error('STUDENT_WORK_VIEW_FAILED');
  const alternate = await database.get('users', OTHER_STUDENT);
  if (alternate?.status === 'active') {
    const otherActor = studentActor(OTHER_STUDENT, 'cls_grade4_1');
    const otherBooks = await contentService.listReadingResources(otherActor);
    const otherMaterials = await workService.listMaterials(otherActor);
    if (otherBooks.some(item => item.id === READING)
      || otherMaterials.some(item => item.id === WORK)) throw new Error('CROSS_CLASS_SAMPLE_LEAK');
  }
  const mediaUrls = await nodeApp.getTempFileURL({ fileList: [
    { fileID: storedFileId(receipt, 'full_audio'), maxAge: 60 },
    { fileID: storedFileId(receipt, 'pep_listening'), maxAge: 60 },
    { fileID: storedFileId(receipt, 'page_01'), maxAge: 60 },
    { fileID: storedFileId(receipt, 'thumb_01'), maxAge: 60 },
  ] });
  if (mediaUrls.fileList?.length !== 4 || mediaUrls.fileList.some(item =>
    typeof item.tempFileURL !== 'string' || !item.tempFileURL.startsWith('https://'))) {
    throw new Error('AUDIO_SIGNED_URL_FAILED');
  }
  const pageFileIds = manifest.files.filter(file => file.kind === 'page' || file.kind === 'thumbnail')
    .map(file => storedFileId(receipt, file.key));
  const pageUrls = await nodeApp.getTempFileURL({ fileList: pageFileIds.map(fileID => ({ fileID, maxAge: 3600 })) });
  if (pageUrls.fileList?.length !== pageFileIds.length || pageUrls.fileList.some(item =>
    typeof item.tempFileURL !== 'string' || !item.tempFileURL.startsWith('https://'))) {
    throw new Error('PAGE_SIGNED_URL_FAILED');
  }
  process.stdout.write(`VERIFY=passed;storageHash=${manifest.files.length}/${manifest.files.length};pageSigned=${pageFileIds.length};studentCatalog=visible;studentReading=visible;progressAccess=ready;studentDubbing=visible;crossClass=denied\n`);
}

if (mode === 'verify' || existing === 3) {
  await verifyPack();
  process.exit(0);
}
if (prefixContents.length !== 0) throw new Error('SAMPLE_STORAGE_PREFIX_NOT_EMPTY');

const uploaded = [];
const receipt = {};
let created = false;
try {
  for (const file of manifest.files) {
    const result = await nodeApp.uploadFile({ cloudPath: file.cloudPath,
      fileContent: localContent.get(file.key) });
    if (typeof result.fileID !== 'string' || !result.fileID.startsWith('cloud://')) {
      throw new Error(`MEDIA_UPLOAD_INVALID_RESPONSE_${file.key}`);
    }
    receipt[file.key] = result.fileID;
    uploaded.push(result.fileID);
  }
  await verifyCloudFiles(receipt);
  const byKey = Object.fromEntries(manifest.files.map(file => [file.key, file]));
  const now = new Date().toISOString();
  const base = (id, type, title, payload) => ({
    _id: id, id, organizationId: ORG, schemaVersion: 1, version: 1,
    deletedAt: null, acceptancePackId: PACK, createdAt: now, updatedAt: now,
    type, title, contentVersion: 1, status: 'published', copyrightStatus: 'demo',
    visibility: { type: 'classes', classIds: [CLASS] }, allowedClassIds: [CLASS], payload,
  });
  const pages = manifest.pages.map(page => {
    const image = byKey[`page_${String(page.pageNumber).padStart(2, '0')}`];
    const thumbnailKey = `thumb_${String(page.pageNumber).padStart(2, '0')}`;
    const audioKey = `page_audio_${String(page.pageNumber).padStart(2, '0')}`;
    if (!image || !byKey[thumbnailKey] || !byKey[audioKey]) {
      throw new Error('PAGE_ASSET_MANIFEST_INCOMPLETE');
    }
    return { id: `page_m3_real_sbc0008_${String(page.pageNumber).padStart(2, '0')}`,
      pageNumber: page.pageNumber, order: page.pageNumber,
      thumbnailAssetKey: storedFileId(receipt, thumbnailKey),
      imageAssetKey: storedFileId(receipt, `page_${String(page.pageNumber).padStart(2, '0')}`),
      width: image.width, height: image.height, assetVersion: 'm3-real-v1',
      ocrText: page.text,
      audioFileId: storedFileId(receipt, audioKey),
      ...(page.textHitArea ? { sentenceMappings: [{ text: page.text,
        hitAreas: [page.textHitArea], audioFileId: storedFileId(receipt, audioKey),
        startMs: 0, endMs: page.audioDurationMs }] } : {}),
    };
  });
  const readingPayload = { category: 'picture_book', grade: '三年级',
    term: '2026 秋季非生产测试', textbook: 'Storybooks Canada', unit: '动作短句',
    difficulty: '基础', theme: '动作', searchText: 'What are you doing 真人朗读 动作',
    sourcePage: manifest.source.storybook,
    chapterAudioFileId: storedFileId(receipt, 'full_audio'),
    chapters: [{ id: 'chapter_m3_real_sbc0008', title: 'What are you doing?', order: 1, pages }],
  };
  const reading = { ...base(READING, 'reading', 'What are you doing?｜真人朗读测试', readingPayload),
    category: 'picture_book', grade: '三年级', term: '2026 秋季非生产测试',
    textbook: 'Storybooks Canada', unit: '动作短句', difficulty: '基础', theme: '动作',
    allowedStudentIds: members.map(member => member.studentId).sort(),
    pages: pages.map(page => ({ id: page.id, chapterId: 'chapter_m3_real_sbc0008', pageNumber: page.pageNumber })),
    wordIds: [] };
  const workPayload = { demonstrationFileId: storedFileId(receipt, 'narrated_video'),
    subtitle: 'I am singing. She is waving. I am clapping. She is stretching. He is calling. I am answering. She is listening. What are you doing?',
    subtitleFileId: storedFileId(receipt, 'caption_vtt'), sourcePage: manifest.source.storybook };
  const work = base(WORK, 'work', 'What are you doing?｜真人旁白配音测试', workPayload);
  const audit = { _id: AUDIT, id: AUDIT, organizationId: ORG, schemaVersion: 1,
    version: 1, deletedAt: null, requestId: PACK, actorUserId: null, actorRole: null,
    action: 'content.realSamplePrepared', targetType: 'learning_resources', targetId: READING,
    result: 'succeeded', errorCode: null, occurredAt: now,
    metadata: { packId: PACK, targetClassId: CLASS, fileCount: manifest.files.length,
      totalBytes: byteCount, assetFileIds: receipt, listeningQuestionFileId: receipt.listening_questions,
      pepListeningFileId: receipt.pep_listening } };
  await database.runTransaction(async transaction => {
    for (const id of [READING, WORK]) {
      if (await transaction.get('learning_resources', id)) throw new Error('SAMPLE_RESOURCE_ID_COLLISION');
    }
    if (await transaction.get('operation_logs', AUDIT)) throw new Error('SAMPLE_AUDIT_ID_COLLISION');
    if (!await transaction.create('learning_resources', reading)
      || !await transaction.create('learning_resources', work)
      || !await transaction.create('operation_logs', audit)) {
      throw new Error('SAMPLE_PACK_TRANSACTION_FAILED');
    }
  });
  created = true;
  const receiptPath = join(root, '.runtime', 'm3-real-samples-20260930', 'receipt.json');
  await writeFile(receiptPath, JSON.stringify({ packId: PACK, fileCount: uploaded.length,
    totalBytes: byteCount, createdAt: now }, null, 2));
  process.stdout.write(`APPLY=created;files=${uploaded.length};bytes=${byteCount};resources=2;audit=1\n`);
  await verifyPack();
} catch (error) {
  if (!created && uploaded.length > 0) {
    try {
      await nodeApp.deleteFile({ fileList: uploaded });
      process.stderr.write(`ROLLBACK=deleted_new_files;count=${uploaded.length}\n`);
    } catch {
      process.stderr.write(`ROLLBACK=manual_review_required;count=${uploaded.length}\n`);
    }
  }
  throw error;
}
process.exit(0);
