// Read-only inventory for a failed T-13 class textbook publish.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('D:/app/workspace/m1-cloudbase')
const require = createRequire(resolve(root, 'package.json'))
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
function call(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')))
  if (parsed.error) throw new Error('CLOUD_PRECHECK_FAILED')
  return parsed.data
}
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'))
const envLine = (await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))
const envId = envLine?.slice(11).trim()
const environments = call(['env', 'list', '--json'])
if (!envId || envId !== config.envId || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no') throw new Error('NONPRODUCTION_ENV_GATE')
const token = call(['secrets', 'get', '--json'])
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE')
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token })
const db = app.database()
async function list(collection) {
  const rows = []
  for (let offset = 0; offset < 500; offset += 100) {
    const page = await db.collection(collection).skip(offset).limit(100).get()
    rows.push(...page.data)
    if (page.data.length < 100) return rows
  }
  throw new Error('READ_LIMIT')
}
const configs = await list('class_textbook_configs')
const classIds = [...new Set(configs.map(row => row.classId).filter(Boolean))]
const classes = await Promise.all(classIds.map(async id => {
  const result = await db.collection('classes').doc(id).get()
  const row = result.data[0]
  return row ? { id, organizationId: row.organizationId, grade: row.grade, status: row.status } : { id, missing: true }
}))
const referenced = new Set(configs.flatMap(row => [
  ...(Array.isArray(row.textbooks) ? row.textbooks : []),
  ...(Array.isArray(row.publishedTextbooks) ? row.publishedTextbooks : []),
].map(item => item.textbookId)))
const publishedPage = await db.collection('learning_resources')
  .where({ category: 'synchronized' }).limit(100).get()
if (publishedPage.data.length >= 100) throw new Error('TEXTBOOK_READ_LIMIT')
const references = await Promise.all([...referenced].map(async id => {
  const result = await db.collection('learning_resources').doc(id).get()
  return result.data[0] ?? null
}))
const resources = [...new Map([...publishedPage.data, ...references.filter(Boolean)]
  .map(row => [row._id, row])).values()]
const textbooks = resources.filter(row => row.type === 'reading'
  && (row.category === 'synchronized' || row.payload?.category === 'synchronized'))
const rows = textbooks.filter(row => row.status === 'published' || referenced.has(row._id))
  .map(row => ({ id: row._id, organizationId: row.organizationId, status: row.status,
    contentVersion: row.contentVersion, deleted: row.deletedAt !== null,
    category: row.category ?? row.payload?.category,
    chapters: (row.payload?.textbookChapters ?? row.payload?.chapters ?? []).length,
    lessons: (row.payload?.textbookChapters ?? row.payload?.chapters ?? [])
      .reduce((count, chapter) => count + (chapter.lessons?.length ?? 0), 0),
    grade: row.grade ?? row.payload?.grade,
    termType: typeof (row.term ?? row.payload?.term),
    editionType: typeof (row.textbook ?? row.payload?.textbook),
    visibilityType: typeof row.visibility === 'string' ? row.visibility : row.visibility?.type,
  }))
const configurations = configs.map(row => ({ id: row._id, organizationId: row.organizationId,
  classId: row.classId, status: row.status, version: row.version,
  textbooks: Array.isArray(row.textbooks) ? row.textbooks.map(item => ({
    id: item.textbookId, contentVersion: item.contentVersion,
    chapters: item.chapterIds?.length, lessons: item.lessonIds?.length })) : [],
  publishedTextbooks: Array.isArray(row.publishedTextbooks) ? row.publishedTextbooks.map(item => ({
    id: item.textbookId, contentVersion: item.contentVersion })) : [] }))
process.stdout.write(JSON.stringify({ environment: 'verified_nonproduction',
  sampledResourceCount: resources.length, textbookCount: textbooks.length,
  classes, configs: configurations, textbooks: rows }, null, 2) + '\n')
