import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, mkdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2]
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { build } = require('esbuild')
const envId = 'cloud1-d8ggzrwwedb786e41'
const orgId = 'org_qihang_demo'
const teacherId = 'usr_teacher_demo_01'
const studentId = 'usr_student_g3_01'
const parentId = 'usr_parent_demo_01'
const classId = 'cls_grade3_2'
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const oldTaskIds = [
  'task_FUYzbIUUNwOEa_di0qdAk1Da6cmtva_D',
  'task_JMapGY8cxbJw5XrAmVn4hvLDsnysWlQ6',
  'task_NXjAT2Fpwgq1XFJzDzZdez8FSQEnjpKE',
  'task_NqOoW-iX1K2d7qlZit8lb3gHpGQgoL_j',
  'task_Pd0xm1u7Nu6zuBGD3zOeXF4PzSN6_dyX',
  'task_qGgMN0lkllrjazmlQKJAg5ZxwJvwhZeC',
  'task_v93BDw0RgFkuCuoKNiQmwTyrE1fW_tcH',
]
const expectedOldTitles = ['后台 AI 点评虚构验证 ce2d10b33900aa', '验收任务', '实验',
  '实验2', '课堂学习任务', '测试任务', '实验']
const exerciseIds = Array.from({ length: 5 }, (_, index) => `res_question_ow2e_l1_u7_q0${index + 1}_v1`)
const resourceIds = [
  'res_formal_sbc0008_v1_20261007', 'res_launch_sbc0008_listening_v2_20261013',
  'res_sbc0008_video_5q_v1_20261015', 'res_launch_sbc0008_recording_v1_20261012',
  'res_launch_sbc0008_dubbing_credited_v1_20261012', 'supplement-pep3a-u2-complete-v1',
  ...exerciseIds,
]
const taskSpecs = [
  { id: 'task_acceptance_20261019_read_listen', title: '绘本阅读与动作听力',
    description: '阅读《What are you doing?》，再听音完成四道动作理解题。',
    refs: [
      { resourceId: resourceIds[0], completionRule: { kind: 'reading_pages', requiredPageCount: 10 },
        scoringRule: { kind: 'manual', maxScore: 100 } },
      { resourceId: resourceIds[1], completionRule: { kind: 'listening',
        questionIds: [1, 2, 3, 4].map(n => `sbc0008-listening-q${n}-v3`),
        segmentIds: [1, 2, 3, 4].map(n => `sbc0008-listening-q${n}-v3_segment`) },
        scoringRule: { kind: 'automatic', maxScore: 100 } },
    ] },
  { id: 'task_acceptance_20261019_video', title: '动作表达视频理解',
    description: '观看绘本视频后完成五道理解题。',
    refs: [{ resourceId: resourceIds[2], completionRule: { kind: 'video', durationMs: 28032,
      questionIds: 'from_resource' }, scoringRule: { kind: 'automatic', maxScore: 100 } }] },
  { id: 'task_acceptance_20261019_speaking', title: '动作英语口语与配音',
    description: '朗读绘本原句，再为同主题短片配音。',
    refs: [
      { resourceId: resourceIds[3], completionRule: { kind: 'recording_upload' },
        scoringRule: { kind: 'manual', maxScore: 100 } },
      { resourceId: resourceIds[4], completionRule: { kind: 'dubbing' },
        scoringRule: { kind: 'manual', maxScore: 100 } },
    ] },
  { id: 'task_acceptance_20261019_vocabulary', title: '三年级上册第二单元家人词汇',
    description: '学习并练习五个家人主题单词，可继续完成整个词包。',
    refs: [{ resourceId: resourceIds[5], completionRule: { kind: 'vocabulary_words', requiredWordCount: 5 },
      scoringRule: { kind: 'manual', maxScore: 100 } }] },
  { id: 'task_acceptance_20261019_exercise', title: '身体部位英语理解练习',
    description: '完成同一题组的五道身体部位英语题。',
    refs: exerciseIds.map(resourceId => ({ resourceId,
      completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
      scoringRule: { kind: 'automatic', maxScore: 100 } })) },
]
function cliJson(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] })
  const at = raw.indexOf('{')
  if (at < 0) throw new Error('CLOUD_JSON_MISSING')
  const parsed = JSON.parse(raw.slice(at))
  if (parsed.error) throw new Error('CLOUD_API_ERROR')
  return parsed.data
}
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'))
const line = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(item => item.startsWith('TCB_ENV_ID='))
const localEnv = line?.slice(11).trim()
const envs = cliJson(['env', 'list', '--json'])
if (localEnv !== envId || config.envId !== envId || !Array.isArray(envs)
  || envs.length !== 1 || envs[0].EnvId !== envId || envs[0].Status !== 'NORMAL'
  || envs[0].PackageName !== '个人版' || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no' || envs[0].EnableOverrun !== false) {
  throw new Error('NONPRODUCTION_COST_GATE')
}
const quota = cliJson(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json'])
if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('QUOTA_GATE')
const token = cliJson(['secrets', 'get', '--json'])
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE')
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token })
const entry = join(root, '.runtime/demo-acceptance-20261019/entry.cjs')
await mkdir(dirname(entry), { recursive: true })
await build({ entryPoints: [join(root, 'src/seed/m2-acceptance-entry.ts')], outfile: entry,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' })
const api = require(entry)
const db = api.createCloudBaseDocumentDatabase(app.database())
const [teacher, student, parent, roleRows, grants, memberships, links, resources, oldTasks, newTasks] = await Promise.all([
  db.get('users', teacherId), db.get('users', studentId), db.get('users', parentId),
  db.find('role_assignments', { organizationId: orgId, userId: teacherId,
    status: 'active', deletedAt: null }),
  db.find('teacher_class_grants', { organizationId: orgId, teacherId, classId,
    status: 'active', deletedAt: null }),
  db.find('class_memberships', { organizationId: orgId, studentId, classId,
    status: 'active', deletedAt: null }),
  db.find('parent_student_links', { organizationId: orgId, parentId, studentId,
    status: 'active', deletedAt: null }),
  Promise.all(resourceIds.map(id => db.get('learning_resources', id))),
  Promise.all(oldTaskIds.map(id => db.get('tasks', id))),
  Promise.all(taskSpecs.map(spec => db.get('tasks', spec.id))),
])
const role = roleRows.find(item => item.role === 'teacher') ?? roleRows[0]
if ([teacher, student, parent].some(user => user?.organizationId !== orgId
  || user.status !== 'active' || user.deletedAt !== null)
  || !role?.permissions?.includes('task.publish') || !role.permissions.includes('content.read')
  || !grants.some(item => item.permissions?.includes('task.publish')
    && item.permissions.includes('content.read'))
  || memberships.length !== 1 || links.length !== 1) throw new Error('DEMO_RELATIONSHIP_GATE')
if (resources.some((row, index) => !row || row.status !== 'published'
  || row.copyrightStatus !== 'verified' || row.testOnly === true
  || row.organizationId !== orgId
  || row.type !== (index === 0 ? 'reading' : index === 1 ? 'listening'
    : index === 2 ? 'video' : index === 3 ? 'recording' : index === 4 ? 'dubbing'
      : index === 5 ? 'vocabulary' : 'exercise'))) throw new Error('RESOURCE_GATE')
const questionIds = resources[2].payload?.teacherMedia?.questionIds
if (!Array.isArray(questionIds) || questionIds.length !== 5
  || resources[2].payload.teacherMedia.durationMs !== 28032
  || resources[0].payload?.chapters?.reduce((n, chapter) => n + (chapter.pages?.length ?? 0), 0) !== 10
  || resources[5].words?.length !== 19) throw new Error('CONTENT_COMPLETENESS_GATE')
taskSpecs[1].refs[0].completionRule.questionIds = questionIds
if (mode === 'inspect' && (newTasks.some(Boolean) || oldTasks.some((task, index) => !task
  || task.title !== expectedOldTitles[index] || task.creatorTeacherId !== teacherId
  || task.visibility !== 'visible' || task.status !== 'active'))) {
  throw new Error('TASK_SCOPE_CHANGED')
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ status: 'ready', environment: 'verified_nonproduction',
    teacherAuthorized: true, studentAndParentLinked: true, newTaskTitles: taskSpecs.map(item => item.title),
    contentTypes: [...new Set(taskSpecs.flatMap(spec => spec.refs.map(ref => resources[resourceIds.indexOf(ref.resourceId)].type)))],
    oldVisibleTestTasks: oldTasks.length, oldSubmittedTaskCount: 5,
    plannedNewAssignments: taskSpecs.length, physicalDeletes: 0,
    currentQuotaWrites: quota.Value }) + '\n')
  process.exit(0)
}
let requestSequence = 0
let idSequence = 0
let currentTaskId = ''
const ids = { next: prefix => prefix === 'task' ? currentTaskId
  : `${prefix}_acceptance_20261019_${++idSequence}` }
