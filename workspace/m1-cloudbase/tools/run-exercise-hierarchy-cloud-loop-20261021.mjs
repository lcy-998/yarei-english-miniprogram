/** Virtual-account teacher → student → teacher exercise hierarchy closure. */
import { execFile } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const require = createRequire(import.meta.url)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const envId = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'))
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')
const stage = JSON.parse(await readFile(resolve('G:/英语资产/reports/independent-exercise-hierarchy-test-stage-2026-10-21.json'), 'utf8'))
const packBytes = await readFile(resolve('G:/英语资产/library/derived/independent-exercises-20261020/v4/packs/exercise_pack_original_g3_a_20261020_v4.json'))
const pack = JSON.parse(packBytes.toString('utf8'))
const nonce = randomBytes(8).toString('hex')
if (envId !== 'cloud1-d8ggzrwwedb786e41' || config.envId !== envId
  || stage.environmentId !== envId || stage.resourceIds.length !== 5
  || stage.sourcePackSha256 !== createHash('sha256').update(packBytes).digest('hex')) {
  throw new Error('ENV_OR_TEST_PACK_MISMATCH')
}
try { require('@cloudbase/js-sdk').useAdapters(require('@cloudbase/adapter-node').default) } catch { /* already registered */ }
const sdk = require('@cloudbase/js-sdk')
const questions = pack.sections.flatMap(section => section.questions)
const itemRefs = stage.resourceIds.map((resourceId, index) => ({
  id: `item_hierarchy_${nonce}_${index + 1}`, resourceId,
  completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
  scoringRule: { kind: questions[index].questionType === 'subjective' ? 'manual' : 'automatic', maxScore: 100 },
  order: index + 1,
}))
let taskId = null, publishedVersion = null, teacherPassword = null
const out = { environmentId: envId, testPackId: stage.testPackId,
  startedAt: new Date().toISOString(), taskId: null, stages: [], cleanup: null }
try {
  const teacherPass = await preparePassword('demo_teacher_01')
  const studentPass = await preparePassword('demo_student_01')
  const parentPass = await preparePassword('demo_parent_01')
  teacherPassword = teacherPass
  const teacher = await login('demo_teacher_01', 'teacher', teacherPass)
  const firstQuestion = await call(teacher, 'content-query', 'getSchoolQuestion',
    { resourceId: stage.resourceIds[0], targetClassIds: ['cls_grade3_2'] })
  requireOk(firstQuestion, 'teacher-question-preview')
  if (firstQuestion.data?.exerciseSection?.order !== 1
    || firstQuestion.data.exercisePackId !== stage.testPackId) throw new Error('TEACHER_SECTION_PROJECTION_MISSING')
  out.stages.push('teacher_preview_hierarchy')

  const now = Date.now()
  const draft = await call(teacher, 'task-command', 'saveDraft', {
    title: `虚构分层习题闭环 ${nonce}`, itemRefs,
    target: { type: 'students', studentIds: ['usr_student_g3_01'] },
    startsAt: new Date(now - 60_000).toISOString(), dueAt: new Date(now + 86_400_000).toISOString(),
    latePolicy: { allowLate: true, lateDays: 7 },
    description: '仅限虚构三年级班级的两道大题、五道小题非生产验证。',
  }, `op_hierarchy_draft_${nonce}`)
  requireOk(draft, 'draft')
  taskId = requiredString(draft.data?.taskId)
  out.taskId = taskId
  const published = await call(teacher, 'task-command', 'publishTask', { taskId },
    `op_hierarchy_publish_${nonce}`, requiredNumber(draft.data?.version))
  requireOk(published, 'publish')
  publishedVersion = requiredNumber(published.data?.version)
  out.stages.push('teacher_publish_five_question_pack')

  const student = await login('demo_student_01', 'student', studentPass)
  const task = await call(student, 'student-task-query', 'getMyTask', { taskId })
  requireOk(task, 'student-task')
  const items = task.data?.items
  if (!Array.isArray(items) || items.length !== 5
    || items.some((item, index) => item.resourceId !== stage.resourceIds[index]
      || item.exerciseQuestion?.exercisePackId !== stage.testPackId
      || item.exerciseQuestion?.exerciseSection?.order !== (index < 2 ? 1 : 2))
    || items[2]?.exerciseQuestion?.exerciseSection?.studentMaterial
      !== pack.sections[1].studentMaterial) throw new Error('STUDENT_SNAPSHOT_SECTION_OR_MATERIAL_MISMATCH')
  out.stages.push('student_snapshot_two_sections_material')
  const answers = itemRefs.map((ref, index) => ({ itemId: ref.id,
    value: { kind: 'exercise', questionResponses: [{ questionId: ref.resourceId,
      response: questions[index].correctAnswer }] } }))
  const submitted = await call(student, 'submission-command', 'submit',
    { taskId, answers }, `op_hierarchy_submit_${nonce}`,
    requiredNumber(task.data?.assignment?.version))
  requireOk(submitted, 'student-submit')
  const submissionId = requiredString(submitted.data?.submissionId)
  out.stages.push('student_submit_all_five')

  const reviewer = await login('demo_teacher_01', 'teacher', teacherPass)
  const reviewView = await call(reviewer, 'review-query', 'getSubmissionForReview', { submissionId })
  requireOk(reviewView, 'teacher-review-read')
  const evidence = reviewView.data?.exerciseEvidence
  if (!Array.isArray(evidence) || evidence.length !== 5
    || !evidence.every((item, index) => item.questionId === stage.resourceIds[index]
      && item.exerciseSection?.order === (index < 2 ? 1 : 2))
    || !Array.isArray(evidence[1]?.rubric) || evidence[1].rubric.length < 2) {
    throw new Error('TEACHER_REVIEW_SECTION_OR_RUBRIC_MISSING')
  }
  out.stages.push('teacher_review_evidence_and_rubric')
  const manualItem = itemRefs.find((_, index) => questions[index].questionType === 'subjective')
  if (!manualItem) throw new Error('MANUAL_ITEM_MISSING')
  const reviewed = await call(reviewer, 'review-command', 'publishReview', {
    submissionId, decision: 'approved', score: 100,
    itemScores: [{ itemId: manualItem.id, score: 100 }],
    textComment: '虚构分层习题两道大题五道小题已逐项核对。',
    expectedSubmissionVersion: requiredNumber(reviewView.data?.submissionVersion),
  }, `op_hierarchy_review_${nonce}`, requiredNumber(reviewView.data?.assignmentVersion))
  requireOk(reviewed, 'teacher-review-publish')
  out.stages.push('teacher_manual_score_and_publish')

  const parent = await login('demo_parent_01', 'parent', parentPass)
  const feedback = await call(parent, 'parent-query', 'getFeedback',
    { childId: 'usr_student_g3_01', feedbackId: requiredString(reviewed.data?.feedbackId) })
  requireOk(feedback, 'parent-feedback')
  out.stages.push('parent_feedback_read')

  const cleanupTeacher = await login('demo_teacher_01', 'teacher', teacherPass)
  const recycled = await call(cleanupTeacher, 'task-command', 'recycleTask',
    { taskId, reason: '分层习题非生产闭环完成后软回收，保留提交与点评。' },
    `op_hierarchy_recycle_${nonce}`, publishedVersion)
  requireOk(recycled, 'task-recycle')
  out.cleanup = 'task_soft_recycled'
  out.completedAt = new Date().toISOString()
  out.result = 'passed'
} catch (error) {
  out.result = 'failed'
  out.error = safe(error?.message)
  if (taskId && publishedVersion !== null && teacherPassword) {
    try {
      const teacher = await login('demo_teacher_01', 'teacher', teacherPassword)
      const cleanup = await call(teacher, 'task-command', 'recycleTask',
        { taskId, reason: '分层习题非生产联调失败后回收。' },
        `op_hierarchy_failure_recycle_${nonce}`, publishedVersion)
      out.cleanup = cleanup.ok ? 'task_soft_recycled' : `cleanup_failed_${safe(cleanup.error?.code)}`
    } catch { out.cleanup = 'cleanup_failed' }
  }
  process.exitCode = 2
}
await writeFile(resolve('G:/英语资产/reports/independent-exercise-hierarchy-cloud-loop-2026-10-21.json'),
  JSON.stringify(out, null, 2) + '\n', 'utf8')
