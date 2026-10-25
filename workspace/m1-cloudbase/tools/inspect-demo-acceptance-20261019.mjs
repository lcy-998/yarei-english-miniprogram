import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const envId = 'cloud1-d8ggzrwwedb786e41'
const organizationId = 'org_qihang_demo'
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const require = createRequire(resolve(root, 'package.json'))
function cliJson(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE')
  const parsed = JSON.parse(raw.slice(start))
  if (parsed.error) throw new Error('CLOUD_CLI_FAILED')
  return parsed.data
}
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'))
const localEnv = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
if (config.envId !== envId || localEnv !== envId) throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH')
const envs = cliJson(['env', 'list', '--json'])
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE')
}
const secrets = cliJson(['secrets', 'get', '--json'])
if (secrets?.envId !== envId || secrets.isTemporary !== true
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE')
const sdk = require('@cloudbase/node-sdk')
const entry = require(resolve(root, '.runtime/m3-real-vocabulary-audio-v2/entry.cjs'))
const db = entry.createCloudBaseDocumentDatabase(sdk.init({ env: envId,
  secretId: secrets.secretId, secretKey: secrets.secretKey, sessionToken: secrets.token }).database())
const teacherId = 'usr_teacher_demo_01'
const studentId = 'usr_student_g3_01'
const parentId = 'usr_parent_demo_01'
const teacher = await db.get('users', teacherId)
const student = await db.get('users', studentId)
const parent = await db.get('users', parentId)
if ([teacher, student, parent].some(value => !value || value.organizationId !== organizationId
  || value.status !== 'active' || value.deletedAt !== null)) throw new Error('DEMO_ACCOUNT_GATE')
const links = await db.find('parent_student_links', { organizationId, parentId, deletedAt: null })
const grants = await db.find('teacher_class_grants', { organizationId, teacherId, deletedAt: null })
const allTasks = await db.find('tasks', { organizationId, deletedAt: null })
const tasks = allTasks.filter(task => task.creatorTeacherId === teacherId && task.visibility === 'visible')
const assignments = await db.find('task_assignments', { organizationId, studentId, deletedAt: null })
const studentTaskIds = new Set(assignments.map(item => item.taskId))
const demoTasks = tasks.filter(task => studentTaskIds.has(task._id ?? task.id))
const resources = await db.find('learning_resources', { organizationId, deletedAt: null })
const activity = await db.find('checkin_activities', { organizationId, deletedAt: null })
const assignmentByTask = new Map(assignments.map(item => [item.taskId, item]))
const secondChild = links.find(item => item.status === 'active' && item.studentId !== studentId)
const secondChildUser = secondChild ? await db.get('users', secondChild.studentId) : null
const selectedIds = ['res_formal_sbc0008_v1_20261007', 'res_launch_sbc0008_listening_v2_20261013',
  'res_launch_sbc0008_recording_v1_20261012', 'res_launch_sbc0008_dubbing_credited_v1_20261012',
  'res_sbc0008_video_5q_v1_20261015', 'supplement-pep3a-u2-complete-v1',
  ...Array.from({ length: 5 }, (_, index) => `res_question_ow2e_l1_u7_q0${index + 1}_v1`)]
const selectedResources = selectedIds.map(id => resources.find(item => (item._id ?? item.id) === id))
const summary = { environment: 'verified_nonproduction', organizationId,
  accounts: { teacherId, studentId, parentId,
    parentActiveChildIds: links.filter(item => item.status === 'active').map(item => item.studentId),
    teacherActiveClassIds: grants.filter(item => item.status === 'active').map(item => item.classId),
    secondChild: secondChild ? { status: secondChildUser?.status ?? null,
      createdAt: secondChildUser?.createdAt ?? null, linkCreatedAt: secondChild.createdAt ?? null } : null },
  teacherTaskCount: tasks.length, studentAssignmentCount: assignments.length,
  studentTasks: demoTasks.map(task => ({ id: task._id ?? task.id, title: task.title,
    status: task.status, visibility: task.visibility, version: task.version,
    targetCount: task.targetStudentIds?.length ?? null,
    itemTypes: (task.items ?? []).map(item => item.resourceSnapshot?.type ?? item.kind ?? null),
    assignmentStatus: assignmentByTask.get(task._id ?? task.id)?.status ?? null,
    latestSubmissionIdPresent: !!assignmentByTask.get(task._id ?? task.id)?.latestSubmissionId,
    publishedAt: task.publishedAt ?? null })),
  catalog: {
    selected: selectedResources.map((item, index) => ({ id: selectedIds[index],
      present: !!item, title: item?.title ?? null, status: item?.status ?? null,
      type: item?.type ?? null, grade: item?.grade ?? null,
      copyrightStatus: item?.copyrightStatus ?? null, testOnly: item?.testOnly ?? null,
      pageCount: item?.chapters?.reduce((count, chapter) => count + (chapter.pages?.length ?? 0), 0) ?? null,
      wordCount: item?.words?.length ?? null,
      questionId: item?.questionId ?? null,
      questionGroupId: item?.questionGroupId ?? item?.payload?.questionGroupId ?? null,
      mediaDurationMs: item?.durationMs ?? item?.payload?.durationMs ?? null,
      mediaQuestionIds: item?.questionIds ?? item?.payload?.questionIds ?? null,
      payloadKeys: Object.keys(item?.payload ?? {}),
      mediaQuestionCount: item?.payload?.questions?.length ?? null,
      teacherMediaKeys: Object.keys(item?.payload?.teacherMedia ?? {}),
      teacherMediaDurationMs: item?.payload?.teacherMedia?.durationMs ?? null,
      teacherMediaQuestionIds: item?.payload?.teacherMedia?.questions?.map(question => question.id) ?? null,
      contentPageCount: item?.payload?.chapters?.reduce((count, chapter) => count + (chapter.pages?.length ?? 0), 0) ?? null })),
    activityCount: activity.filter(item => item.status === 'active').length,
  } }
process.stdout.write(JSON.stringify(summary) + '\n')
