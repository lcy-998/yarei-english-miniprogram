import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(backend, 'package.json'));
const mode = process.argv[2];
if (!['inspect', 'apply', 'repair', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const envExpected = 'cloud1-d8ggzrwwedb786e41';
const assetRoot = 'G:/英语资产';
const mapPath = join(assetRoot, 'library/derived/pep-synchronized-chapters-2026-10-15/v1/chapter-map.json');
const receiptPath = join(assetRoot, 'reports/pep-synchronized-chapters-nonproduction-2026-10-15.json');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const digest = value => createHash('sha256').update(value).digest('hex');
const dataOne = value => Array.isArray(value?.data) ? value.data[0] ?? null
  : value?.data && typeof value.data === 'object' ? value.data : null;
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: backend, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLI_JSON_MISSING');
  const parsed = JSON.parse(raw.slice(start));
  if (parsed.error) throw new Error('CLI_API_ERROR');
  return parsed.data;
}
const configured = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
if (configured.envId !== envExpected) throw new Error('ENVIRONMENT_CHANGED');
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envExpected || environments[0].Status !== 'NORMAL'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_GATE');
const quota = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envExpected, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('WRITE_QUOTA_GATE');
const token = cliData(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envExpected
  || Date.parse(token.expiredAt) < Date.now() + 60000) throw new Error('TEMPORARY_CREDENTIAL_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envExpected,
  secretId: token.secretId, secretKey: token.secretKey, sessionToken: token.token });
