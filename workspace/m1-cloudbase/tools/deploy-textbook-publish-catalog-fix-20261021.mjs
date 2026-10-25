// Narrow code-only repair of the nonproduction teacher-textbook-command function.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('D:/app/workspace/m1-cloudbase')
const cache = resolve('D:/app-m3-cache/teacher-textbook-publish-20261021')
const configFile = resolve(cache, 'cloudbaserc.json')
const baseline = resolve(cache, 'baseline')
const candidate = resolve(cache, 'candidate')
const preflightFile = resolve(cache, 'preflight.json')
const receiptFile = resolve(cache, 'receipt.json')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const envId = 'cloud1-d8ggzrwwedb786e41'
const name = 'teacher-textbook-command'
const mode = process.argv[2]
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID')
const sha = value => createHash('sha256').update(value).digest('hex')
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
function cliData(args, timeout = 60000) {
  let raw
  try {
    raw = execFileSync(process.execPath, [cli, '--config-file', configFile, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: args[0] === 'fn' && args[1] === 'code' && args[2] === 'download'
        ? { ...process.env, NODE_OPTIONS: `--require=${resolve(root, 'tools/cloudbase-code-dns-fallback.cjs')}` }
        : process.env,
    })
  } catch (error) {
    const response = String(error?.stdout ?? '')
    let code = 'UNKNOWN'
    try { code = JSON.parse(response.slice(response.indexOf('{')))?.error?.code ?? 'UNKNOWN' }
    catch { /* Do not log signed storage URLs or credentials. */ }
    throw new Error(`CLOUD_COMMAND_FAILED_${args.slice(0, 3).join('_')}_${code}`)
  }
  const at = raw.indexOf('{')
  if (at < 0) throw new Error('CLOUD_JSON_MISSING')
  const parsed = JSON.parse(raw.slice(at))
  if (parsed.error) throw new Error('CLOUD_API_REJECTED')
  return parsed.data
}
const detail = () => cliData(['fn', 'detail', name, '--json'])
function route() {
  const value = cliData(['fn', 'get-route', name, '--json'])
  return { functionVersion: value.FunctionVersion ?? value.RoutingConfig?.FunctionVersion ?? null,
    weights: value.RoutingConfig?.AdditionalVersionWeights ?? [],
    matches: value.RoutingConfig?.AdditionVersionMatches ?? [],
    legacyMatches: value.RoutingConfig?.AddtionVersionMatchs ?? [] }
}
function signature(value) {
  const variables = Array.isArray(value.Environment?.Variables) ? value.Environment.Variables : []
  if (variables.some(row => typeof row.Key !== 'string' || typeof row.Value !== 'string')) {
    throw new Error('FUNCTION_ENV_INVALID')
  }
  return { runtime: value.Runtime, memory: value.MemorySize, timeout: value.Timeout,
    handler: value.Handler, role: value.Role, installDependency: value.InstallDependency,
    triggers: value.Triggers, vpc: value.VpcConfig, publicNet: value.PublicNetConfig,
    environmentDigest: sha(JSON.stringify(variables.map(row => [row.Key, row.Value])
      .sort((a, b) => a[0].localeCompare(b[0])))),
    environmentKeys: variables.map(row => row.Key).sort() }
}
const oldGuard = 'book.grade !== target.grade || !visible(book, input.classId) || '
await mkdir(cache, { recursive: true })
await writeFile(configFile, `${JSON.stringify({ envId }, null, 2)}\n`, { flag: 'wx' })
  .catch(error => { if (error?.code !== 'EEXIST') throw error })
if (!same(JSON.parse(await readFile(configFile, 'utf8')), { envId })) throw new Error('CONFIG_ENV_MISMATCH')
const environments = cliData(['env', 'list', '--json'])
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_COST_GATE')
}
const quota = {}
for (const metric of ['FunctionInvocation', 'DbWritepkg', 'DbReadpkg']) {
  const value = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
    '--body', JSON.stringify({ EnvId: envId, MetricName: metric }), '--json'])
  if (!Number.isFinite(value?.Value) || value.Value >= 190000) throw new Error(`QUOTA_GATE_${metric}`)
  quota[metric] = value.Value
}
const current = detail()
if (current.FunctionName !== name || current.Status !== 'Active'
  || typeof current.CodeInfo !== 'string' || !current.CodeInfo) throw new Error('REMOTE_FUNCTION_INVALID')
