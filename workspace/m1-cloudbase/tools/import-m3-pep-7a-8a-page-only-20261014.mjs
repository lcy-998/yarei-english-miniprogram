import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = 'G:/英语资产';
const output = join(assets, 'library/derived/pep-current-page-only-release-2026-10-14');
const envId = 'cloud1-d8ggzrwwedb786e41';
const orgs = ['org_isolation_secondary', 'org_qihang_demo'];
const ids = ['book-pep-7a-2022', 'book-pep-8a-2025'];
const auditId = 'audit_pep_7a_8a_page_only_20261014';
const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const require = createRequire(join(backend, 'package.json'));
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: backend,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLI_JSON_MISSING');
  const parsed = JSON.parse(raw.slice(first));
  if (parsed.error) throw new Error('CLI_API_REJECTED');
  return parsed.data;
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function one(value) { return Array.isArray(value?.data) ? value.data[0] ?? null
  : value?.data && typeof value.data === 'object' ? value.data : null; }
function materialize(value, fileIds) {
  if (Array.isArray(value)) return value.map(item => materialize(item, fileIds));
  if (value && typeof value === 'object') {
    if (typeof value.$assetKey === 'string') {
      const fileId = fileIds.get(value.$assetKey);
      if (!fileId) throw new Error('ASSET_REFERENCE_MISSING');
      return fileId;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item, fileIds)]));
  }
  return value;
}
const config = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
if (config.envId !== envId) throw new Error('ENVIRONMENT_CONFIG_MISMATCH');
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
  || Date.parse(temporary.expiredAt) < Date.now() + 60000) throw new Error('TEMPORARY_CREDENTIAL_INVALID');
const nodeSdk = require('@cloudbase/node-sdk');
const nodeApp = nodeSdk.init({ env: envId, secretId: temporary.secretId,
  secretKey: temporary.secretKey, sessionToken: temporary.token });
const native = nodeApp.database();
const db = {};
let totalBytes = 0;
for (const id of ids) {
  const dir = join(output, id);
  const plan = JSON.parse(await readFile(join(dir, 'release-plan.json'), 'utf8'));
  const template = JSON.parse(await readFile(join(dir, 'database-template.json'), 'utf8'));
  const rows = (await readFile(join(dir, 'storage-upload.jsonl'), 'utf8')).trim().split(/\r?\n/u)
    .filter(Boolean).map(line => JSON.parse(line));
  const document = template.document;
  if (plan.allowed !== true || plan.resourceId !== id || template.operation !== 'stage_reviewed_draft'
    || document.type !== 'reading' || document.status !== 'draft'
    || document.payload.audioMode !== 'page_only'
    || document.payload.audioAvailabilityNote !== '点读、跟读与示范音频暂未开放') {
    throw new Error(`PACKAGE_REVIEW_GATE_${id}`);
  }
  const existing = one(await native.collection('learning_resources').doc(id).get().catch(() => null));
  if (mode === 'apply' && existing) throw new Error(`RESOURCE_ID_COLLISION_${id}`);
  if (mode === 'verify' && (!existing || existing.status !== 'published')) throw new Error(`PUBLISHED_RESOURCE_MISSING_${id}`);
  const files = [];
  for (const row of rows) {
    const bytes = await readFile(resolve(assets, ...row.localRelativePath.split('/')));
    if (bytes.length !== row.bytes || sha(bytes) !== row.sha256.toLowerCase()) throw new Error(`LOCAL_HASH_MISMATCH_${id}`);
    totalBytes += bytes.length;
    files.push({ ...row, bytes });
  }
  db[id] = { dir, plan, template, files };
}
if (totalBytes !== 113105901 || totalBytes > 125 * 1024 * 1024) throw new Error('MEDIA_BUDGET_MISMATCH');
const organizations = await Promise.all(orgs.map(async id => one(
  await native.collection('organizations').doc(id).get().catch(() => null))));
if (organizations.some((row, index) => row?._id !== orgs[index] || row.status !== 'active'
  || row.deletedAt !== null)) throw new Error('ORGANIZATION_SCOPE_GATE');
const existingAudit = one(await native.collection('operation_logs').doc(auditId).get().catch(() => null));
if (mode === 'apply' && existingAudit) throw new Error('AUDIT_ID_COLLISION');
if (mode === 'verify' && existingAudit?.result !== 'succeeded') throw new Error('PUBLISHED_AUDIT_MISSING');

