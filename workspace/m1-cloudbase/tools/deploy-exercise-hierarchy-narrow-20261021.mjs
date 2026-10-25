/** Nonproduction-only exact-code deployment with fresh backups and automatic rollback. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2]
if (!['inspect', 'apply', 'verify', 'rollback'].includes(mode)) throw new Error('MODE_INVALID')
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')
const cache = resolve('D:/app/workspace/m1-cloudbase/.runtime/exercise-hierarchy-deploy-20261021')
const baselineRoot = join(root, '.runtime', 'exercise-hierarchy-baseline-20261021')
const candidateRoot = join(root, '.runtime', 'exercise-hierarchy-candidate-20261021')
const reportPath = resolve('G:/英语资产/reports/independent-exercise-hierarchy-deployment-2026-10-21.json')
const baseline = JSON.parse(await readFile(resolve('G:/英语资产/reports/independent-exercise-function-baseline-2026-10-21.json'), 'utf8'))
const candidate = JSON.parse(await readFile(resolve('G:/英语资产/reports/independent-exercise-narrow-function-candidates-2026-10-21.json'), 'utf8'))
const names = ['content-query', 'task-command', 'student-task-query', 'review-query']
const sha = value => createHash('sha256').update(value).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function call(args, timeout = 60000, configFile = null, allowEmpty = false) {
  try {
    const raw = execFileSync(process.execPath, [cli,
      ...(configFile ? ['--config-file', configFile] : []), ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout,
      maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS,
        `--require=${resolve(root, 'tools/launch-catalog-cos-dns-20261013.cjs')}`]
        .filter(Boolean).join(' ') },
    })
    const start = raw.indexOf('{')
    if (start < 0 && allowEmpty) return null
    if (start < 0) throw new Error('CLOUD_JSON_MISSING')
    const data = JSON.parse(raw.slice(start))
    if (data.error) throw new Error('CLOUD_API_REJECTED')
    return data.data
  } catch {
    throw new Error(`CLOUD_CALL_FAILED_${args.slice(0, 3).join('_')}`)
  }
}
const envId = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
const projectConfig = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'))
if (envId !== 'cloud1-d8ggzrwwedb786e41' || projectConfig.envId !== envId
  || baseline.environmentId !== envId || candidate.environmentId !== envId) throw new Error('ENV_MISMATCH')
await mkdir(cache, { recursive: true })
const configFile = join(cache, 'cloudbaserc.json')
await writeFile(configFile, JSON.stringify({ envId }, null, 2) + '\n', { flag: 'wx' }).catch(error => {
  if (error?.code !== 'EEXIST') throw error
})
if (!same(JSON.parse(await readFile(configFile, 'utf8')), { envId })) throw new Error('ISOLATED_CONFIG_CHANGED')
const envs = call(['env', 'list', '--json'], 60000, configFile)
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_COST_PREFLIGHT_FAILED')
}
function signature(detail) {
  const variables = detail.Environment?.Variables
  if (!Array.isArray(variables) || !variables.length) throw new Error('FUNCTION_ENV_UNAVAILABLE')
  return { runtime: detail.Runtime, memory: detail.MemorySize, timeout: detail.Timeout,
    handler: detail.Handler, role: detail.Role, installDependency: detail.InstallDependency,
    triggers: detail.Triggers?.length ?? null,
    environmentDigest: sha(JSON.stringify(variables.map(row => [row.Key, row.Value])
      .sort((a, b) => a[0].localeCompare(b[0])))) }
}
function expected(name) {
  const row = baseline.functions.find(item => item.name === name)
  const next = candidate.functions.find(item => item.name === name)
  if (!row || !next || next.baselineSha256 !== row.remoteSha256) throw new Error(`REPORT_MISMATCH_${name}`)
  return { row, next }
}
function current(name) {
  const detail = call(['fn', 'detail', name, '--json'], 60000, configFile)
  const route = call(['fn', 'get-route', name, '--json'], 60000, configFile)
  return { status: detail.Status, version: detail.FunctionVersion,
    routeVersion: route.FunctionVersion ?? route.RoutingConfig?.FunctionVersion,
    weights: route.RoutingConfig?.AdditionalVersionWeights?.length ?? 0,
    config: signature(detail) }
}
function expectedConfig(row) {
  return { runtime: row.runtime, memory: row.memory, timeout: row.timeout,
    handler: row.handler, role: row.role, installDependency: row.installDependency,
    triggers: row.triggers, environmentDigest: row.environmentDigest }
}
function assertState(name, row, state) {
  if (state.status !== 'Active' || state.version !== '$LATEST'
    || state.routeVersion !== '$LATEST' || state.weights !== 0
    || !same(state.config, expectedConfig(row))) throw new Error(`FUNCTION_CONFIG_OR_ROUTE_CHANGED_${name}`)
}
async function download(name, label) {
  const directory = join(cache, `${name}-${label}`)
  await mkdir(directory, { recursive: true })
  if ((await readdir(directory)).length) throw new Error(`DOWNLOAD_TARGET_NOT_EMPTY_${name}_${label}`)
  call(['fn', 'code', 'download', name, directory, '--json'], 120000, configFile)
  return { directory, hash: sha(await readFile(join(directory, 'index.js'))) }
}
async function ensureConfig(name, row) {
  let state = current(name)
  for (let attempt = 0; state.status !== 'Active' && attempt < 12; attempt += 1) {
    await new Promise(resolveWait => setTimeout(resolveWait, 3000))
    state = current(name)
  }
  if (state.status !== 'Active') throw new Error(`FUNCTION_NOT_ACTIVE_${name}`)
  if (state.config.installDependency !== row.installDependency) {
    const path = join(cache, `${name}-restore-config.json`)
    const desired = { envId, functions: [{ name,
      installDependency: row.installDependency === 'TRUE' }] }
    await writeFile(path, JSON.stringify(desired, null, 2) + '\n', { flag: 'wx' }).catch(error => {
      if (error?.code !== 'EEXIST') throw error
    })
    if (!same(JSON.parse(await readFile(path, 'utf8')), desired)) throw new Error(`RESTORE_CONFIG_CHANGED_${name}`)
    let updated = false
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        call(['config', 'update', 'fn', name, '--json'], 60000, path, true)
        updated = true
        break
      } catch {
        if (attempt === 3) break
        await new Promise(resolveWait => setTimeout(resolveWait, 3000))
      }
    }
    if (!updated) throw new Error(`CONFIG_UPDATE_FAILED_${name}`)
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try { assertState(name, row, current(name)); return } catch {
      if (attempt === 11) throw new Error(`CONFIG_RESTORE_UNVERIFIED_${name}`)
      await new Promise(resolveWait => setTimeout(resolveWait, 3000))
    }
  }
}
async function codeUpdate(name, directory, row, expectedHash) {
  call(['fn', 'code', 'update', name, '--dir', directory, '--deployMode', 'zip', '--json'],
    180000, configFile)
  await ensureConfig(name, row)
  const readback = await download(name, `readback-${Date.now()}`)
  if (readback.hash !== expectedHash) throw new Error(`CODE_READBACK_HASH_MISMATCH_${name}`)
  assertState(name, row, current(name))
}
const before = []
for (const name of names) {
  const { row, next } = expected(name)
  const state = current(name)
  assertState(name, row, state)
  const old = await readFile(join(baselineRoot, name, 'index.js'))
  const desired = await readFile(join(candidateRoot, name, 'index.js'))
  if (sha(old) !== row.remoteSha256 || sha(desired) !== next.candidateSha256) {
    throw new Error(`LOCAL_PACKAGE_HASH_MISMATCH_${name}`)
  }
  if (mode === 'inspect' || mode === 'apply') {
    const fresh = await download(name, `before-${Date.now()}`)
    if (fresh.hash !== row.remoteSha256) throw new Error(`REMOTE_BASELINE_CHANGED_${name}`)
  }
  before.push({ name, baselineHash: row.remoteSha256, candidateHash: next.candidateSha256 })
}
if (mode === 'inspect') {
  process.stdout.write(JSON.stringify({ status: 'ready', functions: before }) + '\n')
  process.exit(0)
}
if (mode === 'verify') {
  for (const name of names) {
    const { row, next } = expected(name)
    const fresh = await download(name, `verify-${Date.now()}`)
    if (fresh.hash !== next.candidateSha256) throw new Error(`CANDIDATE_NOT_DEPLOYED_${name}`)
    assertState(name, row, current(name))
  }
  process.stdout.write(JSON.stringify({ status: 'verified', functions: names }) + '\n')
  process.exit(0)
}
if (mode === 'rollback') {
  for (const name of [...names].reverse()) {
    const { row } = expected(name)
    await codeUpdate(name, join(baselineRoot, name), row, row.remoteSha256)
    process.stdout.write(JSON.stringify({ status: 'rolled_back', functionName: name }) + '\n')
  }
  process.exit(0)
}
const completed = []
let inFlight = null
try {
  for (const name of names) {
    const { row, next } = expected(name)
    inFlight = name
    await codeUpdate(name, join(candidateRoot, name), row, next.candidateSha256)
    completed.push(name)
    inFlight = null
    process.stdout.write(JSON.stringify({ status: 'deployed', functionName: name,
      readbackHash: next.candidateSha256 }) + '\n')
  }
  await writeFile(reportPath, JSON.stringify({ environmentId: envId,
    completedAt: new Date().toISOString(), functionNames: completed,
    baselineHashes: before, configAndRouteUnchanged: true,
    rollbackRoot: baselineRoot }, null, 2) + '\n', 'utf8')
  process.stdout.write(JSON.stringify({ status: 'complete', functionNames: completed }) + '\n')
} catch (error) {
  const rollbackFailures = []
  for (const name of [...new Set([...completed, ...(inFlight ? [inFlight] : [])])].reverse()) {
    try {
      const { row } = expected(name)
      await codeUpdate(name, join(baselineRoot, name), row, row.remoteSha256)
      process.stdout.write(JSON.stringify({ status: 'rolled_back', functionName: name }) + '\n')
    } catch { rollbackFailures.push(name) }
  }
  await writeFile(reportPath, JSON.stringify({ environmentId: envId,
    failedAt: new Date().toISOString(), completedBeforeFailure: completed,
    rollbackFailures, error: error.message }, null, 2) + '\n', 'utf8')
  throw new Error(`DEPLOY_FAILED_${error.message}_ROLLBACK_FAILURES_${rollbackFailures.join(',') || 'none'}`)
}
