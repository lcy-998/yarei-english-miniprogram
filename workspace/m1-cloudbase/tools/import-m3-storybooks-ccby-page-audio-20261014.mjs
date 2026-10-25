import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = 'G:/英语资产';
const output = join(assets, 'library/derived/storybooks-ccby-page-audio-2026-10-14');
const envId = 'cloud1-d8ggzrwwedb786e41';
const organizations = ['org_isolation_secondary', 'org_qihang_demo'];
const sourceIds = ['book-sbc-en-0001', 'book-sbc-en-0141', 'book-sbc-en-0004',
  'book-973b4f5d78bc', 'book-c59bdd641b51', 'book-47c3a29d9223',
  'book-fede301c12da', 'book-dcf25517aea8', 'book-97d134956f31',
  'book-8841c1689c78', 'book-9b3e18882326'];
const auditId = 'audit_storybooks_ccby_audio_20261014';
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const require = createRequire(join(backend, 'package.json'));
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: backend,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error(`CLI_JSON_MISSING_${args.slice(0, 2).join('_')}`);
  const parsed = JSON.parse(raw.slice(first));
  if (parsed.error) throw new Error(`CLI_API_REJECTED_${args.slice(0, 2).join('_')}`);
  return parsed.data;
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function rows(value) { return Array.isArray(value?.data) ? value.data : []; }
function one(value) { return Array.isArray(value?.data) ? value.data[0] ?? null
  : value?.data && typeof value.data === 'object' ? value.data : null; }
function materialize(value, ids) {
  if (Array.isArray(value)) return value.map(item => materialize(item, ids));
  if (value && typeof value === 'object') {
    if (typeof value.$assetKey === 'string') {
      const fileId = ids.get(value.$assetKey);
      if (!fileId) throw new Error('ASSET_REFERENCE_MISSING');
      return fileId;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item, ids)]));
  }
  return value;
}

const config = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
if (config.envId !== envId) throw new Error('CONFIGURED_ENVIRONMENT_MISMATCH');
const envs = cliData(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_COST_GATE');
}
const storageUsage = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'StorageSizepkg' }), '--json']);
const dbUsage = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(storageUsage?.Value) || !Number.isFinite(dbUsage?.Value) || dbUsage.Value > 190000) {
  throw new Error('QUOTA_UNAVAILABLE_OR_NEAR_LIMIT');
}
const temporary = cliData(['secrets', 'get', '--json']);
if (temporary?.isTemporary !== true || temporary.envId !== envId
  || Date.parse(temporary.expiredAt) <= Date.now() + 60000) throw new Error('TEMPORARY_CREDENTIAL_INVALID');
const cloudbase = require('@cloudbase/node-sdk');
const nodeApp = cloudbase.init({ env: envId, secretId: temporary.secretId,
  secretKey: temporary.secretKey, sessionToken: temporary.token });
const database = nodeApp.database();

const packages = [];
let totalBytes = 0;
for (const id of sourceIds) {
  const dir = join(output, id);
  const plan = JSON.parse(await readFile(join(dir, 'release-plan.json'), 'utf8'));
  const template = JSON.parse(await readFile(join(dir, 'database-template.json'), 'utf8'));
  const files = (await readFile(join(dir, 'storage-upload.jsonl'), 'utf8')).trim().split(/\r?\n/u)
    .filter(Boolean).map(line => JSON.parse(line));
  const doc = template.document;
  if (plan.allowed !== true || plan.resourceId !== id || template.operation !== 'stage_reviewed_draft'
    || doc.type !== 'reading' || doc.status !== 'draft' || doc.copyrightStatus !== 'verified'
    || doc.payload.category !== 'picture_book' || !doc.payload.readingAudio
    || !doc.payload.pronunciation || doc.pages.length < 7) throw new Error(`PACKAGE_REVIEW_GATE_${id}`);
  const local = [];
  for (const row of files) {
    const bytes = await readFile(resolve(assets, ...row.localRelativePath.split('/')));
    if (bytes.length !== row.bytes || sha(bytes) !== row.sha256.toLowerCase()) {
      throw new Error(`LOCAL_HASH_MISMATCH_${id}`);
    }
    totalBytes += bytes.length;
    local.push({ ...row, bytes });
  }
  const existing = one(await database.collection('learning_resources').doc(id).get().catch(() => null));
  if (mode === 'apply' && existing) throw new Error(`RESOURCE_ID_COLLISION_${id}`);
  if (mode === 'verify' && (!existing || existing.status !== 'published')) {
    throw new Error(`PUBLISHED_RESOURCE_MISSING_${id}`);
  }
  packages.push({ id, dir, plan, template, files: local });
}
if (totalBytes > 120 * 1024 * 1024) throw new Error('MEDIA_BUDGET_EXCEEDED');
const activeOrganizations = await Promise.all(organizations.map(async id => one(
  await database.collection('organizations').doc(id).get().catch(() => null))));
