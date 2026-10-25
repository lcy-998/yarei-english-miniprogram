// Read-only, identifier-minimized inventory for six-page nonproduction acceptance planning.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'))
const envId = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim()
if (!envId || envId !== config.envId || envId !== 'cloud1-d8ggzrwwedb786e41') {
  throw new Error('NONPRODUCTION_ENV_MISMATCH')
}
let raw
try {
  raw = execFileSync(process.execPath, [cli, 'secrets', 'get', '--json'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 })
} catch { throw new Error('TEMPORARY_CREDENTIALS_UNAVAILABLE') }
const credentials = JSON.parse(raw.slice(raw.indexOf('{'))).data
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID')
}
const require = createRequire(resolve(root, 'package.json'))
const database = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token }).database()
const organizationId = 'org_qihang_demo'
const allOrganizations = await database.collection('organizations').count()
const organizationRowsResult = await database.collection('organizations').limit(10).get()
const organizationRows = Array.isArray(organizationRowsResult.data)
  ? organizationRowsResult.data : []
process.stdout.write(JSON.stringify({ collection: 'organizations',
  environmentTotal: allOrganizations.total ?? allOrganizations.count ?? null,
  organizationFixtures: organizationRows.map(row => ({ id: row._id,
    status: row.status ?? null, deleted: row.deletedAt !== null })) }) + '\n')
for (const row of organizationRows) {
  const teachers = await database.collection('role_assignments').where({
    organizationId: row._id, deletedAt: null, role: 'teacher', status: 'active',
  }).limit(10).get()
  process.stdout.write(JSON.stringify({ organizationId: row._id,
    activeTeacherRoleIds: (Array.isArray(teachers.data) ? teachers.data : [])
      .map(role => role.userId).filter(value => typeof value === 'string') }) + '\n')
}
const collections = ['organizations', 'classes', 'users', 'role_assignments',
  'native_admin_grants', 'learning_resources', 'operation_logs']

for (const name of collections) {
  const collection = database.collection(name).where({ organizationId, deletedAt: null })
  const [count, sample] = await Promise.all([collection.count(), collection.limit(100).get()])
  const rows = Array.isArray(sample.data) ? sample.data : []
  const typeCounts = {}
  const statusCounts = {}
  for (const row of rows) {
    if (typeof row.type === 'string') typeCounts[row.type] = (typeCounts[row.type] ?? 0) + 1
    if (typeof row.status === 'string') statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1
  }
  const total = count.total ?? count.count ?? null
  process.stdout.write(JSON.stringify({ collection: name, total, sampled: rows.length,
    sampleComplete: typeof total === 'number' && total <= 100,
    typeCounts, statusCounts,
    ...(name === 'classes' ? { classFixtures: rows.filter(row => typeof row._id === 'string')
      .map(row => ({ id: row._id,
      status: row.status ?? null, version: row.version ?? null })) } : {}),
    ...(name === 'role_assignments' ? { teacherFixtures: rows.filter(row => row.role === 'teacher'
      && typeof row.userId === 'string' && row.userId.includes('demo')).map(row => ({
        userId: row.userId, status: row.status ?? null })) } : {}),
  }) + '\n')
}

const resources = await database.collection('learning_resources')
  .where({ organizationId, deletedAt: null }).limit(100).get()
const resourceRows = Array.isArray(resources.data) ? resources.data : []
process.stdout.write(JSON.stringify({ collection: 'learning_resources',
  candidateFixtures: resourceRows.filter(row => typeof row._id === 'string'
    && (row._id.includes('demo') || row._id.includes('m3_'))
    && ['exercise', 'listening', 'video', 'dubbing'].includes(row.type)).map(row => ({
      id: row._id, type: row.type, status: row.status ?? null,
      version: row.version ?? null, contentVersion: row.contentVersion ?? null,
      hasAssetLibrary: Boolean(row.payload?.assetLibrary),
      publicCatalogSource: row.publicCatalogSource === true,
    })) }) + '\n')
