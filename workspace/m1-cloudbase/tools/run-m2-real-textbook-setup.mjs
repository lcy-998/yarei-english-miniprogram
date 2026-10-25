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
const manifestPath = join(projectRoot, 'workspace', 'm2-acceptance', '2026-09-30-real-textbooks', 'manifest.json');
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('Use inspect, apply, or verify.');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const PACK = 'm2-real-textbook-samples-2026-09-30';
const ORG = 'org_qihang_demo';
const AUDIT = 'audit_m2_real_textbooks_20260930';
const TEACHER = 'usr_teacher_demo_01';
const PREFIX = 'm2-real-textbooks/2026-09-30/';
const targetClasses = new Map([['cls_grade3_2', { count: 36, student: 'usr_student_g3_01' }],
  ['cls_grade4_1', { count: 32, student: 'usr_student_g4_01' }]]);
if (manifest.packId !== PACK || manifest.organizationId !== ORG || manifest.prefix !== PREFIX
  || manifest.books?.length !== 2 || manifest.files?.length !== 60
  || manifest.books.some(book => !targetClasses.has(book.classId)
    || !['res_m2_real_pep3a_unit1_20260930', 'res_m2_real_pep4a_unit1_20260930'].includes(book.resourceId))
  || manifest.files.some(file => !file.cloudPath.startsWith(PREFIX)
    || !/^[a-f0-9]{64}$/u.test(file.sha256) || file.bytes < 1)) throw new Error('MANIFEST_INVALID');
if (new Set(manifest.files.map(file => file.key)).size !== 60
  || new Set(manifest.files.map(file => file.cloudPath)).size !== 60
  || new Set(manifest.books.map(book => book.resourceId)).size !== 2) throw new Error('MANIFEST_DUPLICATE');

const assetRoot = resolve(manifest.assetRoot);
const bytesByKey = new Map();
let totalBytes = 0;
for (const book of manifest.books) {
  const sourcePath = resolve(assetRoot, ...book.sourcePdfPath.split('/'));
  if (!sourcePath.startsWith(`${assetRoot}\\`) && !sourcePath.startsWith(`${assetRoot}/`)) throw new Error('PDF_PATH_INVALID');
  const pdf = await readFile(sourcePath);
  if (createHash('sha256').update(pdf).digest('hex') !== book.sourcePdfSha256) throw new Error('PDF_HASH_MISMATCH');
}
for (const file of manifest.files) {
  const sourcePath = resolve(assetRoot, ...file.sourceRelativePath.split('/'));
  if (!sourcePath.startsWith(`${assetRoot}\\`) && !sourcePath.startsWith(`${assetRoot}/`)) throw new Error('FILE_PATH_INVALID');
  const bytes = await readFile(sourcePath);
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error(`FILE_HASH_MISMATCH_${file.key}`);
  }
  bytesByKey.set(file.key, bytes);
  totalBytes += bytes.length;
}
if (totalBytes !== manifest.totalBytes || totalBytes > 15 * 1024 * 1024) throw new Error('BYTE_BUDGET_EXCEEDED');