const db = app.database();
const mapBytes = await readFile(mapPath);
const map = JSON.parse(mapBytes.toString('utf8'));
if (map.books?.length !== 5) throw new Error('MAP_COUNT_MISMATCH');
const secondaryOrg = 'org_isolation_secondary';
const projectionId = id => `global_asset_${digest(JSON.stringify([id, secondaryOrg])).slice(0, 40)}`;
const records = [];
for (const book of map.books) {
  const manifestPath = join(assetRoot, 'library/books', book.bookId, 'v1/manifest.json');
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (digest(manifestBytes) !== book.manifestSha256 || manifest.sourceSha256.toLowerCase() !== book.sourcePdfSha256
    || manifest.details.pageCount !== book.pageCount) throw new Error(`SOURCE_CHANGED_${book.bookId}`);
  const source = dataOne(await db.collection('learning_resources').doc(book.bookId).get());
  const projection = dataOne(await db.collection('learning_resources').doc(projectionId(book.bookId)).get());
  if (!source || !projection || source.organizationId !== 'org_qihang_demo'
    || projection.organizationId !== secondaryOrg || source.status !== 'published'
    || projection.status !== 'published' || source.globalCatalogSource !== true
    || projection.globalCatalogProjection !== true || projection.globalSourceId !== source._id
    || source.payload?.audioMode !== 'page_only' || projection.payload?.audioMode !== 'page_only') {
    throw new Error(`PUBLISHED_SOURCE_GATE_${book.bookId}`);
  }
  const expected = Array.from({ length: book.pageCount }, (_, i) => i + 1);
  if (source.pages?.length !== book.pageCount || projection.pages?.length !== book.pageCount
    || (['inspect', 'apply'].includes(mode) && (source.payload?.chapters?.length !== 1
      || projection.payload?.chapters?.length !== 1))
    || source.pages.some((p, i) => p.pageNumber !== expected[i])
    || projection.pages.some((p, i) => p.pageNumber !== expected[i])
    || projection.globalSourceVersion !== source.version) throw new Error(`CURRENT_PAGE_GATE_${book.bookId}`);
  const keyOf = value => `${value.imageAssetKey}|${value.thumbnailAssetKey}`;
  if (source.pages.some((p, i) => keyOf(p) !== keyOf(projection.pages[i]))) {
    throw new Error(`SOURCE_PROJECTION_MEDIA_MISMATCH_${book.bookId}`);
  }
  records.push({ book, source, projection });
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ environment: envExpected, mode,
    books: records.map(({ book, source, projection }) => ({ id: book.bookId,
      sourceVersion: source.version, projectionVersion: projection.version,
      chapters: book.chapters.length, pages: book.pageCount })),
    writesPlanned: records.length * 3, overrunBilling: false }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  const now = new Date().toISOString();
  const backups = records.map(({ book, source, projection }) => ({ bookId: book.bookId, source, projection }));
  const backupPath = receiptPath.replace(/\.json$/u, '-before.json');
  await writeFile(backupPath, JSON.stringify({ at: now, mapSha256: digest(mapBytes), books: backups }) + '\n', { flag: 'wx' });
  const written = [];
  for (const { book, source, projection } of records) {
    const convert = row => {
      const fullPages = row.payload.chapters.flatMap(chapter => chapter.pages);
      if (fullPages.length !== book.pageCount) throw new Error(`FULL_PAGE_GATE_${book.bookId}`);
      const pageByNumber = new Map(fullPages.map(page => [page.pageNumber, page]));
      const chapters = book.chapters.map(chapter => ({ id: chapter.id, title: chapter.title,
        order: chapter.order, pages: Array.from({ length: chapter.endPage - chapter.startPage + 1 },
          (_, i) => ({ ...pageByNumber.get(chapter.startPage + i), order: i + 1 })) }));
      const chapterByPage = new Map(chapters.flatMap(chapter => chapter.pages.map(page => [page.pageNumber, chapter.id])));
      const pages = row.pages.map(page => ({ ...page, chapterId: chapterByPage.get(page.pageNumber) }));
      if (!/^\d+\.\d+$/u.test(String(row.contentVersion))) {
        throw new Error(`CONTENT_VERSION_FORMAT_${book.bookId}`);
      }
      const [major, minor] = String(row.contentVersion).split('.').map(Number);
      const next = { ...row, version: row.version + 1, updatedAt: now,
        contentVersion: `${major}.${minor + 1}`, pages, chapters,
        payload: { ...row.payload, chapters, textbookChapters: chapters.map(({ id, title, order }) => ({
          id, title, order, lessons: [] })) } };
      return next;
    };
    const nextSource = convert(source);
    nextSource.globalCatalogFingerprint = digest(JSON.stringify({ id: nextSource._id,
      version: nextSource.version, type: nextSource.type, title: nextSource.title,
      contentVersion: nextSource.contentVersion, payload: nextSource.payload,
      visibility: nextSource.visibility, status: nextSource.status }));
    const nextProjection = convert(projection);
    nextProjection.globalSourceVersion = nextSource.version;
    nextProjection.globalSourceFingerprint = nextSource.globalCatalogFingerprint;
    const auditId = `audit_pep_chapters_${book.bookId}_20261015`;
    const audit = { _id: auditId, organizationId: source.organizationId, schemaVersion: 1,
      version: 1, deletedAt: null, requestId: auditId, actorUserId: 'controlled_import',
      actorRole: 'system', action: 'asset_library.split_synchronized_book_chapters',
      targetType: 'learning_resources', targetId: source._id, result: 'succeeded',
      errorCode: null, occurredAt: now, metadata: { mapSha256: digest(mapBytes),
        sourcePriorVersion: source.version, sourceVersion: nextSource.version,
        projectionPriorVersion: projection.version, projectionVersion: nextProjection.version,
        chapterCount: book.chapters.length, pageCount: book.pageCount } };
    const tx = await db.startTransaction();
    try {
      const sourceCurrent = dataOne(await tx.collection('learning_resources').doc(source._id).get());
      const projectionCurrent = dataOne(await tx.collection('learning_resources').doc(projection._id).get());
      const priorAudit = dataOne(await tx.collection('operation_logs').doc(auditId).get());
      if (sourceCurrent?.version !== source.version || projectionCurrent?.version !== projection.version || priorAudit) {
        throw new Error(`VERSION_OR_AUDIT_CONFLICT_${book.bookId}`);
      }
      const { _id: _sourceId, ...sourceData } = nextSource;
      const { _id: _projectionId, ...projectionData } = nextProjection;
      const { _id: _auditId, ...auditData } = audit;
      await tx.collection('learning_resources').doc(source._id).set(sourceData);
      await tx.collection('learning_resources').doc(projection._id).set(projectionData);
      await tx.collection('operation_logs').doc(auditId).set(auditData);
      await tx.commit();
    } catch (error) { await tx.rollback().catch(() => {}); throw error; }
    written.push(book.bookId);
  }
  await writeFile(receiptPath, JSON.stringify({ environment: envExpected, mapSha256: digest(mapBytes),
    updatedAt: now, books: written, chapterCount: map.books.reduce((n, b) => n + b.chapters.length, 0),
    pageCount: map.books.reduce((n, b) => n + b.pageCount, 0) }, null, 2) + '\n', { flag: 'wx' });
}
if (mode === 'repair') {
  const backupPath = receiptPath.replace(/\.json$/u, '-before.json');
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  if (backup.mapSha256 !== digest(mapBytes) || backup.books.length !== map.books.length) {
    throw new Error('BACKUP_SOURCE_GATE');
  }
  const now = new Date().toISOString();
  for (const { book, source, projection } of records) {
    const prior = backup.books.find(row => row.bookId === book.bookId);
    if (!prior || source.version !== prior.source.version + 1
      || projection.version !== prior.projection.version + 1) throw new Error(`REPAIR_VERSION_GATE_${book.bookId}`);
    function fullChapters(previous) {
      const fullPages = previous.payload.chapters.flatMap(chapter => chapter.pages);
      if (fullPages.length !== book.pageCount) throw new Error('BACKUP_PAGE_COUNT');
      const byNumber = new Map(fullPages.map(page => [page.pageNumber, page]));
      return book.chapters.map(chapter => ({ id: chapter.id, title: chapter.title, order: chapter.order,
        pages: Array.from({ length: chapter.endPage - chapter.startPage + 1 }, (_, i) => ({
          ...byNumber.get(chapter.startPage + i), order: i + 1 })) }));
    }
    const sourceChapters = fullChapters(prior.source);
    const projectionChapters = fullChapters(prior.projection);
    const nextSource = { ...source, version: source.version + 1, updatedAt: now,
      chapters: sourceChapters, payload: { ...source.payload, chapters: sourceChapters } };
    nextSource.globalCatalogFingerprint = digest(JSON.stringify({ id: nextSource._id,
      version: nextSource.version, type: nextSource.type, title: nextSource.title,
      contentVersion: nextSource.contentVersion, payload: nextSource.payload,
      visibility: nextSource.visibility, status: nextSource.status }));
    const nextProjection = { ...projection, version: projection.version + 1, updatedAt: now,
      chapters: projectionChapters, payload: { ...projection.payload, chapters: projectionChapters },
      globalSourceVersion: nextSource.version,
      globalSourceFingerprint: nextSource.globalCatalogFingerprint };
    const auditId = `audit_pep_chapters_full_pages_${book.bookId}_20261015`;
    const audit = { _id: auditId, organizationId: source.organizationId, schemaVersion: 1,
      version: 1, deletedAt: null, requestId: auditId, actorUserId: 'controlled_import',
      actorRole: 'system', action: 'asset_library.repair_chapter_page_mapping',
      targetType: 'learning_resources', targetId: source._id, result: 'succeeded',
      errorCode: null, occurredAt: now, metadata: { mapSha256: digest(mapBytes),
        priorVersion: source.version, version: nextSource.version,
        chapterCount: book.chapters.length, pageCount: book.pageCount } };
    const tx = await db.startTransaction();
    try {
      const current = dataOne(await tx.collection('learning_resources').doc(source._id).get());
      const currentProjection = dataOne(await tx.collection('learning_resources').doc(projection._id).get());
      if (current?.version !== source.version || currentProjection?.version !== projection.version
        || dataOne(await tx.collection('operation_logs').doc(auditId).get())) throw new Error('REPAIR_CONFLICT');
      const { _id: _s, ...s } = nextSource;
      const { _id: _p, ...p } = nextProjection;
      const { _id: _a, ...a } = audit;
      await tx.collection('learning_resources').doc(source._id).set(s);
      await tx.collection('learning_resources').doc(projection._id).set(p);
      await tx.collection('operation_logs').doc(auditId).set(a);
      await tx.commit();
    } catch (error) { await tx.rollback().catch(() => {}); throw error; }
  }
}
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
if (receipt.mapSha256 !== digest(mapBytes)) throw new Error('RECEIPT_MAP_MISMATCH');
for (const book of map.books) {
  const source = dataOne(await db.collection('learning_resources').doc(book.bookId).get());
  const projection = dataOne(await db.collection('learning_resources').doc(projectionId(book.bookId)).get());
  if (source?.payload?.chapters?.length !== book.chapters.length
    || projection?.payload?.chapters?.length !== book.chapters.length
    || source.pages.length !== book.pageCount || projection.pages.length !== book.pageCount
    || projection.globalSourceVersion !== source.version
    || projection.globalSourceFingerprint !== source.globalCatalogFingerprint
    || source.payload.audioMode !== 'page_only' || projection.payload.audioMode !== 'page_only') {
    throw new Error(`READBACK_FAILED_${book.bookId}`);
  }
}
const api = require(join(backend, '.runtime/pep-page-only-20261014/entry.cjs'));
const documents = api.createCloudBaseDocumentDatabase(db);
const textbookService = new api.TeacherTextbookService(new api.DocumentTextbookRepository(documents),
  { nowIso: () => new Date().toISOString() });