if (activeOrganizations.some((row, index) => row?._id !== organizations[index]
  || row.status !== 'active' || row.deletedAt !== null)) throw new Error('ORGANIZATION_SCOPE_GATE');
const priorAudit = one(await database.collection('operation_logs').doc(auditId).get().catch(() => null));
if (mode === 'apply' && priorAudit) throw new Error('AUDIT_ID_COLLISION');
if (mode === 'verify' && (!priorAudit || priorAudit.result !== 'succeeded')) throw new Error('PUBLISHED_AUDIT_MISSING');

if (mode === 'inspect') {
  const acl = cliData(['storage', 'rules', 'get', '--json']);
  if (acl?.acl !== 'PRIVATE' || acl.aclDesc !== 'Only creator and admin can read and write') {
    throw new Error('STORAGE_NOT_PRIVATE');
  }
  const summaries = packages.map(item => ({ id: item.id, pages: item.template.document.pages.length,
    contentPages: item.template.document.payload.pronunciation.segments.length, files: item.files.length,
    bytes: item.files.reduce((sum, row) => sum + row.bytes.length, 0) }));
  process.stdout.write(JSON.stringify({ mode, environment: envId, nonproduction: true,
    books: summaries, totalBytes, storageUsage: storageUsage.Value, dbWriteUsage: dbUsage.Value,
    organizations, existingResources: 0, overrunBilling: false }) + '\n');
  process.exit(0);
}

