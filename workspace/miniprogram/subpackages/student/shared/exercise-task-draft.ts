export interface ExerciseTaskDraft {
  response: string
  selectedOptions: string[]
  answeredQuestionCount: string
}

export function exerciseTaskDraftKey(sessionId: string, taskId: string, assignmentId: string,
  redoCount: number, itemId: string): string {
  return `task_exercise_answer_${sessionId}_${taskId}_${assignmentId}_${redoCount}_${itemId}`
}

export function readExerciseTaskDraft(key: string): ExerciseTaskDraft | null {
  if (typeof wx.getStorageSync !== 'function') return null
  const stored = wx.getStorageSync(key) as unknown
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null
  const value = stored as { savedAt?: string; response?: unknown;
    selectedOptions?: unknown; answeredQuestionCount?: unknown }
  if (!value.savedAt || !Number.isFinite(Date.parse(value.savedAt))
    || Date.now() - Date.parse(value.savedAt) > 7 * 24 * 60 * 60 * 1000
    || Date.parse(value.savedAt) > Date.now() + 5 * 60 * 1000
    || typeof value.response !== 'string' || typeof value.answeredQuestionCount !== 'string'
    || !Array.isArray(value.selectedOptions)
    || !value.selectedOptions.every(option => typeof option === 'string')) return null
  return { response: value.response, selectedOptions: [...value.selectedOptions],
    answeredQuestionCount: value.answeredQuestionCount }
}

export function writeExerciseTaskDraft(key: string, draft: ExerciseTaskDraft): boolean {
  if (typeof wx.setStorageSync !== 'function') return false
  try { wx.setStorageSync(key, { ...draft, savedAt: new Date().toISOString() }); return true }
  catch (_error: unknown) { return false }
}
