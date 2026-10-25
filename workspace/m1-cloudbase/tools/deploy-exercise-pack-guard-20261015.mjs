import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const mode = process.argv[2]
if (!['inspect', 'apply', 'verify', 'diagnose', 'restore-config', 'inspect-query', 'prepare-query', 'apply-query', 'verify-query', 'diagnose-query', 'restore-query-config'].includes(mode)) throw new Error('MODE_INVALID')
const root = resolve(import.meta.dirname, '..')
const cache = 'D:/app-m3-cache/exercise-pack-guard-20261015'
const configPath = resolve(cache, 'cloudbaserc.json')
const receiptPath = resolve(cache, 'receipt.json')
const candidate = resolve(root, 'dist/functions/task-command')
const baseline = resolve(cache, 'baseline')
const expectedBaseline = '3e2af863afcc4d0b1181ddbd058b0fc7a45be9070207ea8c47e2ff11be62e01c'
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function call(args, timeout = 60000, configFile = configPath, allowEmpty = false) {
  try {
    const raw = execFileSync(process.execPath, [cli, '--config-file', configFile, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout,
      maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS,
        `--require=${resolve(root, 'tools/launch-catalog-cos-dns-20261013.cjs')}`].filter(Boolean).join(' ') },
    })
    const start = raw.indexOf('{')
    if (start < 0 && allowEmpty) return null
    if (start < 0) throw new Error('CLOUD_JSON_MISSING')
    const parsed = JSON.parse(raw.slice(start))
    if (parsed.error) throw new Error('CLOUD_API_REJECTED')
    return parsed.data
  } catch {
    throw new Error(`CLOUD_CALL_FAILED_${args.slice(0, 3).join('_')}`)
  }
}
async function download(directory, name = 'task-command') {
  if ((await readdir(directory).catch(() => [])).length) throw new Error('BACKUP_TARGET_NOT_EMPTY')
  call(['fn', 'code', 'download', name, directory, '--json'])
  return sha(await readFile(resolve(directory, 'index.js')))
}
function signature(detail) {
  const variables = detail.Environment?.Variables
  if (!Array.isArray(variables) || !variables.length
    || variables.some(row => typeof row.Key !== 'string' || typeof row.Value !== 'string' || !row.Value)) {
    throw new Error('FUNCTION_ENV_UNAVAILABLE')
  }
  return { runtime: detail.Runtime, memory: detail.MemorySize, timeout: detail.Timeout,
    handler: detail.Handler, installDependency: detail.InstallDependency,
    role: detail.Role, triggers: detail.Triggers,
    environmentDigest: sha(JSON.stringify(variables.map(row => [row.Key, row.Value]).sort((a, b) => a[0].localeCompare(b[0])))) }
}
function remote() {
  const detail = call(['fn', 'detail', 'task-command', '--json'])
  const route = call(['fn', 'get-route', 'task-command', '--json'])
  const routeVersion = route.FunctionVersion ?? route.RoutingConfig?.FunctionVersion
  if (detail.Status !== 'Active' || routeVersion !== '$LATEST'
    || detail.FunctionVersion !== '$LATEST' || (detail.Triggers?.length ?? -1) !== 0
    || (route.RoutingConfig?.AdditionalVersionWeights?.length ?? 0) !== 0) throw new Error('FUNCTION_ROUTE_CHANGED')
  return { config: signature(detail), routeVersion }
}

