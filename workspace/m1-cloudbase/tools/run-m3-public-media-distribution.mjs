/** Controlled M3 media materialization. Plan is offline; apply/sync need a separate reviewed package. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const [mode, value, reviewPath] = process.argv.slice(2)
if (!['plan', 'apply', 'sync-org'].includes(mode) || !value
  || (mode !== 'plan' && !reviewPath)) {
  throw new Error('Usage: plan <input.json> | apply <input.json> <review.json> | sync-org <organizationId> <review.json>')
}
const bundle = join(root, '.runtime', 'm3-public-media', 'entry.cjs')
await mkdir(dirname(bundle), { recursive: true })
await build({ entryPoints: [join(root, 'src', 'seed', 'm3-public-media-entry.ts')],
  outfile: bundle, bundle: true, format: 'cjs', platform: 'node',
  target: 'node20', logLevel: 'silent' })
const api = require(bundle)
const inputBytes = mode === 'sync-org' ? null : await readFile(resolve(value))
const input = inputBytes ? JSON.parse(inputBytes.toString('utf8')) : null
if (input) api.buildVerifiedCentralMediaResource(input)
const inputSha256 = inputBytes ? createHash('sha256').update(inputBytes).digest('hex') : null
if (mode === 'plan') {
  process.stdout.write(JSON.stringify({ ready: true, sourceId: input.resourceId,
    inputSha256, operation: 'controlled_import_and_project_active_organizations' }) + '\n')
  process.exit(0)
}
const review = JSON.parse(await readFile(resolve(reviewPath), 'utf8'))
const expectedOperation = mode === 'apply' ? 'import_public_media' : 'sync_new_organization'
if (review.authorizationScope !== 'm3_public_media_nonproduction'
  || review.approved !== true || review.operation !== expectedOperation
  || mode === 'apply' && review.inputSha256 !== inputSha256
  || mode === 'apply' && review.sourceOrganizationId !== input.organizationId
  || mode === 'sync-org' && review.organizationId !== value) {
  throw new Error('REVIEW_SCOPE_MISMATCH')
}
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'))
const envText = await readFile(join(root, '.env.local'), 'utf8')
const environmentId = envText.split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim()
if (!environmentId || config.envId !== environmentId || review.environmentId !== environmentId) {
  throw new Error('NONPRODUCTION_ENV_MISMATCH')
}
const cli = resolve('D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb')
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE')
  return JSON.parse(raw.slice(start)).data
}
const environments = cliData(['env', 'list', '--json'])
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== environmentId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_COST_PREFLIGHT_FAILED')
}
const secrets = cliData(['secrets', 'get', '--json'])
if (secrets?.isTemporary !== true || secrets.envId !== environmentId
  || Date.parse(secrets.expiredAt) <= Date.now() + 60_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID')
}
const sdk = require('@cloudbase/js-sdk')
const app = sdk.init({ env: environmentId, secretId: secrets.secretId,
  secretKey: secrets.secretKey, sessionToken: secrets.token })
const database = api.createCloudBaseDocumentDatabase(app.database())
if (mode === 'apply') {
  const sourceOrganization = await database.get('organizations', input.organizationId)
  if (!sourceOrganization || sourceOrganization.status !== 'active'
    || sourceOrganization.deletedAt !== null) throw new Error('SOURCE_ORGANIZATION_NOT_ACTIVE')
}
const service = new api.PublicMediaDistributionService(database,
  { nowIso: () => new Date().toISOString() })
const result = mode === 'apply'
  ? await service.importVerified(input)
  : { organizationId: value, projectedCount: await service.syncOrganization(value) }
process.stdout.write(JSON.stringify({ mode, result }) + '\n')
