/** Controlled, resumable wrapper around the existing one-source nonproduction retire command. */
import { spawn } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const reportRoot = resolve('G:/英语资产/reports')
const preflight = JSON.parse(await readFile(join(reportRoot, 'independent-exercise-cloud-preflight-2026-10-21.json'), 'utf8'))
const plan = JSON.parse(await readFile(join(reportRoot, 'independent-exercise-legacy-offline-plan-2026-10-20.json'), 'utf8'))
if (preflight.environmentId !== 'cloud1-d8ggzrwwedb786e41' || preflight.sourceCount !== 80
  || preflight.environmentClass !== 'nonproduction_personal_free_no_overrun_no_charge'
  || plan.sourceCount !== 80 || plan.packCount !== 16 || preflight.cloudWritesPerformed !== false) {
  throw new Error('RETIRE_SCOPE_OR_COST_PREFLIGHT_MISMATCH')
}
const logPath = join(reportRoot, 'independent-exercise-offline-execution-2026-10-21.jsonl')
let previous = []
try { previous = (await readFile(logPath, 'utf8')).split(/\r?\n/u).filter(Boolean).map(JSON.parse) } catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const done = new Set(previous.filter(row => ['offline', 'already_offline'].includes(row.status))
  .map(row => row.sourceId))
const sourceIds = [...new Set(plan.sources.map(row => row.sourceId))].sort()
if (sourceIds.length !== 80) throw new Error('SOURCE_ID_SCOPE_MISMATCH')
const command = join(root, 'tools', 'run-m3-public-question-distribution.mjs')
async function retire(sourceId) {
  const review = join(reportRoot, 'independent-exercise-offline-reviews-2026-10-21', `${sourceId}.json`)
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [command, 'offline-source', sourceId, review], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = '', settled = false
    const timer = setTimeout(() => finish(new Error(`OFFLINE_TIMEOUT_${sourceId}`)), 90000)
    function finish(error, result) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill() } catch {}
      error ? rejectPromise(error) : resolvePromise(result)
    }
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8')
      for (;;) {
        const newline = stdout.indexOf('\n')
        if (newline < 0) break
        const line = stdout.slice(0, newline).trim()
        stdout = stdout.slice(newline + 1)
        try {
          const payload = JSON.parse(line)
          if (payload.mode === 'offline-source' && payload.result?.sourceId === sourceId
            && ['offline', 'already_offline'].includes(payload.result.status)) {
            finish(null, payload.result)
            return
          }
        } catch { /* ignore CLI progress */ }
      }
    })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-3000) })
    child.on('error', error => finish(error))
    child.on('exit', code => {
      if (!settled) finish(new Error(`OFFLINE_EXIT_${code}_${sourceId}_${stderr.replace(/[^A-Za-z0-9_-]/gu, '_').slice(-180)}`))
    })
  })
}
for (const sourceId of sourceIds) {
  if (done.has(sourceId)) continue
  const result = await retire(sourceId)
  const entry = { sourceId, status: result.status, version: result.version ?? null,
    completedAt: new Date().toISOString() }
  await appendFile(logPath, JSON.stringify(entry) + '\n', 'utf8')
  done.add(sourceId)
  if (done.size % 5 === 0 || done.size === sourceIds.length) {
    process.stdout.write(JSON.stringify({ completed: done.size, total: sourceIds.length,
      latestSourceId: sourceId, latestStatus: result.status }) + '\n')
  }
}
process.stdout.write(JSON.stringify({ status: 'complete', sourcesOfflinedOrAlreadyOffline: done.size,
  report: logPath }) + '\n')
