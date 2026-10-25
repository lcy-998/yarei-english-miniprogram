// Read-only log metadata; do not print messages, events, users, or tokens.
import { execFileSync } from 'node:child_process'
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb'
let raw
try {
  raw = execFileSync(process.execPath, [cli, 'fn', 'log', 'native-admin-query',
    '-l', '15', '--json'], { cwd: 'D:/app/workspace/m1-cloudbase',
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 })
} catch { throw new Error('READ_ONLY_LOG_QUERY_FAILED') }
const result = JSON.parse(raw.slice(raw.indexOf('{')))
const data = result.data ?? {}
process.stdout.write(JSON.stringify({ resultKeys: Object.keys(result).sort(),
  dataIsArray: Array.isArray(data), dataLength: Array.isArray(data) ? data.length : null,
  dataKeys: Object.keys(data).sort(),
  rowCount: Array.isArray(data.Data) ? data.Data.length
    : Array.isArray(data.Logs) ? data.Logs.length : null }) + '\n')
const rows = Array.isArray(data.Data) ? data.Data : Array.isArray(data.Logs) ? data.Logs : []
for (const row of rows) {
  process.stdout.write(JSON.stringify({ keys: Object.keys(row).sort(),
    status: row.Status ?? row.status ?? null,
    durationMs: row.Duration ?? row.duration ?? null,
    time: row.Time ?? row.time ?? row.StartTime ?? null }) + '\n')
}