const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const envText = await readFile(join(root, '.env.local'), 'utf8');
const privateEnvId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!privateEnvId || config.envId !== privateEnvId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
async function cliOutput(args) {
  const { stdout } = await execute(process.execPath, [cli, ...args],
    { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}
function parseJson(output) { const first = output.indexOf('{'); if (first < 0) throw new Error('CLI_JSON_MISSING'); return JSON.parse(output.slice(first)); }
const environments = parseJson(await cliOutput(['env', 'list', '--json'])).data;
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== privateEnvId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') throw new Error('ENV_OR_COST_PREFLIGHT_FAILED');
const acl = await cliOutput(['storage', 'get-acl', '--json']);
if (!acl.includes('Only creator and admin can read and write')) throw new Error('STORAGE_NOT_PRIVATE');
const prefixContents = parseJson(await cliOutput(['storage', 'list', PREFIX, '--json'])).data;
if (!Array.isArray(prefixContents)) throw new Error('STORAGE_PREFIX_READ_FAILED');

const secrets = parseJson(await cliOutput(['secrets', 'get', '--json'])).data;
if (secrets?.isTemporary !== true || secrets.envId !== privateEnvId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const jsSdk = require('@cloudbase/js-sdk');
const app = jsSdk.init({ env: privateEnvId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token });
const nodeApp = require('@cloudbase/node-sdk').init({ env: privateEnvId,
  secretId: secrets.secretId, secretKey: secrets.secretKey, sessionToken: secrets.token });
const bundle = join(root, '.runtime', 'm2-real-textbooks-20260930', 'entry.cjs');
await mkdir(dirname(bundle), { recursive: true });
await build({ entryPoints: [join(root, 'src', 'seed', 'm2-real-textbook-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(bundle);
const database = api.createCloudBaseDocumentDatabase(app.database());

const organization = await database.get('organizations', ORG);
const seed = await database.get('migration_runs', 'seed_m2_local_addon_v1');
const teacher = await database.get('users', TEACHER);
const membersByClass = new Map();
for (const [classId, expected] of targetClasses) {
  const classEntity = await database.get('classes', classId);
  const sampleStudent = await database.get('users', expected.student);
  const grant = await database.find('teacher_class_grants',
    { organizationId: ORG, teacherId: TEACHER, classId, status: 'active', deletedAt: null });
  const members = await database.find('class_memberships',
    { organizationId: ORG, classId, status: 'active', deletedAt: null });
  const studentIds = members.map(member => member.studentId);
  if (classEntity?.status !== 'active' || String(classEntity.grade) !== classId.slice(9, 10)
    || sampleStudent?.status !== 'active' || grant.length !== 1 || !grant[0].permissions?.includes('content.read')
    || members.length !== expected.count || new Set(studentIds).size !== expected.count
    || !studentIds.includes(expected.student)) throw new Error(`CLASS_PREFLIGHT_FAILED_${classId}`);
  membersByClass.set(classId, studentIds.sort());
}
if (organization?.status !== 'active' || seed?.status !== 'succeeded'
  || teacher?.status !== 'active') throw new Error('DEMO_ORGANIZATION_PREFLIGHT_FAILED');
const priorBooks = await Promise.all(manifest.books.map(book => database.get('learning_resources', book.resourceId)));
const priorAudit = await database.get('operation_logs', AUDIT);
const existing = [...priorBooks, priorAudit].filter(Boolean).length;
if (existing !== 0 && existing !== 3) throw new Error('PARTIAL_PACK_REQUIRES_REVIEW');
if (existing === 3 && (priorBooks.some(book => book.acceptancePackId !== PACK)
  || priorAudit.metadata?.packId !== PACK)) throw new Error('PACK_OWNERSHIP_MISMATCH');
if (mode === 'inspect') {
  process.stdout.write(`PREFLIGHT=passed;books=2;files=60;bytes=${totalBytes};existing=${existing}/3;prefixEntries=${prefixContents.length}\n`);
  process.exit(0);
}

function fileId(receipt, key) {
  const value = receipt[key];
  if (typeof value !== 'string' || !value.startsWith('cloud://')) throw new Error(`FILE_ID_MISSING_${key}`);
  return value;
}
async function verifyFiles(receipt) {
  for (let offset = 0; offset < manifest.files.length; offset += 4) {
    await Promise.all(manifest.files.slice(offset, offset + 4).map(async file => {
      const readback = await nodeApp.downloadFile({ fileID: fileId(receipt, file.key) });
      const bytes = readback.fileContent;
      if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error('FILE_READBACK_INVALID');
      if (Buffer.from(bytes).length !== file.bytes
        || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
        throw new Error(`FILE_READBACK_HASH_MISMATCH_${file.key}`);
      }
    }));
  }
}
function actor(userId, role, scopeIds) {
  return { requestId: `m2_real_textbook_verify_${userId}`, sessionId: 'server-textbook-verify',
    actorUserId: userId, actorRole: role, organizationId: ORG,
    platformSubjectDigest: 'server-textbook-verify', permissions: ['content.read', 'task.publish'],
    scopeIds, authzVersion: 1 };
}
async function verifyPack() {
  const books = await Promise.all(manifest.books.map(book => database.get('learning_resources', book.resourceId)));
  const audit = await database.get('operation_logs', AUDIT);
  if (books.some(book => book?.acceptancePackId !== PACK || book.status !== 'published')
    || audit?.metadata?.packId !== PACK || audit.result !== 'succeeded') throw new Error('RESOURCE_READBACK_FAILED');
  const receipt = audit.metadata.assetFileIds;
  if (!receipt || Object.keys(receipt).length !== 60) throw new Error('AUDIT_RECEIPT_INCOMPLETE');
  await verifyFiles(receipt);
  const contentService = new api.ContentQueryService(api.createOrgContentDocumentRepository(database));
  const textbookService = new api.TeacherTextbookService(new api.DocumentTextbookRepository(database),
    { nowIso: () => new Date().toISOString() });
  const progressService = new api.LearningProgressService(
    api.createLearningProgressDocumentRepository(database),
    { nowIso: () => new Date().toISOString() }, { next: () => 'unused_textbook_verify' });
  const teacherActor = actor(TEACHER, 'teacher', [...targetClasses.keys()]);
  const teacherList = await textbookService.listTextbooks(teacherActor, {}, { limit: 20, offset: 0 });
  if (manifest.books.some(book => !teacherList.items.some(item => item.id === book.resourceId))) {
    throw new Error('TEACHER_TEXTBOOK_CATALOG_MISSING');
  }
  for (const book of manifest.books) {
    const studentActor = actor(targetClasses.get(book.classId).student, 'student', [book.classId]);
    const other = manifest.books.find(item => item.classId !== book.classId);
    const catalog = await contentService.listStudentCatalog(studentActor,
      { type: 'reading', category: 'synchronized' }, { limit: 20, offset: 0 });
    const detail = await contentService.getReadingResource(studentActor, book.resourceId);
    const teacherDetail = await textbookService.getTextbook(teacherActor, book.resourceId, book.classId);
    const progress = await progressService.getReadingProgress(studentActor, book.resourceId);
    const indexed = books.find(item => item._id === book.resourceId);
    if (!catalog.items.some(item => item.id === book.resourceId)
      || catalog.items.some(item => item.id === other.resourceId)
      || detail.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0) !== book.selectedPageCount
      || teacherDetail.chapters[0]?.title !== book.unitTitle
      || indexed.allowedStudentIds.length !== targetClasses.get(book.classId).count
      || indexed.pages.length !== book.selectedPageCount
      || (progress !== null && progress.resourceId !== book.resourceId)) {
      throw new Error(`READING_OR_CLASS_VIEW_FAILED_${book.slug}`);
    }
  }
  for (let offset = 0; offset < manifest.files.length; offset += 40) {
    const group = manifest.files.slice(offset, offset + 40);
    const signed = await nodeApp.getTempFileURL({ fileList: group.map(file => ({ fileID: fileId(receipt, file.key), maxAge: 3600 })) });
    if (signed.fileList?.length !== group.length || signed.fileList.some(file =>
      typeof file.tempFileURL !== 'string' || !file.tempFileURL.startsWith('https://'))) {
      throw new Error('PAGE_SIGNED_URL_FAILED');
    }
  }
  process.stdout.write('VERIFY=passed;storageHash=60/60;teacherCatalog=2;studentCatalog=2;crossClass=denied;progressAccess=ready;pageSigned=60\n');
}
if (mode === 'verify' || existing === 3) { await verifyPack(); process.exit(0); }
if (prefixContents.length !== 0) throw new Error('STORAGE_PREFIX_NOT_EMPTY');

const uploaded = [];
const receipt = {};
let created = false;
try {
  for (const [index, file] of manifest.files.entries()) {
    const result = await nodeApp.uploadFile({ cloudPath: file.cloudPath,
      fileContent: bytesByKey.get(file.key) });
    if (typeof result.fileID !== 'string' || !result.fileID.startsWith('cloud://')) throw new Error('UPLOAD_RESPONSE_INVALID');
    receipt[file.key] = result.fileID;
    uploaded.push(result.fileID);
    if ((index + 1) % 10 === 0) process.stdout.write(`UPLOAD_PROGRESS=${index + 1}/60\n`);
  }
  await verifyFiles(receipt);
  const now = new Date().toISOString();
  const resources = manifest.books.map(book => {
    const pages = Array.from({ length: book.selectedPageCount }, (_, index) => {
      const pageNumber = index + 1;
      const source = manifest.files.find(file => file.bookSlug === book.slug && file.kind === 'page' && file.pageNumber === pageNumber);
      const chapterId = pageNumber < book.firstUnitPage ? `chapter_${book.slug}_front` : `chapter_${book.slug}_unit1`;
      return { id: `page_${book.slug}_${String(pageNumber).padStart(4, '0')}`, pageNumber, order: pageNumber,
        thumbnailAssetKey: fileId(receipt, `${book.slug}_thumbnail_${pageNumber}`),
        imageAssetKey: fileId(receipt, `${book.slug}_page_${pageNumber}`),
        width: source.width, height: source.height, assetVersion: 'asset-library-v1', chapterId };
    });
    const front = pages.filter(page => page.pageNumber < book.firstUnitPage);
    const unit = pages.filter(page => page.pageNumber >= book.firstUnitPage);
    const readingPages = items => items.map(({ chapterId: ignored, ...page }) => page);
    const chapters = [
      { id: `chapter_${book.slug}_front`, title: '封面与目录', order: 1, pages: readingPages(front) },
      { id: `chapter_${book.slug}_unit1`, title: book.unitTitle, order: 2, pages: readingPages(unit) },
    ];
    const textbookChapters = [{ id: `textbook_chapter_${book.slug}_unit1`, title: book.unitTitle,
      lessons: ['Part A', 'Part B', 'Reading time'].map((title, index) =>
        ({ id: `textbook_lesson_${book.slug}_${index + 1}`, title })) }];
    const payload = { category: 'synchronized', grade: book.grade, term: '上册',
      textbook: '人教版 PEP', unit: 'Unit 1', difficulty: '基础', theme: '教材',
      searchText: `${book.sourceTitle} ${book.unitTitle} 测试节选`, chapters, textbookChapters,
      sourceAssetId: book.sourceId, sourcePdfSha256: book.sourcePdfSha256 };
    return { _id: book.resourceId, id: book.resourceId, organizationId: ORG, schemaVersion: 1,
      version: 1, deletedAt: null, acceptancePackId: PACK, createdAt: now, updatedAt: now,
      type: 'reading', title: book.title, contentVersion: 1, status: 'published', copyrightStatus: 'demo',
      visibility: { type: 'classes', classIds: [book.classId] }, allowedClassIds: [book.classId],
      allowedStudentIds: membersByClass.get(book.classId),
      pages: pages.map(page => ({ id: page.id, chapterId: page.chapterId, pageNumber: page.pageNumber })), wordIds: [],
      category: 'synchronized', grade: book.grade, term: '上册', textbook: '人教版 PEP',
      unit: 'Unit 1', difficulty: '基础', theme: '教材', payload };
  });
  const audit = { _id: AUDIT, id: AUDIT, organizationId: ORG, schemaVersion: 1, version: 1,
    deletedAt: null, requestId: PACK, actorUserId: null, actorRole: null,
    action: 'content.realTextbookSamplesPrepared', targetType: 'learning_resources',
    targetId: resources[0]._id, result: 'succeeded', errorCode: null, occurredAt: now,
    metadata: { packId: PACK, resourceIds: resources.map(item => item._id), fileCount: 60,
      totalBytes, assetFileIds: receipt } };
  await database.runTransaction(async transaction => {
    for (const resource of resources) {
      if (await transaction.get('learning_resources', resource._id)) throw new Error('RESOURCE_ID_COLLISION');
      if (!await transaction.create('learning_resources', resource)) throw new Error('RESOURCE_CREATE_FAILED');
    }
    if (await transaction.get('operation_logs', AUDIT)
      || !await transaction.create('operation_logs', audit)) throw new Error('AUDIT_CREATE_FAILED');
  });
  created = true;
  await writeFile(join(root, '.runtime', 'm2-real-textbooks-20260930', 'receipt.json'),
    JSON.stringify({ packId: PACK, fileCount: uploaded.length, totalBytes, createdAt: now }, null, 2));
  process.stdout.write('APPLY=created;resources=2;files=60;audit=1\n');
  await verifyPack();
} catch (error) {
  if (!created && uploaded.length > 0) {
    try {
      await nodeApp.deleteFile({ fileList: uploaded });
      process.stderr.write(`ROLLBACK=deleted_new_files;count=${uploaded.length}\n`);
    } catch { process.stderr.write(`ROLLBACK=manual_review_required;count=${uploaded.length}\n`); }
  }
  throw error;
}
process.exit(0);
