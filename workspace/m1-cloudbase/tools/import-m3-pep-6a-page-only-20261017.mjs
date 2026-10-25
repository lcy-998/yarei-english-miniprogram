import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(backend, '..', '..');
const assets = 'G:/英语资产';
const out = join(assets, 'library/derived/pep-6a-current-page-only-release-20261017');
const envExpected = 'cloud1-d8ggzrwwedb786e41';
const orgIds = ['org_isolation_secondary', 'org_qihang_demo'];
const bookIds = ['book-pep-6a-current-2024'];
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
  if (parsed.error) throw new Error('CLI_API_ERROR');
  return parsed.data;
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function rows(value) { return Array.isArray(value?.data) ? value.data : []; }
function dataOne(value) {
  if (Array.isArray(value?.data)) return value.data[0] ?? null;
  if (value?.data && typeof value.data === 'object') return value.data;
  return null;
}
function materialize(value, ids) {
  if (Array.isArray(value)) return value.map(item => materialize(item, ids));
  if (value && typeof value === 'object') {
    if (typeof value.$assetKey === 'string') {
      const fileID = ids.get(value.$assetKey);
      if (!fileID) throw new Error('ASSET_REFERENCE_MISSING');
      return fileID;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item, ids)]));
  }
  return value;
}

const config = JSON.parse(await readFile(join(backend, 'cloudbaserc.json'), 'utf8'));
if (config.envId !== envExpected) throw new Error('CONFIGURED_ENVIRONMENT_MISMATCH');
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envExpected || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_COST_GATE');
}
const storageUsage = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envExpected, MetricName: 'StorageSizepkg' }), '--json']);
const dbUsage = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envExpected, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(storageUsage.Value) || !Number.isFinite(dbUsage.Value)
  || dbUsage.Value > 190000) throw new Error('QUOTA_UNAVAILABLE_OR_NEAR_LIMIT');
const temporary = cliData(['secrets', 'get', '--json']);
if (temporary?.isTemporary !== true || temporary.envId !== envExpected
  || Date.parse(temporary.expiredAt) <= Date.now() + 60000) throw new Error('TEMPORARY_CREDENTIAL_INVALID');
const nodeCloudbase = require('@cloudbase/node-sdk');
const nodeApp = nodeCloudbase.init({ env: envExpected, secretId: temporary.secretId,
  secretKey: temporary.secretKey, sessionToken: temporary.token });
const database = nodeApp.database();

const packages = [];
let totalBytes = 0;
for (const id of bookIds) {
  const dir = join(out, id);
  const plan = JSON.parse(await readFile(join(dir, 'release-plan.json'), 'utf8'));
  const template = JSON.parse(await readFile(join(dir, 'database-template.json'), 'utf8'));
  const uploadRows = (await readFile(join(dir, 'storage-upload.jsonl'), 'utf8')).trim().split(/\r?\n/u)
    .filter(Boolean).map(line => JSON.parse(line));
  if (plan.allowed !== true || plan.resourceId !== id || plan.organizationId !== 'org_qihang_demo'
    || template.operation !== 'stage_reviewed_draft'
    || template.document.status !== 'draft' || template.document.type !== 'reading'
    || template.document.payload.audioMode !== 'page_only'
    || template.document.payload.audioAvailabilityNote !== '点读、跟读与示范音频暂未开放') {
    throw new Error(`PACKAGE_REVIEW_GATE_${id}`);
  }
  const files = [];
  for (const row of uploadRows) {
    const bytes = await readFile(resolve(assets, ...row.localRelativePath.split('/')));
    if (bytes.length !== row.bytes || digest(bytes) !== row.sha256.toLowerCase()) {
      throw new Error(`LOCAL_HASH_MISMATCH_${id}`);
    }
    totalBytes += bytes.length;
    files.push({ ...row, bytes });
  }
  const existing = await database.collection('learning_resources').doc(id).get().catch(() => null);
  const existingDoc = dataOne(existing);
  if (mode === 'inspect' && existingDoc) throw new Error(`RESOURCE_ID_ALREADY_EXISTS_${id}`);
  if (mode === 'apply' && existingDoc) throw new Error(`RESOURCE_ID_ALREADY_EXISTS_${id}`);
  packages.push({ id, dir, plan, template, files });
}
if (totalBytes !== 33516982 || totalBytes > 70 * 1024 * 1024) throw new Error('MEDIA_BUDGET_MISMATCH');
const organizations = await Promise.all(orgIds.map(async id => dataOne(
  await database.collection('organizations').doc(id).get().catch(() => null))));
if (organizations.some((row, index) => row?._id !== orgIds[index]
  || row.status !== 'active' || row.deletedAt !== null)) throw new Error('ORGANIZATION_SCOPE_GATE');