const requestIds = { next: () => `request_acceptance_20261019_${++requestSequence}` }
const clock = { nowIso: () => new Date().toISOString() }
const service = new api.TaskCoreService(api.createTaskCoreDocumentRepository(db),
  api.createIdentityDocumentRepository(db), clock, ids, requestIds)
const actor = { requestId: requestIds.next(), sessionId: 'demo-acceptance-setup',
  actorUserId: teacherId, actorRole: 'teacher', organizationId: orgId,
  platformSubjectDigest: 'demo-acceptance-setup', permissions: role.permissions,
  scopeIds: [classId], authzVersion: teacher.authzVersion ?? 1 }
const studentActor = { ...actor, requestId: requestIds.next(), actorUserId: studentId,
  actorRole: 'student', permissions: [], authzVersion: student.authzVersion ?? 1 }
const queryDeps = { repository: api.createTaskQueryDocumentRepository(db), clock, requestIds }
const studentQuery = new api.StudentTaskQueryService(queryDeps)
const teacherQuery = new api.TeacherTaskQueryService(queryDeps)
if (mode === 'apply') {
  if (newTasks.some(Boolean) || oldTasks.some((task, index) => !task
    || task.title !== expectedOldTitles[index] || task.creatorTeacherId !== teacherId
    || task.visibility !== 'visible' || task.status !== 'active')) throw new Error('TASK_SCOPE_CHANGED')
  const created = []
  try {
    for (const [index, spec] of taskSpecs.entries()) {
      currentTaskId = spec.id
      const now = Date.now()
      const input = { title: spec.title, description: spec.description, teacherNote: '',
        itemRefs: spec.refs.map((ref, itemIndex) => ({ id: `item_acceptance_${index + 1}_${itemIndex + 1}`,
          resourceId: ref.resourceId, completionRule: ref.completionRule,
          scoringRule: ref.scoringRule, order: itemIndex + 1 })),
        targetType: 'students', targetClassIds: [], targetStudentIds: [studentId],
        startsAt: new Date(now - 60_000).toISOString(), dueAt: new Date(now + 14 * 86400_000).toISOString(),
        latePolicy: { allowLate: true, lateDays: 3 } }
      const saved = await service.saveTaskDraft(actor, input, 0, `op_acceptance_save_${index + 1}`)
      if (!saved.ok || saved.data?.taskId !== spec.id) throw new Error(`SAVE_FAILED_${index + 1}_${saved.error?.code ?? 'UNKNOWN'}`)
      created.push(spec.id)
      const published = await service.publishTask(actor, spec.id, saved.data.version,
        `op_acceptance_publish_${index + 1}`)
      if (!published.ok || published.data?.status !== 'active') {
        throw new Error(`PUBLISH_FAILED_${index + 1}_${published.error?.code ?? 'UNKNOWN'}`)
      }
      const studentView = await studentQuery.getMyTask(studentActor, spec.id)
      if (!studentView.ok || studentView.data.items?.length !== spec.refs.length) {
        throw new Error(`STUDENT_READ_FAILED_${index + 1}`)
      }
      const teacherView = await teacherQuery.getCompletion(actor, spec.id, {}, { limit: 20 })
      if (!teacherView.ok || teacherView.data.assignments.items.length !== 1) {
        throw new Error(`TEACHER_READ_FAILED_${index + 1}`)
      }
      process.stdout.write(JSON.stringify({ stage: 'published', title: spec.title,
        studentReadable: true, teacherReadable: true }) + '\n')
    }
  } catch (error) {
    const rolledBack = []
    for (const id of created) {
      const task = await db.get('tasks', id).catch(() => null)
      if (task?.visibility === 'visible') {
        const result = await service.recycleTask(actor, id,
          '验收布置未全部完成，撤回本批新任务。', task.version,
          `op_acceptance_rollback_${id}`).catch(() => null)
        rolledBack.push({ id, recycled: result?.ok === true })
      }
    }
    process.stdout.write(JSON.stringify({ status: 'publish_failed',
      reason: String(error?.message ?? 'UNKNOWN'), rolledBack }) + '\n')
    process.exit(2)
  }
  const recycled = []
  for (const [index, id] of oldTaskIds.entries()) {
    const current = await db.get('tasks', id)
    if (current?.title !== expectedOldTitles[index] || current.creatorTeacherId !== teacherId
      || current.visibility !== 'visible' || current.status !== 'active') {
      throw new Error(`OLD_TASK_SCOPE_CHANGED_${index + 1}`)
    }
    const result = await service.recycleTask(actor, id,
      '甲方验收准备：旧虚构测试任务软回收，保留提交、点评和审计历史。', current.version,
      `op_acceptance_recycle_${index + 1}`)
    if (!result.ok) throw new Error(`OLD_TASK_RECYCLE_FAILED_${index + 1}_${result.error?.code ?? 'UNKNOWN'}`)
    recycled.push(id)
  }
  process.stdout.write(JSON.stringify({ status: 'applied', published: taskSpecs.length,
    recycled: recycled.length, physicalDeletes: 0, submissionsPreserved: true }) + '\n')
  process.exit(0)
}
const finalNew = await Promise.all(taskSpecs.map(spec => db.get('tasks', spec.id)))
const finalOld = await Promise.all(oldTaskIds.map(id => db.get('tasks', id)))
if (finalNew.some((task, index) => !task || task.visibility !== 'visible'
  || task.status !== 'active' || task.title !== taskSpecs[index].title
  || task.targetStudentIds?.length !== 1 || task.targetStudentIds[0] !== studentId)
  || finalOld.some(task => !task || task.visibility !== 'recycled')) {
  throw new Error('FINAL_READBACK_FAILED')
}
for (const spec of taskSpecs) {
  const result = await studentQuery.getMyTask(studentActor, spec.id)
  if (!result.ok || result.data.items?.length !== spec.refs.length) throw new Error('STUDENT_FINAL_READ_FAILED')
}
const parentEntry = join(root, '.runtime/demo-acceptance-20261019/parent.cjs')
await build({ entryPoints: [join(root, 'src/task-query/parent-service.ts')], outfile: parentEntry,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' })
const { ParentTaskQueryService } = require(parentEntry)
const parentRoles = await db.find('role_assignments', { organizationId: orgId, userId: parentId,
  status: 'active', deletedAt: null })
const parentRole = parentRoles.find(item => item.role === 'parent') ?? parentRoles[0]
if (!parentRole?.permissions?.includes('child.read')) throw new Error('PARENT_ROLE_GATE')
const parentActor = { ...actor, requestId: requestIds.next(), actorUserId: parentId,
  actorRole: 'parent', permissions: parentRole.permissions, scopeIds: [],
  authzVersion: parent.authzVersion ?? 1 }
const parentQuery = new ParentTaskQueryService({ repository: api.createTaskQueryDocumentRepository(db),
  identities: api.createIdentityDocumentRepository(db), clock, requestIds })
const parentList = await parentQuery.listChildTasks(parentActor, studentId, {}, { limit: 50 })
if (!parentList.ok || taskSpecs.some(spec => !parentList.data.items.some(item => item.taskId === spec.id))) {
  throw new Error('PARENT_FINAL_READ_FAILED')
}
process.stdout.write(JSON.stringify({ status: 'verified', visibleNewTasks: finalNew.length,
  recycledOldTasks: finalOld.length, studentRead: true, parentRead: true,
  newTitles: finalNew.map(task => task.title), historyPreserved: true }) + '\n')
