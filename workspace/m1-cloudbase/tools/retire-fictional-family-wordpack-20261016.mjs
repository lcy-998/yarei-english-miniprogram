import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'

const mode = process.argv[2]
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID')
const root = process.cwd()
const require = createRequire(join(root, 'package.json'))
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'))
const envId = config.envId
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const RESOURCE_ID = 'res_launch_pep3a_u2_vocabulary_v1_20261012'
const TASK_ID = 'task_6B7LI74NTk0lI2k3ri5Ar-hlheWYW2wt'
const ORGANIZATION_ID = 'org_qihang_demo'
const AUDIT_ID = 'audit_m3_fictional_family_wordpack_offline_20261016'
const OPERATION_ID = 'm3-retire-fictional-family-wordpack-2026-10-16'
const EXPECTED_ORGANIZATIONS = ['org_isolation_secondary', 'org_qihang_demo']

function cliJson(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] })
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE')
  const result = JSON.parse(raw.slice(start))
  if (result.error) throw new Error('CLOUD_PREFLIGHT_FAILED')
  return result
}

if (!envId || !config.envId) throw new Error('NONPRODUCTION_ENV_MISSING')
const envs = cliJson(['env', 'list', '--json']).data
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '\u4e2a\u4eba\u7248'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE')
}
const secrets = cliJson(['secrets', 'get', '--json']).data
if (secrets?.isTemporary !== true || secrets.envId !== envId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_TOKEN_GATE')
const bundle = join(root, '.runtime', 'fictional-wordpack-retirement', 'entry.cjs')
await mkdir(join(root, '.runtime', 'fictional-wordpack-retirement'), { recursive: true })
await build({ entryPoints: [join(root, 'src', 'seed', 'm3-real-sample-entry.ts')], outfile: bundle,
  bundle: true, format: 'cjs', platform: 'node', target: 'node20', logLevel: 'silent' })
const api = require(bundle)
const app = require('@cloudbase/js-sdk').init({ env: envId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token })
const db = api.createCloudBaseDocumentDatabase(app.database())
const content = new api.ContentQueryService(api.createOrgContentDocumentRepository(db))
const [resource, task, assignments, submissions, audit, orgRows, otherTasks] = await Promise.all([
  db.get('learning_resources', RESOURCE_ID), db.get('tasks', TASK_ID),
  db.find('task_assignments', { organizationId: ORGANIZATION_ID, taskId: TASK_ID }),
  db.find('submissions', { organizationId: ORGANIZATION_ID, taskId: TASK_ID }),
  db.get('operation_logs', AUDIT_ID),
  db.find('organizations', { status: 'active', deletedAt: null }),
  db.find('tasks', { organizationId: ORGANIZATION_ID, deletedAt: null }),
])
const activeOrganizationIds = orgRows.filter(x => x._id === x.organizationId).map(x => x._id).sort()
if (JSON.stringify(activeOrganizationIds) !== JSON.stringify(EXPECTED_ORGANIZATIONS)) {
  throw new Error('ACTIVE_ORGANIZATION_SCOPE_CHANGED')
}
if (!resource || resource._id !== RESOURCE_ID || resource.organizationId !== ORGANIZATION_ID
  || resource.type !== 'vocabulary' || resource.status !== 'published' || resource.version !== 2
  || resource.deletedAt !== null || resource.publicCatalogSource === true
  || resource.visibility?.type !== 'organization'
  || resource.payload?.words?.length !== 3
  || JSON.stringify(resource.payload.words.map(x => x.word)) !== JSON.stringify(['mum', 'grandma', 'grandpa'])) {
  throw new Error('TARGET_RESOURCE_SCOPE_MISMATCH')
}
if (!task || task._id !== TASK_ID || task.organizationId !== ORGANIZATION_ID
  || task.status !== 'active' || task.visibility !== 'visible' || task.version !== 2
  || !(Date.parse(task.dueAt) < Date.now())
  || !(task.itemRefs ?? []).some(x => x.resourceId === RESOURCE_ID)
  || !(task.items ?? []).some(x => x.resourceId === RESOURCE_ID || x.resourceSnapshot?.id === RESOURCE_ID)) {
  throw new Error('RELATED_TASK_SCOPE_MISMATCH')
}
const references = otherTasks.filter(x => x.itemRefs?.some(r => r.resourceId === RESOURCE_ID)
  || x.items?.some(i => i.resourceId === RESOURCE_ID || i.resourceSnapshot?.id === RESOURCE_ID))
const activeReferences = references.filter(x => x.status === 'active' && x.visibility !== 'recycled'
  && x.status !== 'withdrawn')
if (references.length !== 4 || activeReferences.length !== 1 || activeReferences[0]._id !== TASK_ID) {
  throw new Error('TASK_REFERENCE_SCOPE_CHANGED')
}
if (audit) throw new Error('RETIREMENT_AUDIT_ALREADY_EXISTS')
const actor = { requestId: 'fictional_wordpack_retirement_readback', sessionId: 'server-retirement',
  actorUserId: 'usr_student_g3_01', actorRole: 'student', organizationId: ORGANIZATION_ID,
  platformSubjectDigest: 'server-retirement', permissions: ['content.read'],
  scopeIds: ['cls_grade3_2'], authzVersion: 1 }
const preCatalog = await content.listStudentCatalog(actor,
  { type: 'vocabulary', keyword: '\u5bb6\u5ead\u6210\u5458\u4e09\u8bcd' }, { limit: 50, offset: 0 })
if (!preCatalog.items.some(x => x.id === RESOURCE_ID)) throw new Error('TARGET_NOT_IN_STUDENT_DIRECTORY')
if (mode === 'inspect') {
  console.log(JSON.stringify({ status: 'ready', envId, sourceId: RESOURCE_ID, sourceVersion: resource.version,
    taskId: TASK_ID, taskVersion: task.version, relatedTasks: references.length,
    visibleActiveTasks: activeReferences.length, assignmentsPreserved: assignments.length,
    submissionsPreserved: submissions.length, currentStudentCatalogVisible: true,
    plannedChanges: ['offline source', 'recycle overdue demo task', 'append audit'],
    physicalDeletion: false, mediaDeletion: false }))
  process.exit(0)
}
if (mode === 'apply') {
  const now = new Date().toISOString()
  const recoverableUntil = new Date(Date.now() + 7 * 86400_000).toISOString()
  const nextResource = { ...resource, status: 'offline', version: resource.version + 1,
    updatedAt: now, offlineAt: now, offlineReason: 'fictional_test_material_retired_at_user_request' }
  const nextTask = { ...task, status: 'withdrawn', visibility: 'recycled', version: task.version + 1,
    updatedAt: now, recycledAt: now, recycledBy: 'system_m3_fictional_material_retirement',
    recycleReason: 'fictional_test_material_retired_at_user_request', recoverableUntil,
    withdrawnAt: now, withdrawnBy: 'system_m3_fictional_material_retirement',
    withdrawReason: 'fictional_test_material_retired_at_user_request' }
  const log = { _id: AUDIT_ID, id: AUDIT_ID, organizationId: ORGANIZATION_ID,
    schemaVersion: 1, version: 1, deletedAt: null, requestId: OPERATION_ID,
    actorUserId: null, actorRole: 'system', action: 'content.fictionalTestMaterialRetired',
    targetType: 'learning_resource', targetId: RESOURCE_ID, result: 'succeeded', errorCode: null,
    occurredAt: now, metadata: { operationId: OPERATION_ID, resourceId: RESOURCE_ID,
      resourceVersion: { from: resource.version, to: nextResource.version },
      previousStatus: resource.status, newStatus: nextResource.status,
      relatedTaskIds: references.map(x => x._id), recycledTaskId: TASK_ID,
      taskVersion: { from: task.version, to: nextTask.version },
      assignmentsPreserved: assignments.length, submissionsPreserved: submissions.length,
      taskHistoryAndSnapshotsPreserved: true, physicalDeletion: false, mediaDeletion: false,
      activeOrganizations: activeOrganizationIds } }
  await db.runTransaction(async tx => {
    if (await tx.get('operation_logs', AUDIT_ID)) throw new Error('RETIREMENT_AUDIT_ALREADY_EXISTS')
    const latestResource = await tx.get('learning_resources', RESOURCE_ID)
    const latestTask = await tx.get('tasks', TASK_ID)
    if (!latestResource || latestResource.version !== resource.version || latestResource.status !== 'published'
      || !await tx.replace('learning_resources', RESOURCE_ID, resource.version, nextResource)) {
      throw new Error('RESOURCE_VERSION_CHANGED')
    }
    if (!latestTask || latestTask.version !== task.version || latestTask.visibility !== 'visible'
      || !await tx.replace('tasks', TASK_ID, task.version, nextTask)) throw new Error('TASK_VERSION_CHANGED')
    if (!await tx.create('operation_logs', log)) throw new Error('AUDIT_WRITE_FAILED')
  })
}
const [afterResource, afterTask, afterAssignments, afterSubmissions, afterAudit] = await Promise.all([
  db.get('learning_resources', RESOURCE_ID), db.get('tasks', TASK_ID),
  db.find('task_assignments', { organizationId: ORGANIZATION_ID, taskId: TASK_ID }),
  db.find('submissions', { organizationId: ORGANIZATION_ID, taskId: TASK_ID }),
  db.get('operation_logs', AUDIT_ID),
])
const afterCatalog = await content.listStudentCatalog(actor,
  { type: 'vocabulary', keyword: '\u5bb6\u5ead\u6210\u5458\u4e09\u8bcd' }, { limit: 50, offset: 0 })
if (afterResource?.status !== 'offline' || afterResource.version !== resource.version + 1
  || afterTask?.status !== 'withdrawn' || afterTask.visibility !== 'recycled'
  || afterTask.version !== task.version + 1 || afterAssignments.length !== assignments.length
  || afterSubmissions.length !== submissions.length || !afterAudit
  || afterCatalog.items.some(x => x.id === RESOURCE_ID)) throw new Error('RETIREMENT_READBACK_FAILED')
console.log(JSON.stringify({ status: 'verified', envId, resourceId: RESOURCE_ID,
  resourceStatus: afterResource.status, resourceVersion: afterResource.version,
  taskId: TASK_ID, taskStatus: afterTask.status, taskVisibility: afterTask.visibility,
  taskVersion: afterTask.version, assignmentCountPreserved: afterAssignments.length,
  submissionCountPreserved: afterSubmissions.length, studentCatalogVisible: false,
  historyDeleted: false, mediaDeleted: false, auditId: afterAudit._id }))
process.exit(0)
