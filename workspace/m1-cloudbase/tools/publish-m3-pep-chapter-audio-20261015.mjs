import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(backend, 'package.json'));
const envId = 'cloud1-d8ggzrwwedb786e41';
const root = 'G:/英语资产';
const base = join(root, 'library/derived/pep-current-chapter-narration-2026-10-15/v2');
const manifestPath = join(base, 'narration-manifest.json');
const reviewPath = join(base, 'review/approved-chapter-audio-v1.json');
const stagingPath = join(root, 'reports/pep-chapter-audio-private-staging-2026-10-15.json');
const receiptPath = join(root, 'reports/pep-chapter-audio-nonproduction-publication-2026-10-15.json');
const backupPath = receiptPath.replace(/\.json$/u, '-before.json');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const sha = value => createHash('sha256').update(value).digest('hex');
const dataOne = value => Array.isArray(value?.data) ? value.data[0] ?? null
  : value?.data && typeof value.data === 'object' ? value.data : null;
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: backend, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error(`CLOUD_API_ERROR_${args[0]}`);
  return parsed.data;
}
const config = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
if (config.envId !== envId) throw new Error('ENVIRONMENT_CHANGED');
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_GATE');
const quota = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('DB_QUOTA_GATE');
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
if (manifest.chapters?.length !== 39 || review.decision !== 'approved_for_chapter_continuous_listening_only'
  || review.evidence.narrationManifestSha256 !== sha(manifestBytes)
  || staging.manifestSha256 !== sha(manifestBytes) || staging.fileCount !== 39
  || staging.status !== 'private_staging_only_not_published') throw new Error('CONTENT_REVIEW_GATE');