const bundlePath = join(backend, '.runtime', 'pep-page-only-20261014', 'entry.cjs');
await mkdir(dirname(bundlePath), { recursive: true });
await build({ entryPoints: [join(backend, 'src/seed/m3-global-asset-audit-entry.ts')],
  outfile: bundlePath, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(bundlePath);
const documents = api.createCloudBaseDocumentDatabase(nodeApp.database());

async function verifyReaders() {
  const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(documents));
  const textbooks = new api.TeacherTextbookService(new api.DocumentTextbookRepository(documents),
    { nowIso: () => new Date().toISOString() });
  const results = [];
  for (const orgId of orgIds) {
    const grantsResponse = await database.collection('teacher_class_grants')
      .where({ organizationId: orgId, status: 'active', deletedAt: null }).get();
    const grants = rows(grantsResponse);
    if (!grants.length) throw new Error(`TEACHER_GRANT_MISSING_${orgId}`);
    const grant = grants[0];
    const classIds = [...new Set(grants.map(row => row.classId).filter(Boolean))];
    const teacherActor = { requestId: `pep_page_only_teacher_${orgId}`,
      sessionId: 'pep-page-only-readback', actorUserId: grant.teacherId, actorRole: 'teacher',
      organizationId: orgId, platformSubjectDigest: 'pep-page-only-readback',
      permissions: ['content.read', 'task.publish'], scopeIds: classIds, authzVersion: 1 };
    const teacherPage = await textbooks.listTextbooks(teacherActor, {}, { limit: 50, offset: 0 });
    for (const id of bookIds) {
      const resourceId = orgId === 'org_qihang_demo' ? id : api.legacyGlobalProjectionId(id, orgId);
      const book = teacherPage.items.find(item => item.id === resourceId);
      if (!book) throw new Error(`TEACHER_DIRECTORY_MISSING_${resourceId}`);
      if (book.audioMode !== 'page_only'
        || book.audioAvailabilityNote !== '点读、跟读与示范音频暂未开放') {
        throw new Error(`TEACHER_AUDIO_DISCLOSURE_MISSING_${resourceId}`);
      }
    }
    const membershipResponse = await database.collection('class_memberships')
      .where({ organizationId: orgId, status: 'active', deletedAt: null }).get();
    const membership = rows(membershipResponse)[0];
    if (!membership?.studentId || !membership.classId) throw new Error(`STUDENT_MEMBER_MISSING_${orgId}`);
    const studentActor = { requestId: `pep_page_only_student_${orgId}`,
      sessionId: 'pep-page-only-readback', actorUserId: membership.studentId, actorRole: 'student',
      organizationId: orgId, platformSubjectDigest: 'pep-page-only-readback',
      permissions: ['content.read'], scopeIds: [membership.classId], authzVersion: 1 };
    const catalog = await content.listStudentCatalog(studentActor,
      { type: 'reading', category: 'synchronized' }, { limit: 50, offset: 0 });
    for (const id of bookIds) {
      const resourceId = orgId === 'org_qihang_demo' ? id : api.legacyGlobalProjectionId(id, orgId);
      const item = catalog.items.find(row => row.id === resourceId);
      if (!item || item.audioPointreadReady !== false || item.pronunciationReady !== false) {
        throw new Error(`STUDENT_CATALOG_OR_AUDIO_DISCLOSURE_INVALID_${resourceId}`);
      }
      const detail = await content.getReadingResource(studentActor, resourceId);
      if (detail.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0)
        !== 100) throw new Error(`STUDENT_PAGE_COUNT_MISMATCH_${resourceId}`);
    }
    results.push({ organizationId: orgId, teacherId: grant.teacherId,
      studentId: membership.studentId, teacherBooks: bookIds.length, studentBooks: bookIds.length });
  }
  return results;
}

if (mode === 'inspect') {
  const acl = cliData(['storage', 'rules', 'get', '--json']);
  if (acl?.acl !== 'PRIVATE' || acl.aclDesc !== 'Only creator and admin can read and write') {
    throw new Error('STORAGE_NOT_PRIVATE');
  }
  process.stdout.write(JSON.stringify({ mode, environment: envExpected, nonproduction: true,
    books: packages.map(item => ({ id: item.id, pageCount: item.template.document.pages.length,
      files: item.files.length })), totalBytes, storageUsage: storageUsage.Value,
    dbWriteUsage: dbUsage.Value, organizations: orgIds, existingResources: 0,
    overrunBilling: false }) + '\n');
  process.exit(0);
}

