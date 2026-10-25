import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
const { parseBuffer } = await import('music-metadata');

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(root, '..', '..');
const assetRoot = 'F:/英语资产';
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('Use inspect, apply, or verify.');

const ORG = 'org_qihang_demo';
const RESOURCE = 'res_m3_sbc0008_review_draft_20261002';
const PAGE_ONLY_RESOURCE = 'res_m3_real_sbc0008_reading_20260930';
const AUDIT = 'audit_m3_sbc0008_reading_pronunciation_20261006';
const PAGE_ONLY_AUDIT = 'audit_m3_sbc0008_reading_no_audio_label_20261006';
const CLASSES = ['cls_grade3_2', 'cls_grade4_1'];
const APPROVED_RELATIVE = 'library/books/book-sbc-en-0008/v1/review/approved-content-v1.json';
const APPROVED_PATH = resolve(assetRoot, ...APPROVED_RELATIVE.split('/'));
const APPROVED_SHA256 = 'eee0698937721370f919cab9a22e9b3f58c7ca37459955f7875a99feef760c43';
const MANIFEST_PATH = resolve(projectRoot, 'workspace/m3-real-samples/2026-10-02-minimum-asset-package/manifest.json');
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envText = await readFile(resolve(root, '.env.local'), 'utf8');
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (!envId || config.envId !== envId) throw new Error('NONPRODUCTION_ENV_MISMATCH');
const approvedBytes = await readFile(APPROVED_PATH);
if (createHash('sha256').update(approvedBytes).digest('hex') !== APPROVED_SHA256) throw new Error('APPROVED_SOURCE_HASH_MISMATCH');
const approved = JSON.parse(approvedBytes.toString('utf8'));
const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
if (approved.decision !== 'approved' || approved.resourceId !== 'book-sbc-en-0008'
  || approved.copyrightStatus !== 'verified' || approved.sourceVersion !== 1
  || manifest.bookResourceId !== approved.resourceId
  || manifest.sourceSha256.toLowerCase() !== approved.sourceSha256.toLowerCase()) {
  throw new Error('APPROVED_READING_SOURCE_INVALID');
}
const manifestFiles = new Map(manifest.files.map(file => [file.key, file]));
const contentPages = approved.reading.pages.filter(page => page.role === 'content');
if (contentPages.length !== 8 || contentPages.some(page => typeof page.followReadText !== 'string'
  || page.sentenceMappings?.length !== 1 || page.sentenceMappings[0].text !== page.followReadText)) {
  throw new Error('APPROVED_FOLLOW_READ_TEXT_OR_MAPPING_INVALID');
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
const envRows = environments.data;
if (!Array.isArray(envRows) || envRows.length !== 1 || envRows[0].EnvId !== envId
  || envRows[0].Status !== 'NORMAL' || envRows[0].PackageName !== '个人版'
  || envRows[0].EnableOverrun !== false || envRows[0].EnvPaid !== 'no' || envRows[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_COST_PREFLIGHT_FAILED');
}
const acl = await execute(process.execPath, [cli, 'storage', 'get-acl'],
  { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (!acl.stdout.includes('Only creator and admin can read and write')) throw new Error('STORAGE_NOT_PRIVATE');
const quota = await cliJson(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.data?.Value) || quota.data.Value > 190_000) throw new Error('DB_QUOTA_MARGIN_INSUFFICIENT');

const secretResult = await execute(process.execPath, [cli, 'secrets', 'get', '--json'],
  { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const secretStart = secretResult.stdout.indexOf('{');
if (secretStart < 0) throw new Error('TEMPORARY_CREDENTIALS_UNAVAILABLE');
const credentials = JSON.parse(secretResult.stdout.slice(secretStart)).data;
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const cloudbase = require('@cloudbase/node-sdk');
const app = cloudbase.init({ env: envId, secretId: credentials.secretId,
  secretKey: credentials.secretKey, sessionToken: credentials.token });
const database = app.database();
const apiEntry = resolve(root, '.runtime/m3-reading-pronunciation-20261006/entry.cjs');
await mkdir(dirname(apiEntry), { recursive: true });
await build({ entryPoints: [resolve(root, 'src/seed/m3-real-sample-entry.ts')], outfile: apiEntry,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(apiEntry);
const databasePort = api.createCloudBaseDocumentDatabase(database);
const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(databasePort));
const now = new Date().toISOString();
const [bookResult, pageOnlyResult, auditResult, pageOnlyAuditResult, members3Result, members4Result] = await Promise.all([
  database.collection('learning_resources').doc(RESOURCE).get().catch(() => null),
  database.collection('learning_resources').doc(PAGE_ONLY_RESOURCE).get().catch(() => null),
  database.collection('operation_logs').doc(AUDIT).get().catch(() => null),
  database.collection('operation_logs').doc(PAGE_ONLY_AUDIT).get().catch(() => null),
  database.collection('class_memberships').where({ organizationId: ORG, classId: CLASSES[0], status: 'active', deletedAt: null }).get(),
  database.collection('class_memberships').where({ organizationId: ORG, classId: CLASSES[1], status: 'active', deletedAt: null }).get(),
]);
const book = dataOne(bookResult);
const pageOnly = dataOne(pageOnlyResult);
const audit = dataOne(auditResult);
const pageOnlyAudit = dataOne(pageOnlyAuditResult);
const expectUnchanged = mode !== 'verify';
const validAudioVersion = expectUnchanged
  ? book?.version === 5 && book.payload?.pronunciation === undefined && !audit
  : book?.version === 6 && book.payload?.pronunciation?.reviewStatus === 'approved'
    && book.payload.pronunciation.segments?.length === 8 && audit?.targetId === RESOURCE;
const validPageOnlyLabel = expectUnchanged
  ? !pageOnlyAudit
  : pageOnly?.version === 3 && pageOnly.title === 'What are you doing?｜页图阅读测试（无音频）'
    && pageOnlyAudit?.targetId === PAGE_ONLY_RESOURCE;
if (!book || book.organizationId !== ORG || book.type !== 'reading' || book.status !== 'published'
  || !validAudioVersion || book.contentVersion !== '1' && book.contentVersion !== 1
  || book.copyrightStatus !== 'verified' || book.payload?.readingAudio?.reviewStatus !== 'approved'
  || !pageOnly || pageOnly.organizationId !== ORG || pageOnly.type !== 'reading'
  || pageOnly.status !== 'published' || pageOnly.payload?.readingAudio !== undefined || !validPageOnlyLabel
  || dataList(members3Result).length !== 36 || dataList(members4Result).length !== 32) {
  throw new Error('READING_RESOURCE_PRECONDITION_MISMATCH');
}
const cloudAudio = book.payload.readingAudio.chapters;
if (cloudAudio.length !== 1 || cloudAudio[0].chapterId !== book.payload.chapters[0].id
  || cloudAudio[0].segments.length !== 8) throw new Error('APPROVED_AUDIO_MAP_INCOMPLETE');
const pronunciationSegments = [];
const clipEvidence = [];
for (const page of contentPages) {
  const pageNumber = page.pageNumber;
  const map = cloudAudio[0].segments.find(item => item.pageNumber === pageNumber);
  const pageEntity = book.payload.chapters[0].pages.find(item => item.pageNumber === pageNumber);
  const file = manifestFiles.get(`page_audio_${String(pageNumber).padStart(2, '0')}`);
  const pageAudio = page.audioSourceRelativePath;
  const sourceRelativePath = file?.sourceRelativePath ?? file?.assetRootRelativePath;
  if (!map || !pageEntity || !file || map.pageId !== pageEntity.id || map.text !== page.followReadText
    || map.startMs !== page.sentenceMappings[0].startMs || map.endMs !== page.sentenceMappings[0].endMs
    || map.clipAudioAssetKey !== pageEntity.audioFileId || !map.clipAudioAssetKey?.startsWith('cloud://')
    || sourceRelativePath !== pageAudio || map.clipDurationMs < map.endMs) {
    throw new Error(`APPROVED_PAGE_AUDIO_MAPPING_MISMATCH_${pageNumber}`);
  }
  const bytes = readFile(resolve(assetRoot, ...sourceRelativePath.split('/')));
  const localAudio = await bytes;
  const localHash = createHash('sha256').update(localAudio).digest('hex');
  if (localAudio.length !== file.bytes || localHash !== file.sha256.toLowerCase()) {
    throw new Error(`LOCAL_PAGE_AUDIO_HASH_MISMATCH_${pageNumber}`);
  }
  const metadata = await parseBuffer(localAudio, { mimeType: 'audio/mpeg', size: localAudio.length },
    { duration: true, skipCovers: true });
  const durationMs = Math.floor((metadata.format.duration ?? 0) * 1000);
  if (durationMs !== map.clipDurationMs) throw new Error(`PAGE_AUDIO_DURATION_MISMATCH_${pageNumber}`);
  const cloudFile = await app.downloadFile({ fileID: map.clipAudioAssetKey });
  const cloudBytes = Buffer.isBuffer(cloudFile.fileContent) ? cloudFile.fileContent : Buffer.from(cloudFile.fileContent ?? '');
  if (cloudBytes.length !== file.bytes || createHash('sha256').update(cloudBytes).digest('hex') !== localHash) {
    throw new Error(`CLOUD_PAGE_AUDIO_HASH_MISMATCH_${pageNumber}`);
  }
  clipEvidence.push({ pageNumber, text: page.followReadText, sha256: localHash, bytes: localAudio.length });
  pronunciationSegments.push({ id: `follow_sbc0008_p${String(pageNumber).padStart(2, '0')}`,
    text: page.followReadText, pageNumber, demonstrationAudioAssetKey: map.clipAudioAssetKey });
}
if (mode === 'inspect') {
  process.stdout.write(`PREFLIGHT=passed;bookVersion=${book.version};pages=${contentPages.length};pageAudioSourceMatches=${clipEvidence.length}/${contentPages.length};cloudHashes=${clipEvidence.length}/${contentPages.length};students=${dataList(members3Result).length}+${dataList(members4Result).length};pronunciation=empty;newAudits=empty;dbWrites=within-free-limit\n`);
  process.exit(0);
}

if (mode === 'apply') {
  const nextBook = { ...book, version: 6, updatedAt: now,
    title: 'What are you doing?｜音频·点读·跟读测试',
    payload: { ...book.payload, pronunciation: {
      reviewStatus: 'approved', sourceVersion: String(book.contentVersion),
      approvedAt: approved.reviewedAt, approvedBy: approved.reviewerId, segments: pronunciationSegments,
    }, sourceHistory: [...(Array.isArray(book.payload.sourceHistory) ? book.payload.sourceHistory : []), {
      version: book.version, contentVersion: book.contentVersion, title: book.title,
      pronunciation: null, archivedAt: now,
    }] } };
  const nextPageOnly = { ...pageOnly, version: pageOnly.version + 1, updatedAt: now,
    title: 'What are you doing?｜页图阅读测试（无音频）',
    sourceHistory: [...(Array.isArray(pageOnly.sourceHistory) ? pageOnly.sourceHistory : []), {
      version: pageOnly.version, contentVersion: pageOnly.contentVersion, title: pageOnly.title, archivedAt: now,
    }] };
  const log = (id, action, targetId, metadata) => ({ _id: id, id, requestId: id,
    organizationId: ORG, schemaVersion: 1, version: 1, deletedAt: null,
    actorUserId: null, actorRole: null, action, targetType: 'learning_resources', targetId,
    result: 'succeeded', errorCode: null, occurredAt: now, metadata });
  const pronunciationAudit = log(AUDIT, 'content.testReadingPronunciationEnabled', RESOURCE, {
    approvedSourceResourceId: approved.resourceId, approvedSourceSha256: approved.sourceSha256,
    approvedRecordSha256: APPROVED_SHA256, priorVersion: book.version, version: nextBook.version,
    segmentCount: pronunciationSegments.length, classIds: book.visibility.classIds,
    sourceAudioHashes: clipEvidence.map(item => item.sha256),
  });
  const pageOnlyAuditRecord = log(PAGE_ONLY_AUDIT, 'content.pageOnlyReadingLabeled', PAGE_ONLY_RESOURCE, {
    priorVersion: pageOnly.version, version: nextPageOnly.version,
    note: 'Clarifies that this separate 9-page acceptance book has no audio/point-read mapping.',
    classIds: pageOnly.visibility.classIds,
  });
  const { _id: _bookId, ...bookFields } = nextBook;
  const { _id: _pageOnlyId, ...pageOnlyFields } = nextPageOnly;
  const { _id: _pronunciationAuditId, ...pronunciationAuditFields } = pronunciationAudit;
  const { _id: _pageOnlyAuditId, ...pageOnlyAuditFields } = pageOnlyAuditRecord;
  await database.runTransaction(async transaction => {
    const currentBook = dataOne(await transaction.collection('learning_resources').doc(RESOURCE).get());
    const currentPageOnly = dataOne(await transaction.collection('learning_resources').doc(PAGE_ONLY_RESOURCE).get());
    const currentAudit = dataOne(await transaction.collection('operation_logs').doc(AUDIT).get().catch(() => null));
    const currentPageOnlyAudit = dataOne(await transaction.collection('operation_logs').doc(PAGE_ONLY_AUDIT).get().catch(() => null));
    if (!currentBook || currentBook.version !== book.version || currentBook.payload?.pronunciation !== undefined
      || !currentPageOnly || currentPageOnly.version !== pageOnly.version
      || currentAudit || currentPageOnlyAudit) {
      throw new Error('READING_PRONUNCIATION_VERSION_CONFLICT');
    }
    await transaction.collection('learning_resources').doc(RESOURCE).set(bookFields);
    await transaction.collection('learning_resources').doc(PAGE_ONLY_RESOURCE).set(pageOnlyFields);
    await transaction.collection('operation_logs').doc(AUDIT).set(pronunciationAuditFields);
    await transaction.collection('operation_logs').doc(PAGE_ONLY_AUDIT).set(pageOnlyAuditFields);
  });
  process.stdout.write(`APPLY=versioned;audioBookVersion=${nextBook.version};pageOnlyBookVersion=${nextPageOnly.version};pronunciationSegments=${pronunciationSegments.length};audits=2;newFiles=0\n`);
  process.exit(0);
}

const updated = dataOne(await database.collection('learning_resources').doc(RESOURCE).get());
const updatedPageOnly = dataOne(await database.collection('learning_resources').doc(PAGE_ONLY_RESOURCE).get());
const finalPronunciation = await servicePronunciation();
if (updated?.version !== 6 || updated?.payload?.pronunciation?.reviewStatus !== 'approved'
  || finalPronunciation.length !== 8 || updatedPageOnly?.title !== 'What are you doing?｜页图阅读测试（无音频）'
  || dataOne(await database.collection('operation_logs').doc(AUDIT).get())?.targetId !== RESOURCE
  || dataOne(await database.collection('operation_logs').doc(PAGE_ONLY_AUDIT).get())?.targetId !== PAGE_ONLY_RESOURCE) {
  throw new Error('READING_PRONUNCIATION_POSTWRITE_VERIFY_FAILED');
}
const classResults = [];
for (const [index, classId] of CLASSES.entries()) {
  const actor = { requestId: `m3_reading_pron_verify_${index}`, sessionId: 'm3-reading-pron-verify',
    actorUserId: index === 0 ? 'usr_student_g3_01' : 'usr_student_g4_01', actorRole: 'student',
    organizationId: ORG, platformSubjectDigest: 'm3-reading-pron-verify', permissions: ['content.read'],
    scopeIds: [classId], authzVersion: 1 };
  const page = await content.listStudentCatalog(actor, { type: 'reading', category: 'picture_book' }, { limit: 50, offset: 0 });
  const item = page.items.find(value => value.id === RESOURCE);
  if (!item?.audioPointreadReady || !item.pronunciationReady) throw new Error(`READING_CAPABILITY_NOT_VISIBLE_${classId}`);
  const chapterMap = await content.getReadingAudioMap(actor, RESOURCE, book.payload.chapters[0].id);
  if (chapterMap.audioAssetKey === null || chapterMap.segments.length !== 8) {
    throw new Error(`POINTREAD_MAP_NOT_VISIBLE_${classId}`);
  }
  classResults.push({ classId, audioPointreadReady: item.audioPointreadReady, pronunciationReady: item.pronunciationReady });
}
const teacherGrantResult = await database.collection('teacher_class_grants').where({
  organizationId: ORG, classId: CLASSES[0], status: 'active', deletedAt: null,
}).get();
const teacherGrant = dataList(teacherGrantResult).find(row =>
  Array.isArray(row.permissions) && row.permissions.includes('content.read')
    && row.permissions.includes('task.publish'));
if (!teacherGrant?.teacherId) throw new Error('AUTHORIZED_TEACHER_GRANT_UNAVAILABLE');
const teacherActor = { requestId: 'm3_reading_pron_teacher_verify', sessionId: 'm3-reading-pron-verify',
  actorUserId: teacherGrant.teacherId, actorRole: 'teacher', organizationId: ORG,
  platformSubjectDigest: 'm3-reading-pron-verify', permissions: ['content.read', 'task.publish'],
  scopeIds: [CLASSES[0]], authzVersion: 1 };
const teacherCatalog = await content.listTaskCatalogResources(teacherActor,
  { type: 'reading', targetClassIds: [CLASSES[0]], keyword: 'What are you doing' }, { limit: 20, offset: 0 });
const teacherBook = await content.getReadingResource(teacherActor, RESOURCE);
const teacherMap = await content.getReadingAudioMap(teacherActor, RESOURCE, book.payload.chapters[0].id);
const teacherPronunciation = await servicePronunciation(teacherActor);
if (!teacherCatalog.items.some(item => item.id === RESOURCE) || teacherBook.chapters[0]?.pages.length !== 10
  || teacherMap.segments.length !== 8 || teacherPronunciation.length !== 8) {
  throw new Error('AUTHORIZED_TEACHER_READING_PREVIEW_VERIFY_FAILED');
}
const signer = await app.getTempFileURL({ fileList: finalPronunciation.map(item => ({
  fileID: item.demonstrationAudioAssetKey, maxAge: 60,
})) });
if (signer.fileList?.length !== 8 || signer.fileList.some(item => !item.tempFileURL?.startsWith('https://')
  || (item.code !== undefined && item.code !== 'SUCCESS'))) throw new Error('FOLLOWREAD_SIGNING_FAILED');
const urlsByFileId = new Map(signer.fileList.map(item => [item.fileID, item.tempFileURL]));
for (const segment of finalPronunciation) {
  const file = clipEvidence.find(item => item.pageNumber === segment.pageNumber);
  const url = urlsByFileId.get(segment.demonstrationAudioAssetKey);
  if (!file || !url) throw new Error(`FOLLOWREAD_EVIDENCE_MISSING_${segment.pageNumber}`);
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`FOLLOWREAD_URL_FETCH_FAILED_${segment.pageNumber}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error(`FOLLOWREAD_URL_HASH_MISMATCH_${segment.pageNumber}`);
  }
}
process.stdout.write(JSON.stringify({ verify: 'passed', readingBookVersion: updated.version,
  pointReadSegments: cloudAudio[0].segments.length, followReadSegments: finalPronunciation.length,
  signedDemonstrationUrls: signer.fileList.length, signedAudioHashReadback: finalPronunciation.length,
  studentCapabilities: classResults, teacherCatalog: 'visible', teacherPreviewPages: teacherBook.chapters[0].pages.length,
  labeledPageOnlyBook: updatedPageOnly.title }) + '\n');

async function servicePronunciation(actor = { requestId: 'm3_reading_pronunciation_verify',
  sessionId: 'm3-reading-pron-verify', actorUserId: 'usr_student_g3_01', actorRole: 'student',
  organizationId: ORG, platformSubjectDigest: 'm3-reading-pron-verify', permissions: ['content.read'],
  scopeIds: [CLASSES[0]], authzVersion: 1 }) {
  const view = await content.getReadingPronunciationSegments(actor, RESOURCE);
  return view.segments;
}
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
