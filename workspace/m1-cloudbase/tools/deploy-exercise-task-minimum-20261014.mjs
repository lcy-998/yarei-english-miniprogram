import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const mode = process.argv[2]
if (!['inspect', 'current', 'download', 'apply', 'verify', 'rollback'].includes(mode)) throw new Error('MODE_INVALID')
const root = resolve(import.meta.dirname, '..')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const output = resolve(root, 'dist/exercise-task-replacement-20261014/task-command')
const cache = 'D:/app-m3-cache/exercise-task-replacement-20261014'
const configPath = resolve(cache, 'cloudbaserc.json')
const planPath = resolve(cache, 'deployment-plan.json')
const resultPath = resolve(cache, 'deployment-result.json')
const candidatePath = resolve(cache, 'candidate')
const baselinePath = resolve(cache, 'baseline')
const sha = value => createHash('sha256').update(value).digest('hex')
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

function cliData(args, timeout = 30000) {
  const raw = execFileSync(process.execPath, [cli, '--config-file', configPath, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout,
    maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const at = raw.indexOf('{')
  if (at < 0) throw new Error(`CLOUD_JSON_MISSING_${args.slice(0, 3).join('_')}`)
  const result = JSON.parse(raw.slice(at))
  if (result.error) throw new Error(`CLOUD_CALL_FAILED_${args.slice(0, 3).join('_')}`)
  return result.data
}
function functionDetail() { return cliData(['fn', 'detail', 'task-command', '--json']) }
function route() {
  const value = cliData(['fn', 'get-route', 'task-command', '--json'])
  return { functionVersion: value.FunctionVersion ?? value.RoutingConfig?.FunctionVersion ?? null,
    weights: value.RoutingConfig?.AdditionalVersionWeights ?? [],
    matches: value.RoutingConfig?.AdditionVersionMatches ?? [],
    legacyMatches: value.RoutingConfig?.AddtionVersionMatchs ?? [] }
}
function configSignature(detail) {
  const variables = Array.isArray(detail.Environment?.Variables) ? detail.Environment.Variables : []
  if (!variables.length || variables.some(row => typeof row.Key !== 'string'
    || typeof row.Value !== 'string' || row.Value.length === 0)) throw new Error('FUNCTION_ENV_UNAVAILABLE')
  return { runtime: detail.Runtime, memory: detail.MemorySize, timeout: detail.Timeout,
    handler: detail.Handler, role: detail.Role, installDependency: detail.InstallDependency,
    triggers: detail.Triggers, vpc: detail.VpcConfig, publicNet: detail.PublicNetConfig,
    dnsCache: detail.DnsCache,
    environmentDigest: sha(JSON.stringify(variables.map(row => [row.Key, row.Value])
      .sort((left, right) => left[0].localeCompare(right[0])))),
    environmentKeys: variables.map(row => row.Key).sort() }
}
function assertFunctionShape(detail, selectedRoute) {
  if (detail.FunctionName !== 'task-command' || detail.Status !== 'Active'
    || detail.Runtime !== 'Nodejs20.19' || detail.MemorySize !== 256 || detail.Timeout !== 20
    || detail.InstallDependency !== 'FALSE' || detail.Handler !== 'index.main'
    || detail.FunctionVersion !== '$LATEST' || !Array.isArray(detail.Triggers) || detail.Triggers.length !== 0
    || selectedRoute.functionVersion !== '$LATEST' || selectedRoute.weights.length
    || selectedRoute.matches.length || selectedRoute.legacyMatches.length) {
    throw new Error('REMOTE_FUNCTION_CONFIG_OR_ROUTE_CHANGED')
  }
}
function assertEnvironment(envId) {
  const environments = cliData(['env', 'list', '--json'])
  if (!Array.isArray(environments) || environments.length !== 1
    || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
    || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
    || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
    throw new Error('KNOWN_NONPRODUCTION_ENVIRONMENT_OR_COST_GATE_FAILED')
  }
  const values = {}
  for (const metric of ['FunctionInvocation', 'DbWritepkg', 'DbReadpkg']) {
    const quota = cliData(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
      '--body', JSON.stringify({ EnvId: envId, MetricName: metric }), '--json'])
    if (!Number.isFinite(quota?.Value) || quota.Value >= 190000) throw new Error(`QUOTA_GATE_${metric}`)
    values[metric] = quota.Value
  }
  return values
}
async function pollHash(expectedHash) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const detail = functionDetail()
    if (detail.Status === 'Active' && sha(detail.CodeInfo ?? '') === expectedHash) return detail
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  throw new Error('FUNCTION_CODE_READBACK_MISMATCH')
}
function codeUpdate(directory) {
  cliData(['fn', 'code', 'update', 'task-command', '--dir', directory,
    '--deployMode', 'zip', '--json'], 180000)
}

