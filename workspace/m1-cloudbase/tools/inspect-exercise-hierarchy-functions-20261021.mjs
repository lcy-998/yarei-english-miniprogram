/** Read-only code/config inventory for the four functions touched by sectioned exercises. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const target = resolve('D:/app/workspace/m1-cloudbase/.runtime/exercise-hierarchy-baseline-20261021')
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')
const sha = value => createHash('sha256').update(value).digest('hex')
function call(args, timeout = 60000) {
  try {
    const raw = execFileSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout,
      maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS,
        `--require=${resolve(root, 'tools/launch-catalog-cos-dns-20261013.cjs')}`]
        .filter(Boolean).join(' ') },
    })
    const start = raw.indexOf('{')
    if (start < 0) throw new Error('MISSING_JSON')
    const payload = JSON.parse(raw.slice(start))
    if (payload.error) throw new Error('CLOUD_ERROR')
    return payload.data
  } catch {
    throw new Error(`CLOUD_CALL_FAILED_${args[0]}_${args[1]}`)
  }
}
const envId = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'))
const envs = call(['env', 'list', '--json'])
if (envId !== 'cloud1-d8ggzrwwedb786e41' || config.envId !== envId
  || !Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].EnableOverrun !== false
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') throw new Error('ENVIRONMENT_MISMATCH')
await mkdir(target, { recursive: true })
const functions = ['content-query', 'task-command', 'student-task-query', 'review-query']
const rows = []
for (const name of functions) {
  const detail = call(['fn', 'detail', name, '--json'])
  const route = call(['fn', 'get-route', name, '--json'])
  const directory = join(target, name)
  await mkdir(directory, { recursive: true })
  if (!(await readdir(directory)).length) call(['fn', 'code', 'download', name, directory, '--json'], 120000)
  const remote = await readFile(join(directory, 'index.js'))
  const local = await readFile(join(root, 'dist', 'functions', name, 'index.js'))
  const variables = detail.Environment?.Variables
  const environmentDigest = Array.isArray(variables)
    ? sha(JSON.stringify(variables.map(item => [item.Key, item.Value]).sort((a, b) => a[0].localeCompare(b[0]))))
    : null
  rows.push({ name, status: detail.Status, functionVersion: detail.FunctionVersion,
    routeVersion: route.FunctionVersion ?? route.RoutingConfig?.FunctionVersion,
    additionalWeights: route.RoutingConfig?.AdditionalVersionWeights?.length ?? 0,
    runtime: detail.Runtime, memory: detail.MemorySize, timeout: detail.Timeout,
    handler: detail.Handler, role: detail.Role,
    installDependency: detail.InstallDependency,
    triggers: detail.Triggers?.length ?? null, environmentDigest,
    remoteSha256: sha(remote), localSha256: sha(local),
    remoteBytes: remote.length, localBytes: local.length })
}
const report = { environmentId: envId, observedAt: new Date().toISOString(),
  cloudWritesPerformed: false, functions: rows }
await writeFile(resolve('G:/英语资产/reports/independent-exercise-function-baseline-2026-10-21.json'),
  JSON.stringify(report, null, 2) + '\n', 'utf8')
process.stdout.write(JSON.stringify(rows.map(({ name, status, remoteSha256, localSha256, remoteBytes, localBytes }) =>
  ({ name, status, remoteSha256, localSha256, remoteBytes, localBytes }))) + '\n')
