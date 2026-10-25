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
const bookId = 'book-unknown-3a';
const secondary = 'org_isolation_secondary';
const chapterId = 'book-unknown-3a-chapter-02';
const base = join(root, 'library/derived/pep3a-u1-pointread-pilot-2026-10-16/v2');
const manifestPath = join(base, 'pilot-manifest.json');
const reviewPath = join(base, 'review/approved-pointread-v1.json');
const stagingPath = join(root, 'reports/pep3a-u1-pointread-private-staging-2026-10-16.json');
const receiptPath = join(root, 'reports/pep3a-u1-pointread-nonproduction-publication-2026-10-16.json');
const backupPath = receiptPath.replace(/\.json$/u, '-before.json');
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const sha = value => createHash('sha256').update(value).digest('hex');
const projectionId = `global_asset_${sha(JSON.stringify([bookId, secondary])).slice(0, 40)}`;
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
if (manifest.bookId !== bookId || manifest.chapterId !== chapterId || manifest.segments?.length !== 6
  || review.decision !== 'approved_for_page4_sentence_pointread_and_follow_reading_nonproduction'
  || review.evidence.pilotManifestSha256 !== sha(manifestBytes)
  || staging.status !== 'private_staging_not_published'
  || staging.manifestSha256 !== sha(manifestBytes) || staging.reviewSha256 !== sha(reviewBytes)
  || staging.files?.length !== 6) throw new Error('CONTENT_EVIDENCE_GATE');