process.stdout.write(JSON.stringify({ result: out.result, stages: out.stages,
  taskId: out.taskId, cleanup: out.cleanup, error: out.error ?? null }) + '\n')
process.exit(process.exitCode ?? 0)

async function cliJson(args) {
  try {
    const { stdout } = await execute(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 })
    const start = stdout.indexOf('{')
    if (start < 0) throw new Error('JSON_MISSING')
    const parsed = JSON.parse(stdout.slice(start))
    if (parsed.error) throw new Error('CLOUD_REJECTED')
    return parsed
  } catch { throw new Error(`CLI_FAILED_${args[0]}_${args[1]}`) }
}
async function preparePassword(alias) {
  const users = await cliJson(['user', 'list', '-e', envId, '--name', alias, '--json'])
  const matches = Array.isArray(users.data) ? users.data.filter(row => row?.Name === alias) : []
  if (matches.length !== 1) throw new Error('DEMO_ACCOUNT_UNAVAILABLE')
  const password = `YareiM3!${randomBytes(18).toString('base64url')}`
  await cliJson(['user', 'update', '-e', envId, matches[0].Uid,
    '--password', password, '--status', 'ACTIVE', '--json'])
  return password
}
async function login(alias, role, password) {
  const app = sdk.init({ env: envId })
  await app.auth({ persistence: 'local' }).signInWithPassword({ username: alias, password })
  const bootstrap = await call({ app, token: null }, 'auth-session', 'bootstrap', {})
  requireOk(bootstrap, 'bootstrap')
  const token = requiredString(bootstrap.data?.sessionId)
  const selected = await call({ app, token }, 'auth-session', 'selectRole', { role })
  requireOk(selected, 'select-role')
  return { app, token }
}
async function call(session, name, action, payload, operationId, expectedVersion) {
  try {
    const data = { apiVersion: 'm1.v1', action, payload,
      ...(session.token === null ? {} : { businessSessionToken: session.token }),
      ...(operationId === undefined ? {} : { operationId }),
      ...(expectedVersion === undefined ? {} : { expectedVersion }) }
    const response = await Promise.race([session.app.callFunction({ name, data, parse: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CALL_TIMEOUT')), 20000))])
    return response?.result ?? { ok: false, error: { code: 'INVALID_RESPONSE' } }
  } catch (error) { return { ok: false, error: { code: safe(error?.code ?? error?.message) } } }
}
function requireOk(result, stageName) {
  if (!result?.ok) throw new Error(`${stageName}_${safe(result?.error?.code)}`)
}
function requiredString(value) {
  if (typeof value !== 'string' || !value) throw new Error('EXPECTED_STRING')
  return value
}
function requiredNumber(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('EXPECTED_INTEGER')
  return value
}
function safe(value) { return String(value ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 100) }