const contentService = new api.ContentQueryService(api.createOrgContentDocumentRepository(documents));
const serviceReadback = [];
for (const orgId of ['org_qihang_demo', secondaryOrg]) {
  const grants = (await db.collection('teacher_class_grants').where({ organizationId: orgId,
    status: 'active', deletedAt: null }).get()).data;
  const membership = (await db.collection('class_memberships').where({ organizationId: orgId,
    status: 'active', deletedAt: null }).get()).data?.[0];
  if (!grants?.length || !membership?.studentId || !membership?.classId) {
    throw new Error(`SERVICE_ACTOR_MISSING_${orgId}`);
  }
  const teacher = { requestId: `pep_chapters_teacher_${orgId}`, sessionId: 'pep-chapters-readback',
    actorUserId: grants[0].teacherId, actorRole: 'teacher', organizationId: orgId,
    platformSubjectDigest: 'pep-chapters-readback', permissions: ['content.read', 'task.publish'],
    scopeIds: [...new Set(grants.map(row => row.classId))], authzVersion: 1 };
  const student = { requestId: `pep_chapters_student_${orgId}`, sessionId: 'pep-chapters-readback',
    actorUserId: membership.studentId, actorRole: 'student', organizationId: orgId,
    platformSubjectDigest: 'pep-chapters-readback', permissions: ['content.read'],
    scopeIds: [membership.classId], authzVersion: 1 };
  const teacherList = await textbookService.listTextbooks(teacher, {}, { limit: 50, offset: 0 });
  let chapterCount = 0;
  for (const book of map.books) {
    const resourceId = orgId === 'org_qihang_demo' ? book.bookId : projectionId(book.bookId);
    const teacherBook = teacherList.items.find(item => item.id === resourceId);
    let detail;
    try { detail = await contentService.getReadingResource(student, resourceId); }
    catch (error) { throw new Error(`STUDENT_DETAIL_${resourceId}_${error.code ?? error.message}`); }
    if (!teacherBook || teacherBook.chapters.length !== book.chapters.length
      || detail.chapters.length !== book.chapters.length
      || detail.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0) !== book.pageCount) {
      throw new Error(`SERVICE_CHAPTER_READBACK_FAILED_${resourceId}`);
    }
    chapterCount += detail.chapters.length;
  }
  serviceReadback.push({ organizationId: orgId, books: map.books.length, chapters: chapterCount });
}
process.stdout.write(JSON.stringify({ environment: envExpected, mode, books: map.books.length,
  chapters: receipt.chapterCount, pages: receipt.pageCount, cloudReadback: true,
  serviceReadback, audioStillPageOnly: true }) + '\n');
