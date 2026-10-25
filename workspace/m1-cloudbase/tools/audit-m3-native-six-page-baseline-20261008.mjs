// Read-only CloudBase comparison for the six native management pages.
// Saves remote code locally for review/rollback; never prints or persists environment variable values.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'))
const reviewedEnvironmentId = 'cloud1-d8ggzrwwedb786e41'
const envLine = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))
const expectedEnv = envLine?.slice('TCB_ENV_ID='.length).trim()
if (!expectedEnv || expectedEnv !== config.envId || expectedEnv !== reviewedEnvironmentId) {
  throw new Error('NONPRODUCTION_ENV_MISMATCH')
}

const names = [
  'native-admin-query', 'native-admin-command', 'native-admin-management-command',
  'native-admin-operations-command', 'native-admin-media-command',
  'content-query', 'task-command', 'student-task-query',
  'learning-progress-command', 'learning-progress-query', 'organization-admin',
]
const output = resolve(root, 'dist/m3-native-six-page-review-20261008/remote-baseline')
const relativeOutput = relative(resolve(root, 'dist'), output)
if (!relativeOutput || relativeOutput.startsWith('..')) throw new Error('UNSAFE_OUTPUT')
mkdirSync(output, { recursive: true })

function readCloud(args) {
  let raw
  try {
    raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
      windowsHide: true, timeout: 30000, maxBuffer: 24 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    throw new Error(`READ_ONLY_CLI_FAILED:${args[1] ?? 'unknown'}`)
  }
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('CLI_JSON_MISSING')
  return JSON.parse(raw.slice(start)).data
}

const summary = []
for (const name of names) {
  const detail = readCloud(['fn', 'detail', name, '--json'])
  if (detail?.FunctionName !== name || typeof detail.CodeInfo !== 'string'
    || detail.FunctionVersion !== '$LATEST') throw new Error(`FUNCTION_BASELINE_INVALID:${name}`)
  const variables = Array.isArray(detail.Environment?.Variables) ? detail.Environment.Variables : []
  const code = detail.CodeInfo
  const codeAvailable = code.length > 0
  const codeSha256 = codeAvailable
    ? createHash('sha256').update(code).digest('hex').toUpperCase() : null
  if (codeAvailable) {
    const target = resolve(output, name)
    mkdirSync(target, { recursive: true })
    writeFileSync(resolve(target, 'index.js'), code, 'utf8')
  }
  const item = { name, status: detail.Status, runtime: detail.Runtime, handler: detail.Handler,
    timeout: detail.Timeout, memorySize: detail.MemorySize,
    installDependency: detail.InstallDependency, functionVersion: detail.FunctionVersion,
    triggerCount: Array.isArray(detail.Triggers) ? detail.Triggers.length : null,
    environmentKeys: variables.map(value => value.Key).filter(value => typeof value === 'string').sort(),
    codeAvailable, codeBytes: Buffer.byteLength(code), codeSha256,
    modifiedAt: detail.ModTime ?? null }
  summary.push(item)
  process.stdout.write(JSON.stringify(item) + '\n')
}
writeFileSync(resolve(output, 'summary.json'), JSON.stringify({ environmentId: expectedEnv,
  capturedAt: new Date().toISOString(), functions: summary }, null, 2) + '\n', 'utf8')
