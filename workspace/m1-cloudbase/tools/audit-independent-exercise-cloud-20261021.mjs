/** Read-only nonproduction inventory before legacy exercise soft retirement. */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const expectOffline = process.argv.includes('--expect-offline')
const planPath = resolve('G:/英语资产/reports/independent-exercise-legacy-offline-plan-2026-10-20.json')
const outputPath = resolve(expectOffline
  ? 'G:/英语资产/reports/independent-exercise-cloud-readback-2026-10-21.json'
  : 'G:/英语资产/reports/independent-exercise-cloud-preflight-2026-10-21.json')
const plan = JSON.parse(await readFile(planPath, 'utf8'))
if (plan.sourceCount !== 80 || plan.packCount !== 16 || plan.cloudWritesPerformed !== false) {
  throw new Error('LOCAL_PLAN_MISMATCH')
}
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'))
const envText = await readFile(join(root, '.env.local'), 'utf8')
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
if (envId !== 'cloud1-d8ggzrwwedb786e41' || config.envId !== envId) throw new Error('ENV_MISMATCH')
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
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_COST_PREFLIGHT_FAILED')
}
const secrets = cliData(['secrets', 'get', '--json'])
if (secrets?.isTemporary !== true || secrets.envId !== envId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMPORARY_CREDENTIALS_INVALID')
const bundle = join(root, '.runtime', 'm3-public-question', `audit-entry-${process.pid}.cjs`)
await mkdir(resolve(bundle, '..'), { recursive: true })
await build({ entryPoints: [join(root, 'src', 'seed', 'm3-public-question-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node20', logLevel: 'silent' })
const api = require(bundle)
const sdk = require('@cloudbase/js-sdk')
const app = sdk.init({ env: envId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token })
const db = api.createCloudBaseDocumentDatabase(app.database())

async function pages(collection, query) {
  const items = []
  for (let offset = 0; offset <= 10000;) {
    const page = await db.findPage(collection, query, { limit: 50, offset })
    items.push(...page.items)
    if (!page.hasMore) return items
    if (!page.items.length) throw new Error('EMPTY_PAGE_WITH_MORE')
    offset += page.items.length
  }
  throw new Error('COLLECTION_TOO_LARGE')
}
const organizations = (await pages('organizations', { status: 'active', deletedAt: null }))
  .filter(row => row._id === row.organizationId).map(row => row._id).sort()
if (JSON.stringify(organizations) !== JSON.stringify(['org_isolation_secondary', 'org_qihang_demo'])) {
  throw new Error('ORGANIZATION_SCOPE_CHANGED')
}
const rows = []
let auditLogMatches = 0, projectionNewReferenceRefusals = 0
for (let start = 0; start < plan.sources.length; start += 8) {
  const slice = plan.sources.slice(start, start + 8)
  const batch = await Promise.all(slice.map(async entry => {
    const source = await db.get('learning_resources', entry.sourceId)
    const projectionId = api.publicQuestionProjectionId(entry.sourceId, 'org_isolation_secondary')
    const projection = await db.get('learning_resources', projectionId)
    const origin = source?.payload?.assetLibrary
    const projectionOrigin = projection?.payload?.assetLibrary
    return { sourceId: entry.sourceId, packId: entry.exercisePackId,
      sourceStatus: source?.status ?? 'missing', sourceVersion: source?.version ?? null,
      sourceOrganizationId: source?.organizationId ?? null,
      sourceType: source?.type ?? null, sourcePublicMarker: source?.publicCatalogSource === true,
      sourceSha256Matches: origin?.sourceSha256 === entry.sourceSha256,
      manifestSha256Matches: origin?.manifestSha256 === entry.manifestSha256,
      projectionId, projectionStatus: projection?.status ?? 'missing',
      projectionVersion: projection?.version ?? null,
      projectionOrganizationId: projection?.organizationId ?? null,
      projectionLinkMatches: projectionOrigin?.sourcePublicId === entry.sourceId,
      projectionHashesMatch: projectionOrigin?.sourceSha256 === entry.sourceSha256
        && projectionOrigin?.manifestSha256 === entry.manifestSha256 }
  }))
  rows.push(...batch)
}
if (expectOffline) {
  for (let start = 0; start < rows.length; start += 8) {
    const batch = await Promise.all(rows.slice(start, start + 8).map(async row => {
      const review = JSON.parse(await readFile(resolve('G:/英语资产/reports/independent-exercise-offline-reviews-2026-10-21', `${row.sourceId}.json`), 'utf8'))
      const log = await db.get('operation_logs', `public_question_rollback_${review.operationId}`)
      const projection = await db.get('learning_resources', row.projectionId)
      const active = projection ? await api.hasActivePublicQuestionSource(db, projection) : false
      return { logMatches: log?.action === 'asset_library.question.public_source_offline'
        && log?.targetId === row.sourceId && log?.requestId === `public_question_rollback_${review.operationId}`
        && log?.result === 'succeeded', projectionRefused: !active }
    }))
    auditLogMatches += batch.filter(row => row.logMatches).length
    projectionNewReferenceRefusals += batch.filter(row => row.projectionRefused).length
  }
}
const unsafe = rows.filter(row => row.sourceStatus !== (expectOffline ? 'offline' : 'published')
  || (expectOffline && row.sourceVersion !== 2)
  || row.sourceOrganizationId !== 'org_qihang_demo' || row.sourceType !== 'exercise'
  || !row.sourcePublicMarker || !row.sourceSha256Matches || !row.manifestSha256Matches
  || row.projectionStatus !== 'published' || row.projectionOrganizationId !== 'org_isolation_secondary'
  || !row.projectionLinkMatches || !row.projectionHashesMatch)
const tasks = await pages('tasks', { deletedAt: null })
const targetIds = new Set([...rows.map(row => row.sourceId), ...rows.map(row => row.projectionId)])
let activeTaskReferences = 0, allTaskReferences = 0
for (const task of tasks) {
  const refs = Array.isArray(task.itemRefs) ? task.itemRefs : []
  for (const ref of refs) if (targetIds.has(ref?.resourceId)) {
    allTaskReferences += 1
    if (['active', 'scheduled'].includes(task.status)) activeTaskReferences += 1
  }
}
const result = { schemaVersion: 1, environmentId: envId,
  environmentClass: 'nonproduction_personal_free_no_overrun_no_charge',
  observedAt: new Date().toISOString(), cloudWritesPerformed: false,
  readbackAfterOffline: expectOffline,
  activeOrganizations: organizations, sourceCount: rows.length,
  publishedMatchedSourceCount: rows.length - unsafe.length,
  mismatchCount: unsafe.length, taskCountScanned: tasks.length,
  activeTaskReferences, allTaskReferences,
  ...(expectOffline ? { auditLogMatches, projectionNewReferenceRefusals } : {}), rows }
await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf8')
process.stdout.write(JSON.stringify({ environmentId: envId, sourceCount: rows.length,
  matched: rows.length - unsafe.length, mismatches: unsafe.length,
  taskCountScanned: tasks.length, activeTaskReferences, allTaskReferences,
  ...(expectOffline ? { auditLogMatches, projectionNewReferenceRefusals } : {}),
  report: outputPath }) + '\n')
if (unsafe.length || expectOffline && (auditLogMatches !== rows.length
  || projectionNewReferenceRefusals !== rows.length)) process.exitCode = 2
else process.exit(0)