const buildPath = join(backend, '.runtime', 'pep-7a-8a-pageonly-20261014', 'entry.cjs');
await mkdir(dirname(buildPath), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-global-asset-audit-entry.ts')],
  outfile: buildPath, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(buildPath);
const documents = api.createCloudBaseDocumentDatabase(nodeApp.database());
async function verifyReaders() {
  const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(documents));
  const textbooks = new api.TeacherTextbookService(new api.DocumentTextbookRepository(documents),
    { nowIso: () => new Date().toISOString() });
  const result = [];
  for (const orgId of orgs) {
    const grants = native.collection('teacher_class_grants').where({ organizationId: orgId,
      status: 'active', deletedAt: null });
    const grantData = await grants.get();
    const grant = Array.isArray(grantData?.data) ? grantData.data[0] : null;
    if (!grant) throw new Error(`TEACHER_GRANT_MISSING_${orgId}`);
    const classIds = [...new Set(grantData.data.map(item => item.classId).filter(Boolean))];
    const teacher = { requestId: `pep_7a_8a_teacher_${orgId}`, sessionId: 'pep-7a-8a-readback',
      actorUserId: grant.teacherId, actorRole: 'teacher', organizationId: orgId,
      platformSubjectDigest: 'pep-7a-8a-readback', permissions: ['content.read', 'task.publish'],
      scopeIds: classIds, authzVersion: 1 };
    const teacherPage = await textbooks.listTextbooks(teacher, {}, { limit: 50, offset: 0 });
    const members = await native.collection('class_memberships').where({ organizationId: orgId,
      status: 'active', deletedAt: null }).get();
    const member = members.data?.[0];
    if (!member?.studentId || !member.classId) throw new Error(`STUDENT_MEMBER_MISSING_${orgId}`);
    const student = { requestId: `pep_7a_8a_student_${orgId}`, sessionId: 'pep-7a-8a-readback',
      actorUserId: member.studentId, actorRole: 'student', organizationId: orgId,
      platformSubjectDigest: 'pep-7a-8a-readback', permissions: ['content.read'],
      scopeIds: [member.classId], authzVersion: 1 };
    const studentCatalog = await content.listStudentCatalog(student,
      { type: 'reading', category: 'synchronized' }, { limit: 50, offset: 0 });
    for (const id of ids) {
      const expectedId = orgId === 'org_qihang_demo' ? id : api.legacyGlobalProjectionId(id, orgId);
      const book = teacherPage.items.find(item => item.id === expectedId);
      const item = studentCatalog.items.find(row => row.id === expectedId);
      if (!book || book.audioMode !== 'page_only'
        || book.audioAvailabilityNote !== '点读、跟读与示范音频暂未开放'
        || !item || item.audioPointreadReady !== false || item.pronunciationReady !== false) {
        throw new Error(`DIRECTORY_OR_DISCLOSURE_FAILED_${expectedId}`);
      }
      const detail = await content.getReadingResource(student, expectedId);
      const expectedPages = id === 'book-pep-7a-2022' ? 138 : 150;
      if (detail.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0) !== expectedPages) {
        throw new Error(`STUDENT_PAGE_COUNT_MISMATCH_${expectedId}`);
      }
    }
    result.push({ organizationId: orgId, teacherId: grant.teacherId,
      studentId: member.studentId, teacherBooks: 2, studentBooks: 2 });
  }
  return result;
}

if (mode === 'inspect') {
  const acl = cliData(['storage', 'rules', 'get', '--json']);
  if (acl?.acl !== 'PRIVATE' || acl.aclDesc !== 'Only creator and admin can read and write') {
    throw new Error('STORAGE_NOT_PRIVATE');
  }
  const summary = ids.map(id => ({ id, pages: db[id].template.document.pages.length, files: db[id].files.length,
    bytes: db[id].files.reduce((sum, file) => sum + file.bytes.length, 0) }));
  process.stdout.write(JSON.stringify({ mode, environment: envId, nonproduction: true,
    books: summary, totalBytes, storageUsage: storageUsage.Value, dbWriteUsage: dbUsage.Value,
    organizations: orgs, overrunBilling: false }) + '\n');
  process.exit(0);
}

