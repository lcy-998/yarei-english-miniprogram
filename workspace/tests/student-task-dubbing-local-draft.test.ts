import { afterEach, describe, expect, it, vi } from 'vitest'
import { readTaskDubbingLocalDraft, saveTaskDubbingLocalDraft,
  taskDubbingDraftKey } from '../miniprogram/shared/task-dubbing-local-draft'

describe('S-07 task dubbing local recovery', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('restores only the same student session and round, then removes the exact expired draft', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T10:00:00Z'))
    const storage = new Map<string, unknown>()
    const removeStorageSync = vi.fn((key: string) => storage.delete(key))
    vi.stubGlobal('wx', { setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      getStorageSync: (key: string) => storage.get(key) ?? null, removeStorageSync })
    const draft = { savedAt: '', ownerUserId: 'student_1', ownerSessionId: 'session_1',
      taskId: 'task_1', itemId: 'item_1', round: 1, localPath: 'wxfile://take.mp3',
      durationMs: 2200, fileSize: 1000, work: null, stagingFileId: '',
      beginIntent: { operationId: 'begin_1', fingerprint: 'draft_1' },
      sealIntent: { operationId: '', fingerprint: '' } }
    saveTaskDubbingLocalDraft(draft)
    const key = taskDubbingDraftKey('session_1', 'task_1', 'item_1', 1)
    expect(readTaskDubbingLocalDraft('student_1', 'session_1', 'task_1', 'item_1', 1))
      .toMatchObject({ localPath: 'wxfile://take.mp3' })
    expect(readTaskDubbingLocalDraft('student_2', 'session_1', 'task_1', 'item_1', 1)).toBeNull()
    expect(removeStorageSync).toHaveBeenCalledWith(key)
    saveTaskDubbingLocalDraft(draft)
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000)
    expect(readTaskDubbingLocalDraft('student_1', 'session_1', 'task_1', 'item_1', 1)).toBeNull()
    expect(storage.has(key)).toBe(false)
  })
})