const questionFixture = resourceRows.find(row => row._id === 'res_m2_exercise_animals_choice_demo')
process.stdout.write(JSON.stringify({ questionStatusFixture:
  questionFixture ? { id: questionFixture._id, status: questionFixture.status,
    version: questionFixture.version, visibilityType: questionFixture.visibility?.type ?? null,
    hasStem: typeof questionFixture.stem === 'string' && questionFixture.stem.length > 0,
    hasAnswer: questionFixture.correctAnswer !== undefined,
    hasExplanation: typeof questionFixture.explanation === 'string',
    hasActivePublicSourceReference: typeof questionFixture.payload?.assetLibrary?.sourcePublicId === 'string',
  } : null }) + '\n')
const activeTasks = await database.collection('tasks').where({ organizationId,
  deletedAt: null, status: 'active' }).limit(100).get()
const activeTaskRows = Array.isArray(activeTasks.data) ? activeTasks.data : []
process.stdout.write(JSON.stringify({ questionStatusFixtureActiveTaskCheck: {
  inspectedActiveTasks: activeTaskRows.length,
  taskPageMayBeIncomplete: activeTaskRows.length === 100,
  references: activeTaskRows.filter(row => JSON.stringify(row)
    .includes('res_m2_exercise_animals_choice_demo')).length,
} }) + '\n')
process.stdout.write(JSON.stringify({ realQuestionActiveTaskCheck: {
  id: 'res_m3_peter_rabbit_real_question_20261005',
  references: activeTaskRows.filter(row => JSON.stringify(row)
    .includes('res_m3_peter_rabbit_real_question_20261005')).length,
} }) + '\n')

const parentLinks = await database.collection('parent_student_links')
  .where({ organizationId, deletedAt: null, parentId: 'usr_parent_demo_01' }).limit(20).get()
const linkRows = Array.isArray(parentLinks.data) ? parentLinks.data : []
process.stdout.write(JSON.stringify({ collection: 'parent_student_links',
  parentFixture: 'usr_parent_demo_01', links: linkRows.map(row => ({
    studentId: row.studentId ?? null, status: row.status ?? null,
    version: row.version ?? null })) }) + '\n')
const [parentUser, studentUser, studentMembership] = await Promise.all([
  database.collection('users').doc('usr_parent_demo_01').get(),
  database.collection('users').doc('usr_student_g3_02').get(),
  database.collection('class_memberships').where({ organizationId,
    studentId: 'usr_student_g3_02', status: 'active', deletedAt: null }).limit(5).get(),
])
const first = result => Array.isArray(result.data) ? result.data[0] : result.data
const parent = first(parentUser)
const student = first(studentUser)
const memberships = Array.isArray(studentMembership.data) ? studentMembership.data : []
process.stdout.write(JSON.stringify({ bindingTestPair: {
  parentId: 'usr_parent_demo_01', parentStatus: parent?.status ?? null,
  studentId: 'usr_student_g3_02', studentStatus: student?.status ?? null,
  activeClassIds: memberships.map(row => row.classId),
  activeLinkAlreadyExists: linkRows.some(row => row.studentId === 'usr_student_g3_02'
    && row.status === 'active'),
} }) + '\n')

for (const action of ['native_admin.granted', 'native_admin.revoked',
  'native_admin.teacher.assigned', 'native_admin.teacher.assignment_revoked',
  'native_admin.teacher.granted']) {
  const response = await database.collection('operation_logs').where({
    organizationId, deletedAt: null, action }).limit(20).get()
  const rows = Array.isArray(response.data) ? response.data : []
  process.stdout.write(JSON.stringify({ collection: 'operation_logs', action,
    countWithinFirst20: rows.length,
    allVersioned: rows.every(row => Number.isSafeInteger(row.version)
      && Number.isSafeInteger(row.schemaVersion)) }) + '\n')
}
for (const targetId of ['cls_native_07c69e068bf5ffed13a66f8e57fa1ae3',
  'link_native_5c4b37eb8ccb7b7ee3fd00c521d730ab']) {
  const response = await database.collection('operation_logs').where({
    organizationId, deletedAt: null, targetId }).limit(20).get()
  const rows = Array.isArray(response.data) ? response.data : []
  process.stdout.write(JSON.stringify({ auditTarget: targetId,
    actions: rows.map(row => row.action).sort() }) + '\n')
}
