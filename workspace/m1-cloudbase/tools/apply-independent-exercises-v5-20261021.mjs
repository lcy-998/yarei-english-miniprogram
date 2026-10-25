/** Resumable controlled import of 18 complete v5 packs to virtual nonproduction schools. */
import { spawn } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const reports = resolve('G:/英语资产/reports')
const stage = resolve('G:/英语资产/library/derived/independent-exercises-20261020/v5/staging')
const preflight = JSON.parse(await readFile(join(reports, 'independent-exercise-v5-cloud-preflight-2026-10-21.json'), 'utf8'))
const plan = JSON.parse(await readFile(join(reports, 'independent-exercise-v5-plan-2026-10-21.json'), 'utf8'))
if (preflight.environmentId !== 'cloud1-d8ggzrwwedb786e41'
  || preflight.environmentClass !== 'nonproduction_personal_free_no_overrun_no_charge'
  || preflight.targetConflictCount !== 0 || preflight.expectedNewSources !== 90
  || plan.itemCount !== 90 || plan.packCount !== 18) throw new Error('V5_IMPORT_SCOPE_OR_COST_MISMATCH')
if (Date.now() - Date.parse(preflight.checkedAt) > 30 * 60_000) throw new Error('V5_PREFLIGHT_STALE')
const logPath = join(reports, 'independent-exercise-v5-cloud-import-2026-10-21.jsonl')
let prior = []
try { prior = (await readFile(logPath, 'utf8')).split(/\r?\n/u).filter(Boolean).map(JSON.parse) }
catch (error) { if (error?.code !== 'ENOENT') throw error }
const completed = new Set(prior.filter(row => row.status === 'imported').map(row => row.sourceId))
const rows = [...plan.rows].sort((a, b) => a.packId.localeCompare(b.packId)
  || a.sourceId.localeCompare(b.sourceId))
if (rows.length !== 90 || new Set(rows.map(row => row.sourceId)).size !== 90) {
  throw new Error('V5_IMPORT_SOURCE_LIST_INVALID')
}
const command = join(root, 'tools', 'run-m3-public-question-distribution.mjs')
function apply(row) {
  const input = join(stage, row.sourceId, 'input.json')
  const review = join(reports, 'independent-exercise-v5-import-reviews-2026-10-21', `${row.sourceId}.json`)
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [command, 'apply', input, review], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = '', settled = false
    const timer = setTimeout(() => finish(new Error(`IMPORT_TIMEOUT_${row.sourceId}`)), 90000)
    function finish(error, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill() } catch {}
      error ? rejectPromise(error) : resolvePromise(value)
    }
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8')
      for (;;) {
        const newline = stdout.indexOf('\n')
        if (newline < 0) break
        const line = stdout.slice(0, newline).trim()
        stdout = stdout.slice(newline + 1)
        try {
          const result = JSON.parse(line)
          if (result.mode === 'apply' && result.result?.sourceId === row.sourceId
            && Array.isArray(result.result.projectedOrganizations)
            && result.result.projectedOrganizations.length === 2) {
            finish(null, result.result)
            return
          }
        } catch { /* CLI progress */ }
      }
    })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-2500) })
    child.on('error', error => finish(error))
    child.on('exit', code => {
      if (!settled) finish(new Error(`IMPORT_EXIT_${code}_${row.sourceId}_${stderr.replace(/[^A-Za-z0-9_-]/gu, '_').slice(-180)}`))
    })
  })
}
for (const row of rows) {
  if (completed.has(row.sourceId)) continue
  const result = await apply(row)
  await appendFile(logPath, JSON.stringify({ sourceId: row.sourceId, packId: row.packId,
    grade: row.grade, status: 'imported', projectedOrganizations: result.projectedOrganizations.length,
    completedAt: new Date().toISOString() }) + '\n', 'utf8')
  completed.add(row.sourceId)
  if (completed.size % 5 === 0 || completed.size === rows.length) {
    process.stdout.write(JSON.stringify({ imported: completed.size, total: rows.length,
      latestPackId: row.packId }) + '\n')
  }
}
process.stdout.write(JSON.stringify({ status: 'complete', imported: completed.size,
  packCount: new Set(rows.map(row => row.packId)).size, report: logPath }) + '\n')
