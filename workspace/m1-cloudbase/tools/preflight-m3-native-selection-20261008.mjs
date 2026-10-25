// Exact read-only gate for the pending one-function candidate-list review.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const envId = 'cloud1-d8ggzrwwedb786e41'
const configured = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(row => row.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim()
if (configured !== envId
  || JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8')).envId !== envId) {
  throw new Error('ENVIRONMENT_MISMATCH')
}
function cloud(args) {
  let raw
  try {
    raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
      encoding: 'utf8', windowsHide: true, timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 24 * 1024 * 1024 })
  } catch { throw new Error(`READ_ONLY_CLI_FAILED:${args[1] ?? 'unknown'}`) }
  const result = JSON.parse(raw.slice(raw.indexOf('{')))
  if (result.error) throw new Error(`READ_ONLY_CLI_ERROR:${args[1] ?? 'unknown'}`)
  return result.data
}
const environments = cloud(['env', 'list', '--json'])
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_COST_GATE')
}
const today = new Date().toISOString().slice(0, 10)
const credits = cloud(['api', 'tcb', 'DescribeCreditsUsage', '--body', JSON.stringify({
  EnvId: envId, StartDate: `${today.slice(0, 7)}-01`, EndDate: today }), '--json'])
if (credits?.ReportValue !== 0) throw new Error('NONZERO_OR_UNKNOWN_BILLING')
const review = resolve(root, 'dist/m3-native-selection-review-20261008')
const manifest = JSON.parse(readFileSync(resolve(review, 'manifest.json'), 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase()
const code = readFileSync(resolve(review, 'local-native/native-admin-query/index.js'))
const zip = readFileSync(resolve(review, 'native-admin-query.zip'))
if (hash(code) !== manifest.codeSha256 || hash(zip) !== manifest.zipSha256
  || manifest.codeSha256 !== 'CC1235B2221FF959088153351E056ED6CAF311C7A9190852E8B4E7F7EAA48F59') {
  throw new Error('LOCAL_ARTIFACT_CHANGED')
}
const detail = cloud(['fn', 'detail', 'native-admin-query', '--json'])
const currentHash = typeof detail.CodeInfo === 'string' ? hash(detail.CodeInfo) : null
const keys = Array.isArray(detail.Environment?.Variables)
  ? detail.Environment.Variables.map(row => row.Key).sort() : []
const expectedKeys = ['YAREI_BATCH_REVIEW_SIGNING_KEY', 'YAREI_BINDING_CODE_DERIVATION_KEY',
  'YAREI_BINDING_CODE_PEPPER', 'YAREI_BUSINESS_SESSION_ENCRYPTION_KEY',
  'YAREI_QUERY_CURSOR_SIGNING_KEY', 'YAREI_SUBJECT_PEPPER']
const route = cloud(['fn', 'get-route', 'native-admin-query', '--json'])
const versions = cloud(['fn', 'list-function-versions', 'native-admin-query', '--json'])
if (detail.Status !== 'Active' || detail.Runtime !== 'Nodejs20.19'
  || detail.Handler !== 'index.main' || detail.Timeout !== 20 || detail.MemorySize !== 256
  || detail.InstallDependency !== 'TRUE' || detail.FunctionVersion !== '$LATEST'
  || detail.Triggers?.length !== 0 || JSON.stringify(keys) !== JSON.stringify(expectedKeys)
  || currentHash !== 'A02F61301E2C62B1AE66FE92076DBC981D0FCA47783B9B71C4DDDDB67717D9EE'
  || route.FunctionVersion !== '$LATEST'
  || route.RoutingConfig?.AdditionalVersionWeights?.length !== 0
  || !Array.isArray(versions.Versions)
  || versions.Versions.some(row => row.Version === '2')
  || !versions.Versions.some(row => row.Version === '1' && row.Status === 'Active')) {
  throw new Error('REMOTE_FUNCTION_OR_ROLLBACK_CHANGED')
}
const credential = cloud(['secrets', 'get', '--json'])
if (credential?.isTemporary !== true || credential.envId !== envId
  || Date.parse(credential.expiredAt) <= Date.now() + 120_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID')
}
const require = createRequire(resolve(root, 'package.json'))
const database = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: credential.secretId, secretKey: credential.secretKey,
  sessionToken: credential.token }).database()
const teacherResponse = await database.collection('users').doc('usr_teacher_demo_01').get()
const grantResponse = await database.collection('native_admin_grants').where({
  organizationId: 'org_qihang_demo', teacherId: 'usr_teacher_demo_01', deletedAt: null,
}).limit(2).get()
const teacher = Array.isArray(teacherResponse.data) ? teacherResponse.data[0] : teacherResponse.data
const grants = Array.isArray(grantResponse.data) ? grantResponse.data : []
if (teacher?.status !== 'active' || teacher.authorizationVersion !== 8
  || grants.length !== 1 || grants[0].version !== 2 || grants[0].status !== 'active'
  || grants[0].permissions?.length !== 6) throw new Error('DEMO_GRANT_CHANGED')
process.stdout.write(JSON.stringify({ ready: true, environmentId: envId,
  billingReportValue: 0, currentHash, candidateHash: manifest.codeSha256,
  candidateZipHash: manifest.zipSha256, existingRollbackVersion: 1,
  nextRollbackVersionAvailable: 2, grantVersion: 2 }) + '\n')
