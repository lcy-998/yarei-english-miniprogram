/** Approved teaching-content publication only. No function or account changes. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const mode = process.argv[2]
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID')
const root = resolve(import.meta.dirname, '..')
const asset = 'G:/英语资产/library/derived/timezones3e-level1-unit3-global-exercises-20261017/v1'
const exportsDir = 'G:/英语资产/exports/wechat/timezones3e-level1-unit3-global-20261017-v1'
const planPath = resolve(asset, 'preflight/approved-publication-plan.json')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const require = createRequire(import.meta.url)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function cliData(args) {
  try {
    const raw = execFileSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const at = raw.indexOf('{')
    if (at < 0) throw new Error('MISSING_JSON')
    const parsed = JSON.parse(raw.slice(at))
    if (parsed.error) throw new Error('API_REJECTED')
    return parsed.data
  } catch {
    throw new Error(`CLOUD_PREFLIGHT_FAILED_${args.slice(0, 3).join('_')}`)
  }
}

const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'))
const envId = (await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
const environments = cliData(['env', 'list', '--json'])
if (!envId || config.envId !== envId || !Array.isArray(environments)
  || environments.length !== 1 || environments[0].EnvId !== envId
  || environments[0].Status !== 'NORMAL' || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('ENVIRONMENT_OR_COST_GATE')
const quotas = {}
for (const metric of ['DbWritepkg', 'DbReadpkg', 'FunctionInvocation']) {
  const value = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
    '--body', JSON.stringify({ EnvId: envId, MetricName: metric }), '--json'])
  if (!Number.isFinite(value?.Value) || value.Value >= 190000) throw new Error(`QUOTA_GATE_${metric}`)
  quotas[metric] = value.Value
}
const secrets = cliData(['secrets', 'get', '--json'])
if (secrets?.isTemporary !== true || secrets.envId !== envId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE')
const bundle = resolve(root, '.runtime', 'tz3e-approved', `entry-${process.pid}.cjs`)
await mkdir(resolve(root, '.runtime', 'tz3e-approved'), { recursive: true })
await build({ entryPoints: [resolve(root, 'src/seed/m3-public-question-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node20', logLevel: 'silent' })
const api = require(bundle)
const sdk = require('@cloudbase/js-sdk')
const app = sdk.init({ env: envId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token })
const db = api.createCloudBaseDocumentDatabase(app.database())

const batch = JSON.parse(await readFile(resolve(asset, 'batch-manifest.json'), 'utf8'))
if (batch.packCount !== 1 || batch.packs?.[0]?.questionCount !== 5
  || batch.packs[0].resourceIds.length !== 5) throw new Error('PACK_SHAPE_CHANGED')
const ids = batch.packs[0].resourceIds
const expectedOrgs = ['org_isolation_secondary', 'org_qihang_demo']
const actualOrgs = []
for (let offset = 0; offset <= 100; offset += 50) {
  const page = await db.findPage('organizations', { status: 'active', deletedAt: null }, { limit: 50, offset })
  actualOrgs.push(...page.items.filter(row => row._id === row.organizationId).map(row => row._id))
  if (!page.hasMore) break
}
if (!same(actualOrgs.sort(), expectedOrgs)) throw new Error('ORGANIZATION_SCOPE_CHANGED')

const files = []
const sources = []
for (const id of ids) {
  const path = resolve(exportsDir, `${id}.json`)
  const bytes = await readFile(path)
  const item = JSON.parse(bytes.toString('utf8'))
  if (item.sourceId !== id || item.organizationId !== 'org_qihang_demo'
    || item.exercisePackId !== batch.packs[0].packId
    || item.contentVersion !== 1 || item.grade !== '七年级') throw new Error('PACKAGE_ID_OR_GRADE_CHANGED')
  const expected = JSON.parse(await readFile(resolve(asset, 'cloudbase-items', id, 'approved-content.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(resolve(asset, 'cloudbase-items', id, 'manifest.json'), 'utf8'))
  const rights = JSON.parse(await readFile(resolve(asset, 'cloudbase-items', id, 'copyright-evidence.json'), 'utf8'))
  if (expected.decision !== 'approved' || expected.reviewerId !== 'Codex'
    || expected.exercisePackId !== item.exercisePackId
    || manifest.processingStatus !== 'publish_ready'
    || rights.decision !== 'approved' || rights.scope !== 'all_schools_teaching'
    || !item.stem.includes('Time Zones')
    || item.correctAnswer === undefined || !item.options.includes(item.correctAnswer)) {
    throw new Error('CONTENT_OR_RIGHTS_GATE')
  }
  const { assetRoot: ignoredRoot, evidence: ignoredEvidence, ...input } = item
  void ignoredRoot
  void ignoredEvidence
  const source = api.buildVerifiedPublicQuestionSource(input)
  const origin = source.payload.assetLibrary
  const approved = { ...source, payload: { ...source.payload,
    assetLibrary: { ...origin, reviewStatus: 'approved', approvedBy: 'Codex',
      approvedAt: expected.reviewedAt, contentReviewSha256: sha(await readFile(resolve(asset, 'cloudbase-items', id, 'approved-content.json'))) } } }
  delete approved.payload.assetLibrary.verificationScope
  delete approved.payload.assetLibrary.automatedVerifier
  if (!api.isVerifiedPublicQuestionSource(approved)) throw new Error('APPROVED_SOURCE_REJECTED')
  files.push({ id, sha256: sha(bytes), reviewSha256: approved.payload.assetLibrary.contentReviewSha256 })
  sources.push(approved)
}
const projected = sources.map(source => api.projectPublicQuestionForOrganization(source, 'org_isolation_secondary'))
const targets = [...sources, ...projected]
const allIds = targets.map(row => row._id)
const auditIds = targets.map(row => `approved_tz3e_content_${row._id}`)

async function assertEmptyTargets() {
  for (const id of [...allIds, ...auditIds]) {
    const collection = id.startsWith('approved_tz3e_content_') ? 'operation_logs' : 'learning_resources'
    if (await db.get(collection, id)) throw new Error(`TARGET_NOT_EMPTY_${collection}`)
  }
}
if (mode === 'inspect') {
  await assertEmptyTargets()
  const receipt = { createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 2 * 3600000).toISOString(),
    envId, organizationIds: expectedOrgs, packId: batch.packs[0].packId,
    files, targetIds: allIds, auditIds, quotas,
    rollback: { action: 'offline_exact_new_sources_and_projections_preserve_history', targetIds: allIds } }
  await mkdir(resolve(asset, 'preflight'), { recursive: true })
  await writeFile(planPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  process.stdout.write(JSON.stringify({ mode, ready: true, count: sources.length,
    projectedCount: projected.length, envId, quota: quotas, planPath }) + '\n')
  process.exit(0)
}
const receipt = JSON.parse(await readFile(planPath, 'utf8'))
if (receipt.envId !== envId || Date.parse(receipt.expiresAt) <= Date.now()
  || !same(receipt.organizationIds, expectedOrgs) || receipt.packId !== batch.packs[0].packId
  || !same(receipt.files, files) || !same(receipt.targetIds, allIds)
  || !same(receipt.auditIds, auditIds)) throw new Error('PUBLISH_PLAN_STALE')
if (mode === 'apply') {
  await assertEmptyTargets()
  for (const [index, source] of sources.entries()) {
    const targetProjection = projected[index]
    const now = new Date().toISOString()
    await db.runTransaction(async tx => {
      if (await tx.get('learning_resources', source._id)
        || await tx.get('learning_resources', targetProjection._id)) throw new Error('TARGET_CHANGED')
      for (const target of [source, targetProjection]) {
        if (!await tx.create('learning_resources', target)) throw new Error('CONTENT_CREATE_FAILED')
        const audit = { _id: `approved_tz3e_content_${target._id}`,
          organizationId: target.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
          action: 'asset_library.question.approved_publish', targetType: 'learning_resource',
          targetId: target._id, actorUserId: 'codex_content_publisher', actorRole: 'system',
          result: 'succeeded', occurredAt: now, requestId: `approved_tz3e_content_${target._id}`,
          errorCode: null, metadata: { sourceId: source._id, sourceSha256: files[index].sha256,
            reviewSha256: files[index].reviewSha256, packId: batch.packs[0].packId } }
        if (!await tx.append('operation_logs', audit)) throw new Error('AUDIT_APPEND_FAILED')
      }
    })
  }
}
for (const [index, source] of sources.entries()) {
  const projection = projected[index]
  for (const expected of [source, projection]) {
    const actual = await db.get('learning_resources', expected._id)
    if (!actual || actual.status !== 'published' || actual.version !== 1
      || !same(actual.payload, expected.payload)
      || !await db.get('operation_logs', `approved_tz3e_content_${expected._id}`)) {
      throw new Error(`CONTENT_READBACK_MISMATCH_${expected._id}`)
    }
  }
  if (!await api.hasActivePublicQuestionSource(db, projection)) {
    throw new Error(`PROJECTION_SOURCE_LINK_FAILED_${projection._id}`)
  }
}
const catalog = new api.ContentQueryService(api.createOrgContentDocumentRepository(db))
const catalogReadback = {}
for (const organizationId of expectedOrgs) {
  const actor = { requestId: 'tz3e_content_audit', sessionId: 'tz3e_content_audit',
    actorUserId: 'tz3e_catalog_auditor', actorRole: 'teacher', organizationId,
    platformSubjectDigest: 'tz3e_catalog_auditor', permissions: ['content.read'],
    scopeIds: [], authzVersion: 1 }
  const found = new Set()
  let offset = 0
  for (let page = 0; page < 20; page += 1) {
    const result = await catalog.listSchoolQuestions(actor, {}, { limit: 50, offset })
    for (const item of result.items) {
      if (item.exercisePackId === batch.packs[0].packId
        && !('correctAnswer' in item) && !('explanation' in item)) found.add(item.id)
    }
    if (result.nextOffset === null) break
    offset = result.nextOffset
  }
  const expectedIds = organizationId === 'org_qihang_demo'
    ? ids : projected.map(row => row._id)
  if (!same([...found].sort(), [...expectedIds].sort())) {
    throw new Error(`CATALOG_READBACK_MISMATCH_${organizationId}`)
  }
  catalogReadback[organizationId] = found.size
}
process.stdout.write(JSON.stringify({ mode, status: 'published_and_verified',
  sourceCount: sources.length, projectionCount: projected.length,
  auditCount: auditIds.length, catalogReadback, sourceIds: ids, envId }) + '\n')
process.exit(0)
