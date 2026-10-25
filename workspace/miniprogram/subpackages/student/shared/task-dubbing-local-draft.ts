import type { TaskDubbingWorkView } from '../../../domain/types'
import type { WriteIntentState } from '../../../shared/write-intent'

export interface TaskDubbingLocalDraft {
  savedAt: string
  ownerUserId: string
  ownerSessionId: string
  taskId: string
  itemId: string
  round: number
  localPath: string
  durationMs: number
  fileSize: number
  work: TaskDubbingWorkView | null
  stagingFileId: string
  beginIntent: WriteIntentState
  sealIntent: WriteIntentState
}

export function taskDubbingDraftKey(sessionId: string, taskId: string,
  itemId: string, round: number): string {
  return `task_media_answer_dubbing_${sessionId}_${taskId}_${itemId}_${round}`
}

export function readTaskDubbingLocalDraft(userId: string, sessionId: string,
  taskId: string, itemId: string, round: number): TaskDubbingLocalDraft | null {
  if (typeof wx.getStorageSync !== 'function') return null
  const key = taskDubbingDraftKey(sessionId, taskId, itemId, round)
  const value = wx.getStorageSync(key) as unknown
  if (!value) return null
  const draft = value as Partial<TaskDubbingLocalDraft>
  if (typeof value !== 'object' || Array.isArray(value)
    || draft.ownerUserId !== userId || draft.ownerSessionId !== sessionId
    || draft.taskId !== taskId || draft.itemId !== itemId || draft.round !== round
    || typeof draft.savedAt !== 'string' || !Number.isFinite(Date.parse(draft.savedAt))
    || Date.now() - Date.parse(draft.savedAt) > 7 * 24 * 60 * 60 * 1000
    || typeof draft.localPath !== 'string' || typeof draft.durationMs !== 'number'
    || typeof draft.fileSize !== 'number') {
    if (typeof wx.removeStorageSync === 'function') wx.removeStorageSync(key)
    return null
  }
  return draft as TaskDubbingLocalDraft
}

export function saveTaskDubbingLocalDraft(draft: TaskDubbingLocalDraft): void {
  if (typeof wx.setStorageSync !== 'function') return
  wx.setStorageSync(taskDubbingDraftKey(draft.ownerSessionId, draft.taskId,
    draft.itemId, draft.round), { ...draft, savedAt: new Date().toISOString() })
}

export function clearTaskDubbingLocalDraft(sessionId: string, taskId: string,
  itemId: string, round: number): void {
  if (typeof wx.removeStorageSync === 'function') {
    wx.removeStorageSync(taskDubbingDraftKey(sessionId, taskId, itemId, round))
  }
}
