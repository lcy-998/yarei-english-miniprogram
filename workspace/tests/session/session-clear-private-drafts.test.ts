import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearDubbingLocalDraft, readDubbingLocalDraft, saveDubbingLocalDraft } from '../../miniprogram/shared/dubbing-local-draft'
import { clearSession, getCurrentChildId, getCurrentTaskId, getSession, saveSession,
  setCurrentChildId, setCurrentTaskId } from '../../miniprogram/session/session'
import { readTaskMediaDraft, writeTaskMediaDraft } from '../../miniprogram/shared/task-media-draft'

afterEach(() => {
  clearDubbingLocalDraft()
  vi.unstubAllGlobals()
})

describe('session privacy cleanup', () => {
  it('removes private offline answers and recording drafts on logout', () => {
    const storage = new Map<string, unknown>([
      ['task_media_answer_ses_one_task_assignment_0_item_1', { answers: { question: 'child answer' } }],
      ['pronunciation_local_usr_one_ses_one_reading_book_segment', { localPath: 'private-recording.mp3' }],
      ['task_media_answer_ses_older_task_assignment_0_item_1', { answers: { question: 'old answer' } }],
      ['vocabulary_recent_pack_usr_one', 'pack_demo'],
    ])
    vi.stubGlobal('wx', {
      getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
      getStorageSync: (key: string) => storage.get(key) ?? null,
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
    })
    saveSession({ sessionId: 'ses_one', user: { id: 'usr_one', displayName: '虚构学员', role: 'student' } })
    saveDubbingLocalDraft({ ownerUserId: 'usr_one', ownerSessionId: 'ses_one', materialId: 'media_demo',
      materialVersion: 'v1', localPath: 'private-dubbing.mp3', durationMs: 1000, fileSize: 100,
      note: '', draft: null, beginIntent: { operationId: '', fingerprint: '' },
      submitIntent: { operationId: '', fingerprint: '' } })
    setCurrentTaskId('task_demo')
    setCurrentChildId('child_demo')
    const memoryKey = 'task_media_answer_ses_one_private_task_assignment_0_item_1'
    writeTaskMediaDraft(memoryKey, { question: 'child answer' })

    clearSession()

    expect(getSession()).toBeNull()
    expect([...storage.keys()]).toEqual(['vocabulary_recent_pack_usr_one'])
    expect(readDubbingLocalDraft('usr_one', 'ses_one')).toBeNull()
    expect(getCurrentTaskId()).toBe('')
    expect(getCurrentChildId()).toBe('')
    expect(readTaskMediaDraft(memoryKey)).toEqual({})
  })

  it('still clears the session when storage enumeration is unavailable', () => {
    const removed: string[] = []
    vi.stubGlobal('wx', {
      getStorageInfoSync: () => { throw new Error('storage unavailable') },
      removeStorageSync: (key: string) => removed.push(key),
    })

    expect(() => clearSession()).not.toThrow()
    expect(removed).toContain('yarei_session')
  })

  it('clears private drafts when a different account replaces the session', () => {
    const storage = new Map<string, unknown>([
      ['task_media_answer_old_session_task_assignment_0_item_1', { answers: { question: 'old answer' } }],
      ['pronunciation_local_old_user_old_session_reading_book_segment', { localPath: 'old.mp3' }],
      ['reading_recent_category_old_user', 'picture-books'],
    ])
    vi.stubGlobal('wx', {
      getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
      getStorageSync: (key: string) => storage.get(key) ?? null,
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
    })
    saveSession({ sessionId: 'old_session', user: { id: 'old_user', displayName: '旧虚构学员', role: 'student' } })
    saveDubbingLocalDraft({ ownerUserId: 'old_user', ownerSessionId: 'old_session', materialId: 'media_demo',
      materialVersion: 'v1', localPath: 'old-dubbing.mp3', durationMs: 1000, fileSize: 100,
      note: '', draft: null, beginIntent: { operationId: '', fingerprint: '' },
      submitIntent: { operationId: '', fingerprint: '' } })

    saveSession({ sessionId: 'new_session', user: { id: 'new_user', displayName: '新虚构学员', role: 'student' } })

    expect(getSession()?.user.id).toBe('new_user')
    expect([...storage.keys()]).toEqual(['reading_recent_category_old_user', 'yarei_session'])
    expect(readDubbingLocalDraft('old_user', 'old_session')).toBeNull()
  })

  it('removes abandoned private drafts on a fresh login', () => {
    const storage = new Map<string, unknown>([
      ['task_media_answer_stale_session_task_assignment_0_item_1', { answers: { question: 'stale answer' } }],
    ])
    vi.stubGlobal('wx', {
      getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
      getStorageSync: (key: string) => storage.get(key) ?? null,
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
    })

    saveSession({ sessionId: 'fresh_session', user: { id: 'fresh_user', displayName: '新虚构学员', role: 'student' } })

    expect([...storage.keys()]).toEqual(['yarei_session'])
  })
})
