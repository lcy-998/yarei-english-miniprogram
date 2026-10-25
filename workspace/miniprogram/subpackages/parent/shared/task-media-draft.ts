type TaskMediaAnswers = Record<string, string | string[]>
const memoryDrafts = new Map<string, { savedAt: string; answers: TaskMediaAnswers }>()
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function sharedDrafts(): Record<string, { savedAt: string; answers: TaskMediaAnswers }> {
  try {
    const app = getApp<IAppOption>()
    if (app.globalData.taskMediaDrafts) return app.globalData.taskMediaDrafts
    const drafts: Record<string, { savedAt: string; answers: TaskMediaAnswers }> = {}
    app.globalData.taskMediaDrafts = drafts
    return drafts
  } catch {
    return Object.fromEntries(memoryDrafts) as Record<string, { savedAt: string; answers: TaskMediaAnswers }>
  }
}

function copyAnswers(answers: Readonly<Record<string, string | readonly string[]>>): TaskMediaAnswers {
  return Object.fromEntries(Object.entries(answers).map(([id, value]) =>
    [id, Array.isArray(value) ? [...value] : value])) as TaskMediaAnswers
}

export function clearTaskMediaDraftMemory(): void {
  memoryDrafts.clear()
  try { delete getApp<IAppOption>().globalData.taskMediaDrafts }
  catch { /* The host app is not available in the current runtime. */ }
}

export function taskMediaDraftKey(sessionId: string, taskId: string, assignmentId: string,
  redoCount: number, itemId: string, mediaVersion: number): string {
  return `task_media_answer_${sessionId}_${taskId}_${assignmentId}_${redoCount}_${itemId}_${mediaVersion}`
}

export function readTaskMediaDraft(key: string): Record<string, string | string[]> {
  const memory = sharedDrafts()[key] ?? memoryDrafts.get(key)
  const memoryAge = memory ? Date.now() - Date.parse(memory.savedAt) : Number.POSITIVE_INFINITY
  const validMemory = memory && Number.isFinite(memoryAge)
    && memoryAge >= -5 * 60 * 1000 && memoryAge <= MAX_AGE_MS
  const recentMemory = validMemory ? copyAnswers(memory.answers) : {}
  if (memory && !validMemory) {
    memoryDrafts.delete(key)
    delete sharedDrafts()[key]
  }
  if (typeof wx.getStorageSync !== 'function') return recentMemory
  let stored: unknown
  try { stored = wx.getStorageSync(key) }
  catch { return { ...recentMemory } }
  const discard = () => { try { if (typeof wx.removeStorageSync === 'function') wx.removeStorageSync(key) }
    catch { /* Keep the in-memory answer available. */ } }
  if (!stored) return recentMemory
  if (typeof stored !== 'object' || Array.isArray(stored)) { discard(); return recentMemory }
  const record = stored as { savedAt?: string; answers?: Record<string, unknown> }
  if (typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt))
    || Date.now() - Date.parse(record.savedAt) > MAX_AGE_MS
    || Date.parse(record.savedAt) > Date.now() + 5 * 60 * 1000
    || !record.answers || typeof record.answers !== 'object' || Array.isArray(record.answers)) {
    discard(); return recentMemory
  }
  const answers: Record<string, string | string[]> = {}
  for (const [questionId, answer] of Object.entries(record.answers)) {
    if (typeof answer === 'string') answers[questionId] = answer
    else if (Array.isArray(answer) && answer.every(value => typeof value === 'string')) answers[questionId] = [...answer]
  }
  return { ...answers, ...recentMemory }
}

export function writeTaskMediaDraft(key: string, answers: Readonly<Record<string, string | readonly string[]>>): boolean {
  const entry = { savedAt: new Date().toISOString(), answers: copyAnswers(answers) }
  memoryDrafts.set(key, entry)
  sharedDrafts()[key] = entry
  if (typeof wx.setStorageSync !== 'function') return false
  try { wx.setStorageSync(key, { savedAt: new Date().toISOString(), answers }); return true }
  catch (_error: unknown) { return false }
}
