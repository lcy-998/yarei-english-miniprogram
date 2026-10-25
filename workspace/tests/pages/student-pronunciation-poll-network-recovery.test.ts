import { afterEach, describe, expect, it, vi } from 'vitest'

const getScore = vi.fn(), beginScore = vi.fn()
const service = () => ({ getPronunciationScore: getScore, beginPronunciationRecording: vi.fn(),
  sealPronunciationRecording: vi.fn(), beginPronunciationScore: beginScore,
  getReadingPronunciationSegments: vi.fn(), listPronunciationAttempts: vi.fn() })
vi.mock('../../miniprogram/services/student-pronunciation-service', () => service())
vi.mock('../../miniprogram/subpackages/student/services/student-pronunciation-service', () => service())
const session = () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } })
vi.mock('../../miniprogram/session/session', () => ({ getSession: () => session() }))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({ getSession: () => session() }))

describe('autonomous score polling survives a temporary network failure', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); getScore.mockReset(); beginScore.mockReset() })
  it('retries a system failure with the current version instead of the original sealed version', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | undefined
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    await import('../../miniprogram/components/pronunciation-panel/pronunciation-panel')
    if (!definition) throw new Error('Missing component')
    beginScore.mockResolvedValue({ ok: true, data: { scoreId: 'score_demo', status: 'unreliable', experimental: true } })
    const context = { data: { ...definition.data, scoreOperationId: 'retry_demo',
      sealed: { recordingId: 'score_demo', expectedVersion: 2 },
      source: { kind: 'reading', resourceId: 'book_demo', segmentId: 'sentence_demo' },
      scoreView: { scoreId: 'score_demo', status: 'failed', retryable: true, expectedVersion: 9 } },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods, { rememberDraft: vi.fn() })
    await context.requestScore('score_demo')
    expect(beginScore).toHaveBeenCalledWith('student_demo', 'score_demo', 'retry_demo', 9)
  })
  it.each(['inline', 'standalone'])('%s resumes polling and displays the eventual score', async mode => {
    vi.useFakeTimers()
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | undefined
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    if (mode === 'inline') await import('../../miniprogram/components/pronunciation-panel/pronunciation-panel')
    else await import('../../miniprogram/subpackages/student/pronunciation/pronunciation')
    if (!definition) throw new Error('Missing component')
    getScore.mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: '网络暂不可用', retryable: true } })
      .mockResolvedValueOnce({ ok: true, data: { scoreId: 'score_demo', status: 'scored', experimental: true,
        score: { total: 94, pronunciation: 100, fluency: 74, completeness: 100 } } })
    const context = { data: { ...definition.data, pageVisible: true, scoreId: 'score_demo',
      scoreRecoveryCheckedAt: Date.now(), source: { kind: 'reading', resourceId: 'book_demo', segmentId: 'sentence_demo' },
      scoreView: { scoreId: 'score_demo', status: 'processing', experimental: true } },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    context.scheduleScoreRefresh()
    await vi.advanceTimersByTimeAsync(2000)
    expect(context.data.scoreError).toContain('网络暂不可用')
    await vi.advanceTimersByTimeAsync(4000)
    expect(getScore).toHaveBeenCalledTimes(2)
    expect(context.data).toMatchObject({ showScore: true, scoreError: '', scoreView: { score: { total: 94 } } })
    await vi.advanceTimersByTimeAsync(20000)
    expect(getScore).toHaveBeenCalledTimes(2)
  })
})