await mkdir(cache, { recursive: true })
const projectConfig = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'))
const envText = await readFile(resolve(root, '.env.local'), 'utf8')
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
if (!envId || projectConfig.envId !== envId) throw new Error('NONPRODUCTION_ENVIRONMENT_CONFIG_MISMATCH')
const isolatedConfig = { envId, functions: [{ name: 'task-command', installDependency: false }] }
try {
  const existing = JSON.parse(await readFile(configPath, 'utf8'))
  if (!same(existing, isolatedConfig)) throw new Error('ISOLATED_FUNCTION_CONFIG_MISMATCH')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
  await writeFile(configPath, `${JSON.stringify(isolatedConfig, null, 2)}\n`, { flag: 'wx' })
}
const quotaValues = assertEnvironment(envId)
const current = functionDetail()
const currentRoute = route()
assertFunctionShape(current, currentRoute)
const beforeConfig = configSignature(current)
const beforeHash = sha(current.CodeInfo ?? '')
if (mode === 'current') {
  process.stdout.write(JSON.stringify({ functionName: 'task-command', status: current.Status,
    codeSha256: beforeHash, codeBytes: Buffer.byteLength(current.CodeInfo ?? ''),
    codeInfoPresent: typeof current.CodeInfo === 'string' && current.CodeInfo.length > 0,
    codeSize: current.CodeSize ?? null, modifiedAt: current.ModTime ?? null,
    detailFields: Object.keys(current).sort(),
    functionVersion: current.FunctionVersion, route: currentRoute,
    configSignature: beforeConfig }) + '\n')
  process.exit(0)
}
if (mode === 'download') {
  const destination = resolve(cache, `remote-download-${Date.now()}`)
  cliData(['fn', 'code', 'download', 'task-command', destination, '--json'], 60000)
  const indexBytes = await readFile(resolve(destination, 'index.js'))
  const packageBytes = await readFile(resolve(destination, 'package.json'))
  process.stdout.write(JSON.stringify({ status: 'downloaded', functionName: 'task-command',
    indexSha256: sha(indexBytes), indexBytes: indexBytes.length,
    packageSha256: sha(packageBytes), packageBytes: packageBytes.length,
    destination }) + '\n')
  process.exit(0)
}

