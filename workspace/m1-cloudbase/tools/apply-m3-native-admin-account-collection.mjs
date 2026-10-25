// Additive account-operation collection only. No existing M1/M2/M3 collection is modified.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const mode = process.argv[2]
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID')
const root = resolve('D:/app/workspace/m1-cloudbase')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const environmentId = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8')).envId
const name = 'native_admin_account_operations'
if (typeof environmentId !== 'string' || !environmentId) throw new Error('ENVIRONMENT_NOT_CONFIGURED')

function call(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const first = raw.indexOf('{')
  if (first < 0) throw new Error('CLOUD_JSON_UNAVAILABLE')
  const result = JSON.parse(raw.slice(first))
  if (result.error) throw new Error(`CLOUD_API_${result.error.code ?? 'FAILED'}`)
  return result.data
}
const api = (action, body) => call(['api', 'tcb', action, '--api-version', '2018-06-08',
  '--body', JSON.stringify(body), '--json'])

const environments = call(['env', 'list', '--json'])
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== environmentId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnableOverrun !== false
  || environments[0].EnvPaid !== 'no' || environments[0].EnvCharged !== 'no') {
  throw new Error('ENVIRONMENT_OR_COST_GATE')
}

function tableRow() {
  const data = api('DescribeTables', { EnvId: environmentId, MgoLimit: 100, MgoOffset: 0 })
  if (!Array.isArray(data.Tables) || !Number.isSafeInteger(data.Pager?.Total)
    || data.Pager.Total > 100) throw new Error('TABLE_LIST_INCOMPLETE')
  return data.Tables.find(row => row.TableName === name) ?? null
}

function verify(row) {
  if (!row) throw new Error('ACCOUNT_TABLE_MISSING')
  const acl = api('DescribeDatabaseACL', { EnvId: environmentId, CollectionName: name })
  const detail = api('DescribeTable', { EnvId: environmentId, TableName: name })
  const idIndex = detail.Indexes?.find(index => index.Name === '_id_')
  // CloudBase describes Mongo's built-in `_id_` index with Unique=false even
  // though `_id` is the platform-enforced unique document identifier.
  if (acl.AclTag !== 'ADMINONLY' || !idIndex
    || idIndex.Name !== '_id_'
    || JSON.stringify(idIndex.Keys?.map(key => key.Name)) !== JSON.stringify(['_id'])) {
    throw new Error('ACCOUNT_TABLE_PROTECTION_MISMATCH')
  }
  return { exists: true, acl: 'ADMINONLY', defaultIdIndex: true,
    idUniqueness: 'platform-enforced',
    documentCount: typeof row.Count === 'number' ? row.Count : null }
}

if (mode === 'inspect') {
  const row = tableRow()
  process.stdout.write(JSON.stringify({ mode, exists: Boolean(row),
    ...(row ? verify(row) : {}), overrunBilling: false }) + '\n')
  process.exit(0)
}

if (mode === 'apply') {
  const reviewPath = process.argv[3]
  if (!reviewPath) throw new Error('REVIEW_FILE_REQUIRED')
  const review = JSON.parse(readFileSync(resolve(reviewPath), 'utf8'))
  if (review.authorizationScope !== 'm3_native_admin_account_nonproduction'
    || review.approved !== true || review.operation !== 'create_account_operations_collection'
    || review.environmentId !== environmentId
    || !Number.isFinite(Date.parse(review.expiresAt))
    || Date.parse(review.expiresAt) <= Date.now()
    || review.rollback?.action !== 'preserve_collection_and_audit'
    || review.expectedExistingCount !== 0) throw new Error('REVIEW_SCOPE_INVALID')
  const quota = api('DescribeQuotaData', { EnvId: environmentId, MetricName: 'DbWritepkg' })
  if (!Number.isFinite(quota.Value) || quota.Value > 190000) throw new Error('DB_QUOTA_GATE')
  const prior = tableRow()
  if (prior) {
    const state = verify(prior)
    if (state.documentCount !== 0) throw new Error('ACCOUNT_TABLE_NOT_EMPTY')
  } else {
    api('CreateTable', { EnvId: environmentId, TableName: name,
      PermissionInfo: { AclTag: 'ADMINONLY', EnvId: environmentId } })
  }
  let row = tableRow()
  for (let attempt = 0; !row && attempt < 12; attempt++) {
    await new Promise(resolveWait => setTimeout(resolveWait, 1000))
    row = tableRow()
  }
  const state = verify(row)
  if (state.documentCount !== 0) throw new Error('ACCOUNT_TABLE_NOT_EMPTY')
  process.stdout.write(JSON.stringify({ mode, ...state, overrunBilling: false }) + '\n')
  process.exit(0)
}

process.stdout.write(JSON.stringify({ mode, ...verify(tableRow()), overrunBilling: false }) + '\n')