if (mode === 'verify') {
  const receipt = JSON.parse(await readFile(join(output, 'cloudbase-nonproduction-receipt.json'), 'utf8'));
  if (receipt.environment !== envId || receipt.nonproduction !== true) throw new Error('RECEIPT_SCOPE_INVALID');
  process.stdout.write(JSON.stringify({ mode, published: receipt.resourceIds,
    filesReadback: receipt.uploadedHashesVerified, serviceReadback: await verifyReaders() }) + '\n');
  process.exit(0);
}

const fileIdsByBook = new Map();
const uploaded = [];
let committed = false;
try {
  for (const id of ids) {
    const objects = cliData(['storage', 'list', `yarei-assets/books/${id}/v1/`, '--json']);
    if (Array.isArray(objects) && objects.length) throw new Error(`STORAGE_PREFIX_NOT_EMPTY_${id}`);
  }
  for (const id of ids) {
    const mapping = new Map();
    for (const file of db[id].files) {
      const uploadedFile = await nodeApp.uploadFile({ cloudPath: file.cloudPath, fileContent: file.bytes });
      if (typeof uploadedFile?.fileID !== 'string' || !uploadedFile.fileID.startsWith('cloud://')) {
        throw new Error(`UPLOAD_RESPONSE_INVALID_${id}`);
      }
      mapping.set(file.assetKey, uploadedFile.fileID);
      uploaded.push({ fileID: uploadedFile.fileID, bytes: file.bytes.length,
        sha256: file.sha256, resourceId: id });
    }
    fileIdsByBook.set(id, mapping);
  }
  for (let offset = 0; offset < uploaded.length; offset += 8) {
    await Promise.all(uploaded.slice(offset, offset + 8).map(async file => {
      const result = await nodeApp.downloadFile({ fileID: file.fileID });
      const bytes = Buffer.from(result.fileContent);
      if (bytes.length !== file.bytes || sha(bytes) !== file.sha256.toLowerCase()) {
        throw new Error(`CLOUD_HASH_READBACK_MISMATCH_${file.resourceId}`);
      }
    }));
  }
  const now = new Date().toISOString();
  const resources = ids.map(id => {
    const resource = structuredClone(db[id].template.document);
    resource.createdAt = now; resource.updatedAt = now; resource.status = 'published';
    resource.visibility = { type: 'organization' }; resource.allowedClassIds = []; resource.allowedStudentIds = [];
    resource.payload = materialize(resource.payload, fileIdsByBook.get(id));
    return resource;
  });
  const audit = { _id: auditId, organizationId: 'org_qihang_demo', schemaVersion: 1,
    version: 1, deletedAt: null, requestId: auditId, actorUserId: 'controlled_import',
    actorRole: 'system', action: 'asset_library.publish_pep_7a_8a_page_only',
    targetType: 'learning_resources', targetId: resources[0]._id, result: 'succeeded',
    errorCode: null, occurredAt: now, metadata: { resourceIds: ids, fileCount: uploaded.length,
      totalBytes, environment: envId, publicationMode: 'page_only', audioUnavailable: true } };
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
  for (const id of ids) await distribution.migrate(id, orgs);
  const projections = await Promise.all(ids.map(id => documents.get('learning_resources',
    api.legacyGlobalProjectionId(id, 'org_isolation_secondary'))));
  if (projections.some(row => !row || row.globalCatalogProjection !== true
    || row.payload.audioMode !== 'page_only' || row.pages.length < 100)) {
    throw new Error('GLOBAL_PROJECTION_READBACK_FAILED');
  }
  const serviceReadback = await verifyReaders();
  await writeFile(join(output, 'cloudbase-nonproduction-receipt.json'), JSON.stringify({
    environment: envId, nonproduction: true, resourceIds: ids,
    globalProjectionIds: projections.map(row => row._id), fileCount: uploaded.length,
    totalBytes, uploadedHashesVerified: uploaded.length, publishedAt: now, serviceReadback,
    audioMode: 'page_only' }, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ mode, published: ids,
    globalProjections: projections.map(row => row._id), filesReadback: uploaded.length,
    totalBytes, serviceReadback, overrunBilling: false }) + '\n');
} catch (error) {
  if (!committed && uploaded.length) {
    try { await nodeApp.deleteFile({ fileList: uploaded.map(file => file.fileID) });
      process.stderr.write(`ROLLBACK_NEW_UPLOADS=${uploaded.length}\n`); }
    catch { process.stderr.write(`ROLLBACK_REQUIRES_MANUAL_REVIEW=${uploaded.length}\n`); }
  }
  throw error;
}