await mkdir(cache, { recursive: true })
const envText = await readFile(resolve(root, '.env.local'), 'utf8')
const envId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
const projectConfig = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'))
if (!envId || envId !== projectConfig.envId) throw new Error('NONPRODUCTION_CONFIG_MISMATCH')
await writeFile(configPath, `${JSON.stringify({ envId }, null, 2)}\n`, { flag: 'wx' }).catch(error => {
  if (error?.code !== 'EEXIST') throw error
})
if (!same(JSON.parse(await readFile(configPath, 'utf8')), { envId })) throw new Error('ISOLATED_CONFIG_CHANGED')
const environments = call(['env', 'list', '--json'])
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') throw new Error('ENVIRONMENT_OR_COST_GATE')
if (mode === 'inspect-query') {
  const detail = call(['fn', 'detail', 'content-query', '--json'])
  const route = call(['fn', 'get-route', 'content-query', '--json'])
  if (detail.Status !== 'Active' || detail.FunctionVersion !== '$LATEST'
    || (route.FunctionVersion ?? route.RoutingConfig?.FunctionVersion) !== '$LATEST'
    || (detail.Triggers?.length ?? -1) !== 0) throw new Error('CONTENT_QUERY_CONFIG_CHANGED')
  const directory = resolve(cache, 'content-query-baseline')
  const hash = await download(directory, 'content-query')
  const localHash = sha(await readFile(resolve(root, 'dist/functions/content-query/index.js')))
  process.stdout.write(JSON.stringify({ functionName: 'content-query', baselineHash: hash,
    candidateHash: localHash, backup: directory, config: signature(detail) }) + '\n')
  process.exit(0)
}
if (mode === 'prepare-query') {
  const directory = resolve(cache, 'content-query-baseline')
  const candidateDirectory = resolve(cache, 'content-query-candidate')
  const bytes = await readFile(resolve(directory, 'index.js'))
  if (sha(bytes) !== '373475a6c0bae52437208009363f28505d3efee57a3ab9362593cb84f240ef88') {
    throw new Error('CONTENT_QUERY_BASELINE_CHANGED')
  }
  let code = bytes.toString('utf8')
  const changes = [
    ['function schoolQuestionListItem(resource) {\n  return {\n    id: resource.id,',
      'function schoolQuestionListItem(resource) {\n  return {\n    id: resource.id,\n    ...resource.exercisePackId === void 0 ? {} : { exercisePackId: resource.exercisePackId },'],
    ['    const correctAnswer = field2(document, payload, "correctAnswer");\n    const teacherCatalogOnly = document.teacherCatalogOnly === true;\n    if (grade === null',
      '    const correctAnswer = field2(document, payload, "correctAnswer");\n    const teacherCatalogOnly = document.teacherCatalogOnly === true;\n    const assetLibrary = isJsonObject2(payload.assetLibrary) ? payload.assetLibrary : null;\n    const exercisePackId = typeof assetLibrary?.exercisePackId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(assetLibrary.exercisePackId) ? assetLibrary.exercisePackId : void 0;\n    if (grade === null'],
    ['      correctAnswer,\n      ...teacherCatalogOnly ? { teacherCatalogOnly: true } : {},',
      '      correctAnswer,\n      ...exercisePackId === void 0 ? {} : { exercisePackId },\n      ...teacherCatalogOnly ? { teacherCatalogOnly: true } : {},'],
  ]
  for (const [before, after] of changes) {
    if (code.split(before).length !== 2) throw new Error('NARROW_QUERY_PATCH_ANCHOR_CHANGED')
    code = code.replace(before, after)
  }
  await mkdir(candidateDirectory, { recursive: true })
  await writeFile(resolve(candidateDirectory, 'index.js'), code, { flag: 'wx' })
  await writeFile(resolve(candidateDirectory, 'package.json'),
    await readFile(resolve(directory, 'package.json')), { flag: 'wx' })
  process.stdout.write(JSON.stringify({ status: 'prepared', candidateHash: sha(code), candidateDirectory }) + '\n')
  process.exit(0)
}
if (mode === 'diagnose-query') {
  const detail = call(['fn', 'detail', 'content-query', '--json'])
  const route = call(['fn', 'get-route', 'content-query', '--json'])
  process.stdout.write(JSON.stringify({ status: detail.Status, config: signature(detail),
    version: detail.FunctionVersion, routeVersion: route.FunctionVersion ?? route.RoutingConfig?.FunctionVersion }) + '\n')
  process.exit(0)
}
if (mode === 'restore-query-config') {
  const detail = call(['fn', 'detail', 'content-query', '--json'])
  const expected = { runtime: 'Nodejs20.19', memory: 256, timeout: 10, handler: 'index.main',
    installDependency: 'FALSE', role: 'TCB_QcsRole', triggers: [],
    environmentDigest: '7f45c4d0f9504564ee8da08bd91159a220fa2d80b2a0278430933f962eefe992' }
  if (detail.Status !== 'Active' || !same({ ...signature(detail), installDependency: 'FALSE' }, expected)) {
    throw new Error('QUERY_RESTORE_BASELINE_CHANGED')
  }
  if (detail.InstallDependency === 'TRUE') {
    const restoreConfigPath = resolve(cache, 'content-query-restore.json')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { call(['config', 'update', 'fn', 'content-query', '--json'], 60000, restoreConfigPath, true); break }
      catch {
        if (attempt === 2) throw new Error('QUERY_CONFIG_RESTORE_FAILED')
        await new Promise(resolveWait => setTimeout(resolveWait, 3000))
      }
    }
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = call(['fn', 'detail', 'content-query', '--json'])
    if (current.Status === 'Active' && same(signature(current), expected)) {
      process.stdout.write(JSON.stringify({ status: 'config-restored', functionName: 'content-query' }) + '\n')
      process.exit(0)
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 3000))
  }
  throw new Error('QUERY_CONFIG_RESTORE_UNVERIFIED')
}
if (mode === 'apply-query' || mode === 'verify-query') {
  const directory = resolve(cache, 'content-query-candidate')
  const candidateHash = sha(await readFile(resolve(directory, 'index.js')))
  const baselineHash = '373475a6c0bae52437208009363f28505d3efee57a3ab9362593cb84f240ef88'
  if (candidateHash !== 'c667e4cf487dbe44cd7dcb47c5a3b426a26764a5f9a45b817922fe7c9bc18141') {
    throw new Error('QUERY_CANDIDATE_CHANGED')
  }
  const expectedConfig = { runtime: 'Nodejs20.19', memory: 256, timeout: 10,
    handler: 'index.main', installDependency: 'FALSE', role: 'TCB_QcsRole', triggers: [],
    environmentDigest: '7f45c4d0f9504564ee8da08bd91159a220fa2d80b2a0278430933f962eefe992' }
  const queryState = () => {
    const detail = call(['fn', 'detail', 'content-query', '--json'])
    const route = call(['fn', 'get-route', 'content-query', '--json'])
    if (detail.Status !== 'Active' || detail.FunctionVersion !== '$LATEST'
      || (route.FunctionVersion ?? route.RoutingConfig?.FunctionVersion) !== '$LATEST'
      || (route.RoutingConfig?.AdditionalVersionWeights?.length ?? 0) !== 0
      || !same(signature(detail), expectedConfig)) throw new Error('QUERY_CONFIG_OR_ROUTE_CHANGED')
  }
  queryState()
  if (mode === 'apply-query') {
    const fresh = await download(resolve(cache, `query-fresh-before-${Date.now()}`), 'content-query')
    if (fresh !== baselineHash) throw new Error('QUERY_BASELINE_CHANGED')
    call(['fn', 'code', 'update', 'content-query', '--dir', directory, '--deployMode', 'zip', '--json'], 180000)
    const restoreConfigPath = resolve(cache, 'content-query-restore.json')
    const restoreConfig = { envId, functions: [{ name: 'content-query', installDependency: false }] }
    await writeFile(restoreConfigPath, `${JSON.stringify(restoreConfig, null, 2)}\n`, { flag: 'wx' }).catch(error => {
      if (error?.code !== 'EEXIST') throw error
    })
    if (!same(JSON.parse(await readFile(restoreConfigPath, 'utf8')), restoreConfig)) {
      throw new Error('QUERY_RESTORE_CONFIG_CHANGED')
    }
    call(['config', 'update', 'fn', 'content-query', '--json'], 60000, restoreConfigPath, true)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { queryState(); break } catch {
        if (attempt === 9) throw new Error('QUERY_CONFIG_RESTORE_UNVERIFIED')
        await new Promise(resolveWait => setTimeout(resolveWait, 3000))
      }
    }
  }
  const readbackHash = await download(resolve(cache, `query-readback-${mode}-${Date.now()}`), 'content-query')
  if (readbackHash !== candidateHash) throw new Error('QUERY_READBACK_HASH_MISMATCH')
  queryState()
  process.stdout.write(JSON.stringify({ status: mode === 'apply-query' ? 'deployed' : 'verified',
    functionName: 'content-query', readbackHash, configUnchanged: true, routeUnchanged: true }) + '\n')
  process.exit(0)
}
const state = remote()
const candidateHash = sha(await readFile(resolve(candidate, 'index.js')))
if (candidateHash !== 'ab4373496dbdffa11490a0c081732c5f601a62dd56a07a98b3f6bf8b40523c64') {
  throw new Error('CANDIDATE_CHANGED')
}
if (mode === 'inspect') {
  const baselineHash = await download(baseline)
  if (baselineHash !== expectedBaseline) throw new Error('BASELINE_CHANGED')
  const receipt = { envId, functionName: 'task-command', baselineHash, candidateHash,
    config: state.config, routeVersion: state.routeVersion, createdAt: new Date().toISOString() }
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
  process.stdout.write(JSON.stringify({ status: 'ready', baselineHash, candidateHash }) + '\n')
  process.exit(0)
}
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
if (mode === 'diagnose') {
  process.stdout.write(JSON.stringify({ before: receipt.config, after: state.config,
    routeBefore: receipt.routeVersion, routeAfter: state.routeVersion }) + '\n')
  process.exit(0)
}
if (mode === 'restore-config') {
  if (state.config.installDependency !== 'TRUE'
    || !same({ ...state.config, installDependency: receipt.config.installDependency }, receipt.config)
    || state.routeVersion !== receipt.routeVersion) throw new Error('RESTORE_BASELINE_CHANGED')
  const restoreConfigPath = resolve(cache, 'cloudbaserc-restore.json')
  const restoreConfig = { envId, functions: [{ name: 'task-command', installDependency: false }] }
  await writeFile(restoreConfigPath, `${JSON.stringify(restoreConfig, null, 2)}\n`, { flag: 'wx' }).catch(error => {
    if (error?.code !== 'EEXIST') throw error
  })
  if (!same(JSON.parse(await readFile(restoreConfigPath, 'utf8')), restoreConfig)) throw new Error('RESTORE_CONFIG_CHANGED')
  call(['config', 'update', 'fn', 'task-command', '--json'], 60000, restoreConfigPath, true)
  const restored = remote()
  if (!same(restored.config, receipt.config) || restored.routeVersion !== receipt.routeVersion) {
    throw new Error('CONFIG_RESTORE_UNVERIFIED')
  }
  process.stdout.write(JSON.stringify({ status: 'config-restored', functionName: 'task-command' }) + '\n')
  process.exit(0)
}
if (receipt.envId !== envId || receipt.baselineHash !== expectedBaseline
  || receipt.candidateHash !== candidateHash || !same(receipt.config, state.config)
  || receipt.routeVersion !== state.routeVersion) throw new Error('DEPLOYMENT_PLAN_STALE')
if (mode === 'apply') {
  call(['fn', 'code', 'update', 'task-command', '--dir', candidate, '--deployMode', 'zip', '--json'], 180000)
}
let readbackHash = ''
for (let attempt = 0; attempt < 3; attempt += 1) {
  const target = resolve(cache, `readback-${mode}-${Date.now()}-${attempt}`)
  try { readbackHash = await download(target); break } catch { if (attempt === 2) throw new Error('READBACK_UNAVAILABLE') }
}
if (readbackHash !== candidateHash) throw new Error('READBACK_HASH_MISMATCH_REVIEW_ROLLBACK')
const after = remote()
if (!same(after.config, state.config) || after.routeVersion !== state.routeVersion) {
  throw new Error('POST_DEPLOY_CONFIG_CHANGED_REVIEW_ROLLBACK')
}
process.stdout.write(JSON.stringify({ status: mode === 'apply' ? 'deployed' : 'verified',
  functionName: 'task-command', readbackHash, configUnchanged: true, routeUnchanged: true }) + '\n')
