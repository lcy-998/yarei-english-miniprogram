import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const require = createRequire(resolve(root, 'package.json'))
function call(args) {
  try {
    const raw = execFileSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const start = raw.indexOf('{')
    if (start < 0) throw new Error('NO_JSON')
    const parsed = JSON.parse(raw.slice(start))
    if (parsed.error) throw new Error('API_ERROR')
    return parsed.data
  } catch {
    throw new Error(`CLOUD_READ_FAILED_${args.slice(0, 2).join('_')}`)
  }
}
const configured = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8')).envId
const localEnv = (await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
const environments = call(['env', 'list', '--json'])
if (!localEnv || configured !== localEnv || !Array.isArray(environments)
  || environments.length !== 1 || environments[0].EnvId !== localEnv
  || environments[0].Status !== 'NORMAL' || environments[0].EnableOverrun !== false) {
  throw new Error('ENVIRONMENT_CHANGED')
}
const token = call(['secrets', 'get', '--json'])
if (token?.isTemporary !== true || token.envId !== localEnv
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_INVALID')
const db = require('@cloudbase/node-sdk').init({ env: localEnv,
  secretId: token.secretId, secretKey: token.secretKey, sessionToken: token.token }).database()
const patterns = [
  ['环球少年英语', /环球少年英语|\bOur World\b/iu],
  ['新时空英语', /新时空英语|\bTime Zones\b/iu],
  ['阅读探索者', /阅读探索者|\bReading Explorer\b/iu],
  ['Phonics Monster 1', /Phonics Monster\s*(?:Student Book\s*)?1\b/iu],
  ['SSS儿歌', /Super Simple Songs|SSS儿歌/iu],
]
const counts = Object.fromEntries(patterns.map(([name]) => [name, { all: 0, published: 0, rows: [] }]))
let scanned = 0
for (let offset = 0; offset < 5000; offset += 100) {
  const page = await db.collection('learning_resources').skip(offset).limit(100).get()
  if (!Array.isArray(page.data)) throw new Error('RESOURCE_PAGE_INVALID')
  for (const row of page.data) {
    scanned += 1
    const projection = [row._id, row.title, row.series, row.textbook,
      row.payload?.series, row.payload?.textbook, row.payload?.assetLibrary?.sourceTitle]
      .filter(value => typeof value === 'string').join(' ')
    for (const [name, pattern] of patterns) if (pattern.test(projection)) {
      const target = counts[name]
      target.all += 1
      if (row.status === 'published' && row.deletedAt == null) target.published += 1
      target.rows.push({ id: row._id, status: row.status ?? null, type: row.type ?? null })
    }
  }
  if (page.data.length < 100) break
}
if (scanned >= 5000) throw new Error('RESOURCE_SCAN_INCOMPLETE')
process.stdout.write(JSON.stringify({ environmentId: localEnv, scanned, counts }) + '\n')
