import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = 'G:/英语资产';
const output = join(assets, 'exports/wechat/join-in-vocabulary-2026-10-16');
const envId = 'cloud1-d8ggzrwwedb786e41';
const organizations = ['org_isolation_secondary', 'org_qihang_demo'];
const auditId = 'audit_join_in_vocabulary_14_packs_20261016';
const require = createRequire(join(backend, 'package.json'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(bytes.toString('utf8'));
function cliData(args) {
  const raw = execFileSync(process.execPath,
    ['D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb', ...args],
    { cwd: backend, encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error(`CLOUD_API_REJECTED_${args[0]}`);
  return parsed.data;
}
function one(result) {
  return Array.isArray(result?.data) ? result.data[0] ?? null
    : result?.data && typeof result.data === 'object' ? result.data : null;
}
function materialize(value, ids) {
  if (Array.isArray(value)) return value.map(item => materialize(item, ids));
  if (value && typeof value === 'object') {
    if (typeof value.$assetKey === 'string') {
      const id = ids.get(value.$assetKey);
      if (!id) throw new Error('MISSING_AUDIO_FILE_ID');
      return id;
    }
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, materialize(item, ids)]));
  }
  return value;
}

const cfg = json(await readFile(join(backend, 'cloudbaserc.json')));
const configured = (await readFile(join(backend, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (cfg.envId !== envId || configured !== envId) throw new Error('ENV_ID_MISMATCH');
const envs = cliData(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_GATE');
const quota = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
const storage = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'StorageSizepkg' }), '--json']);
if (!Number.isFinite(quota?.Value) || quota.Value > 190000
  || !Number.isFinite(storage?.Value)) throw new Error('QUOTA_GATE');
const acl = cliData(['storage', 'rules', 'get', '--json']);
if (acl?.acl !== 'PRIVATE') throw new Error('STORAGE_NOT_PRIVATE');
const token = cliData(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) < Date.now() + 60000) throw new Error('TOKEN_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: token.secretId, secretKey: token.secretKey, sessionToken: token.token });
const database = app.database();
const declaration = json(await readFile(join(assets,
  'library/derived/textbook-wordlists-2026-10-14/v74/config-entries.json')));
const ids = declaration.declarations.map(row => row.relativePath.split('/').at(-1).replace(/\.json$/u, ''));
if (ids.length !== 14 || new Set(ids).size !== 14) throw new Error('PACK_COUNT_GATE');
const packages = [];
const uploads = new Map();
for (const id of ids) {
  const dir = join(output, id);
  const plan = json(await readFile(join(dir, 'release-plan.json')));
  const template = json(await readFile(join(dir, 'database-template.json')));
  const sourcePath = `library/derived/textbook-wordlists-2026-10-14/v74/packs/${id}.json`;
  const provenancePath = `library/derived/textbook-wordlists-2026-10-14/v74/provenance/${id}.json`;
  const sourceBytes = await readFile(join(assets, sourcePath));
  const provenanceBytes = await readFile(join(assets, provenancePath));
  const provenance = json(provenanceBytes);
  const reviewPath = join(assets, 'library/supplements', id, 'v1/review/approved-content-v1.json');
  const reviewBytes = await readFile(reviewPath);
  const review = json(reviewBytes);
  const pack = json(sourceBytes);
  const rows = (await readFile(join(dir, 'storage-upload.jsonl'), 'utf8'))
    .trim().split(/\r?\n/u).map(line => JSON.parse(line));
  if (plan.allowed !== true || plan.resourceId !== id || template.document._id !== id
    || template.document.status !== 'draft' || template.document.type !== 'vocabulary'
    || template.document.payload.words.length !== pack.words.length
    || rows.length !== pack.words.length || provenance.outputSha256 !== sha(sourceBytes)
    || !review || review.reviewerId !== 'Codex') throw new Error(`LOCAL_REVIEW_GATE_${id}`);
  for (const row of rows) {
    const bytes = await readFile(resolve(assets, ...row.localRelativePath.split('/')));
    if (bytes.length !== row.bytes || sha(bytes) !== row.sha256.toLowerCase()) {
      throw new Error(`MEDIA_HASH_GATE_${id}`);
    }
    if (uploads.has(row.assetKey)) throw new Error('DUPLICATE_MEDIA_KEY');
    uploads.set(row.assetKey, { ...row, bytes });
  }
  packages.push({ id, dir, plan, template, pack, provenance, reviewBytes,
    sourceBytes, provenanceBytes });
}
if (uploads.size !== 238 || [...uploads.values()].reduce((n, row) => n + row.bytes.length, 0)
  > 4 * 1024 * 1024) throw new Error('MEDIA_COUNT_OR_BUDGET_GATE');
const orgRows = await Promise.all(organizations.map(async id => one(
  await database.collection('organizations').doc(id).get().catch(() => null))));
if (orgRows.some((row, index) => row?._id !== organizations[index]
  || row.status !== 'active' || row.deletedAt !== null)) throw new Error('ORGANIZATION_GATE');
const existing = await Promise.all(ids.map(async id => one(
  await database.collection('learning_resources').doc(id).get().catch(() => null))));
const projectedIds = ids.map(id => `global_asset_${sha(Buffer.from(JSON.stringify(
  [id, 'org_isolation_secondary']))).slice(0, 40)}`);
const existingProjections = await Promise.all(projectedIds.map(async id => one(
  await database.collection('learning_resources').doc(id).get().catch(() => null))));
const audit = one(await database.collection('operation_logs').doc(auditId).get().catch(() => null));
if (mode !== 'verify' && (existing.some(Boolean) || existingProjections.some(Boolean) || audit)) {
  throw new Error('TARGET_NOT_EMPTY');
}
if (mode === 'verify' && (existing.some(row => row?.status !== 'published') || !audit)) {
  throw new Error('PUBLISHED_READBACK_MISSING');
}
if (mode !== 'verify') {
  const result = cliData(['storage', 'list', 'yarei-assets/media/', '--json']);
  const occupied = new Set((Array.isArray(result) ? result : [])
    .map(row => row.Key ?? row.key ?? row.FilePath ?? row.filePath));
  if ([...uploads.values()].some(row => occupied.has(row.cloudPath))) {
    throw new Error('STORAGE_TARGET_NOT_EMPTY');
  }
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ mode, environment: envId,
    packs: packages.length, words: packages.reduce((n, row) => n + row.pack.words.length, 0),
    distinctAudio: uploads.size,
    audioBytes: [...uploads.values()].reduce((n, row) => n + row.bytes.length, 0),
    quota: quota.Value, storage: storage.Value, billedOverrun: false,
    emptyTargets: existing.length, cloudWrites: 0 }) + '\n');
  process.exit(0);
}
const entry = join(backend, '.runtime/join-in-vocabulary-20261016/entry.cjs');
await mkdir(dirname(entry), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-global-asset-audit-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22',
  logLevel: 'silent' });
