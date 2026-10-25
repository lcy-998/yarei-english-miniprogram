// Read-only data contract exercise against the current nonproduction database.
// Executes local services, not deployed cloud-function code; emits counts and status only.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve('D:/app/workspace/m1-cloudbase')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'))
const envLine = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))
const envId = envLine?.slice('TCB_ENV_ID='.length).trim()
if (envId !== 'cloud1-d8ggzrwwedb786e41' || config.envId !== envId) {
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

const runtime = resolve(root, '.runtime/m3-native-six-page-readonly')
await mkdir(runtime, { recursive: true })
const entry = resolve(runtime, 'entry.cjs')
await build({ entryPoints: [resolve(root, 'src/seed/m3-native-admin-readonly-audit-entry.ts')],
  outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' })
const require = createRequire(resolve(root, 'package.json'))
const api = require(entry)
const cloudbase = require('@cloudbase/node-sdk')
const database = api.createCloudBaseDocumentDatabase(cloudbase.init({ env: envId,
  secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token }).database())
const grants = new api.DocumentNativeAdminGrantRepository(database)
const user = await database.get('users', 'usr_teacher_demo_01')
const grant = await grants.findGrant('org_qihang_demo', 'usr_teacher_demo_01')
if (!user || !grant || grant.status !== 'active' || grant.version !== 2
  || user.authorizationVersion !== 8) throw new Error('DEMO_TEACHER_BASELINE_CHANGED')
const actor = { requestId: 'm3_six_page_readonly', sessionId: 'm3_six_page_readonly',
  actorUserId: 'usr_teacher_demo_01', actorRole: 'teacher', organizationId: 'org_qihang_demo',
  platformSubjectDigest: 'audit_only', permissions: [...grant.permissions],
  scopeIds: ['org_qihang_demo'], authzVersion: user.authorizationVersion }
const access = new api.NativeAdminQueryService(grants)
const data = new api.NativeAdminDataService(grants, database)
const candidates = new api.NativeAdminGrantCandidateService(grants, database)

async function check(name, fn) {
  try {
    const value = await fn()
    process.stdout.write(JSON.stringify({ name, ok: true, ...value }) + '\n')
  } catch (error) {
    process.stdout.write(JSON.stringify({ name, ok: false,
      errorName: typeof error?.name === 'string' ? error.name : 'UnknownError',
      errorKind: typeof error?.kind === 'string' ? error.kind : null,
      safeMessage: typeof error?.message === 'string' && error.message.startsWith('CloudBase ')
        ? error.message.slice(0, 120) : null,
      code: typeof error?.code === 'string' ? error.code : 'UNAVAILABLE' }) + '\n')
  }
}

await check('A01.access', async () => {
  const result = await access.getAccess(actor)
  return { permissionCount: result.permissions.length }
})
await check('A02.organization', async () => ({ version: (await data.getOrganization(actor)).version }))
await check('A02.classes', async () => {
  const result = await data.listClasses(actor, 20, 0, '')
  return { count: result.items.length, nextOffset: result.nextOffset }
})
await check('A03.users', async () => {
  const result = await data.listUsers(actor, '', 20, 0, '', '')
  return { count: result.items.length, nextOffset: result.nextOffset }
})
await check('A03.students', async () => {
  const started = Date.now()
  const result = await data.listUsers(actor, '', 20, 0, '', 'student')
  return { count: result.items.length, nextOffset: result.nextOffset,
    elapsedMs: Date.now() - started }
})
for (const [name, kind, classId] of [
  ['A02.teacherOptions', 'teacher_for_class', 'cls_grade3_2'],
  ['A03.classOptions', 'class_for_user', ''],
  ['A03.parentOptions', 'parent_for_binding', ''],
  ['A03.studentOptions', 'student_for_binding', 'cls_grade3_2'],
  ['A04.classOptions', 'class_for_grant', ''],
]) {
  await check(name, async () => {
    const result = await data.listSelectionOptions(actor, kind, classId, 20, 0, '')
    return { count: result.items.length, nextOffset: result.nextOffset }
  })
}
await check('A03.bindings', async () => ({ count: (await data.listUserBindings(actor,
  'usr_parent_demo_01')).items.length }))
await check('A04.grants', async () => ({ count: (await data.listGrants(actor, 20, 0, '')).items.length }))
await check('A04.candidates', async () => ({ count: (await candidates.list(actor, 20, 0, '')).items.length }))
await check('A04.audit', async () => ({ count: (await data.listAudit(actor, 20, 0)).items.length }))
await check('A06.questions', async () => {
  const result = await data.listRecords(actor, 'questions', 20, 0, {})
  return { count: result.items.length, nextOffset: result.nextOffset }
})
await check('A06.preview', async () => ({ version: (await data.getQuestionPreview(actor,
  'res_m3_peter_rabbit_real_question_20261005')).version }))
await check('A08.media', async () => {
  const result = await data.listRecords(actor, 'media', 20, 0, {})
  return { count: result.items.length, nextOffset: result.nextOffset }
})
await check('A08.summary', async () => ({ version: (await data.getMediaReviewSummary(actor,
  'res_m3_peter_rabbit_listening_auto_20261005')).recordVersion }))
await check('A08.audit', async () => ({ count: (await data.listMediaAudit(actor,
  'res_m3_peter_rabbit_listening_auto_20261005', 20, 0)).items.length }))
