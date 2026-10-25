import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(backend, 'package.json'));
const root = 'G:/英语资产';
const envId = 'cloud1-d8ggzrwwedb786e41';
const resourceId = 'supplement-pep4a-u1-complete-v1';
const secondary = 'org_isolation_secondary';
const auditId = 'audit_pep4a_u1_vocabulary_20261017';
const base = join(root, 'library/derived/pep4a-wordpacks-2026-10-17/v1');
const receiptPath = join(root, 'reports/pep4a-u1-wordpack-nonproduction-2026-10-17.json');
const sha = value => createHash('sha256').update(value).digest('hex');
const one = result => Array.isArray(result?.data) ? result.data[0] ?? null
  : result?.data && typeof result.data === 'object' ? result.data : null;
function cliData(args) {
  const raw = execFileSync(process.execPath,
    ['D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb', ...args],
    { cwd: backend, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error('CLOUD_API_ERROR');
  return parsed.data;
}
const cfg = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
const configured = (await readFile(join(backend, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (cfg.envId !== envId || configured !== envId) throw new Error('ENVIRONMENT_GATE');
const envs = cliData(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no') throw new Error('COST_GATE');
const quota = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota?.Value) || quota.Value > 190000) throw new Error('QUOTA_GATE');
if (cliData(['storage', 'rules', 'get', '--json'])?.acl !== 'PRIVATE') throw new Error('STORAGE_GATE');
const token = cliData(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) < Date.now() + 60000) throw new Error('TOKEN_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token });
const db = app.database();
const packBytes = await readFile(join(base, 'word-pack.json'));
const reviewBytes = await readFile(join(base, 'review/approved-content-v1.json'));
const pack = JSON.parse(packBytes);
const review = JSON.parse(reviewBytes);
if (pack.resourceId !== resourceId || pack.words?.length !== 19
  || review.resourceId !== resourceId || review.packSha256 !== sha(packBytes)
  || review.decision !== 'approved_for_nonproduction_vocabulary_release') {
  throw new Error('CONTENT_REVIEW_GATE');
}
const audio = [];
for (const word of pack.words) {
  const bytes = await readFile(join(root, word.audioRelativePath));
  if (bytes.length !== word.audioBytes || sha(bytes) !== word.audioSha256) {
    throw new Error(`AUDIO_HASH_${word.id}`);
  }
  audio.push({ word, bytes, cloudPath: `yarei-assets/media/pep4a-u1-words-20261017/${word.id}.mp3` });
}
const projectionId = `global_asset_${sha(JSON.stringify([resourceId, secondary])).slice(0, 40)}`;
const source = one(await db.collection('learning_resources').doc(resourceId).get().catch(() => null));
const projection = one(await db.collection('learning_resources').doc(projectionId).get().catch(() => null));
const audit = one(await db.collection('operation_logs').doc(auditId).get().catch(() => null));
if (mode !== 'verify' && (source || projection || audit)) throw new Error('TARGET_NOT_EMPTY');
if (mode === 'verify' && (source?.status !== 'published'
  || projection?.status !== 'published' || !audit)) throw new Error('PUBLISHED_GATE');
if (mode !== 'verify') {
  const objects = cliData(['storage', 'list', 'yarei-assets/media/pep4a-u1-words-20261017/', '--json']);
  if (Array.isArray(objects) && objects.length) throw new Error('STORAGE_NOT_EMPTY');
}
const entry = join(backend, '.runtime/pep4a-u1-vocabulary-20261017/entry.cjs');
await mkdir(dirname(entry), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-global-asset-audit-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(entry);
const documents = api.createCloudBaseDocumentDatabase(db);
if (mode === 'inspect') {
  const orgs = await Promise.all(['org_qihang_demo', secondary].map(async id => one(
    await db.collection('organizations').doc(id).get())));
  if (orgs.some(row => row?.status !== 'active')) throw new Error('ORGANIZATION_GATE');
  process.stdout.write(JSON.stringify({ mode, environment: envId, resourceId,
    units: 1, words: audio.length, bytes: audio.reduce((n, row) => n + row.bytes.length, 0),
    dbWriteQuota: quota.Value, overrunBilling: false }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  const uploaded = [];
  let committed = false;
  try {
    for (const item of audio) {
      const result = await app.uploadFile({ cloudPath: item.cloudPath, fileContent: item.bytes });
      if (!result.fileID?.startsWith('cloud://')) throw new Error('UPLOAD_GATE');
      uploaded.push({ ...item, fileID: result.fileID });
    }
    for (const item of uploaded) {
      const result = await app.downloadFile({ fileID: item.fileID });
      const bytes = Buffer.from(result.fileContent);
      if (bytes.length !== item.bytes.length || sha(bytes) !== item.word.audioSha256) {
        throw new Error(`READBACK_${item.word.id}`);
      }
    }
    const now = new Date().toISOString();
    const words = uploaded.map(({ word, fileID }) => ({ id: word.id, word: word.word,
      meaning: word.meaning, example: word.example, syllables: word.syllables,
      ipa: word.ipa, audioAssetKey: fileID, startMs: 0,
      endMs: word.sourceEndMs - word.sourceStartMs }));
    const doc = { _id: resourceId, id: resourceId, organizationId: 'org_qihang_demo',
      schemaVersion: 1, version: 1, deletedAt: null, createdAt: now, updatedAt: now,
      type: 'vocabulary', title: pack.title, contentVersion: '1.0', status: 'published',
      copyrightStatus: 'verified', visibility: { type: 'organization' },
      reviewSha256: sha(reviewBytes), assetRelease: 'content-pep4a-u1-20261017',
      grade: pack.grade, term: pack.term, textbook: pack.textbook, unit: pack.unit,
      allowedStudentIds: [], allowedClassIds: [], pages: [], wordIds: words.map(word => word.id),
      words, testOnly: false, sourceRightsStatus: 'user_confirmed_cleared',
      sourceEvidence: { sourceBookSha256: pack.sourceBookSha256,
        sourcePageNumbers: [pack.sourcePageNumber], sourcePageSha256: pack.sourcePageSha256,
        sourceAudioSha256: pack.sourceAudioSha256, manifestSha256: sha(packBytes),
        reviewSha256: sha(reviewBytes) },
      payload: { grade: pack.grade, term: pack.term, textbook: pack.textbook,
        unit: pack.unit, words: structuredClone(words), reviewStatus: 'approved',
        reviewerId: 'Codex', reviewedAt: review.reviewedAt,
        assetLibrary: { kind: 'central_asset_library', catalogScope: 'all_teachers',
          reviewStatus: 'approved', resourceId, version: '1.0',
          sourceSha256: pack.sourceBookSha256, manifestSha256: sha(packBytes),
          copyrightEvidenceSha256: sha(reviewBytes), reviewId: sha(reviewBytes) } } };
    if (!api.hasCompletePublicLearningMapping(doc)) throw new Error('PUBLIC_MAPPING_GATE');
    const auditRow = { _id: auditId, organizationId: 'org_qihang_demo', schemaVersion: 1,
      version: 1, deletedAt: null, requestId: auditId, actorUserId: 'controlled_import',
      actorRole: 'system', action: 'asset_library.publish_pep4a_vocabulary',
      targetType: 'learning_resources', targetId: resourceId, result: 'succeeded',
      errorCode: null, occurredAt: now, metadata: { environment: envId,
        words: 19, manifestSha256: sha(packBytes), reviewSha256: sha(reviewBytes) } };
    await documents.runTransaction(async tx => {
      if (await tx.get('learning_resources', resourceId)
        || !await tx.create('learning_resources', doc)) throw new Error('SOURCE_CREATE_GATE');
      if (await tx.get('operation_logs', auditId)
        || !await tx.append('operation_logs', auditRow)) throw new Error('AUDIT_CREATE_GATE');
    });
    committed = true;
    const distribution = new api.LegacyGlobalDistributionService(documents,
      { nowIso: () => new Date().toISOString() });
    await distribution.migrate(resourceId, ['org_qihang_demo', secondary]);
    await writeFile(receiptPath, JSON.stringify({ environment: envId, publishedAt: now,
      resourceId, projectionId, wordCount: 19, audioHashesReadBack: 19,
      packSha256: sha(packBytes), reviewSha256: sha(reviewBytes),
      files: uploaded.map(item => ({ fileID: item.fileID, sha256: item.word.audioSha256,
        bytes: item.bytes.length })) }, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (!committed && uploaded.length) {
      await app.deleteFile({ fileList: uploaded.map(item => item.fileID) });
    }
    throw error;
  }
}
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
if (receipt.environment !== envId || receipt.resourceId !== resourceId
  || receipt.packSha256 !== sha(packBytes) || receipt.reviewSha256 !== sha(reviewBytes)) {
  throw new Error('RECEIPT_GATE');
}
const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(documents));
const result = [];
for (const orgId of ['org_qihang_demo', secondary]) {
  const grants = await db.collection('teacher_class_grants').where({ organizationId: orgId,
    status: 'active', deletedAt: null }).get();
  const members = await db.collection('class_memberships').where({ organizationId: orgId,
    status: 'active', deletedAt: null }).get();
  const grant = grants.data?.[0];
  const member = members.data?.[0];
  if (!grant?.teacherId || !grant?.classId || !member?.studentId || !member?.classId) {
    throw new Error('ACTOR_GATE');
  }
  const actor = { requestId: `pep4a_vocab_${orgId}`, sessionId: 'pep4a-vocab-readback',
    actorUserId: member.studentId, actorRole: 'student', organizationId: orgId,
    platformSubjectDigest: 'pep4a-vocab-readback', permissions: ['content.read'],
    scopeIds: [member.classId], authzVersion: 1 };
  const teacher = { ...actor, actorUserId: grant.teacherId, actorRole: 'teacher',
    scopeIds: [grant.classId], permissions: ['content.read', 'task.publish'] };
  const id = orgId === 'org_qihang_demo' ? resourceId : projectionId;
  const detail = await content.getVocabularyPack(actor, id);
  const teacherList = await content.listTaskCatalogResources(teacher,
    { type: 'vocabulary', keyword: 'Helping at home' }, { limit: 50, offset: 0 });
  const studentList = await content.listStudentCatalog(actor,
    { type: 'vocabulary', keyword: 'Helping at home' }, { limit: 50, offset: 0 });
  if (detail.words.length !== 19 || detail.words.some(word => !word.audioAssetKey?.startsWith('cloud://'))
    || !teacherList.items.some(item => item.id === id)
    || !studentList.items.some(item => item.id === id)) throw new Error('SERVICE_READBACK_GATE');
  result.push({ organizationId: orgId, words: detail.words.length,
    teacherCatalog: true, studentCatalog: true });
}
process.stdout.write(JSON.stringify({ mode, environment: envId, resourceId,
  words: 19, readback: result }) + '\n');
