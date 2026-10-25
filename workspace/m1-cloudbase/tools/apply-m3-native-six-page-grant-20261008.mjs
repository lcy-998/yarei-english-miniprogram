// Exact virtual-teacher grant narrowing from the user-approved 2026-10-08 review.
// `plan` is read-only. `apply --approved` performs one audited CAS operation.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const mode = process.argv[2]
if (!['plan', 'apply'].includes(mode)
  || mode === 'apply' && !process.argv.includes('--approved')) throw new Error('MODE_OR_APPROVAL_INVALID')
const root = resolve('D:/app/workspace/m1-cloudbase')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const envId = 'cloud1-d8ggzrwwedb786e41'
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'))
const configuredEnv = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(row => row.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim()
if (config.envId !== envId || configuredEnv !== envId) throw new Error('ENVIRONMENT_MISMATCH')

function readCloud(args) {
  let raw
  try {
    raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
      windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'] })
  } catch { throw new Error(`CLOUD_READ_FAILED:${args[1] ?? 'unknown'}`) }
  const result = JSON.parse(raw.slice(raw.indexOf('{')))
  if (result.error) throw new Error(`CLOUD_READ_ERROR:${args[1] ?? 'unknown'}`)
  return result.data
}
const environments = readCloud(['env', 'list', '--json'])
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('COST_OR_ENVIRONMENT_GATE')
}
const today = new Date().toISOString().slice(0, 10)
const credits = readCloud(['api', 'tcb', 'DescribeCreditsUsage', '--body', JSON.stringify({
  EnvId: envId, StartDate: `${today.slice(0, 7)}-01`, EndDate: today }), '--json'])
if (credits?.ReportValue !== 0) throw new Error('NONZERO_OR_UNKNOWN_BILLING')
const credential = readCloud(['secrets', 'get', '--json'])
if (credential?.isTemporary !== true || credential.envId !== envId
  || Date.parse(credential.expiredAt) <= Date.now() + 120_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID')
}

const output = resolve(root, '.runtime/m3-native-six-page-grant-20261008')
await mkdir(output, { recursive: true })
const entry = resolve(output, 'entry.cjs')
await build({ entryPoints: [resolve(root, 'src/seed/m3-native-admin-bootstrap-entry.ts')],
  outfile: entry, bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' })
const require = createRequire(resolve(root, 'package.json'))
const api = require(entry)
const cloudbase = require('@cloudbase/node-sdk')
const database = api.createCloudBaseDocumentDatabase(cloudbase.init({ env: envId,
  secretId: credential.secretId, secretKey: credential.secretKey,
  sessionToken: credential.token }).database())
const org = 'org_qihang_demo'
const adminId = 'usr_admin_demo_01'
const teacherId = 'usr_teacher_demo_01'
const operationId = 'm3_native_six_page_scope_20261008'
const desired = ['dashboard.read', 'organization.manage', 'user.manage',
  'authorization.manage', 'question.manage', 'media.review']
const old = [...desired, 'textbook.manage', 'task.manage', 'student_work.restore']
const grantId = `native_admin_${createHash('sha256')
  .update(JSON.stringify([org, teacherId])).digest('hex').slice(0, 40)}`
const receiptId = `native_admin_op_${createHash('sha256')
  .update(JSON.stringify([org, adminId, operationId])).digest('hex').slice(0, 40)}`
const [admin, adminRole, teacher, teacherRole, grant, receipt] = await Promise.all([
  database.get('users', adminId), database.get('role_assignments', 'rol_admin_demo_01'),
  database.get('users', teacherId), database.get('role_assignments', 'rol_teacher_demo_01'),
  database.get('native_admin_grants', grantId), database.get('native_admin_operations', receiptId),
])
if (admin?.organizationId !== org || admin.status !== 'active'
  || adminRole?.organizationId !== org || adminRole.role !== 'admin'
  || adminRole.status !== 'active' || !adminRole.permissions?.includes('authorization.manage')
  || teacher?.organizationId !== org || teacher.status !== 'active'
  || teacherRole?.organizationId !== org || teacherRole.role !== 'teacher'
  || teacherRole.status !== 'active' || grant?.organizationId !== org
  || grant.teacherId !== teacherId || grant.status !== 'active'
  || grant.scope?.organizationWide !== true) throw new Error('ACTOR_OR_GRANT_BASELINE_CHANGED')
const equalPermissions = (actual, expected) => Array.isArray(actual)
  && actual.length === expected.length && expected.every(value => actual.includes(value))
if (receipt) {
  if (grant.version !== 2 || teacher.authorizationVersion !== 8
    || !equalPermissions(grant.permissions, desired)
    || receipt.operationId !== operationId) throw new Error('PARTIAL_GRANT_STATE')
  process.stdout.write(JSON.stringify({ status: 'already-applied', grantVersion: 2,
    authorizationVersion: 8, permissionCount: 6 }) + '\n')
  process.exit(0)
}
if (grant.version !== 1 || teacher.version !== 8 || teacher.authorizationVersion !== 7
  || !equalPermissions(grant.permissions, old)) throw new Error('EXPECTED_GRANT_VERSION_CHANGED')
process.stdout.write(JSON.stringify({ status: 'ready', mode,
  grantVersion: 1, teacherVersion: 8, authorizationVersion: 7,
  remove: ['textbook.manage', 'task.manage', 'student_work.restore'],
  keep: desired, billingReportValue: 0 }) + '\n')
if (mode === 'plan') process.exit(0)

const grants = new api.DocumentNativeAdminGrantRepository(database)
const service = new api.NativeAdminGrantService(grants,
  { nowIso: () => new Date().toISOString() },
  { next: prefix => `${prefix}_${randomUUID().replaceAll('-', '')}` }, grants)
const actor = { requestId: `req_${operationId}`, sessionId: `operator_${operationId}`,
  actorUserId: adminId, actorRole: 'admin', organizationId: org,
  platformSubjectDigest: 'authorized_nonproduction_operator',
  permissions: [...adminRole.permissions], scopeIds: [...adminRole.scopeIds],
  authzVersion: admin.authorizationVersion }
const result = await service.setGrant(actor, teacherId, { status: 'active',
  permissions: desired, scope: { organizationWide: true, classIds: [] } },
1, 8, 'M3 六页非生产验收：收敛虚构教师管理授权', operationId)
const [updatedUser, updatedGrant, operation] = await Promise.all([
  database.get('users', teacherId), database.get('native_admin_grants', grantId),
  database.get('native_admin_operations', receiptId),
])
if (result.version !== 2 || updatedGrant?.version !== 2
  || !equalPermissions(updatedGrant.permissions, desired)
  || updatedUser?.authorizationVersion !== 8 || !operation) {
  throw new Error('GRANT_POSTCHECK_FAILED')
}
process.stdout.write(JSON.stringify({ status: 'applied', grantVersion: 2,
  authorizationVersion: 8, permissionCount: 6,
  operationReceiptPresent: true }) + '\n')
