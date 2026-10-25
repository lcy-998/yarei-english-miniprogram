// Exact, read-only gate for the user-approved 2026-10-08 native-admin package.
// Never prints credentials or environment variable values.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const envId = 'cloud1-d8ggzrwwedb786e41'
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'))
const configuredEnv = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(row => row.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim()
if (config.envId !== envId || configuredEnv !== envId) throw new Error('ENVIRONMENT_MISMATCH')
const expected = new Map([
  ['native-admin-query', '84CFF05F806D400B968C618287F45826D0D61F4A602EBC861DD6ABF4DB81CEFA'],
  ['native-admin-command', 'D2F8B0AB71636C6826D4CD011945A6579E036681EFF5EB2ACBA08F44B5FD0507'],
  ['native-admin-management-command', 'CFA8E4002C84324D53A4764B22996E198BCD478B8274B0E489C4471C00E293EA'],
  ['native-admin-operations-command', '8CC6FCCCE21233CB9B7F8D955E299B66632DDE183F6C4A9D6F26D933E9C33DCC'],
  ['native-admin-media-command', '2499A1DD8469A11B5FD517849395A7344BBE014FD6E7232C47B7EFFE51D46D4F'],
])
const expectedKeys = ['YAREI_BATCH_REVIEW_SIGNING_KEY', 'YAREI_BINDING_CODE_DERIVATION_KEY',
  'YAREI_BINDING_CODE_PEPPER', 'YAREI_BUSINESS_SESSION_ENCRYPTION_KEY',
  'YAREI_QUERY_CURSOR_SIGNING_KEY', 'YAREI_SUBJECT_PEPPER']
const reviewRoot = resolve(root, 'dist/m3-native-six-page-review-20261008')
const manifest = JSON.parse(readFileSync(resolve(reviewRoot, 'local-native-review-manifest.json'), 'utf8'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase()

function readCloud(args) {
  let raw
  try {
    raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
      windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 24 * 1024 * 1024 })
  } catch { throw new Error(`READ_ONLY_CLI_FAILED:${args[1] ?? 'unknown'}`) }
  const first = raw.indexOf('{')
  if (first < 0) throw new Error('CLI_JSON_MISSING')
  const result = JSON.parse(raw.slice(first))
  if (result.error) throw new Error(`READ_ONLY_CLI_ERROR:${args[1] ?? 'unknown'}`)
  return result.data
}

const environments = readCloud(['env', 'list', '--json'])
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_BILLING_GATE')
}
const now = new Date().toISOString().slice(0, 10)
const credits = readCloud(['api', 'tcb', 'DescribeCreditsUsage', '--body', JSON.stringify({
  EnvId: envId, StartDate: `${now.slice(0, 7)}-01`, EndDate: now }), '--json'])
if (credits?.ReportValue !== 0) throw new Error('NONZERO_OR_UNKNOWN_BILLING')

for (const [name, oldHash] of expected) {
  const item = manifest.functions.find(row => row.name === name)
  if (!item) throw new Error(`LOCAL_MANIFEST_MISSING:${name}`)
  const code = readFileSync(resolve(reviewRoot, 'local-native', name, 'index.js'))
  const zip = readFileSync(resolve(reviewRoot, 'zips', `${name}.zip`))
  if (sha(code) !== item.codeSha256 || sha(zip) !== item.zipSha256) {
    throw new Error(`LOCAL_ARTIFACT_CHANGED:${name}`)
  }
  const detail = readCloud(['fn', 'detail', name, '--json'])
  const keys = Array.isArray(detail.Environment?.Variables)
    ? detail.Environment.Variables.map(row => row.Key).sort() : []
  if (detail.FunctionName !== name || detail.Status !== 'Active'
    || detail.Runtime !== 'Nodejs20.19' || detail.Handler !== 'index.main'
    || detail.Timeout !== 20 || detail.MemorySize !== 256
    || detail.InstallDependency !== 'TRUE' || detail.FunctionVersion !== '$LATEST'
    || !Array.isArray(detail.Triggers) || detail.Triggers.length !== 0
    || JSON.stringify(keys) !== JSON.stringify(expectedKeys)
    || typeof detail.CodeInfo !== 'string' || sha(detail.CodeInfo) !== oldHash) {
    throw new Error(`REMOTE_FUNCTION_CHANGED:${name}`)
  }
  const route = readCloud(['fn', 'get-route', name, '--json'])
  if (route.FunctionVersion !== '$LATEST'
    || !Array.isArray(route.RoutingConfig?.AdditionalVersionWeights)
    || route.RoutingConfig.AdditionalVersionWeights.length !== 0) {
    throw new Error(`ROUTE_CHANGED:${name}`)
  }
  process.stdout.write(JSON.stringify({ name, oldHash, newHash: item.codeSha256,
    zipHash: item.zipSha256, configMatched: true, routeMatched: true }) + '\n')
}

const credentials = readCloud(['secrets', 'get', '--json'])
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 120_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID')
}
const require = createRequire(resolve(root, 'package.json'))
const database = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token }).database()
const first = response => Array.isArray(response.data) ? response.data[0] : response.data
const [teacherResponse, adminResponse, parentResponse, studentResponse, grantResponse,
  linksResponse, classResponse] = await Promise.all([
  database.collection('users').doc('usr_teacher_demo_01').get(),
  database.collection('users').doc('usr_admin_demo_01').get(),
  database.collection('users').doc('usr_parent_demo_01').get(),
  database.collection('users').doc('usr_student_g3_02').get(),
  database.collection('native_admin_grants').where({ organizationId: 'org_qihang_demo',
    teacherId: 'usr_teacher_demo_01', deletedAt: null }).limit(2).get(),
  database.collection('parent_student_links').where({ organizationId: 'org_qihang_demo',
    parentId: 'usr_parent_demo_01', studentId: 'usr_student_g3_02',
    status: 'active', deletedAt: null }).limit(1).get(),
  database.collection('classes').where({ organizationId: 'org_qihang_demo',
    name: 'M3-20261008-验收', deletedAt: null }).limit(1).get(),
])
const teacher = first(teacherResponse)
const admin = first(adminResponse)
const parent = first(parentResponse)
const student = first(studentResponse)
const grants = Array.isArray(grantResponse.data) ? grantResponse.data : []
const requiredPermissions = ['dashboard.read', 'organization.manage', 'user.manage',
  'authorization.manage', 'question.manage', 'media.review', 'textbook.manage',
  'task.manage', 'student_work.restore']
if (teacher?.organizationId !== 'org_qihang_demo' || teacher.status !== 'active'
  || teacher.version !== 8 || teacher.authorizationVersion !== 7
  || admin?.organizationId !== 'org_qihang_demo' || admin.status !== 'active'
  || parent?.status !== 'active' || student?.status !== 'active'
  || grants.length !== 1 || grants[0].status !== 'active' || grants[0].version !== 1
  || grants[0].scope?.organizationWide !== true
  || !requiredPermissions.every(permission => grants[0].permissions?.includes(permission))
  || (Array.isArray(linksResponse.data) ? linksResponse.data.length : 0) !== 0
  || (Array.isArray(classResponse.data) ? classResponse.data.length : 0) !== 0) {
  throw new Error('CONTROLLED_FIXTURE_CHANGED')
}
process.stdout.write(JSON.stringify({ environmentId: envId, billingReportValue: 0,
  functionCount: expected.size, demoTeacherGrantVersion: 1,
  demoTeacherAuthorizationVersion: 7, bindingPairUnused: true,
  temporaryClassNameUnused: true, ready: true }) + '\n')