const staged = new Map(staging.files.map(file => [file.chapterId, file]));
const byBook = new Map();
for (const chapter of manifest.chapters) {
  const file = staged.get(chapter.chapterId);
  if (!file || file.bookId !== chapter.bookId || file.sha256 !== chapter.audioSha256
    || file.durationMs !== chapter.durationMs || !file.fileID.startsWith('cloud://')) {
    throw new Error(`STAGING_MAP_GATE_${chapter.chapterId}`);
  }
  const tracks = byBook.get(chapter.bookId) ?? [];
  tracks.push({ chapterId: chapter.chapterId, audioAssetKey: file.fileID,
    durationMs: chapter.durationMs, segments: [] });
  byBook.set(chapter.bookId, tracks);
}
if (byBook.size !== 5 || [...byBook.values()].reduce((n, rows) => n + rows.length, 0) !== 39) {
  throw new Error('BOOK_COVERAGE_GATE');
}
const secondary = 'org_isolation_secondary';
const projectionId = id => `global_asset_${sha(JSON.stringify([id, secondary])).slice(0, 40)}`;
const records = [];
for (const [id, audioChapters] of byBook) {
  const source = dataOne(await db.collection('learning_resources').doc(id).get());
  const projection = dataOne(await db.collection('learning_resources').doc(projectionId(id)).get());
  if (!source || !projection || source.organizationId !== 'org_qihang_demo'
    || projection.organizationId !== secondary || source.status !== 'published'
    || projection.status !== 'published' || source.globalCatalogSource !== true
    || projection.globalCatalogProjection !== true || projection.globalSourceId !== id
    || projection.globalSourceVersion !== source.version) throw new Error(`SOURCE_GATE_${id}`);
  const expectedIds = source.payload?.chapters?.filter(chapter => /^(?:Starter )?Unit \d+|^Revision/u.test(chapter.title))
    .map(chapter => chapter.id);
  if (!expectedIds || expectedIds.length !== audioChapters.length
    || expectedIds.some(chapterId => !audioChapters.some(audio => audio.chapterId === chapterId))
    || source.payload.audioMode !== (mode === 'verify' ? 'chapter_audio' : 'page_only')
    || projection.payload.audioMode !== (mode === 'verify' ? 'chapter_audio' : 'page_only')
    || source.pages.length !== source.payload.chapters.flatMap(chapter => chapter.pages).length) {
    throw new Error(`CHAPTER_GATE_${id}`);
  }
  records.push({ id, source, projection, audioChapters });
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ environment: envId, mode, books: records.length,
    chapters: 39, dbWritesPlanned: 15, stagingHashes: 39,
    quota: quota.Value, overrunBilling: false }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  await writeFile(backupPath, JSON.stringify({ at: new Date().toISOString(),
    reviewSha256: sha(reviewBytes), books: records.map(({ id, source, projection }) => ({ id, source, projection })) }) + '\n', { flag: 'wx' });
  const now = new Date().toISOString();
  for (const { id, source, projection, audioChapters } of records) {
    const media = { reviewStatus: 'approved', sourceVersion: '1.3',
      approvedAt: review.reviewedAt, approvedBy: 'Codex', reviewId: review.reviewId,
      reviewSha256: sha(reviewBytes), chapters: audioChapters };
    function next(row) {
      if (row.contentVersion !== '1.2') throw new Error(`CONTENT_VERSION_GATE_${id}`);
      const note = '已开放章节朗读；点读、跟读与示范音频暂未开放';
      return { ...row, version: row.version + 1, contentVersion: '1.3', updatedAt: now,
        publicationMode: 'chapter_audio', audioMode: 'chapter_audio',
        audioAvailabilityNote: note, readingAudio: media,
        chapterAudioReviewSha256: sha(reviewBytes),
        payload: { ...row.payload, audioMode: 'chapter_audio',
          audioAvailabilityNote: note, readingAudio: media,
          audioAvailability: 'chapter_audio' } };
    }
    const nextSource = next(source);
    nextSource.globalCatalogFingerprint = sha(JSON.stringify({ id: nextSource._id,
      version: nextSource.version, type: nextSource.type, title: nextSource.title,
      contentVersion: nextSource.contentVersion, payload: nextSource.payload,
      visibility: nextSource.visibility, status: nextSource.status }));
    const nextProjection = next(projection);
    nextProjection.globalSourceVersion = nextSource.version;
    nextProjection.globalSourceFingerprint = nextSource.globalCatalogFingerprint;
    const auditId = `audit_pep_chapter_audio_${id}_20261015`;
    const audit = { _id: auditId, organizationId: source.organizationId, schemaVersion: 1,
      version: 1, deletedAt: null, requestId: auditId, actorUserId: 'controlled_import',
      actorRole: 'system', action: 'asset_library.publish_chapter_narration',
      targetType: 'learning_resources', targetId: id, result: 'succeeded',
      errorCode: null, occurredAt: now, metadata: { reviewSha256: sha(reviewBytes),
        manifestSha256: sha(manifestBytes), chapterCount: audioChapters.length,
        sourcePriorVersion: source.version, sourceVersion: nextSource.version,
        projectionPriorVersion: projection.version, projectionVersion: nextProjection.version } };
    const tx = await db.startTransaction();
    try {
      const current = dataOne(await tx.collection('learning_resources').doc(id).get());
      const currentProjection = dataOne(await tx.collection('learning_resources').doc(projection._id).get());
      if (current?.version !== source.version || currentProjection?.version !== projection.version
        || dataOne(await tx.collection('operation_logs').doc(auditId).get())) throw new Error(`WRITE_CONFLICT_${id}`);
      const { _id: _s, ...s } = nextSource;
      const { _id: _p, ...p } = nextProjection;
      const { _id: _a, ...a } = audit;
      await tx.collection('learning_resources').doc(id).set(s);
      await tx.collection('learning_resources').doc(projection._id).set(p);
      await tx.collection('operation_logs').doc(auditId).set(a);
      await tx.commit();
    } catch (error) { await tx.rollback().catch(() => {}); throw error; }
  }
  await writeFile(receiptPath, JSON.stringify({ environment: envId, nonproduction: true,
    publishedAt: now, reviewSha256: sha(reviewBytes), manifestSha256: sha(manifestBytes),
    books: records.map(row => row.id), chapterAudios: 39, filesUploaded: 39,
    privateStorage: true }, null, 2) + '\n', { flag: 'wx' });
}
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
if (receipt.environment !== envId || receipt.reviewSha256 !== sha(reviewBytes)
  || receipt.manifestSha256 !== sha(manifestBytes) || receipt.chapterAudios !== 39) {
  throw new Error('RECEIPT_GATE');
}
const output = join(backend, '.runtime/pep-chapter-audio-20261015/entry.cjs');
await mkdir(dirname(output), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-global-asset-audit-entry.ts')],
  outfile: output, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(output);
const documents = api.createCloudBaseDocumentDatabase(db);
const teacherService = new api.TeacherTextbookService(new api.DocumentTextbookRepository(documents),
  { nowIso: () => new Date().toISOString() });
const studentService = new api.ContentQueryService(api.createOrgContentDocumentRepository(documents));
const serviceReadback = [];
for (const orgId of ['org_qihang_demo', secondary]) {
  const grants = (await db.collection('teacher_class_grants').where({ organizationId: orgId,
    status: 'active', deletedAt: null }).get()).data;
  const membership = (await db.collection('class_memberships').where({ organizationId: orgId,
    status: 'active', deletedAt: null }).get()).data?.[0];
  if (!grants?.length || !membership?.studentId || !membership?.classId) throw new Error('DEMO_ACTOR_MISSING');
  const teacher = { requestId: `pep_audio_teacher_${orgId}`, sessionId: 'pep-audio-readback',
    actorUserId: grants[0].teacherId, actorRole: 'teacher', organizationId: orgId,
    platformSubjectDigest: 'pep-audio-readback', permissions: ['content.read', 'task.publish'],
    scopeIds: [...new Set(grants.map(row => row.classId))], authzVersion: 1 };
  const student = { requestId: `pep_audio_student_${orgId}`, sessionId: 'pep-audio-readback',
    actorUserId: membership.studentId, actorRole: 'student', organizationId: orgId,
    platformSubjectDigest: 'pep-audio-readback', permissions: ['content.read'],
    scopeIds: [membership.classId], authzVersion: 1 };
  const catalog = await teacherService.listTextbooks(teacher, {}, { limit: 50, offset: 0 });
  let maps = 0;
  for (const { id, audioChapters } of records) {
    const resourceId = orgId === 'org_qihang_demo' ? id : projectionId(id);
    const book = catalog.items.find(item => item.id === resourceId);
    const detail = await studentService.getReadingResource(student, resourceId);
    if (!book || book.audioMode !== 'chapter_audio'
      || book.audioAvailabilityNote !== '已开放章节朗读；点读、跟读与示范音频暂未开放'
      || detail.chapters.length < audioChapters.length) throw new Error(`CATALOG_READBACK_${resourceId}`);
    for (const chapter of audioChapters) {
      const result = await studentService.getReadingAudioMap(student, resourceId, chapter.chapterId);
      if (result.audioAssetKey !== chapter.audioAssetKey || result.durationMs !== chapter.durationMs
        || result.segments.length !== 0) throw new Error(`AUDIO_MAP_READBACK_${resourceId}_${chapter.chapterId}`);
      maps += 1;
    }
  }
  serviceReadback.push({ organizationId: orgId, books: records.length, chapterAudioMaps: maps });
}
process.stdout.write(JSON.stringify({ environment: envId, mode, publishedBooks: records.length,
  chapterAudios: 39, serviceReadback, pointreadStillUnavailable: true }) + '\n');
