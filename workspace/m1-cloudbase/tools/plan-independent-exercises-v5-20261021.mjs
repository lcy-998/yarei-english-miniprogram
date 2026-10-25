/** Run the same offline evidence gate used by controlled import for all 90 v5 items. */
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const stage = resolve('G:/英语资产/library/derived/independent-exercises-20261020/v5/staging')
const index = JSON.parse(await readFile(join(stage, 'staging-index.json'), 'utf8'))
if (index.resourceCount !== 90 || index.status !== 'publish_ready_nonproduction_reviewed') {
  throw new Error('V5_STAGE_SCOPE_INVALID')
}
const command = join(root, 'tools', 'run-m3-public-question-distribution.mjs')
async function plan(row) {
  const path = join(stage, row.resourceId, 'input.json')
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [command, 'plan', path], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = '', settled = false
    const timer = setTimeout(() => finish(new Error(`PLAN_TIMEOUT_${row.resourceId}`)), 30000)
    function finish(error, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill() } catch {}
      error ? rejectPromise(error) : resolvePromise(value)
    }
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8')
      for (const line of stdout.split(/\r?\n/u)) {
        try {
          const result = JSON.parse(line)
          if (result.ready === true && result.sourceId === row.resourceId
            && result.inputSha256 === row.inputSha256) {
            finish(null, { sourceId: row.resourceId, packId: row.packId,
              grade: row.grade, inputSha256: row.inputSha256 })
            return
          }
        } catch { /* progress output */ }
      }
    })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-1000) })
    child.on('error', error => finish(error))
    child.on('exit', code => {
      if (!settled) finish(new Error(`PLAN_EXIT_${code}_${row.resourceId}_${stderr.replace(/[^A-Za-z0-9_-]/gu, '_').slice(-90)}`))
    })
  })
}
const rows = []
for (let start = 0; start < index.resources.length; start += 4) {
  rows.push(...await Promise.all(index.resources.slice(start, start + 4).map(plan)))
}
const packCounts = new Map()
for (const row of rows) packCounts.set(row.packId, (packCounts.get(row.packId) ?? 0) + 1)
if (rows.length !== 90 || packCounts.size !== 18 || [...packCounts.values()].some(count => count !== 5)) {
  throw new Error('V5_GROUP_COMPLETENESS_FAILED')
}
const reportPath = resolve('G:/英语资产/reports/independent-exercise-v5-plan-2026-10-21.json')
await writeFile(reportPath, JSON.stringify({ status: 'offline_evidence_gate_passed',
  environmentTarget: 'cloud1-d8ggzrwwedb786e41', checkedAt: new Date().toISOString(),
  itemCount: rows.length, packCount: packCounts.size, rows }, null, 2) + '\n', 'utf8')
process.stdout.write(JSON.stringify({ status: 'offline_evidence_gate_passed',
  itemCount: rows.length, packCount: packCounts.size, report: reportPath }) + '\n')