const requireBundle = createRequire(join(backend, 'package.json'));
const bundlePath = join(backend, '.runtime', 'storybook-ccby-20261014', 'entry.cjs');
await mkdir(dirname(bundlePath), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-global-asset-audit-entry.ts')],
  outfile: bundlePath, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = requireBundle(bundlePath);
const documents = api.createCloudBaseDocumentDatabase(nodeApp.database());

async function verifyReaders() {
  const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(documents));
  const results = [];
  for (const orgId of organizations) {
    const grants = rows(await database.collection('teacher_class_grants')
      .where({ organizationId: orgId, status: 'active', deletedAt: null }).get());
    if (!grants.length) throw new Error(`TEACHER_GRANT_MISSING_${orgId}`);
    const grant = grants[0];
    const scopeIds = [...new Set(grants.map(row => row.classId).filter(Boolean))];
    const teacher = { requestId: `sbc_ccby_teacher_${orgId}`, sessionId: 'sbc-ccby-readback',
      actorUserId: grant.teacherId, actorRole: 'teacher', organizationId: orgId,
      platformSubjectDigest: 'sbc-ccby-readback', permissions: ['content.read', 'task.publish'],
      scopeIds, authzVersion: 1 };
    const taskCatalog = await content.listTaskCatalogResources(teacher,
      { type: 'reading', category: 'picture_book' }, { limit: 50, offset: 0 });
    const members = rows(await database.collection('class_memberships')
      .where({ organizationId: orgId, status: 'active', deletedAt: null }).get());
    const member = members[0];
    if (!member?.studentId || !member.classId) throw new Error(`STUDENT_MEMBER_MISSING_${orgId}`);
    const student = { requestId: `sbc_ccby_student_${orgId}`, sessionId: 'sbc-ccby-readback',
      actorUserId: member.studentId, actorRole: 'student', organizationId: orgId,
      platformSubjectDigest: 'sbc-ccby-readback', permissions: ['content.read'],
      scopeIds: [member.classId], authzVersion: 1 };
    const studentCatalog = await content.listStudentCatalog(student,
      { type: 'reading', category: 'picture_book' }, { limit: 50, offset: 0 });
    for (const item of packages) {
      const resourceId = orgId === 'org_qihang_demo' ? item.id : api.legacyGlobalProjectionId(item.id, orgId);
      const teacherItem = taskCatalog.items.find(row => row.id === resourceId);
      const studentItem = studentCatalog.items.find(row => row.id === resourceId);
      if (!teacherItem || !studentItem || studentItem.audioPointreadReady !== true
        || studentItem.pronunciationReady !== true) throw new Error(`CATALOG_READBACK_FAILED_${resourceId}`);
      const detail = await content.getReadingResource(student, resourceId);
      const pageCount = item.template.document.pages.length;
      if (detail.chapters.reduce((count, chapter) => count + chapter.pages.length, 0) !== pageCount) {
        throw new Error(`STUDENT_PAGE_COUNT_MISMATCH_${resourceId}`);
      }
      const chapter = detail.chapters[0];
      const audioMap = await content.getReadingAudioMap(student, resourceId, chapter.id);
      const pronunciation = await content.getReadingPronunciationSegments(student, resourceId);
      const contentPageCount = pageCount - 2;
      if (audioMap.segments.length !== contentPageCount
        || pronunciation.segments.length !== contentPageCount
        || audioMap.segments.some(segment => !segment.clipAudioAssetKey?.startsWith('cloud://'))
        || pronunciation.segments.some(segment => !segment.demonstrationAudioAssetKey.startsWith('cloud://'))) {
        throw new Error(`PAGE_AUDIO_FOLLOWREAD_READBACK_FAILED_${resourceId}`);
      }
    }
    results.push({ organizationId: orgId, teacherId: grant.teacherId,
      studentId: member.studentId, teacherBooks: packages.length, studentBooks: packages.length });
  }
  return results;
}

if (mode === 'verify') {
  const receipt = JSON.parse(await readFile(join(output, 'cloudbase-nonproduction-receipt.json'), 'utf8'));
  if (receipt.environment !== envId || receipt.nonproduction !== true) throw new Error('RECEIPT_SCOPE_INVALID');
  process.stdout.write(JSON.stringify({ mode, published: receipt.resourceIds,
    filesReadback: receipt.uploadedHashesVerified, serviceReadback: await verifyReaders() }) + '\n');
  process.exit(0);
}

