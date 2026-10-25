/** Soft-offline the isolated virtual-class validation pack; preserve test history. */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')
const stage = JSON.parse(await readFile(resolve('G:/英语资产/reports/independent-exercise-hierarchy-test-stage-2026-10-21.json'), 'utf8'))
const loop = JSON.parse(await readFile(resolve('G:/英语资产/reports/independent-exercise-hierarchy-cloud-loop-2026-10-21.json'), 'utf8'))
const envId = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'))
if (envId !== 'cloud1-d8ggzrwwedb786e41' || config.envId !== envId
  || stage.environmentId !== envId || loop.result !== 'passed'
  || loop.testPackId !== stage.testPackId || loop.cleanup !== 'task_soft_recycled'
  || stage.resourceIds.length !== 5) throw new Error('TEST_CLEANUP_SCOPE_MISMATCH')
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('CLI_JSON_MISSING')
  const payload = JSON.parse(raw.slice(start))
  if (payload.error) throw new Error('CLI_REJECTED')
  return payload.data
}
const envs = cliData(['env', 'list', '--json'])
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].EnableOverrun !== false
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') throw new Error('ENVIRONMENT_OR_COST_CHANGED')
const secrets = cliData(['secrets', 'get', '--json'])
if (secrets?.isTemporary !== true || secrets.envId !== envId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIALS_INVALID')
const bundle = join(root, '.runtime', 'm3-public-question', `hierarchy-retire-${process.pid}.cjs`)
await mkdir(resolve(bundle, '..'), { recursive: true })
await build({ entryPoints: [join(root, 'src', 'seed', 'm3-public-question-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node20', logLevel: 'silent' })
const api = require(bundle), sdk = require('@cloudbase/js-sdk')
const app = sdk.init({ env: envId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token })
const db = api.createCloudBaseDocumentDatabase(app.database())
const resources = await Promise.all(stage.resourceIds.map(id => db.get('learning_resources', id)))
if (resources.some((row, index) => !row || row._id !== stage.resourceIds[index]
  || row.organizationId !== 'org_qihang_demo' || row.status !== 'published'
  || row.version !== 1 || row.testOnly !== true
  || row.payload?.assetLibrary?.exercisePackId !== stage.testPackId)) {
  throw new Error('TEST_RESOURCE_STATE_CHANGED')
}
const tasks = []
for (let offset = 0; offset <= 10000;) {
  const page = await db.findPage('tasks', { deletedAt: null }, { limit: 50, offset })
  tasks.push(...page.items)
  if (!page.hasMore) break
  if (!page.items.length) throw new Error('TASK_PAGE_EMPTY')
  offset += page.items.length
}
const ids = new Set(stage.resourceIds)
const active = tasks.filter(task => task.visibility !== 'recycled'
  && ['active', 'scheduled'].includes(task.status)
  && Array.isArray(task.itemRefs) && task.itemRefs.some(ref => ids.has(ref?.resourceId)))
if (active.length) throw new Error(`TEST_PACK_STILL_REFERENCED_BY_ACTIVE_TASK_${active.map(task =>
  `${task._id}:${task.status}`).join(',')}`)
const now = new Date().toISOString(), logId = `exercise_hierarchy_test_offline_${stage.testPackId}`
await db.runTransaction(async tx => {
  for (const source of resources) {
    const fresh = await tx.get('learning_resources', source._id)
    if (!fresh || fresh.version !== 1 || fresh.status !== 'published') throw new Error('TEST_VERSION_CHANGED')
    if (!await tx.replace('learning_resources', fresh._id, 1,
      { ...fresh, status: 'offline', version: 2, updatedAt: now })) {
      throw new Error('TEST_RESOURCE_OFFLINE_FAILED')
    }
  }
  if (!await tx.append('operation_logs', { _id: logId, requestId: logId,
    organizationId: 'org_qihang_demo', schemaVersion: 1, version: 1, deletedAt: null,
    action: 'asset_library.question.hierarchy_test_offline', targetType: 'learning_resource_pack',
    targetId: stage.testPackId, actorUserId: 'controlled_test', actorRole: 'system',
    result: 'succeeded', errorCode: null, occurredAt: now,
    metadata: { resourceIds: stage.resourceIds } })) throw new Error('TEST_CLEANUP_AUDIT_FAILED')
})
const readback = await Promise.all(stage.resourceIds.map(id => db.get('learning_resources', id)))
const log = await db.get('operation_logs', logId)
if (readback.some(row => row?.status !== 'offline' || row?.version !== 2)
  || log?.result !== 'succeeded') throw new Error('TEST_CLEANUP_READBACK_FAILED')
const reportPath = resolve('G:/英语资产/reports/independent-exercise-hierarchy-test-cleanup-2026-10-21.json')
await writeFile(reportPath, JSON.stringify({ environmentId: envId,
  testPackId: stage.testPackId, resourceCount: 5, offlineReadbackCount: 5,
  historicalTaskCount: tasks.filter(task => Array.isArray(task.itemRefs)
    && task.itemRefs.some(ref => ids.has(ref?.resourceId))).length,
  activeTaskCount: 0, auditLogId: logId, completedAt: new Date().toISOString(),
  historyPreserved: true }, null, 2) + '\n', 'utf8')
process.stdout.write(JSON.stringify({ status: 'offline_verified', resourceCount: 5,
  activeTaskCount: 0, auditLogId: logId, report: reportPath }) + '\n')
process.exit(0)
