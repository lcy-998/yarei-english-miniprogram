import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(backend, 'package.json'));
const root = 'G:/英语资产';
const envId = 'cloud1-d8ggzrwwedb786e41';
const secondary = 'org_isolation_secondary';
const base = join(root, 'library/derived/pep-first-lesson-pointread-2026-10-16/v2');
const manifestPath = join(base, 'pilot-manifest.json');
const reviewPath = join(base, 'review/approved-first-lessons-v1.json');
const stagingPath = join(root, 'reports/pep-first-lessons-pointread-private-staging-2026-10-16.json');
const receiptPath = join(root, 'reports/pep-first-lessons-pointread-nonproduction-publication-2026-10-16.json');
const backupPath = receiptPath.replace(/\.json$/u, '-before.json');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const sha = value => createHash('sha256').update(value).digest('hex');
const projectionId = id => `global_asset_${sha(JSON.stringify([id, secondary])).slice(0, 40)}`;
const dataOne = value => Array.isArray(value?.data) ? value.data[0] ?? null
  : value?.data && typeof value.data === 'object' ? value.data : null;
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: backend,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error(`CLI_API_ERROR_${args[0]}`);
  return parsed.data;
}
const config = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
if (config.envId !== envId) throw new Error('ENVIRONMENT_CHANGED');
const envs = cliData(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].EnableOverrun !== false
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') throw new Error('COST_GATE');
const quota = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('WRITE_QUOTA_GATE');
const temp = cliData(['secrets', 'get', '--json']);
if (temp?.isTemporary !== true || temp.envId !== envId
  || Date.parse(temp.expiredAt) < Date.now() + 60000) throw new Error('CREDENTIAL_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: temp.secretId,
  secretKey: temp.secretKey, sessionToken: temp.token });
