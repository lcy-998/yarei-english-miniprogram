/** Soft-supersede only the five English-title sources and their two-school projections. */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const mode = process.argv[2]
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID')
const root = resolve(import.meta.dirname, '..')
const asset = 'G:/英语资产/library/derived/reading-explorer-3e-foundations-u3a-exercises-20261016/v3'
const oldExports = 'G:/英语资产/exports/wechat/reading-explorer-3e-foundations-u3a-20261016-v2'
const planPath = resolve(asset, 'preflight/english-title-retirement-plan.json')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const require = createRequire(import.meta.url)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function cliData(args) {
  try {
    const raw = execFileSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const at = raw.indexOf('{')
    if (at < 0) throw new Error('NO_JSON')
    const parsed = JSON.parse(raw.slice(at))
    if (parsed.error) throw new Error('API_ERROR')
    return parsed.data
  } catch {
    throw new Error(`CLOUD_READ_FAILED_${args.slice(0, 2).join('_')}`)
  }
}
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'))
const envId = (await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
const envs = cliData(['env', 'list', '--json'])
if (!envId || envId !== config.envId || !Array.isArray(envs) || envs.length !== 1
  || envs[0].EnvId !== envId || envs[0].Status !== 'NORMAL'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no') throw new Error('ENVIRONMENT_GATE')
const secret = cliData(['secrets', 'get', '--json'])
if (secret?.isTemporary !== true || secret.envId !== envId
  || Date.parse(secret.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE')
const entry = resolve(root, '.runtime', 'reading-explorer-approved', `retire-${process.pid}.cjs`)
await build({ entryPoints: [resolve(root, 'src/seed/m3-public-question-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node20', logLevel: 'silent' })
const api = require(entry)
const app = require('@cloudbase/js-sdk').init({ env: envId, secretId: secret.secretId,
  secretKey: secret.secretKey, sessionToken: secret.token })
const db = api.createCloudBaseDocumentDatabase(app.database())
const old = []
for (let index = 1; index <= 5; index += 1) {
  const serial = String(index).padStart(2, '0')
  const sourceId = `res_question_re3e_foundations_u3a_q${serial}_v1`
  const replacementId = `res_question_re3e_foundations_u3a_q${serial}_v2`
  const sourceInput = JSON.parse(await readFile(resolve(oldExports, `${sourceId}.json`), 'utf8'))
  const source = await db.get('learning_resources', sourceId)
  const projectionId = api.publicQuestionProjectionId(sourceId, 'org_isolation_secondary')
  const projection = await db.get('learning_resources', projectionId)
  const replacement = await db.get('learning_resources', replacementId)
  const replacementProjection = await db.get('learning_resources',
    api.publicQuestionProjectionId(replacementId, 'org_isolation_secondary'))
  const origin = source?.payload?.assetLibrary
  if (!source || !projection || !replacement || !replacementProjection
    || source.organizationId !== 'org_qihang_demo'
    || projection.organizationId !== 'org_isolation_secondary'
    || source.type !== 'exercise' || projection.type !== 'exercise'
    || origin?.sourceSha256 !== sourceInput.sourceSha256
    || origin?.manifestSha256 !== sourceInput.manifestSha256
    || origin?.reviewStatus !== 'approved'
    || projection.payload?.assetLibrary?.sourcePublicId !== sourceId
    || replacement.status !== 'published' || replacementProjection.status !== 'published'
    || !replacement.title.startsWith('阅读探索者（Reading Explorer 3e 全球版样章）')) {
    throw new Error(`RETIRE_PRECHECK_FAILED_${sourceId}`)
  }
  old.push({ sourceId, projectionId, replacementId,
    sourceVersion: source.version, projectionVersion: projection.version,
    sourceStatus: source.status, projectionStatus: projection.status,
    sourceSha256: origin.sourceSha256, manifestSha256: origin.manifestSha256 })
}
let currentReferences = 0
for (let offset = 0; offset <= 10000; offset += 50) {
  const page = await db.findPage('tasks', {}, { limit: 50, offset })
  for (const task of page.items) if (task.visibility !== 'recycled'
    && task.status !== 'withdrawn' && task.deletedAt === null
    && old.some(row => task.itemRefs?.some(ref => ref.resourceId === row.sourceId || ref.resourceId === row.projectionId)
      || task.items?.some(item => item.resourceId === row.sourceId || item.resourceId === row.projectionId))) {
    currentReferences += 1
  }
  if (!page.hasMore) break
}
if (currentReferences !== 0) throw new Error('OLD_CONTENT_STILL_REFERENCED_BY_ACTIVE_TASK')
if (mode === 'inspect') {
  if (old.some(row => row.sourceStatus !== 'published' || row.projectionStatus !== 'published'
    || row.sourceVersion !== 1 || row.projectionVersion !== 1)) throw new Error('OLD_VERSION_CHANGED')
  await writeFile(planPath, JSON.stringify({ envId, old, currentReferences,
    expiresAt: new Date(Date.now() + 2 * 3600000).toISOString(),
    rollback: 'source and projection remain preserved with status offline and version 2' }, null, 2) + '\n',
  { flag: 'wx' })
  process.stdout.write(JSON.stringify({ mode, ready: true, oldPackCount: 1,
    sourceCount: old.length, projectionCount: old.length, currentReferences }) + '\n')
  process.exit(0)
}
const plan = JSON.parse(await readFile(planPath, 'utf8'))
const matchingIdentity = plan.old?.length === old.length && old.every((row, index) => {
  const prior = plan.old[index]
  return row.sourceId === prior.sourceId && row.projectionId === prior.projectionId
    && row.replacementId === prior.replacementId
    && row.sourceSha256 === prior.sourceSha256 && row.manifestSha256 === prior.manifestSha256
})
if (plan.envId !== envId || Date.parse(plan.expiresAt) <= Date.now()
  || !matchingIdentity || plan.currentReferences !== 0
  || mode === 'apply' && !same(plan.old, old)) throw new Error('RETIRE_PLAN_STALE')
if (mode === 'apply') {
  for (const row of old) {
    await db.runTransaction(async tx => {
      const source = await tx.get('learning_resources', row.sourceId)
      const projection = await tx.get('learning_resources', row.projectionId)
      if (source?.status !== 'published' || projection?.status !== 'published'
        || source.version !== 1 || projection.version !== 1) throw new Error('RETIRE_CONFLICT')
      const now = new Date().toISOString()
      for (const item of [source, projection]) {
        const nextId = item._id === row.sourceId ? row.replacementId
          : api.publicQuestionProjectionId(row.replacementId, 'org_isolation_secondary')
        const target = { ...item, status: 'offline', version: 2, updatedAt: now,
          supersededBy: nextId }
        if (!await tx.replace('learning_resources', item._id, 1, target)) throw new Error('RETIRE_WRITE_FAILED')
        const log = { _id: `re3e_english_title_superseded_${item._id}`,
          organizationId: item.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
          action: 'asset_library.question.superseded', targetType: 'learning_resource',
          targetId: item._id, actorUserId: 'codex_content_publisher', actorRole: 'system',
          result: 'succeeded', occurredAt: now, requestId: `re3e_english_title_superseded_${item._id}`,
          errorCode: null, metadata: { replacementId: nextId,
            reason: 'Chinese-searchable global-sample title; content unchanged' } }
        if (!await tx.append('operation_logs', log)) throw new Error('RETIRE_AUDIT_FAILED')
      }
    })
  }
}
for (const row of old) {
  for (const id of [row.sourceId, row.projectionId]) {
    const target = await db.get('learning_resources', id)
    const expectedReplacement = id === row.sourceId ? row.replacementId
      : api.publicQuestionProjectionId(row.replacementId, 'org_isolation_secondary')
    if (target?.status !== 'offline' || target.version !== 2
      || target.supersededBy !== expectedReplacement
      || !await db.get('operation_logs', `re3e_english_title_superseded_${id}`)) {
      throw new Error(`RETIRE_READBACK_FAILED_${id}`)
    }
  }
  const replacement = await db.get('learning_resources', row.replacementId)
  if (replacement?.status !== 'published') throw new Error('REPLACEMENT_NOT_PUBLISHED')
}
process.stdout.write(JSON.stringify({ mode, status: 'superseded_and_verified',
  oldSourceCount: old.length, oldProjectionCount: old.length, currentReferences }) + '\n')
process.exit(0)
