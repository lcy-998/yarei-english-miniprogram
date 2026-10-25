/** Read-only source/projection target and cost preflight for the 90 v5 originals. */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')
const index = JSON.parse(await readFile(resolve('G:/英语资产/library/derived/independent-exercises-20261020/v5/staging/staging-index.json'), 'utf8'))
const plan = JSON.parse(await readFile(resolve('G:/英语资产/reports/independent-exercise-v5-plan-2026-10-21.json'), 'utf8'))
const envId = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'))
if (envId !== 'cloud1-d8ggzrwwedb786e41' || config.envId !== envId
  || index.resourceCount !== 90 || plan.itemCount !== 90 || plan.packCount !== 18) {
  throw new Error('V5_TARGET_SCOPE_MISMATCH')
}
function data(args) {
  try {
    const raw = execFileSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    const begin = raw.indexOf('{')
    if (begin < 0) throw new Error('JSON_MISSING')
    const value = JSON.parse(raw.slice(begin))
    if (value.error) throw new Error('CLOUD_REJECTED')
    return value.data
  } catch { throw new Error(`READ_ONLY_CLI_FAILED_${args[0]}_${args[1]}`) }
}
const envs = data(['env', 'list', '--json'])
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no') throw new Error('ENVIRONMENT_OR_COST_CHANGED')
const quotas = {}
for (const metric of ['DbWritepkg', 'DbReadpkg', 'FunctionInvocation']) {
  quotas[metric] = data(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
    '--body', JSON.stringify({ EnvId: envId, MetricName: metric }), '--json'])?.Value
  if (!Number.isFinite(quotas[metric]) || quotas[metric] > 190000) throw new Error(`QUOTA_GATE_${metric}`)
}
const secrets = data(['secrets', 'get', '--json'])
if (secrets?.isTemporary !== true || secrets.envId !== envId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIALS_INVALID')
const bundle = join(root, '.runtime', 'm3-public-question', `v5-targets-${process.pid}.cjs`)
await mkdir(resolve(bundle, '..'), { recursive: true })
await build({ entryPoints: [join(root, 'src', 'seed', 'm3-public-question-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node20', logLevel: 'silent' })
const api = require(bundle), sdk = require('@cloudbase/js-sdk')
const app = sdk.init({ env: envId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token })
const db = api.createCloudBaseDocumentDatabase(app.database())
const organizations = (await db.findPage('organizations', { status: 'active', deletedAt: null },
  { limit: 50, offset: 0 })).items.filter(row => row._id === row.organizationId).map(row => row._id).sort()
if (JSON.stringify(organizations) !== JSON.stringify(['org_isolation_secondary', 'org_qihang_demo'])) {
  throw new Error('ORGANIZATION_SCOPE_CHANGED')
}
const conflicts = []
for (let start = 0; start < index.resources.length; start += 8) {
  const batch = await Promise.all(index.resources.slice(start, start + 8).map(async row => {
    const source = await db.get('learning_resources', row.resourceId)
    const projectionId = api.publicQuestionProjectionId(row.resourceId, 'org_isolation_secondary')
    const projection = await db.get('learning_resources', projectionId)
    return { sourceId: row.resourceId, sourceExists: !!source, projectionId, projectionExists: !!projection }
  }))
  conflicts.push(...batch.filter(row => row.sourceExists || row.projectionExists))
}
const result = { environmentId: envId, environmentClass: 'nonproduction_personal_free_no_overrun_no_charge',
  checkedAt: new Date().toISOString(), activeOrganizations: organizations,
  quotas, expectedNewSources: 90, expectedNewProjections: 90,
  targetConflictCount: conflicts.length, targetConflicts: conflicts,
  estimatedDocumentWrites: 360, cloudWritesPerformed: false }
const path = resolve('G:/英语资产/reports/independent-exercise-v5-cloud-preflight-2026-10-21.json')
await writeFile(path, JSON.stringify(result, null, 2) + '\n', 'utf8')
process.stdout.write(JSON.stringify({ targetConflictCount: conflicts.length,
  quotas, estimatedDocumentWrites: 360, report: path }) + '\n')
if (conflicts.length) process.exitCode = 2
else process.exit(0)