const db = app.database();
const manifestBytes = await readFile(manifestPath);
const reviewBytes = await readFile(reviewPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const review = JSON.parse(reviewBytes.toString('utf8'));
const staging = JSON.parse(await readFile(stagingPath, 'utf8'));
if (manifest.books?.length !== 4 || review.decision
    !== 'approved_for_listed_sentence_pointread_and_follow_reading_nonproduction_only'
  || review.evidence.pilotManifestSha256 !== sha(manifestBytes)
  || staging.status !== 'private_staging_not_published'
  || staging.manifestSha256 !== sha(manifestBytes)
  || staging.reviewSha256 !== sha(reviewBytes) || staging.files?.length !== 26) {
  throw new Error('CONTENT_EVIDENCE_GATE');
}
const staged = new Map(staging.files.map(file => [file.id, file]));
const records = [];
for (const book of manifest.books) {
  const source = dataOne(await db.collection('learning_resources').doc(book.bookId).get());
  const projection = dataOne(await db.collection('learning_resources').doc(projectionId(book.bookId)).get());
  if (!source || !projection || source.organizationId !== 'org_qihang_demo'
    || projection.organizationId !== secondary || source.status !== 'published'
    || projection.status !== 'published' || source.globalCatalogSource !== true
    || projection.globalCatalogProjection !== true || projection.globalSourceId !== book.bookId
    || projection.globalSourceVersion !== source.version
    || source.payload?.audioMode !== (mode === 'verify' ? 'partial_pointread' : 'chapter_audio')
    || projection.payload?.audioMode !== (mode === 'verify' ? 'partial_pointread' : 'chapter_audio')
    || source.payload.chapters.find(chapter => chapter.id === book.chapterId)?.pages
      .some(page => page.id === book.segments[0].pageId) !== true) {
    throw new Error(`PUBLISHED_BOOK_GATE_${book.bookId}`);
  }
  const segments = book.segments.map(item => {
    const file = staged.get(item.id);
    if (!file || file.bookId !== book.bookId || file.sha256 !== item.clipSha256
      || file.durationMs !== item.clipDurationMs || !file.fileID.startsWith('cloud://')) {
      throw new Error(`CLIP_MAPPING_${item.id}`);
    }
    return { id: item.id, pageId: item.pageId, pageNumber: item.pageNumber,
      text: item.text, rect: item.rect, startMs: 0, endMs: file.durationMs,
      clipAudioAssetKey: file.fileID, clipDurationMs: file.durationMs };
  });
  records.push({ book, source, projection, segments });
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ environment: envId, mode, books: records.length,
    sentences: records.reduce((n, item) => n + item.segments.length, 0),
    writesPlanned: records.length * 3, writeQuota: quota.Value,
    overrunBilling: false }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  await writeFile(backupPath, JSON.stringify({ at: new Date().toISOString(),
    reviewSha256: sha(reviewBytes), books: records.map(({ book, source, projection }) => ({
      bookId: book.bookId, source, projection })) }) + '\n', { flag: 'wx' });
  const now = new Date().toISOString();
  for (const { book, source, projection, segments } of records) {
    function next(row) {
      if (row.contentVersion !== '1.3') throw new Error(`CONTENT_VERSION_${book.bookId}`);
      const readingAudio = structuredClone(row.readingAudio);
      readingAudio.sourceVersion = '1.4';
      readingAudio.approvedAt = review.reviewedAt;
      readingAudio.approvedBy = 'Codex';
      readingAudio.reviewId = review.reviewId;
      readingAudio.reviewSha256 = sha(reviewBytes);
      const target = readingAudio.chapters.find(chapter => chapter.chapterId === book.chapterId);
      if (!target || target.segments.length !== 0) throw new Error(`CHAPTER_AUDIO_${book.bookId}`);
      target.segments = segments;
      const pronunciation = { reviewStatus: 'approved', sourceVersion: '1.4',
        approvedAt: review.reviewedAt, approvedBy: 'Codex', reviewId: review.reviewId,
        reviewSha256: sha(reviewBytes), segments: segments.map(item => ({ id: item.id,
          pageNumber: item.pageNumber, text: item.text,
          demonstrationAudioAssetKey: item.clipAudioAssetKey })) };
      const note = '已开放部分课文点读与跟读；其余章节可连听，未标注页面暂未开放';
      return { ...row, version: row.version + 1, contentVersion: '1.4', updatedAt: now,
        publicationMode: 'partial_pointread', audioMode: 'partial_pointread',
        audioAvailabilityNote: note, readingAudio, pronunciation,
        pointreadReviewSha256: sha(reviewBytes),
        payload: { ...row.payload, audioMode: 'partial_pointread',
          audioAvailabilityNote: note, audioAvailability: 'partial_pointread',
          readingAudio, pronunciation } };
    }
    const nextSource = next(source);
    nextSource.globalCatalogFingerprint = sha(JSON.stringify({ id: nextSource._id,
      version: nextSource.version, type: nextSource.type, title: nextSource.title,
      contentVersion: nextSource.contentVersion, payload: nextSource.payload,
      visibility: nextSource.visibility, status: nextSource.status }));
    const nextProjection = next(projection);
    nextProjection.globalSourceVersion = nextSource.version;
    nextProjection.globalSourceFingerprint = nextSource.globalCatalogFingerprint;
    const auditId = `audit_pep_first_lesson_pointread_${book.bookId}_20261016`;
    const audit = { _id: auditId, organizationId: source.organizationId, schemaVersion: 1,
      version: 1, deletedAt: null, requestId: auditId, actorUserId: 'controlled_import',
      actorRole: 'system', action: 'asset_library.publish_partial_pointread',
      targetType: 'learning_resources', targetId: book.bookId, result: 'succeeded',
      errorCode: null, occurredAt: now, metadata: { reviewSha256: sha(reviewBytes),
        pageNumber: book.pageNumber, sentenceCount: segments.length,
        sourcePriorVersion: source.version, sourceVersion: nextSource.version,
        projectionPriorVersion: projection.version, projectionVersion: nextProjection.version } };
    const tx = await db.startTransaction();
    try {
      const current = dataOne(await tx.collection('learning_resources').doc(book.bookId).get());
      const currentProjection = dataOne(await tx.collection('learning_resources').doc(projection._id).get());
      if (current?.version !== source.version || currentProjection?.version !== projection.version
        || dataOne(await tx.collection('operation_logs').doc(auditId).get())) throw new Error('VERSION_CONFLICT');
      const { _id: _s, ...s } = nextSource;
      const { _id: _p, ...p } = nextProjection;
      const { _id: _a, ...a } = audit;
      await tx.collection('learning_resources').doc(book.bookId).set(s);
      await tx.collection('learning_resources').doc(projection._id).set(p);
      await tx.collection('operation_logs').doc(auditId).set(a);
      await tx.commit();
    } catch (error) { await tx.rollback().catch(() => {}); throw error; }
  }
  await writeFile(receiptPath, JSON.stringify({ environment: envId, nonproduction: true,
    publishedAt: now, bookIds: records.map(item => item.book.bookId),
    sentenceCount: 26, reviewSha256: sha(reviewBytes),
    manifestSha256: sha(manifestBytes) }, null, 2) + '\n', { flag: 'wx' });
}
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
if (receipt.environment !== envId || receipt.bookIds?.length !== 4
  || receipt.reviewSha256 !== sha(reviewBytes) || receipt.sentenceCount !== 26) {
  throw new Error('RECEIPT_GATE');
}
const bundlePath = join(backend, '.runtime/pep-pointread-20261016/entry.cjs');
await mkdir(dirname(bundlePath), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-global-asset-audit-entry.ts')],
  outfile: bundlePath, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(bundlePath);
const documents = api.createCloudBaseDocumentDatabase(db);
const textbooks = new api.TeacherTextbookService(new api.DocumentTextbookRepository(documents),
  { nowIso: () => new Date().toISOString() });
const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(documents));
const readback = [];
for (const orgId of ['org_qihang_demo', secondary]) {
  const grants = (await db.collection('teacher_class_grants').where({ organizationId: orgId,
    status: 'active', deletedAt: null }).get()).data;
  const member = (await db.collection('class_memberships').where({ organizationId: orgId,
    status: 'active', deletedAt: null }).get()).data?.[0];
  if (!grants?.length || !member?.studentId || !member?.classId) throw new Error('DEMO_ACTOR_GATE');
  const teacher = { requestId: `pep_pointread_teacher_${orgId}`, sessionId: 'pep-pointread-readback',
    actorUserId: grants[0].teacherId, actorRole: 'teacher', organizationId: orgId,
    platformSubjectDigest: 'pep-pointread-readback', permissions: ['content.read', 'task.publish'],
    scopeIds: [...new Set(grants.map(row => row.classId))], authzVersion: 1 };
  const student = { requestId: `pep_pointread_student_${orgId}`, sessionId: 'pep-pointread-readback',
    actorUserId: member.studentId, actorRole: 'student', organizationId: orgId,
    platformSubjectDigest: 'pep-pointread-readback', permissions: ['content.read'],
    scopeIds: [member.classId], authzVersion: 1 };
  const teacherList = await textbooks.listTextbooks(teacher, {}, { limit: 50, offset: 0 });
  let sentenceCount = 0;
  for (const { book, source, projection, segments } of records) {
    const id = orgId === secondary ? projectionId(book.bookId) : book.bookId;
    const teacherBook = teacherList.items.find(item => item.id === id);
    const detail = await content.getReadingResource(student, id);
    const audio = await content.getReadingAudioMap(student, id, book.chapterId);
    const pronunciation = await content.getReadingPronunciationSegments(student, id);
    if (!teacherBook || teacherBook.audioMode !== 'partial_pointread'
      || !teacherBook.audioAvailabilityNote?.includes('部分课文点读与跟读')
      || detail.chapters.reduce((n, chapter) => n + chapter.pages.length, 0)
        !== (orgId === secondary ? projection.pages.length : source.pages.length)
      || audio.segments.length !== segments.length || pronunciation.segments.length !== segments.length
      || audio.segments.some(item => !item.clipAudioAssetKey?.startsWith('cloud://'))
      || pronunciation.segments.some(item => !item.demonstrationAudioAssetKey.startsWith('cloud://'))) {
      throw new Error(`SERVICE_READBACK_${id}`);
    }
    sentenceCount += segments.length;
  }
  readback.push({ organizationId: orgId, books: records.length,
    pointreadSentences: sentenceCount, followReadingSentences: sentenceCount });
}
process.stdout.write(JSON.stringify({ environment: envId, mode, books: records.length,
  sentences: 26, readback, fullBooksPointreadReady: false }) + '\n');
