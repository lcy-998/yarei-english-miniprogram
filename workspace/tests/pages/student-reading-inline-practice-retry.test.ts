import { afterEach, describe, expect, it, vi } from 'vitest'

const listAttempts = vi.fn()
vi.mock('../../miniprogram/services/student-pronunciation-service', () => ({
  beginPronunciationRecording: vi.fn(), sealPronunciationRecording: vi.fn(),
  beginPronunciationScore: vi.fn(), getPronunciationScore: vi.fn(),
  getReadingPronunciationSegments: vi.fn(), listPronunciationAttempts: listAttempts,
}))
vi.mock('../../miniprogram/session/session', () => ({ getSession: () => ({
  sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' },
}) }))

describe('S-04 actual inline component autonomous practice', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  async function component() {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | undefined
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { removeStorageSync: vi.fn() })
    await import('../../miniprogram/components/pronunciation-panel/pronunciation-panel')
    if (!definition) throw new Error('Inline component was not registered')
    return definition
  }

  it('creates a fresh recording instead of requesting the invalidated job again', async () => {
    const definition = await component()
    const startRecording = vi.fn(), requestScore = vi.fn()
    const context = { data: { ...definition.data,
      source: { kind: 'reading', resourceId: 'book_demo', segmentId: 'segment_demo' },
      sealed: { recordingId: 'old_recording' }, scoreId: 'old_recording',
      scoreView: { status: 'failed', retryable: false }, localPath: 'wxfile://old.mp3' },
      setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() } }
    Object.assign(context, definition.methods, { startRecording, requestScore })
    context.retryScore()
    expect(startRecording).toHaveBeenCalledOnce()
    expect(requestScore).not.toHaveBeenCalled()
    expect(context.data).toMatchObject({ sealed: null, scoreId: '', localPath: '', scoreView: null })
    expect(wx.removeStorageSync).toHaveBeenCalledOnce()
  })

  it('displays the current score without requesting or showing autonomous attempt history', async () => {
    const definition = await component()
    const context = { data: { ...definition.data,
      source: { kind: 'reading', resourceId: 'book_demo', segmentId: 'segment_demo' },
      attemptRows: [{ scoreId: 'old_score' }] },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    context.acceptScore({ status: 'scored', experimental: true,
      score: { total: 94, pronunciation: 94, fluency: 94, completeness: 94 } })
    await context.loadAttempts()
    expect(context.data).toMatchObject({ showScore: true, attemptRows: [], scoreView: { score: { total: 94 } } })
    expect(listAttempts).not.toHaveBeenCalled()
    context.acceptScore({ status: 'failed', experimental: true, retryable: false })
    expect(context.data.scoreMessage).toContain('重新录制')
    expect(context.data.scoreMessage).not.toContain('作业已结束')
  })

  it('keeps a task system-failure retry on the same sealed recording', async () => {
    const definition = await component()
    const startRecording = vi.fn(), requestScore = vi.fn()
    const context = { data: { ...definition.data,
      source: { kind: 'task', taskId: 'task_demo', itemId: 'item_demo', segmentId: 'segment_demo' },
      sealed: { recordingId: 'task_recording' }, scoreView: { status: 'failed', retryable: true } },
      setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() } }
    Object.assign(context, definition.methods, { startRecording, requestScore })
    context.retryScore()
    expect(requestScore).toHaveBeenCalledWith('task_recording')
    expect(startRecording).not.toHaveBeenCalled()
    expect(context.data.sealed).toEqual({ recordingId: 'task_recording' })
  })
})