const clips = new Map(staging.files.map(file => [file.id, file]));
const segments = manifest.segments.map(item => {
  const clip = clips.get(item.id);
  if (!clip || clip.sha256 !== item.clipSha256 || clip.durationMs !== item.clipDurationMs
    || !clip.fileID.startsWith('cloud://')) throw new Error(`CLIP_MAPPING_GATE_${item.id}`);
  return { id: item.id, pageId: item.pageId, pageNumber: item.pageNumber,
    text: item.text, rect: item.rect, startMs: 0, endMs: clip.durationMs,
    clipAudioAssetKey: clip.fileID, clipDurationMs: clip.durationMs };
});
const source = dataOne(await db.collection('learning_resources').doc(bookId).get());
const projection = dataOne(await db.collection('learning_resources').doc(projectionId).get());
if (!source || !projection || source.organizationId !== 'org_qihang_demo'
  || projection.organizationId !== secondary || source.status !== 'published'
  || projection.status !== 'published' || source.globalCatalogSource !== true
  || projection.globalCatalogProjection !== true || projection.globalSourceId !== bookId
  || projection.globalSourceVersion !== source.version
  || source.payload?.audioMode !== (mode === 'verify' ? 'partial_pointread' : 'chapter_audio')
  || projection.payload?.audioMode !== (mode === 'verify' ? 'partial_pointread' : 'chapter_audio')
  || source.payload.chapters.find(chapter => chapter.id === chapterId)?.pages
    .some(page => page.id === 'book-unknown-3a-page-0004') !== true) {
  throw new Error('PUBLISHED_BOOK_GATE');
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ environment: envId, mode, bookId,
    sourceVersion: source.version, projectionVersion: projection.version,
    existingAudioChapters: source.readingAudio?.chapters?.length,
    targetAudioSegments: source.readingAudio?.chapters?.find(item => item.chapterId === chapterId)?.segments?.length,
    approvedPage: 4, sentences: segments.length, writeQuota: quota.Value,
    overrunBilling: false }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  const previousBackup = await readFile(backupPath, 'utf8').then(JSON.parse)
    .catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (previousBackup) {
    if (previousBackup.reviewSha256 !== sha(reviewBytes)
      || previousBackup.source.version !== source.version
      || previousBackup.projection.version !== projection.version) throw new Error('BACKUP_CHANGED');
  } else {
    await writeFile(backupPath, JSON.stringify({ at: new Date().toISOString(),
      reviewSha256: sha(reviewBytes), source, projection }) + '\n', { flag: 'wx' });
  }
  const now = new Date().toISOString();
  function next(row) {
    if (row.contentVersion !== '1.3') throw new Error('CONTENT_VERSION_GATE');
    const readingAudio = structuredClone(row.readingAudio);
    readingAudio.sourceVersion = '1.4';
    readingAudio.approvedAt = review.reviewedAt;
    readingAudio.approvedBy = 'Codex';
    readingAudio.reviewId = review.reviewId;
    readingAudio.reviewSha256 = sha(reviewBytes);
    const target = readingAudio.chapters.find(chapter => chapter.chapterId === chapterId);
    if (!target || target.segments.length !== 0 || readingAudio.chapters.length !== 7) {
      throw new Error('EXISTING_CHAPTER_AUDIO_GATE');
    }
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
  const auditId = 'audit_pep3a_u1_p4_pointread_20261016';
  const audit = { _id: auditId, organizationId: source.organizationId, schemaVersion: 1,
    version: 1, deletedAt: null, requestId: auditId, actorUserId: 'controlled_import',
    actorRole: 'system', action: 'asset_library.publish_partial_pointread',
    targetType: 'learning_resources', targetId: bookId, result: 'succeeded',
    errorCode: null, occurredAt: now, metadata: { reviewSha256: sha(reviewBytes),
      pageNumber: 4, sentenceCount: 6, sourcePriorVersion: source.version,
      sourceVersion: nextSource.version, projectionPriorVersion: projection.version,
      projectionVersion: nextProjection.version } };
  const tx = await db.startTransaction();
  try {
    const current = dataOne(await tx.collection('learning_resources').doc(bookId).get());
    const currentProjection = dataOne(await tx.collection('learning_resources').doc(projectionId).get());
    if (current?.version !== source.version || currentProjection?.version !== projection.version
      || dataOne(await tx.collection('operation_logs').doc(auditId).get())) throw new Error('VERSION_CONFLICT');
    const { _id: _s, ...s } = nextSource;
    const { _id: _p, ...p } = nextProjection;
    const { _id: _a, ...a } = audit;
    await tx.collection('learning_resources').doc(bookId).set(s);
    await tx.collection('learning_resources').doc(projectionId).set(p);
    await tx.collection('operation_logs').doc(auditId).set(a);
    await tx.commit();
  } catch (error) { await tx.rollback().catch(() => {}); throw error; }
  await writeFile(receiptPath, JSON.stringify({ environment: envId,
    nonproduction: true, publishedAt: now, bookId, chapterId, pageNumber: 4,
    sentenceCount: 6, reviewSha256: sha(reviewBytes),
    manifestSha256: sha(manifestBytes) }, null, 2) + '\n', { flag: 'wx' });
}
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
if (receipt.environment !== envId || receipt.bookId !== bookId
  || receipt.reviewSha256 !== sha(reviewBytes) || receipt.sentenceCount !== 6) {
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
  const id = orgId === secondary ? projectionId : bookId;
  const list = await textbooks.listTextbooks(teacher, {}, { limit: 50, offset: 0 });
  const book = list.items.find(item => item.id === id);
  const detail = await content.getReadingResource(student, id);
  const map = await content.getReadingAudioMap(student, id, chapterId);
  const spoken = await content.getReadingPronunciationSegments(student, id);
  if (!book || book.audioMode !== 'partial_pointread'
    || !book.audioAvailabilityNote?.includes('部分课文点读与跟读')
    || detail.chapters.length !== 9 || map.segments.length !== 6
    || spoken.segments.length !== 6
    || map.segments.some(item => !item.clipAudioAssetKey?.startsWith('cloud://'))
    || spoken.segments.some(item => !item.demonstrationAudioAssetKey.startsWith('cloud://'))) {
    throw new Error(`SERVICE_READBACK_${orgId}`);
  }
  readback.push({ organizationId: orgId, bookId: id,
    pointreadSentences: map.segments.length, followReadingSentences: spoken.segments.length });
}
process.stdout.write(JSON.stringify({ environment: envId, mode, pageNumber: 4,
  reviewedSentences: 6, readback, fullBookPointreadReady: false }) + '\n');
