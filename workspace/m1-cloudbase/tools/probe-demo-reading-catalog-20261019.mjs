import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, mkdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { build } = require('esbuild')
const envId = 'cloud1-d8ggzrwwedb786e41'
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
function cliJson(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
  const at = raw.indexOf('{')
  if (at < 0) throw new Error('CLOUD_JSON_UNAVAILABLE')
  const parsed = JSON.parse(raw.slice(at))
  if (parsed.error) throw new Error('CLOUD_CLI_FAILED')
  return parsed.data
}
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'))
const localEnv = (await readFile(join(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
if (config.envId !== envId || localEnv !== envId) throw new Error('ENVIRONMENT_MISMATCH')
const envs = cliJson(['env', 'list', '--json'])
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no' || envs[0].EnableOverrun !== false) {
  throw new Error('NONPRODUCTION_COST_GATE')
}
const token = cliJson(['secrets', 'get', '--json'])
if (!token?.isTemporary || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE')
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token })
const entry = join(root, '.runtime/demo-reading-catalog-20261019/entry.cjs')
await mkdir(dirname(entry), { recursive: true })
await build({ entryPoints: [join(root, 'src/seed/m3-real-sample-entry.ts')], outfile: entry,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' })
const api = require(entry)
const db = api.createCloudBaseDocumentDatabase(app.database())
const query = new api.ContentQueryService(api.createOrgContentDocumentRepository(db))
const progress = new api.LearningProgressService(api.createLearningProgressDocumentRepository(db),
  { nowIso: () => new Date().toISOString() }, { next: prefix => `${prefix}_readonly_probe` })
const student = await db.get('users', 'usr_student_g3_01')
if (student?.status !== 'active' || student.organizationId !== 'org_qihang_demo') throw new Error('STUDENT_GATE')
const actor = { requestId: 'demo_reading_catalog_readonly_20261019', sessionId: 'readonly-probe',
  actorUserId: 'usr_student_g3_01', actorRole: 'student', organizationId: 'org_qihang_demo',
  platformSubjectDigest: 'readonly-probe', permissions: [], scopeIds: [],
  authzVersion: student.authzVersion ?? 1 }
const categories = ['original', 'synchronized', 'picture_book', 'current_events', 'chapter_book']
const result = []
for (const category of categories) {
  const page = await query.listStudentCatalog(actor, { type: 'reading', category }, { limit: 50, offset: 0 })
  const failures = []
  for (const item of page.items) {
    try {
      const detail = await query.getReadingResource(actor, item.id)
      if (detail.id !== item.id) throw new Error('DETAIL_ID_MISMATCH')
      await progress.getReadingProgress(actor, item.id)
    } catch (error) {
      failures.push({ id: item.id, title: item.title,
        reason: String(error?.code ?? error?.message ?? 'UNKNOWN').slice(0, 80) })
    }
  }
  result.push({ category, total: page.total, checked: page.items.length, failures })
}
process.stdout.write(JSON.stringify({ environment: 'verified_nonproduction',
  studentId: actor.actorUserId, results: result }) + '\n')