const idsByBook = new Map();
const uploaded = [];
let committed = false;
try {
  for (const item of packages) {
    const prefix = `yarei-assets/books/${item.id}/v1/`;
    const existing = cliData(['storage', 'list', prefix, '--json']);
    if (Array.isArray(existing) && existing.length) throw new Error(`STORAGE_PREFIX_NOT_EMPTY_${item.id}`);
  }
  for (const item of packages) {
    const ids = new Map();
    for (const [index, file] of item.files.entries()) {
      const result = await nodeApp.uploadFile({ cloudPath: file.cloudPath, fileContent: file.bytes });
      if (typeof result?.fileID !== 'string' || !result.fileID.startsWith('cloud://')) {
        throw new Error(`UPLOAD_RESPONSE_INVALID_${item.id}`);
      }
      ids.set(file.assetKey, result.fileID);
      uploaded.push({ fileID: result.fileID, sha256: file.sha256,
        bytes: file.bytes.length, resourceId: item.id });
      if ((index + 1) % 40 === 0) process.stdout.write(`UPLOAD_PROGRESS=${item.id}:${index + 1}/${item.files.length}\n`);
    }
    idsByBook.set(item.id, ids);
  }
  for (let offset = 0; offset < uploaded.length; offset += 8) {
    await Promise.all(uploaded.slice(offset, offset + 8).map(async file => {
      const data = await nodeApp.downloadFile({ fileID: file.fileID });
      const bytes = Buffer.from(data.fileContent);
      if (bytes.length !== file.bytes || sha(bytes) !== file.sha256.toLowerCase()) {
        throw new Error(`CLOUD_HASH_READBACK_MISMATCH_${file.resourceId}`);
      }
    }));
  }
  const now = new Date().toISOString();
  const resources = packages.map(item => {
    const doc = structuredClone(item.template.document);
    doc.createdAt = now; doc.updatedAt = now; doc.status = 'published';
    doc.visibility = { type: 'organization' }; doc.allowedClassIds = []; doc.allowedStudentIds = [];
    doc.payload = materialize(doc.payload, idsByBook.get(item.id));
    return doc;
  });
  const audit = { _id: auditId, organizationId: 'org_qihang_demo', schemaVersion: 1,
    version: 1, deletedAt: null, requestId: auditId, actorUserId: 'controlled_import',
    actorRole: 'system', action: 'asset_library.publish_storybooks_ccby_page_audio',
    targetType: 'learning_resources', targetId: resources[0]._id, result: 'succeeded',
    errorCode: null, occurredAt: now, metadata: { resourceIds: resources.map(row => row._id),
      fileCount: uploaded.length, totalBytes, environment: envId,
      licenses: ['CC BY 3.0', 'CC BY 4.0'], mappings: 'one reviewed paragraph and source page audio clip per story page' } };
  await documents.runTransaction(async tx => {
    for (const resource of resources) {
      if (await tx.get('learning_resources', resource._id)
        || !await tx.create('learning_resources', resource)) throw new Error('RESOURCE_CREATE_CONFLICT');
    }
    if (await tx.get('operation_logs', auditId) || !await tx.append('operation_logs', audit)) {
      throw new Error('AUDIT_CREATE_CONFLICT');
    }
  });
  committed = true;
  const distribution = new api.LegacyGlobalDistributionService(documents,
    { nowIso: () => new Date().toISOString() });
  for (const id of sourceIds) await distribution.migrate(id, organizations);
  const projections = await Promise.all(sourceIds.map(id => documents.get('learning_resources',
    api.legacyGlobalProjectionId(id, 'org_isolation_secondary'))));
  if (projections.some(row => !row || row.globalCatalogProjection !== true
    || row.status !== 'published' || !row.payload.readingAudio || !row.payload.pronunciation)) {
    throw new Error('GLOBAL_PROJECTION_READBACK_FAILED');
  }
  const serviceReadback = await verifyReaders();
  await writeFile(join(output, 'cloudbase-nonproduction-receipt.json'), JSON.stringify({
    environment: envId, nonproduction: true, resourceIds: sourceIds,
    globalProjectionIds: projections.map(row => row._id), fileCount: uploaded.length,
    totalBytes, uploadedHashesVerified: uploaded.length, publishedAt: now,
    serviceReadback }, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ mode, published: sourceIds,
    globalProjections: projections.map(row => row._id), filesReadback: uploaded.length,
    totalBytes, serviceReadback, overrunBilling: false }) + '\n');
} catch (error) {
  if (!committed && uploaded.length) {
    try { await nodeApp.deleteFile({ fileList: uploaded.map(item => item.fileID) });
      process.stderr.write(`ROLLBACK_NEW_UPLOADS=${uploaded.length}\n`); }
    catch { process.stderr.write(`ROLLBACK_REQUIRES_MANUAL_REVIEW=${uploaded.length}\n`); }
  }
  throw error;
}
