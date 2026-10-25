import { afterEach, describe, expect, it, vi } from 'vitest'

const getPronunciationScore = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/student-pronunciation-service', () => ({
  beginPronunciationRecording: vi.fn(), sealPronunciationRecording: vi.fn(), beginPronunciationScore: vi.fn(),
  getPronunciationScore, getReadingPronunciationSegments: vi.fn(),
  listPronunciationAttempts: vi.fn(async () => ({ ok: true, data: [] })),
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
}))

describe('S-05 processing recovery', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); getPronunciationScore.mockReset() })

  it('keeps an unscored processing result visible and resumes to the server terminal result', async () => {
    vi.useFakeTimers()
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { getRecorderManager: vi.fn(), getStorageSync: vi.fn(), setStorageSync: vi.fn() })
    getPronunciationScore.mockResolvedValueOnce({ ok: true, data: {
      scoreId: 'score_1', status: 'processing', experimental: true, expectedVersion: 2,
    } }).mockResolvedValueOnce({ ok: true, data: {
      scoreId: 'score_1', status: 'scored', experimental: true, effectiveAttemptNumber: 1,
      score: { total: 86, pronunciation: 88, fluency: 82, completeness: 90 },
    } })
    await import('../../miniprogram/subpackages/student/pronunciation/pronunciation')
    if (!definition) throw new Error('Pronunciation page was not registered')
    const context = { data: { ...definition.data, pageVisible: true, scoreId: 'score_1',
      source: { kind: 'reading', resourceId: 'book_demo', segmentId: 'segment_1' },
      scoreView: { scoreId: 'score_1', status: 'processing', experimental: true } },
    setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() } }
    Object.assign(context, definition.methods)
    context.scheduleScoreRefresh()
    await vi.advanceTimersByTimeAsync(2000)
    expect(getPronunciationScore).toHaveBeenCalledOnce()
    expect(context.data.showScore).toBe(false)
    expect(context.data.scoreView).toMatchObject({ status: 'processing' })
    await vi.advanceTimersByTimeAsync(4000)
    expect(context.data.scoreView).toMatchObject({ status: 'scored' })
    expect(context.data.showScore).toBe(true)
  })

  it('stops automatic polling while the page is hidden', async () => {
    vi.useFakeTimers()
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown>;
      pageLifetimes: { hide: (this: unknown) => void } } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { getRecorderManager: vi.fn() })
    await import('../../miniprogram/subpackages/student/pronunciation/pronunciation')
    if (!definition) throw new Error('Pronunciation page was not registered')
    const context = { data: { ...definition.data, pageVisible: true,
      scoreView: { scoreId: 'score_1', status: 'processing', experimental: true } },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    context.scheduleScoreRefresh()
    definition.pageLifetimes.hide.call(context)
    await vi.advanceTimersByTimeAsync(30000)
    expect(getPronunciationScore).not.toHaveBeenCalled()
  })

  it('recovers an in-flight job from the authorized attempt list after local draft loss', async () => {
    vi.useFakeTimers()
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { getRecorderManager: vi.fn() })
    getPronunciationScore.mockResolvedValue({ ok: true, data: {
      scoreId: 'score_2', status: 'processing', experimental: true, expectedVersion: 2,
    } })
    await import('../../miniprogram/subpackages/student/pronunciation/pronunciation')
    if (!definition) throw new Error('Pronunciation page was not registered')
    const context = { data: { ...definition.data, pageVisible: true,
      source: { kind: 'reading', resourceId: 'book_demo', segmentId: 'segment_1' },
      attemptRows: [{ scoreId: 'score_2', status: 'processing', label: '试验评分中',
        scoreLabel: '无正式分数', timeLabel: '未完成评分' }] },
    setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() } }
    Object.assign(context, definition.methods)
    context.recoverProcessingScore({ currentTarget: { dataset: { id: 'score_2' } } })
    await Promise.resolve()
    expect(context.data.scoreId).toBe('score_2')
    expect(getPronunciationScore).toHaveBeenCalledWith('student_demo', 'score_2')
    expect(context.data.showScore).toBe(false)
  })
})
