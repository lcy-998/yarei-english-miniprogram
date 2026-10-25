/** Independent source/projection/audit/catalog readback for all 90 published v5 items. */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')
const stage = JSON.parse(await readFile(resolve('G:/英语资产/library/derived/independent-exercises-20261020/v5/staging/staging-index.json'), 'utf8'))
const index = JSON.parse(await readFile(resolve('G:/英语资产/library/derived/independent-exercises-20261020/v5/batch-index.json'), 'utf8'))
const envId = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
if (envId !== 'cloud1-d8ggzrwwedb786e41' || stage.resourceCount !== 90 || index.packs.length !== 18) {
  throw new Error('V5_READBACK_SCOPE_MISMATCH')
}
function data(args) {
  try {
    const raw = execFileSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    const begin = raw.indexOf('{')
    if (begin < 0) throw new Error('JSON_MISSING')
    const payload = JSON.parse(raw.slice(begin))
    if (payload.error) throw new Error('CLI_REJECTED')
    return payload.data
  } catch { throw new Error(`CLI_FAILED_${args[0]}_${args[1]}`) }
}
const envs = data(['env', 'list', '--json'])
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].EnableOverrun !== false
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') throw new Error('ENVIRONMENT_CHANGED')
const secrets = data(['secrets', 'get', '--json'])
if (secrets?.isTemporary !== true || secrets.envId !== envId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIALS_INVALID')
const bundle = join(root, '.runtime', 'm3-public-question', `v5-readback-${process.pid}.cjs`)
await mkdir(resolve(bundle, '..'), { recursive: true })
await build({ entryPoints: [join(root, 'src', 'seed', 'm3-public-question-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node20', logLevel: 'silent' })
const api = require(bundle), sdk = require('@cloudbase/js-sdk')
const app = sdk.init({ env: envId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token })
const db = api.createCloudBaseDocumentDatabase(app.database())
const rows = []
for (let start = 0; start < stage.resources.length; start += 8) {
  rows.push(...await Promise.all(stage.resources.slice(start, start + 8).map(async expected => {
    const input = JSON.parse(await readFile(resolve('G:/英语资产/library/derived/independent-exercises-20261020/v5/staging',
      expected.resourceId, 'input.json'), 'utf8'))
    const source = await db.get('learning_resources', expected.resourceId)
    const projectionId = api.publicQuestionProjectionId(expected.resourceId, 'org_isolation_secondary')
    const projection = await db.get('learning_resources', projectionId)
    const importLog = await db.get('operation_logs', `public_question_import_${expected.resourceId}`)
    const projectionLog = await db.get('operation_logs', `public_question_projection_${projectionId}`)
    const linked = projection ? await api.hasActivePublicQuestionSource(db, projection) : false
    const section = source?.payload?.exerciseSection
    const sourceValid = source?.status === 'published' && source?.version === 1
      && source?.organizationId === 'org_qihang_demo' && source?.contentVersion === 5
      && source?.payload?.assetLibrary?.exercisePackId === expected.packId
      && source?.payload?.assetLibrary?.sourceSha256 === input.sourceSha256
      && source?.payload?.assetLibrary?.manifestSha256 === input.manifestSha256
      && source?.payload?.assetLibrary?.sourceKind === 'original_by_codex'
      && section?.id === input.exerciseSection.id && section?.points === 100
      && JSON.stringify(source?.payload?.correctAnswer) === JSON.stringify(input.correctAnswer)
      && JSON.stringify(source?.payload?.rubric) === JSON.stringify(input.rubric)
      && JSON.stringify(source?.payload?.acceptedAnswers) === JSON.stringify(input.acceptedAnswers)
    const projectionValid = projection?.status === 'published' && projection?.version === 1
      && projection?.organizationId === 'org_isolation_secondary'
      && projection?.payload?.assetLibrary?.sourcePublicId === expected.resourceId
      && projection?.payload?.exerciseSection?.id === input.exerciseSection.id && linked
    const auditValid = importLog?.action === 'asset_library.question.controlled_import'
      && importLog?.result === 'succeeded'
      && projectionLog?.action === 'asset_library.question.project_public'
      && projectionLog?.result === 'succeeded'
    return { sourceId: expected.resourceId, packId: expected.packId,
      grade: expected.grade, sourceValid, projectionValid, auditValid }
  })))
}
const faulty = rows.filter(row => !row.sourceValid || !row.projectionValid || !row.auditValid)
const catalog = []
const repository = api.createOrgContentDocumentRepository(db)
const service = new api.ContentQueryService(repository)
for (const organizationId of ['org_qihang_demo', 'org_isolation_secondary']) {
  const actor = { actorRole: 'teacher', actorUserId: 'virtual_catalog_audit', organizationId,
    permissions: [], scopeIds: [] }
  for (const grade of ['一年级','二年级','三年级','四年级','五年级','六年级','七年级','八年级','九年级']) {
    const page = await service.listSchoolQuestions(actor, { grade }, { limit: 50, offset: 0 })
    const selected = page.items.filter(item => stage.resources.some(row => row.resourceId === item.id)
      || stage.resources.some(row => api.publicQuestionProjectionId(row.resourceId, 'org_isolation_secondary') === item.id))
    catalog.push({ organizationId, grade, newQuestionCount: selected.length,
      packCount: new Set(selected.map(item => item.exercisePackId)).size,
      answerLeak: selected.some(item => 'correctAnswer' in item || 'explanation' in item) })
  }
}
const catalogErrors = catalog.filter(row => row.newQuestionCount !== 10 || row.packCount !== 2 || row.answerLeak)
const result = { environmentId: envId, checkedAt: new Date().toISOString(),
  sourceCount: rows.length, sourceValidCount: rows.filter(row => row.sourceValid).length,
  projectionValidCount: rows.filter(row => row.projectionValid).length,
  auditValidCount: rows.filter(row => row.auditValid).length,
  catalog, faulty, catalogErrors, cloudWritesPerformed: false }
const path = resolve('G:/英语资产/reports/independent-exercise-v5-cloud-readback-2026-10-21.json')
await writeFile(path, JSON.stringify(result, null, 2) + '\n', 'utf8')
process.stdout.write(JSON.stringify({ sources: result.sourceValidCount,
  projections: result.projectionValidCount, auditPairs: result.auditValidCount,
  catalogGradeOrganizationRows: catalog.length, catalogErrors: catalogErrors.length,
  faults: faulty.length, report: path }) + '\n')
if (faulty.length || catalogErrors.length) process.exitCode = 2
else process.exit(0)
