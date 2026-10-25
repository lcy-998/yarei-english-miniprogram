/** Isolated virtual-class test pack; never projects to the public teacher catalog. */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')
const packPath = resolve('G:/英语资产/library/derived/independent-exercises-20261020/v4/packs/exercise_pack_original_g3_a_20261020_v4.json')
const indexPath = resolve('G:/英语资产/library/derived/independent-exercises-20261020/v4/batch-index.json')
const reportPath = resolve('G:/英语资产/reports/independent-exercise-hierarchy-test-stage-2026-10-21.json')
const packBytes = await readFile(packPath), pack = JSON.parse(packBytes.toString('utf8'))
const index = JSON.parse(await readFile(indexPath, 'utf8'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const record = index.packs.find(row => row.packId === pack.packId)
if (!record || record.packSha256 !== sha(packBytes) || pack.gradeNumber !== 3
  || pack.questionCount !== 5 || pack.sections.length !== 2
  || pack.status !== 'candidate_pending_hierarchy_validation') throw new Error('PACK_PREVIEW_OR_HASH_MISMATCH')
const envId = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'))
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('CLI_JSON_MISSING')
  const payload = JSON.parse(raw.slice(start))
  if (payload.error) throw new Error('CLI_ERROR')
  return payload.data
}
const environments = cliData(['env', 'list', '--json'])
if (envId !== 'cloud1-d8ggzrwwedb786e41' || config.envId !== envId
  || !Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_COST_PREFLIGHT_FAILED')
}
const secrets = cliData(['secrets', 'get', '--json'])
if (secrets?.isTemporary !== true || secrets.envId !== envId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIALS_INVALID')
const bundle = join(root, '.runtime', 'm3-public-question', `hierarchy-stage-${process.pid}.cjs`)
await mkdir(resolve(bundle, '..'), { recursive: true })
await build({ entryPoints: [join(root, 'src', 'seed', 'm3-public-question-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node20', logLevel: 'silent' })
const api = require(bundle), sdk = require('@cloudbase/js-sdk')
const app = sdk.init({ env: envId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token })
const db = api.createCloudBaseDocumentDatabase(app.database())
const organization = await db.get('organizations', 'org_qihang_demo')
const cls = await db.get('classes', 'cls_grade3_2')
if (organization?.status !== 'active' || cls?.organizationId !== 'org_qihang_demo') {
  throw new Error('TEST_ORGANIZATION_OR_CLASS_CHANGED')
}
const nonce = randomBytes(7).toString('hex')
const testPackId = `exercise_pack_hierarchy_test_g3a_${nonce}`
const now = new Date().toISOString()
const resources = pack.sections.flatMap(section => section.questions.map(question => {
  const id = `res_exercise_hierarchy_test_${nonce}_s${section.sectionOrder}_q${question.questionOrder}`
  const sectionMeta = { id: `${testPackId}_s${section.sectionOrder}`,
    title: section.title, instruction: section.instruction,
    studentMaterial: section.studentMaterial, order: section.sectionOrder,
    questionOrder: question.questionOrder, points: question.points }
  const payload = { grade: pack.grade, textbook: '原创英语综合练习', unit: pack.title,
    knowledgePoint: question.knowledgePoint, difficulty: '基础',
    questionType: question.questionType, questionIds: [id], stem: question.stem,
    options: question.options, correctAnswer: question.correctAnswer,
    explanation: question.explanation, exerciseSection: sectionMeta,
    ...(question.acceptedAnswers ? { acceptedAnswers: question.acceptedAnswers } : {}),
    ...(question.rubric ? { rubric: question.rubric } : {}),
    assetLibrary: { kind: 'controlled_nonproduction_test', exercisePackId: testPackId,
      sourcePackSha256: record.packSha256, testOnly: true } }
  return { _id: id, id, organizationId: 'org_qihang_demo', schemaVersion: 1,
    version: 1, deletedAt: null, createdAt: now, updatedAt: now,
    type: 'exercise', title: `${pack.title}｜${section.title}｜第 ${question.questionOrder} 小题`,
    contentVersion: 4, status: 'published', copyrightStatus: 'demo',
    testOnly: true, teacherCatalogOnly: true,
    visibility: { type: 'classes', classIds: ['cls_grade3_2'] },
    allowedClassIds: ['cls_grade3_2'],
    grade: payload.grade, textbook: payload.textbook, unit: payload.unit,
    knowledgePoint: payload.knowledgePoint, difficulty: payload.difficulty,
    questionType: payload.questionType, stem: payload.stem, options: payload.options,
    correctAnswer: payload.correctAnswer, explanation: payload.explanation,
    payload }
}))
if (resources.length !== 5 || new Set(resources.map(row => row._id)).size !== 5) {
  throw new Error('TEST_RESOURCE_SET_INVALID')
}
const logId = `exercise_hierarchy_test_stage_${nonce}`
await db.runTransaction(async tx => {
  for (const row of resources) {
    if (await tx.get('learning_resources', row._id)) throw new Error('TEST_TARGET_NOT_EMPTY')
    if (!await tx.create('learning_resources', row)) throw new Error('TEST_CREATE_FAILED')
  }
  if (!await tx.append('operation_logs', { _id: logId, requestId: logId,
    organizationId: 'org_qihang_demo', schemaVersion: 1, version: 1, deletedAt: null,
    action: 'asset_library.question.hierarchy_test_stage', targetType: 'learning_resource_pack',
    targetId: testPackId, actorUserId: 'controlled_test', actorRole: 'system',
    result: 'succeeded', errorCode: null, occurredAt: now,
    metadata: { sourcePackSha256: record.packSha256, resourceIds: resources.map(row => row._id) } })) {
    throw new Error('TEST_AUDIT_FAILED')
  }
})
const readback = await Promise.all(resources.map(row => db.get('learning_resources', row._id)))
if (readback.some((row, index) => !row || row.status !== 'published'
  || row.testOnly !== true || row.payload?.assetLibrary?.exercisePackId !== testPackId
  || row.payload?.exerciseSection?.id !== resources[index].payload.exerciseSection.id)) {
  throw new Error('TEST_STAGE_READBACK_MISMATCH')
}
await writeFile(reportPath, JSON.stringify({ environmentId: envId, observedAt: new Date().toISOString(),
  testPackId, sourcePackSha256: record.packSha256, classId: 'cls_grade3_2',
  resourceIds: resources.map(row => row._id), status: 'staged_private_nonproduction',
  readbackCount: readback.length, auditLogId: logId,
  cleanup: 'soft_offline_all_five_preserve_history' }, null, 2) + '\n', 'utf8')
process.stdout.write(JSON.stringify({ status: 'staged_private_nonproduction',
  testPackId, resourceCount: resources.length, report: reportPath }) + '\n')
process.exit(0)
