// Read-back gate after each approved code-only update. Never emits environment values.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const envId = 'cloud1-d8ggzrwwedb786e41'
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'))
if (config.envId !== envId) throw new Error('ENVIRONMENT_MISMATCH')
const name = process.argv[2]
const expectedHash = process.argv[3]
if (!/^native-admin-(query|command|management-command|operations-command|media-command)$/.test(name ?? '')
  || !/^[A-F0-9]{64}$/.test(expectedHash ?? '')) throw new Error('VERIFY_ARGUMENTS_INVALID')
const keys = ['YAREI_BATCH_REVIEW_SIGNING_KEY', 'YAREI_BINDING_CODE_DERIVATION_KEY',
  'YAREI_BINDING_CODE_PEPPER', 'YAREI_BUSINESS_SESSION_ENCRYPTION_KEY',
  'YAREI_QUERY_CURSOR_SIGNING_KEY', 'YAREI_SUBJECT_PEPPER']
function readCloud(args) {
  let raw
  try {
    raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
      windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 24 * 1024 * 1024 })
  } catch { throw new Error('READ_ONLY_VERIFY_FAILED') }
  const result = JSON.parse(raw.slice(raw.indexOf('{')))
  if (result.error) throw new Error('READ_ONLY_VERIFY_ERROR')
  return result.data
}
const detail = readCloud(['fn', 'detail', name, '--json'])
const codeHash = typeof detail.CodeInfo === 'string'
  ? createHash('sha256').update(detail.CodeInfo).digest('hex').toUpperCase() : null
const actualKeys = Array.isArray(detail.Environment?.Variables)
  ? detail.Environment.Variables.map(row => row.Key).sort() : []
const route = readCloud(['fn', 'get-route', name, '--json'])
const passed = detail.FunctionName === name && detail.Status === 'Active'
  && detail.Runtime === 'Nodejs20.19' && detail.Handler === 'index.main'
  && detail.Timeout === 20 && detail.MemorySize === 256
  && detail.InstallDependency === 'TRUE' && detail.FunctionVersion === '$LATEST'
  && Array.isArray(detail.Triggers) && detail.Triggers.length === 0
  && JSON.stringify(actualKeys) === JSON.stringify(keys)
  && route.FunctionVersion === '$LATEST'
  && Array.isArray(route.RoutingConfig?.AdditionalVersionWeights)
  && route.RoutingConfig.AdditionalVersionWeights.length === 0
  && codeHash === expectedHash
process.stdout.write(JSON.stringify({ name, expectedHash, actualHash: codeHash,
  status: detail.Status, configMatched: passed, routeVersion: route.FunctionVersion,
  verified: passed }) + '\n')
if (!passed) process.exitCode = 1