const api = require(entry);
const documents = api.createCloudBaseDocumentDatabase(database);
if (mode === 'verify') {
  const projections = await Promise.all(ids.map(id => documents.get('learning_resources',
    api.legacyGlobalProjectionId(id, 'org_isolation_secondary'))));
  if (projections.some(row => row?.globalCatalogProjection !== true)) {
    throw new Error('PROJECTION_READBACK_FAILED');
  }
  const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(documents));
  const serviceReadback = [];
  for (const orgId of organizations) {
    const grants = await database.collection('teacher_class_grants')
      .where({ organizationId: orgId, status: 'active', deletedAt: null }).get();
    const memberships = await database.collection('class_memberships')
      .where({ organizationId: orgId, status: 'active', deletedAt: null }).get();
    const grant = grants.data?.[0];
    const member = memberships.data?.[0];
    if (!grant?.teacherId || !grant?.classId || !member?.studentId || !member?.classId) {
      throw new Error(`DEMO_ACTOR_MISSING_${orgId}`);
    }
    const teacher = { requestId: `join_in_teacher_${orgId}`, sessionId: 'join-in-readback',
      actorUserId: grant.teacherId, actorRole: 'teacher', organizationId: orgId,
      platformSubjectDigest: 'join-in-readback', permissions: ['content.read', 'task.publish'],
      scopeIds: [grant.classId], authzVersion: 1 };
    const student = { ...teacher, requestId: `join_in_student_${orgId}`,
      actorUserId: member.studentId, actorRole: 'student', permissions: ['content.read'],
      scopeIds: [member.classId] };
    let checked = 0;
    for (const item of packages) {
      const resourceId = orgId === 'org_qihang_demo' ? item.id
        : api.legacyGlobalProjectionId(item.id, orgId);
      const teacherList = await content.listTaskCatalogResources(teacher,
        { type: 'vocabulary', keyword: item.template.document.title }, { limit: 50, offset: 0 });
      const studentList = await content.listStudentCatalog(student,
        { type: 'vocabulary', keyword: item.template.document.title }, { limit: 50, offset: 0 });
      const pack = await content.getVocabularyPack(student, resourceId);
      if (!teacherList.items.some(row => row.id === resourceId)
        || !studentList.items.some(row => row.id === resourceId)
        || pack.words.length !== item.pack.words.length
        || pack.words.some((word, index) => word.word !== item.pack.words[index].word
          || word.ipa !== item.pack.words[index].ipa
          || !word.audioAssetKey?.startsWith('cloud://'))) {
        throw new Error(`SERVICE_READBACK_FAILED_${resourceId}`);
      }
      checked++;
    }
    serviceReadback.push({ organizationId: orgId, teacherCatalog: checked,
      studentCatalog: checked, vocabularyDetail: checked });
  }
  const verified = { mode, verifiedAt: new Date().toISOString(),
    environment: envId, published: ids.length,
    projections: projections.length, words: existing.reduce((n, row) => n + row.words.length, 0),
    serviceReadback };
  await writeFile(join(output, 'cloudbase-nonproduction-readback.json'),
    JSON.stringify(verified, null, 2) + '\n');
  process.stdout.write(JSON.stringify(verified) + '\n');
  process.exit(0);
}
const uploaded = [];
let committed = false;
try {
  const fileIds = new Map();
  for (const [key, row] of uploads) {
    const result = await app.uploadFile({ cloudPath: row.cloudPath, fileContent: row.bytes });
    if (!result.fileID?.startsWith('cloud://')) throw new Error('UPLOAD_FILE_ID_INVALID');
    fileIds.set(key, result.fileID);
    uploaded.push({ fileID: result.fileID, sha256: row.sha256, bytes: row.bytes.length });
    if (uploaded.length % 25 === 0) process.stdout.write(`UPLOADED=${uploaded.length}/238\n`);
  }
  for (let at = 0; at < uploaded.length; at += 8) {
    await Promise.all(uploaded.slice(at, at + 8).map(async row => {
      const downloaded = await app.downloadFile({ fileID: row.fileID });
      const bytes = Buffer.from(downloaded.fileContent);
      if (bytes.length !== row.bytes || sha(bytes) !== row.sha256) {
        throw new Error('CLOUD_AUDIO_HASH_MISMATCH');
      }
    }));
  }
  const now = new Date().toISOString();
  const resources = packages.map(item => {
    const doc = structuredClone(item.template.document);
    const words = materialize(doc.payload.words, fileIds).map(word => {
      const { audioFileId, ...other } = word;
      return { ...other, audioAssetKey: audioFileId };
    });
    doc.words = words;
    doc.payload.words = structuredClone(words);
    doc.payload.reviewStatus = 'approved';
    doc.payload.reviewerId = 'Codex';
    doc.payload.assetLibrary = { kind: 'central_asset_library', catalogScope: 'all_teachers',
      reviewStatus: 'approved', resourceId: item.id, version: doc.contentVersion,
      sourceSha256: item.provenance.sourceBookSha256,
      manifestSha256: sha(item.sourceBytes),
      copyrightEvidenceSha256: item.provenance.rightsEvidenceSha256,
      reviewId: sha(item.reviewBytes) };
    doc.sourceEvidence = { sourceBookSha256: item.provenance.sourceBookSha256,
      sourcePageNumbers: item.provenance.sourcePageNumbers,
      manifestSha256: sha(item.sourceBytes), reviewSha256: sha(item.reviewBytes) };
    doc.sourceRightsStatus = 'user_confirmed_cleared';
    doc.createdAt = now; doc.updatedAt = now; doc.status = 'published';
    doc.visibility = { type: 'organization' }; doc.allowedClassIds = [];
    doc.allowedStudentIds = []; doc.testOnly = false;
    if (!api.hasCompletePublicLearningMapping(doc)) throw new Error('CONTENT_MAPPING_GATE');
    return doc;
  });
  const auditRow = { _id: auditId, organizationId: 'org_qihang_demo',
    schemaVersion: 1, version: 1, deletedAt: null, requestId: auditId,
    actorUserId: 'controlled_import', actorRole: 'system',
    action: 'asset_library.publish_join_in_vocabulary', targetType: 'learning_resources',
    targetId: ids[0], result: 'succeeded', errorCode: null, occurredAt: now,
    metadata: { environment: envId, resourceIds: ids, wordCount: 238,
      audioCount: uploaded.length, reviewHashes: packages.map(item => sha(item.reviewBytes)) } };
  await documents.runTransaction(async tx => {
    for (const doc of resources) {
      if (await tx.get('learning_resources', doc._id)
        || !await tx.create('learning_resources', doc)) throw new Error('RESOURCE_CREATE_CONFLICT');
    }
    if (await tx.get('operation_logs', auditId)
      || !await tx.append('operation_logs', auditRow)) throw new Error('AUDIT_CONFLICT');
  });
  committed = true;
  const distribution = new api.LegacyGlobalDistributionService(documents,
    { nowIso: () => new Date().toISOString() });
  for (const id of ids) await distribution.migrate(id, organizations);
  await writeFile(join(output, 'cloudbase-nonproduction-receipt.json'),
    JSON.stringify({ environment: envId, nonproduction: true, resourceIds: ids,
      fileCount: uploaded.length, publishedAt: now, reviewHashes: packages.map(item => sha(item.reviewBytes)) },
    null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ mode, published: ids.length,
    files: uploaded.length, cloudAudioHashesVerified: uploaded.length }) + '\n');
} catch (error) {
  if (!committed && uploaded.length) {
    await app.deleteFile({ fileList: uploaded.map(row => row.fileID) });
    process.stderr.write(`ROLLED_BACK_FILES=${uploaded.length}\n`);
  }
  throw error;
}