const before = { hash: sha(current.CodeInfo), signature: signature(current), route: route() }

if (mode === 'inspect') {
  if (current.CodeInfo.split(oldGuard).length !== 2) throw new Error('OLD_GUARD_NOT_UNIQUE')
  await mkdir(baseline, { recursive: true })
  cliData(['fn', 'code', 'download', name, baseline, '--json'], 180000)
  if (!(await readdir(baseline)).includes('index.js')) throw new Error('ROLLBACK_PACKAGE_MISSING')
  if (sha(await readFile(resolve(baseline, 'index.js'))) !== before.hash) throw new Error('ROLLBACK_HASH_MISMATCH')
  await cp(baseline, candidate, { recursive: true, force: false, errorOnExist: true })
  const source = await readFile(resolve(candidate, 'index.js'), 'utf8')
  if (source.split(oldGuard).length !== 2) throw new Error('PACKAGE_GUARD_NOT_UNIQUE')
  const repaired = source.replace(oldGuard, '')
  if (!repaired.includes('if (!book || !validId(item.textbookId)')) throw new Error('REPAIR_SHAPE_MISMATCH')
  await writeFile(resolve(candidate, 'index.js'), repaired, 'utf8')
  const newHash = sha(repaired)
  await writeFile(preflightFile, JSON.stringify({ environment: envId, function: name,
    before, newHash, quota, inspectedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' })
  process.stdout.write(JSON.stringify({ status: 'ready', environment: 'verified_nonproduction',
    function: name, beforeHash: before.hash, newHash, quota, rollbackDownloaded: true }) + '\n')
  process.exit(0)
}

if (mode === 'verify') {
  const receipt = JSON.parse(await readFile(receiptFile, 'utf8'))
  if (receipt.environment !== envId || receipt.function !== name
    || receipt.newHash !== before.hash || !same(receipt.signature, before.signature)
    || !same(receipt.route, before.route)) throw new Error('READBACK_MISMATCH')
  process.stdout.write(JSON.stringify({ status: 'verified', function: name,
    newHash: before.hash, configurationAndRouteUnchanged: true }) + '\n')
  process.exit(0)
}

const preflight = JSON.parse(await readFile(preflightFile, 'utf8'))
if (preflight.environment !== envId || preflight.function !== name
  || !same(preflight.before, before) || sha(await readFile(resolve(candidate, 'index.js'))) !== preflight.newHash
  || sha(await readFile(resolve(baseline, 'index.js'))) !== before.hash) {
  throw new Error('PREFLIGHT_OR_REMOTE_CHANGED')
}
function update(directory) {
  return cliData(['fn', 'code', 'update', name, '--dir', directory, '--deployMode', 'zip', '--json'], 180000)
}
async function waitForHash(expected) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const value = detail()
    if (value.Status === 'Active' && sha(value.CodeInfo ?? '') === expected) return value
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  throw new Error('FUNCTION_READBACK_TIMEOUT')
}
try {
  update(candidate)
  const after = await waitForHash(preflight.newHash)
  if (!same(signature(after), before.signature) || !same(route(), before.route)) {
    throw new Error('CONFIG_OR_ROUTE_CHANGED')
  }
  await writeFile(receiptFile, JSON.stringify({ environment: envId, function: name,
    oldHash: before.hash, newHash: preflight.newHash,
    signature: before.signature, route: before.route, deployedAt: new Date().toISOString() }, null, 2) + '\n',
  { flag: 'wx' })
  process.stdout.write(JSON.stringify({ status: 'deployed', function: name,
    newHash: preflight.newHash, configurationAndRouteUnchanged: true }) + '\n')
} catch (error) {
  const latest = detail()
  if (sha(latest.CodeInfo ?? '') !== before.hash) {
    update(baseline)
    const restored = await waitForHash(before.hash)
    if (!same(signature(restored), before.signature) || !same(route(), before.route)) {
      throw new Error('ROLLBACK_NOT_VERIFIED')
    }
  }
  throw new Error(`DEPLOYMENT_FAILED_RESTORED_${error.message}`)
}
