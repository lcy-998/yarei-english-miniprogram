// Read-only exact baseline for a later single-function review; no cloud writes.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const envId = 'cloud1-d8ggzrwwedb786e41'
if (JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8')).envId !== envId) {
  throw new Error('ENVIRONMENT_MISMATCH')
}
function readCloud(args) {
  let raw
  try {
    raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
      windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 24 * 1024 * 1024 })
  } catch { throw new Error('READ_ONLY_CLI_FAILED') }
  const result = JSON.parse(raw.slice(raw.indexOf('{')))
  if (result.error) throw new Error('READ_ONLY_CLI_ERROR')
  return result.data
}
const envs = readCloud(['env', 'list', '--json'])
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].EnableOverrun !== false
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_COST_GATE')
}
const detail = readCloud(['fn', 'detail', 'native-admin-query', '--json'])
const hash = createHash('sha256').update(detail.CodeInfo ?? '').digest('hex').toUpperCase()
const expected = 'A02F61301E2C62B1AE66FE92076DBC981D0FCA47783B9B71C4DDDDB67717D9EE'
const route = readCloud(['fn', 'get-route', 'native-admin-query', '--json'])
const keys = Array.isArray(detail.Environment?.Variables)
  ? detail.Environment.Variables.map(value => value.Key).sort() : []
if (hash !== expected || detail.Status !== 'Active' || detail.Runtime !== 'Nodejs20.19'
  || detail.Timeout !== 20 || detail.MemorySize !== 256
  || detail.InstallDependency !== 'TRUE' || detail.FunctionVersion !== '$LATEST'
  || !Array.isArray(detail.Triggers) || detail.Triggers.length !== 0
  || route.FunctionVersion !== '$LATEST'
  || route.RoutingConfig?.AdditionalVersionWeights?.length !== 0
  || keys.length !== 6) throw new Error('REMOTE_QUERY_BASELINE_CHANGED')
const output = resolve(root, 'dist/m3-native-selection-review-20261008/remote-baseline')
mkdirSync(output, { recursive: true })
writeFileSync(resolve(output, 'index.js'), detail.CodeInfo, 'utf8')
writeFileSync(resolve(output, 'summary.json'), JSON.stringify({ name: 'native-admin-query',
  codeHash: hash, codeBytes: Buffer.byteLength(detail.CodeInfo),
  status: detail.Status, runtime: detail.Runtime, timeout: detail.Timeout,
  memorySize: detail.MemorySize, installDependency: detail.InstallDependency,
  route: route.FunctionVersion, environmentKeys: keys,
  capturedAt: new Date().toISOString() }, null, 2) + '\n')
process.stdout.write(JSON.stringify({ name: 'native-admin-query', currentHash: hash,
  codeBytes: Buffer.byteLength(detail.CodeInfo), configMatched: true,
  rollbackVersionBeforeNewUpdate: 1 }) + '\n')
