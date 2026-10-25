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
const bookId = 'book-ffc42d637d97';
const secondary = 'org_isolation_secondary';
const base = join(root, 'library/derived/pep3b-units2-6-pointread-2026-10-16/v1');
const manifestPath = join(base, 'pilot-manifest.json');
const reviewPath = join(base, 'review/approved-units2-6-v1.json');
const stagingPath = join(root, 'reports/pep3b-units2-6-pointread-private-staging-2026-10-16.json');
const receiptPath = join(root, 'reports/pep3b-units2-6-pointread-nonproduction-publication-2026-10-16.json');
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
  if (parsed.error) throw new Error('CLOUD_API_ERROR');
  return parsed.data;
}
if (JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8')).envId !== envId) {
  throw new Error('ENVIRONMENT_CHANGED');
}
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
if (manifest.bookId !== bookId || manifest.pages?.length !== 5
  || review.evidence.manifestSha256 !== sha(manifestBytes)
  || review.decision !== 'approved_for_listed_sentence_pointread_and_follow_reading_nonproduction_only'
  || staging.status !== 'private_staging_not_published'
  || staging.manifestSha256 !== sha(manifestBytes)
  || staging.reviewSha256 !== sha(reviewBytes) || staging.files?.length !== 25) {
  throw new Error('CONTENT_EVIDENCE_GATE');
}
const staged = new Map(staging.files.map(file => [file.id, file]));
const selected = manifest.pages.map(page => ({ chapterId: page.chapterId,
  pageNumber: page.pageNumber, segments: page.segments.map(item => {
    const file = staged.get(item.id);
    if (!file || file.sha256 !== item.clipSha256 || file.durationMs !== item.clipDurationMs
      || !file.fileID.startsWith('cloud://')) throw new Error(`CLIP_GATE_${item.id}`);
    return { id: item.id, pageId: item.pageId, pageNumber: item.pageNumber,
      text: item.text, rect: item.rect, startMs: 0, endMs: file.durationMs,
      clipAudioAssetKey: file.fileID, clipDurationMs: file.durationMs };
  }) }));
