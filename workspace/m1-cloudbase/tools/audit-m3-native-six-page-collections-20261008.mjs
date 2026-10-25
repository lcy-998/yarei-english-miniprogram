// Read-only ACL/index inventory; does not enumerate or mutate documents.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
const environmentId = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8')).envId
if (environmentId !== 'cloud1-d8ggzrwwedb786e41') throw new Error('NONPRODUCTION_ENV_MISMATCH')
const names = ['native_admin_grants', 'native_admin_operations',
  'native_admin_management_operations', 'native_admin_content_operations',
  'teacher_media_records', 'teacher_media_operations', 'native_admin_account_operations',
  'organizations', 'classes', 'users', 'parent_student_links',
  'learning_resources', 'operation_logs']

function call(action, body) {
  let raw
  try {
    raw = execFileSync(process.execPath, [cli, 'api', 'tcb', action,
      '--api-version', '2018-06-08', '--body', JSON.stringify(body), '--json'], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 })
  } catch { throw new Error(`READ_ONLY_API_FAILED:${action}`) }
  const response = JSON.parse(raw.slice(raw.indexOf('{')))
  if (response.error) throw new Error(`READ_ONLY_API_ERROR:${action}`)
  return response.data
}

const tables = call('DescribeTables', { EnvId: environmentId, MgoLimit: 100, MgoOffset: 0 })
if (!Array.isArray(tables.Tables) || tables.Pager?.Total > 100) throw new Error('TABLE_LIST_INCOMPLETE')
for (const name of names) {
  const row = tables.Tables.find(value => value.TableName === name)
  if (!row) { process.stdout.write(JSON.stringify({ name, exists: false }) + '\n'); continue }
  const acl = call('DescribeDatabaseACL', { EnvId: environmentId, CollectionName: name })
  const detail = call('DescribeTable', { EnvId: environmentId, TableName: name })
  const indexes = Array.isArray(detail.Indexes) ? detail.Indexes.map(index => ({
    name: index.Name, fields: index.Keys?.map(key => key.Name) ?? [],
    unique: index.MgoIsUnique === true || index.Unique === true || index.Name === '_id_',
  })) : null
  process.stdout.write(JSON.stringify({ name, exists: true, acl: acl.AclTag ?? null,
    documentCount: row.Count ?? null, indexes }) + '\n')
}