if (mode === 'inspect') {
  const entries = await readdir(output)
  if (!entries.includes('index.js') || !entries.includes('package.json') || entries.length !== 2) {
    throw new Error('CANDIDATE_PACKAGE_SHAPE_INVALID')
  }
  const indexBytes = await readFile(resolve(output, 'index.js'))
  const packageJson = JSON.parse(await readFile(resolve(output, 'package.json'), 'utf8'))
  if (!indexBytes.includes(Buffer.from('习题类型每个任务至少需要 5 道不同的题目'))
    || packageJson.main !== 'index.js' || packageJson.engines?.node !== '20.19.x'
    || packageJson.dependencies?.['@cloudbase/node-sdk'] !== '3.18.3'
    || indexBytes.length > 1500000) throw new Error('CANDIDATE_MINIMUM_QUESTION_RULE_OR_PACKAGE_INVALID')
  await mkdir(candidatePath, { recursive: true })
  await writeFile(resolve(candidatePath, 'index.js'), indexBytes, { flag: 'wx' })
  await writeFile(resolve(candidatePath, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, { flag: 'wx' })
  await mkdir(baselinePath, { recursive: true })
  await writeFile(resolve(baselinePath, 'index.js'), current.CodeInfo, { flag: 'wx' })
  await writeFile(resolve(baselinePath, 'package.json'), `${JSON.stringify({ name: 'task-command-baseline',
    version: '0.1.0', private: true, main: 'index.js', engines: { node: '20.19.x' },
    dependencies: { '@cloudbase/node-sdk': '3.18.3' } }, null, 2)}\n`, { flag: 'wx' })
  const plan = { createdAt: new Date().toISOString(), environmentClass: 'existing-nonproduction-personal-no-overrun-no-charge',
    functionName: 'task-command', baselineSha256: beforeHash, candidateSha256: sha(indexBytes),
    baselineBytes: Buffer.byteLength(current.CodeInfo ?? ''), candidateBytes: indexBytes.length,
    route: currentRoute, config: beforeConfig, quotaValuesBefore: quotaValues }
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' })
  process.stdout.write(JSON.stringify({ status: 'ready', baselineSha256: beforeHash,
    candidateSha256: plan.candidateSha256, candidateBytes: indexBytes.length,
    environmentClass: plan.environmentClass, quotaValues, routeUnchanged: true,
    output: cache }) + '\n')
  process.exit(0)
}

const plan = JSON.parse(await readFile(planPath, 'utf8'))
if (plan.functionName !== 'task-command'
  || (mode === 'apply' && plan.baselineSha256 !== beforeHash)
  || (mode !== 'apply' && plan.candidateSha256 !== beforeHash)
  || !same(plan.route, currentRoute) || !same(plan.config, beforeConfig)) {
  throw new Error('DEPLOYMENT_PLAN_STALE_OR_FUNCTION_CHANGED')
}
const candidateHash = await sha(await readFile(resolve(candidatePath, 'index.js')))
if (candidateHash !== plan.candidateSha256) throw new Error('CANDIDATE_HASH_CHANGED')
if (mode === 'verify') {
  if (beforeHash !== candidateHash) throw new Error('NEW_FUNCTION_CODE_NOT_ACTIVE')
  process.stdout.write(JSON.stringify({ status: 'verified', functionName: 'task-command',
    codeSha256: beforeHash, routeUnchanged: true, configUnchanged: true, quotaValues }) + '\n')
  process.exit(0)
}
if (mode === 'rollback') {
  if (beforeHash !== candidateHash) throw new Error('ROLLBACK_REFUSED_REMOTE_HASH_MISMATCH')
  codeUpdate(baselinePath)
  const restored = await pollHash(plan.baselineSha256)
  if (!same(currentRoute, route()) || !same(beforeConfig, configSignature(restored))) {
    throw new Error('ROLLBACK_CONFIG_OR_ROUTE_MISMATCH')
  }
  const result = { status: 'rolled-back', functionName: 'task-command',
    restoredSha256: plan.baselineSha256, routeUnchanged: true, configUnchanged: true }
  await writeFile(resolve(cache, 'rollback-result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
  process.stdout.write(JSON.stringify(result) + '\n')
  process.exit(0)
}

try {
  codeUpdate(candidatePath)
  const updated = await pollHash(candidateHash)
  if (!same(currentRoute, route()) || !same(beforeConfig, configSignature(updated))) {
    throw new Error('POSTDEPLOY_CONFIG_OR_ROUTE_CHANGED')
  }
  const finalQuotas = assertEnvironment(envId)
  const result = { status: 'deployed', functionName: 'task-command',
    candidateSha256: candidateHash, baselineSha256: plan.baselineSha256,
    routeUnchanged: true, configUnchanged: true,
    quotaValuesBefore: quotaValues, quotaValuesAfter: finalQuotas,
    deployedAt: new Date().toISOString() }
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
  process.stdout.write(JSON.stringify(result) + '\n')
  process.exit(0)
} catch (error) {
  const after = functionDetail()
  const afterHash = sha(after.CodeInfo ?? '')
  if (afterHash === candidateHash) {
    codeUpdate(baselinePath)
    await pollHash(plan.baselineSha256)
  } else if (afterHash !== plan.baselineSha256) {
    throw new Error('DEPLOYMENT_STOPPED_AFTER_CONCURRENT_CHANGE')
  }
  throw error
}