const fileIdsByBook = new Map();
const uploaded = [];
let committed = false;
try {
  if (mode === 'apply') {
    for (const item of packages) {
      const prefix = `yarei-assets/books/${item.id}/v1-r1/`;
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
        uploaded.push({ fileID: result.fileID, sha256: file.sha256, bytes: file.bytes.length, id: item.id });
        if ((index + 1) % 40 === 0) process.stdout.write(`UPLOAD_PROGRESS=${item.id}:${index + 1}/${item.files.length}\n`);
      }
      fileIdsByBook.set(item.id, ids);
    }
    for (let offset = 0; offset < uploaded.length; offset += 8) {
      await Promise.all(uploaded.slice(offset, offset + 8).map(async file => {
        const readback = await nodeApp.downloadFile({ fileID: file.fileID });
        const bytes = Buffer.from(readback.fileContent);
        if (bytes.length !== file.bytes || digest(bytes) !== file.sha256.toLowerCase()) {
          throw new Error(`CLOUD_HASH_READBACK_MISMATCH_${file.id}`);
        }
      }));
    }
    const now = new Date().toISOString();
    const resources = packages.map(item => {
      const document = structuredClone(item.template.document);
      document.createdAt = now;
      document.updatedAt = now;
      document.status = 'published';
      document.visibility = { type: 'organization' };
      document.allowedClassIds = [];
      document.allowedStudentIds = [];
      document.payload = materialize(document.payload, fileIdsByBook.get(item.id));
      document.chapters = document.payload.chapters;
      document.category = 'synchronized';
      document.publicationMode = 'page_only';
      return document;
    });
    const auditId = 'audit_pep_6a_current_page_only_20261017';
    const audit = { _id: auditId, organizationId: 'org_qihang_demo', schemaVersion: 1,
      version: 1, deletedAt: null, requestId: auditId, actorUserId: 'controlled_import',
      actorRole: 'system', action: 'asset_library.publish_pep_page_only_book',
      targetType: 'learning_resources', targetId: resources[0]._id, result: 'succeeded',
      errorCode: null, occurredAt: now, metadata: { resourceIds: resources.map(row => row._id),
        fileCount: uploaded.length, totalBytes, environment: envExpected,
        publicationMode: 'page_only', audioUnavailable: true } };
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
    for (const id of bookIds) await new api.LegacyGlobalDistributionService(documents,
      { nowIso: () => new Date().toISOString() }).migrate(id, orgIds);
    const finalBooks = await Promise.all(bookIds.map(id => documents.get('learning_resources', id)));
    const projections = await Promise.all(bookIds.map(id => documents.get('learning_resources',
      api.legacyGlobalProjectionId(id, 'org_isolation_secondary'))));
    if (finalBooks.some(row => !row || row.status !== 'published' || row.globalCatalogSource !== true)
      || projections.some(row => !row || row.globalCatalogProjection !== true
        || row.payload.audioMode !== 'page_only' || row.pages.length < 80)) {
      throw new Error('GLOBAL_PUBLICATION_READBACK_FAILED');
    }
    const serviceReadback = await verifyReaders();
    await writeFile(join(out, 'cloudbase-nonproduction-receipt.json'), JSON.stringify({
      environment: envExpected, nonproduction: true, resourceIds: bookIds,
      globalProjectionIds: projections.map(row => row._id), fileCount: uploaded.length,
      totalBytes, uploadedHashesVerified: uploaded.length, publishedAt: now,
      audioMode: 'page_only', serviceReadback }, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify({ mode, environment: envExpected, published: bookIds,
      globalProjections: projections.map(row => row._id), filesReadback: uploaded.length,
      totalBytes, overrunBilling: false }) + '\n');
  } else {
    const receipt = JSON.parse(await readFile(join(out, 'cloudbase-nonproduction-receipt.json'), 'utf8'));
    if (receipt.environment !== envExpected || receipt.nonproduction !== true) throw new Error('RECEIPT_SCOPE_INVALID');
    const serviceReadback = await verifyReaders();
    receipt.serviceReadback = serviceReadback;
    receipt.serviceVerifiedAt = new Date().toISOString();
    await writeFile(join(out, 'cloudbase-nonproduction-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ mode: 'verify', published: receipt.resourceIds,
      filesReadback: receipt.uploadedHashesVerified, globalProjections: receipt.globalProjectionIds,
      serviceReadback }) + '\n');
  }
} catch (error) {
  if (!committed && uploaded.length) {
    try { await nodeApp.deleteFile({ fileList: uploaded.map(item => item.fileID) });
      process.stderr.write(`ROLLBACK_NEW_UPLOADS=${uploaded.length}\n`); }
    catch { process.stderr.write(`ROLLBACK_REQUIRES_MANUAL_REVIEW=${uploaded.length}\n`); }
  }
  throw error;
}




