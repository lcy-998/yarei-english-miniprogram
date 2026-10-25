/** Offline plan; cloud apply/sync require a matching, explicit nonproduction review file. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, mkdir, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const [mode, value, reviewPath] = process.argv.slice(2)
if (!['plan', 'apply', 'sync-org', 'offline-source', 'offline-projection'].includes(mode) || !value
  || (mode !== 'plan' && !reviewPath)) {
  throw new Error('Usage: plan <package.json> | apply <package.json> <review.json> | sync-org <organizationId> <review.json> | offline-source <sourceId> <review.json> | offline-projection <projectionId> <review.json>')
}
const bundle = join(root, '.runtime', 'm3-public-learning', `entry-${process.pid}.cjs`)
await mkdir(dirname(bundle), { recursive: true })
await build({ entryPoints: [join(root, 'src', 'seed', 'm3-public-learning-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node20', logLevel: 'silent' })
const api = require(bundle)
const packageBytes = mode === 'sync-org' || mode.startsWith('offline-') ? null : await readFile(resolve(value))
const specification = packageBytes ? JSON.parse(packageBytes.toString('utf8')) : null
const inputSha256 = packageBytes ? digest(packageBytes) : null
const input = specification ? await verifiedInput(specification, resolve(value)) : null
const cloudAssets = specification ? cloudAssetIds(specification.resource) : []
if (input) api.buildVerifiedPublicLearningSource(input)
if (mode === 'plan') {
  process.stdout.write(JSON.stringify({ ready: true, sourceId: input.resource._id,
    sourceOrganizationId: input.resource.organizationId,
    inputSha256, manifestSha256: input.manifestSha256,
    copyrightEvidenceSha256: input.copyrightEvidenceSha256, cloudAssetCount: cloudAssets.length,
    operation: 'controlled_import_and_project_active_organizations' }) + '\n')
  process.exit(0)
}
const review = JSON.parse(await readFile(resolve(reviewPath), 'utf8'))
const expectedOperation = mode === 'apply' ? 'import_public_learning'
  : mode === 'sync-org' ? 'sync_public_learning_to_organization'
    : mode === 'offline-source' ? 'offline_public_learning_source' : 'offline_public_learning_projection'
if (review.authorizationScope !== 'm3_public_learning_nonproduction'
  || review.approved !== true || review.operation !== expectedOperation
  || typeof review.environmentId !== 'string'
  || !Number.isFinite(Date.parse(review.expiresAt)) || Date.parse(review.expiresAt) <= Date.now()
  || mode === 'apply' && (review.inputSha256 !== inputSha256
    || review.sourceId !== input.resource._id
    || review.sourceOrganizationId !== input.resource.organizationId
    || review.expectedCloudAssetCount !== cloudAssets.length
    || !Number.isSafeInteger(review.maxCloudAssetBytes) || review.maxCloudAssetBytes < 1
    || !Array.isArray(review.expectedOrganizationIds)
    || !review.expectedOrganizationIds.every(id => typeof id === 'string')
    || new Set(review.expectedOrganizationIds).size !== review.expectedOrganizationIds.length
    || review.rollback?.action !== 'offline_source_preserve_history'
    || review.rollback?.sourceId !== input.resource._id)
  || mode === 'sync-org' && (review.organizationId !== value
    || review.rollback?.action !== 'offline_projection_preserve_history'
    || review.rollback?.organizationId !== value
    || !Array.isArray(review.expectedSourceIds)
    || !review.expectedSourceIds.every(id => typeof id === 'string')
    || new Set(review.expectedSourceIds).size !== review.expectedSourceIds.length
    || !Number.isSafeInteger(review.maxProjectionCount) || review.maxProjectionCount < 0)
  || mode.startsWith('offline-') && (!/^[A-Za-z0-9_-]{1,128}$/.test(value)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(review.sourceId)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(review.organizationId)
    || mode === 'offline-source' && review.sourceId !== value
    || mode === 'offline-projection' && (review.organizationId === review.sourceOrganizationId
      || value !== api.publicLearningProjectionId(review.sourceId, review.organizationId))
    || !/^[a-f0-9]{64}$/i.test(review.sourceSha256)
    || !/^[a-f0-9]{64}$/i.test(review.manifestSha256)
    || !Number.isSafeInteger(review.expectedVersion) || review.expectedVersion < 1
    || typeof review.reason !== 'string' || !review.reason.trim() || review.reason.length > 200
    || !/^[A-Za-z0-9_-]{8,128}$/.test(review.operationId))) {
  throw new Error('REVIEW_SCOPE_MISMATCH')
}
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'))
const envText = await readFile(join(root, '.env.local'), 'utf8')
const environmentId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
if (!environmentId || config.envId !== environmentId || review.environmentId !== environmentId) {
  throw new Error('NONPRODUCTION_ENV_MISMATCH')
}
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE')
  return JSON.parse(raw.slice(start)).data
}
const environments = cliData(['env', 'list', '--json'])
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== environmentId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_COST_PREFLIGHT_FAILED')
}
const secrets = cliData(['secrets', 'get', '--json'])
if (secrets?.isTemporary !== true || secrets.envId !== environmentId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID')
}
const sdk = require('@cloudbase/js-sdk')
const app = sdk.init({ env: environmentId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token })
const database = api.createCloudBaseDocumentDatabase(app.database())
const service = new api.PublicLearningDistributionService(database,
  { nowIso: () => new Date().toISOString() })
if (mode === 'apply') {
  const owner = await database.get('organizations', input.resource.organizationId)
  if (!owner || owner._id !== input.resource.organizationId
    || owner.status !== 'active' || owner.deletedAt !== null) {
    throw new Error('SOURCE_ORGANIZATION_NOT_ACTIVE')
  }
  await verifyCloudAssets(app, cloudAssets, specification.cloudAssetSha256,
    review.maxCloudAssetBytes)
  const ids = await activeOrganizationIds(database)
  if (JSON.stringify(ids) !== JSON.stringify([...review.expectedOrganizationIds].sort())
    || ids.length > review.maxOrganizationCount
    || !Number.isSafeInteger(review.maxOrganizationCount) || review.maxOrganizationCount < 1) {
    throw new Error('ORGANIZATION_SCOPE_CHANGED')
  }
  const result = await service.importVerified(input, ids)
  process.stdout.write(JSON.stringify({ mode, result }) + '\n')
} else if (mode === 'sync-org') {
  const organization = await database.get('organizations', value)
  if (!organization || organization.status !== 'active' || organization.deletedAt !== null) {
    throw new Error('ORGANIZATION_NOT_ACTIVE')
  }
  const sourceIds = await activePublicLearningSourceIds(database)
  if (JSON.stringify(sourceIds) !== JSON.stringify([...review.expectedSourceIds].sort())
    || sourceIds.length > review.maxProjectionCount) {
    throw new Error('PUBLIC_SOURCE_SCOPE_CHANGED')
  }
  const projectedCount = await service.syncOrganization(value)
  process.stdout.write(JSON.stringify({ mode, organizationId: value, projectedCount }) + '\n')
} else {
  const result = await database.runTransaction(async tx => {
    const source = await tx.get('learning_resources', value)
    const payload = source?.payload && typeof source.payload === 'object' && !Array.isArray(source.payload)
      ? source.payload : null
    const origin = payload?.assetLibrary && typeof payload.assetLibrary === 'object'
      && !Array.isArray(payload.assetLibrary) ? payload.assetLibrary : null
    if (!source || source.organizationId !== review.organizationId
      || !['reading', 'vocabulary'].includes(String(source.type))
      || (mode === 'offline-source' ? source.publicCatalogSource !== true
        : source.publicLearningProjection !== true || origin?.sourcePublicId !== review.sourceId)
      || source.deletedAt !== null
      || origin?.sourceSha256 !== review.sourceSha256
      || origin?.manifestSha256 !== review.manifestSha256) throw new Error('ROLLBACK_SOURCE_MISMATCH')
    if (source.status === 'offline') return { sourceId: value, status: 'already_offline' }
    if (source.status !== 'published' || source.version !== review.expectedVersion) {
      throw new Error('ROLLBACK_VERSION_CONFLICT')
    }
    const next = { ...source, status: 'offline', version: source.version + 1,
      updatedAt: new Date().toISOString() }
    if (!await tx.replace('learning_resources', value, source.version, next)
      || !await tx.append('operation_logs', {
        _id: `public_learning_rollback_${review.operationId}`,
        organizationId: review.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
        action: mode === 'offline-source'
          ? 'asset_library.learning.public_source_offline'
          : 'asset_library.learning.public_projection_offline',
        targetType: 'learning_resource', targetId: value, actorUserId: 'controlled_rollback',
        actorRole: 'system', result: 'succeeded', occurredAt: new Date().toISOString(),
        metadata: { operationId: review.operationId, reason: review.reason.trim() },
      })) throw new Error('ROLLBACK_CONFLICT')
    return { sourceId: value, status: 'offline', version: next.version }
  })
  process.stdout.write(JSON.stringify({ mode, result }) + '\n')
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }
async function evidenceFile(assetRoot, filePath) {
  if (typeof filePath !== 'string' || !filePath || isAbsolute(filePath)) {
    throw new Error('EVIDENCE_PATH_INVALID')
  }
  const absolute = await realpath(resolve(assetRoot, filePath))
  const inside = relative(assetRoot, absolute)
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('EVIDENCE_PATH_OUTSIDE_ROOT')
  return readFile(absolute)
}
async function verifiedInput(specification, packagePath) {
  if (!specification || !/^[A-Za-z0-9_-]{1,128}$/.test(specification.resource?.organizationId)
    || typeof specification.assetRoot !== 'string'
    || !specification.evidence || typeof specification.evidence !== 'object') {
    throw new Error('PUBLIC_SOURCE_PACKAGE_INVALID')
  }
  const assetRoot = await realpath(resolve(dirname(packagePath), specification.assetRoot))
  const [manifestBytes, reviewBytes, sourceBytes, copyrightBytes, exportApprovalBytes] = await Promise.all([
    evidenceFile(assetRoot, specification.evidence.manifestPath),
    evidenceFile(assetRoot, specification.evidence.approvedContentPath),
    evidenceFile(assetRoot, specification.evidence.sourcePath),
    evidenceFile(assetRoot, specification.evidence.copyrightEvidencePath),
    evidenceFile(assetRoot, specification.evidence.publicExportApprovalPath),
  ])
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  const contentReview = JSON.parse(reviewBytes.toString('utf8'))
  const copyrightReview = JSON.parse(copyrightBytes.toString('utf8'))
  const exportApproval = JSON.parse(exportApprovalBytes.toString('utf8'))
  const resource = specification.resource
  const type = resource?.type
  const isReading = type === 'reading' && manifest.resourceType === 'textbook'
    && contentReview.reading && typeof contentReview.reading === 'object'
  const isVocabulary = type === 'vocabulary' && manifest.resourceType === 'supplement'
    && contentReview.contentType === 'vocabulary'
    && contentReview.vocabulary && typeof contentReview.vocabulary === 'object'
  const reviewed = isReading ? contentReview.reading : isVocabulary ? contentReview.vocabulary : null
  const sourceHash = digest(sourceBytes)
  const reviewHash = digest(reviewBytes)
  const copyrightHash = digest(copyrightBytes)
  const resourceHash = digest(JSON.stringify(resource))
  const cloudAssets = cloudAssetIds(resource)
  const hashes = specification.cloudAssetSha256
  if (manifest.resourceId !== resource?._id
    || manifest.processingStatus !== 'publish_ready'
    || !(isReading || isVocabulary)
    || manifest.title !== resource.title
    || manifest.sourceSha256?.toLowerCase() !== sourceHash
    || specification.sourceSha256?.toLowerCase() !== sourceHash
    || specification.manifestSha256?.toLowerCase() !== digest(manifestBytes)
    || contentReview.resourceId !== resource._id || contentReview.decision !== 'approved'
    || contentReview.copyrightStatus !== 'verified'
    || contentReview.sourceSha256?.toLowerCase() !== sourceHash
    || resource.contentVersion !== `${manifest.version}.${contentReview.reviewRevision}`
    || manifest.details?.reviewSha256?.toLowerCase() !== reviewHash
    || manifest.details?.reviewRevision !== contentReview.reviewRevision
    || specification.reviewId !== `review_${reviewHash.slice(0, 32)}`
    || specification.verifiedAt !== contentReview.reviewedAt
    || !reviewed || reviewed.grade !== resource.grade
    || isReading && (reviewed.category !== resource.category
      || reviewed.difficulty !== resource.difficulty)
    || isVocabulary && reviewed.unit !== resource.unit
    || copyrightReview.resourceId !== resource._id
    || copyrightReview.decision !== 'approved'
    || copyrightReview.scope !== 'all_schools_teaching'
    || copyrightReview.sourceSha256?.toLowerCase() !== sourceHash
    || specification.copyrightEvidenceId !== `copyright_${copyrightHash.slice(0, 32)}`
    || specification.copyrightEvidenceSha256?.toLowerCase() !== copyrightHash
    || specification.exportApprovalSha256?.toLowerCase() !== digest(exportApprovalBytes)
    || exportApproval.resourceId !== resource._id
    || exportApproval.decision !== 'approved'
    || exportApproval.scope !== 'all_schools_teaching'
    || exportApproval.reviewSha256?.toLowerCase() !== reviewHash
    || exportApproval.copyrightEvidenceSha256?.toLowerCase() !== copyrightHash
    || exportApproval.preparedResourceSha256?.toLowerCase() !== resourceHash) {
    throw new Error('SOURCE_CONTENT_OR_RIGHTS_PREFLIGHT_FAILED')
  }
  if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)
    || JSON.stringify(Object.keys(hashes).sort()) !== JSON.stringify(cloudAssets)
    || cloudAssets.some(id => !/^[a-f0-9]{64}$/i.test(hashes[id]))) {
    throw new Error('CLOUD_ASSET_HASH_LIST_INVALID')
  }
  const { evidence: ignoredEvidence, assetRoot: ignoredRoot,
    exportApprovalSha256: ignoredApproval, cloudAssetSha256: ignoredAssetHashes,
    ...input } = specification
  void ignoredEvidence
  void ignoredRoot
  void ignoredApproval
  void ignoredAssetHashes
  return input
}
async function activeOrganizationIds(database) {
  const ids = []
  let offset = 0
  while (offset <= 10000) {
    const page = await database.findPage('organizations',
      { status: 'active', deletedAt: null }, { limit: 50, offset })
    ids.push(...page.items.filter(row => row._id === row.organizationId).map(row => row._id))
    if (!page.hasMore) return ids.sort()
    offset += page.items.length
  }
  throw new Error('ORGANIZATION_LIST_TOO_LARGE')
}
async function activePublicLearningSourceIds(database) {
  const ids = []
  let offset = 0
  while (offset <= 10000) {
    const page = await database.findPage('learning_resources',
      { publicCatalogSource: true, type: 'exercise', status: 'published', deletedAt: null },
      { limit: 50, offset })
    ids.push(...page.items.filter(api.isVerifiedPublicLearningSource).map(row => row._id))
    if (!page.hasMore) return ids.sort()
    offset += page.items.length
  }
  throw new Error('PUBLIC_SOURCE_LIST_TOO_LARGE')
}
function cloudAssetIds(value) {
  const found = new Set()
  const visit = node => {
    if (typeof node === 'string' && node.startsWith('cloud://')) found.add(node)
    else if (Array.isArray(node)) node.forEach(visit)
    else if (node && typeof node === 'object') Object.values(node).forEach(visit)
  }
  visit(value)
  return [...found].sort()
}
async function verifyCloudAssets(app, assetIds, hashes, maxBytes) {
  let totalBytes = 0
  for (let offset = 0; offset < assetIds.length; offset += 20) {
    const batch = assetIds.slice(offset, offset + 20)
    const signed = await app.getTempFileURL({
      fileList: batch.map(fileID => ({ fileID, maxAge: 60 })),
    })
    for (const fileID of batch) {
      const item = signed.fileList?.find(candidate => candidate.fileID === fileID)
      if (!item?.tempFileURL?.startsWith('https://')
        || item.code !== undefined && item.code !== 'SUCCESS') {
        throw new Error('CLOUD_ASSET_SIGNING_FAILED')
      }
      const response = await fetch(item.tempFileURL, { redirect: 'error' })
      const declared = Number(response.headers.get('content-length'))
      if (!response.ok || !Number.isSafeInteger(declared) || declared < 1
        || totalBytes + declared > maxBytes) throw new Error('CLOUD_ASSET_SIZE_PREFLIGHT_FAILED')
      const bytes = Buffer.from(await response.arrayBuffer())
      totalBytes += bytes.length
      if (bytes.length !== declared || totalBytes > maxBytes
        || digest(bytes) !== hashes[fileID].toLowerCase()) throw new Error('CLOUD_ASSET_HASH_MISMATCH')
    }
  }
}