if (selected.reduce((n, page) => n + page.segments.length, 0) !== 25) throw new Error('COUNT_GATE');
const source = dataOne(await db.collection('learning_resources').doc(bookId).get());
const projection = dataOne(await db.collection('learning_resources').doc(projectionId).get());
if (!source || !projection || source.organizationId !== 'org_qihang_demo'
  || projection.organizationId !== secondary || source.status !== 'published'
  || projection.status !== 'published' || source.globalCatalogSource !== true
  || projection.globalCatalogProjection !== true || projection.globalSourceId !== bookId
  || projection.globalSourceVersion !== source.version
  || source.payload?.audioMode !== 'partial_pointread'
  || projection.payload?.audioMode !== 'partial_pointread'
  || source.contentVersion !== (mode === 'verify' ? '1.5' : '1.4')
  || projection.contentVersion !== (mode === 'verify' ? '1.5' : '1.4')) {
  throw new Error('PUBLISHED_BOOK_GATE');
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ environment: envId, mode, bookId,
    pages: selected.map(page => page.pageNumber), newSentences: 25,
    existingSentences: source.pronunciation?.segments?.length,
    sourceVersion: source.version, projectionVersion: projection.version,
    writeQuota: quota.Value, overrunBilling: false }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  if (backup.reviewSha256 !== sha(reviewBytes)
    || backup.source?.version !== source.version
    || backup.projection?.version !== projection.version) throw new Error('BACKUP_GATE');
  const now = new Date().toISOString();
  function next(row) {
    if (row.readingAudio?.chapters?.length !== 7 || row.pronunciation?.segments?.length !== 9) {
      throw new Error('PRIOR_AUDIO_GATE');
    }
    const readingAudio = structuredClone(row.readingAudio);
    readingAudio.sourceVersion = '1.5';
    readingAudio.approvedAt = review.reviewedAt;
    readingAudio.approvedBy = 'Codex';
    readingAudio.reviewId = review.reviewId;
    readingAudio.reviewSha256 = sha(reviewBytes);
    for (const page of selected) {
      const chapter = readingAudio.chapters.find(item => item.chapterId === page.chapterId);
      if (!chapter || chapter.segments.length !== 0) throw new Error(`CHAPTER_GATE_${page.chapterId}`);
      chapter.segments = page.segments;
    }
    const pronunciation = structuredClone(row.pronunciation);
    pronunciation.sourceVersion = '1.5';
    pronunciation.approvedAt = review.reviewedAt;
    pronunciation.approvedBy = 'Codex';
    pronunciation.reviewId = review.reviewId;
    pronunciation.reviewSha256 = sha(reviewBytes);
    pronunciation.segments = [...pronunciation.segments,
      ...selected.flatMap(page => page.segments.map(segment => ({ id: segment.id,
        pageNumber: segment.pageNumber, text: segment.text,
        demonstrationAudioAssetKey: segment.clipAudioAssetKey })))];
    return { ...row, version: row.version + 1, contentVersion: '1.5', updatedAt: now,
      readingAudio, pronunciation, pointreadReviewSha256: sha(reviewBytes),
      payload: { ...row.payload, readingAudio, pronunciation } };
  }
  const nextSource = next(source);
  nextSource.globalCatalogFingerprint = sha(JSON.stringify({ id: nextSource._id,
    version: nextSource.version, type: nextSource.type, title: nextSource.title,
    contentVersion: nextSource.contentVersion, payload: nextSource.payload,
    visibility: nextSource.visibility, status: nextSource.status }));
  const nextProjection = next(projection);
  nextProjection.globalSourceVersion = nextSource.version;
  nextProjection.globalSourceFingerprint = nextSource.globalCatalogFingerprint;
  const auditId = 'audit_pep3b_units2_6_pointread_20261016';
  const audit = { _id: auditId, organizationId: source.organizationId, schemaVersion: 1,
    version: 1, deletedAt: null, requestId: auditId, actorUserId: 'controlled_import',
    actorRole: 'system', action: 'asset_library.extend_partial_pointread',
    targetType: 'learning_resources', targetId: bookId, result: 'succeeded',
    errorCode: null, occurredAt: now, metadata: { reviewSha256: sha(reviewBytes),
      pageNumbers: selected.map(item => item.pageNumber), addedSentences: 25,
      sourcePriorVersion: source.version, sourceVersion: nextSource.version,
      projectionPriorVersion: projection.version, projectionVersion: nextProjection.version } };
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
  await writeFile(receiptPath, JSON.stringify({ environment: envId, nonproduction: true,
    publishedAt: now, bookId, addedPages: selected.map(item => item.pageNumber),
    addedSentences: 25, totalSentences: 34, reviewSha256: sha(reviewBytes),
    manifestSha256: sha(manifestBytes) }, null, 2) + '\n', { flag: 'wx' });
}
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
if (receipt.environment !== envId || receipt.bookId !== bookId
  || receipt.reviewSha256 !== sha(reviewBytes) || receipt.totalSentences !== 34) {
  throw new Error('RECEIPT_GATE');
}
const bundlePath = join(backend, '.runtime/pep-pointread-20261016/entry.cjs');
await mkdir(dirname(bundlePath), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-global-asset-audit-entry.ts')],
  outfile: bundlePath, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(bundlePath);
const documents = api.createCloudBaseDocumentDatabase(db);
const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(documents));
const results = [];
for (const orgId of ['org_qihang_demo', secondary]) {
  const member = (await db.collection('class_memberships').where({ organizationId: orgId,
    status: 'active', deletedAt: null }).get()).data?.[0];
  if (!member?.studentId || !member?.classId) throw new Error('DEMO_ACTOR_GATE');
  const actor = { requestId: `pep3b_extend_${orgId}`, sessionId: 'pep3b-pointread-readback',
    actorUserId: member.studentId, actorRole: 'student', organizationId: orgId,
    platformSubjectDigest: 'pep3b-pointread-readback', permissions: ['content.read'],
    scopeIds: [member.classId], authzVersion: 1 };
  const id = orgId === secondary ? projectionId : bookId;
  const spoken = await content.getReadingPronunciationSegments(actor, id);
  let mapped = 0;
  for (const chapterId of ['book-ffc42d637d97-chapter-02', ...selected.map(item => item.chapterId)]) {
    const map = await content.getReadingAudioMap(actor, id, chapterId);
    if (!map.segments.length || map.segments.some(item => !item.clipAudioAssetKey?.startsWith('cloud://'))) {
      throw new Error(`AUDIO_READBACK_${id}_${chapterId}`);
    }
    mapped += map.segments.length;
  }
  if (mapped !== 34 || spoken.segments.length !== 34) throw new Error(`PRONUNCIATION_READBACK_${id}`);
  results.push({ organizationId: orgId, bookId: id, pagesWithPointread: 6,
    pointreadSentences: mapped, followReadingSentences: spoken.segments.length });
}
process.stdout.write(JSON.stringify({ environment: envId, mode, bookId,
  totalPointreadPages: 6, totalSentences: 34, readback: results,
  fullBookPointreadReady: false }) + '\n');

