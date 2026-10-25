import { afterEach, describe, expect, it, vi } from 'vitest'

interface PageContext {
  data: Record<string, unknown>
  setData(patch: Record<string, unknown>): void
}

describe('T-08 AI suggestion recovery', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.doUnmock('../../miniprogram/services/app-service')
    vi.doUnmock('../../miniprogram/session/session')
    vi.doUnmock('../../miniprogram/subpackages/teacher/services/app-service')
    vi.doUnmock('../../miniprogram/subpackages/teacher/session/session')
  })

  it('polls the same operation after a short client timeout and never fills the teacher comment automatically', async () => {
    vi.useFakeTimers()
    const generate = vi.fn(async () => ({ ok: false, error: { code: 'NETWORK_ERROR',
      message: '网络超时', retryable: true } }))
    const get = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { status: 'processing' } })
      .mockResolvedValueOnce({ ok: true, data: { status: 'trial', id: 'suggestion_demo',
        text: '本次习题已记录作答，建议教师核对学生的选择理由并安排同类练习。',
        generationNumber: 1, remainingRegenerations: 3 } })
    vi.doMock('../../miniprogram/services/app-service', () => ({
      generateTeacherSuggestion: generate, getTeacherSuggestion: get,
    }))
    vi.doMock('../../miniprogram/subpackages/teacher/services/app-service', () => ({
      generateTeacherSuggestion: generate, getTeacherSuggestion: get,
    }))
    const session = { user: { id: 'teacher_demo', role: 'teacher' }, sessionId: 'session_demo' }
    vi.doMock('../../miniprogram/session/session', () => ({ getSession: () => session }))
    vi.doMock('../../miniprogram/subpackages/teacher/session/session', () => ({ getSession: () => session }))
    const showToast = vi.fn()
    vi.stubGlobal('wx', { showToast })
    let definition: { methods: Record<string, (this: PageContext) => Promise<void>> } | undefined
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.resetModules()
    await import('../../miniprogram/subpackages/teacher/review-task/review-task')
    if (!definition) throw new Error('T-08 page unavailable')
    const page: PageContext = { data: { selectedSubmissionId: 'submission_demo',
      aiSuggestionOperationId: '', aiSuggestionLoading: false,
      viewingHistory: false, readOnlyMode: false, comment: '教师已有评语' },
    setData(patch) { Object.assign(this.data, patch) } }
    const pending = definition.methods.generateAiSuggestion.call(page)
    await vi.advanceTimersByTimeAsync(10_000)
    await pending

    expect(generate).toHaveBeenCalledOnce()
    const operationId = generate.mock.calls[0]?.[2]
    expect(get).toHaveBeenCalledTimes(2)
    expect(get.mock.calls.every((call: unknown[]) => call[2] === operationId)).toBe(true)
    expect(page.data).toMatchObject({ aiSuggestionLoading: false,
      aiSuggestionOperationId: '', comment: '教师已有评语',
      aiSuggestion: { id: 'suggestion_demo', generationNumber: 1 } })
    expect(showToast).not.toHaveBeenCalled()
  })

  it('loads a background suggestion without changing an existing teacher comment', async () => {
    const getAutomatic = vi.fn(async () => ({ ok: true, data: { status: 'trial',
      id: 'suggestion_auto', text: '请结合已提交的习题核对错误原因，再安排同类练习。',
      generationNumber: 1, remainingRegenerations: 3 } }))
    vi.doMock('../../miniprogram/services/app-service', () => ({
      getAutomaticTeacherSuggestion: getAutomatic,
    }))
    vi.doMock('../../miniprogram/subpackages/teacher/services/app-service', () => ({
      getAutomaticTeacherSuggestion: getAutomatic,
    }))
    const session = { user: { id: 'teacher_demo', role: 'teacher' }, sessionId: 'session_demo' }
    vi.doMock('../../miniprogram/session/session', () => ({ getSession: () => session }))
    vi.doMock('../../miniprogram/subpackages/teacher/session/session', () => ({ getSession: () => session }))
    vi.stubGlobal('wx', {})
    let definition: { methods: Record<string, (this: PageContext, submissionId: string) => Promise<void>> } | undefined
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.resetModules()
    await import('../../miniprogram/subpackages/teacher/review-task/review-task')
    if (!definition) throw new Error('T-08 page unavailable')
    const page: PageContext = { data: { selectedSubmissionId: 'submission_demo',
      aiSuggestionOperationId: '', aiSuggestion: null, aiSuggestionAdopted: false,
      viewingHistory: false, readOnlyMode: false, publishedFeedback: null,
      comment: '我已写好的评语' }, setData(patch) { Object.assign(this.data, patch) } }
    await definition.methods.loadAutomaticAiSuggestion.call(page, 'submission_demo')
    expect(getAutomatic).toHaveBeenCalledWith('teacher_demo', 'submission_demo')
    expect(page.data).toMatchObject({ aiAutomaticStatus: 'ready', comment: '我已写好的评语',
      aiSuggestionAdopted: false, aiSuggestion: { id: 'suggestion_auto' } })
  })

  it('shows the manual-review state when there is not enough specific work evidence', async () => {
    const getAutomatic = vi.fn(async () => ({ ok: true, data: { status: 'insufficient_evidence' } }))
    vi.doMock('../../miniprogram/services/app-service', () => ({
      getAutomaticTeacherSuggestion: getAutomatic,
    }))
    const session = { user: { id: 'teacher_demo', role: 'teacher' }, sessionId: 'session_demo' }
    vi.doMock('../../miniprogram/session/session', () => ({ getSession: () => session }))
    vi.doMock('../../miniprogram/subpackages/teacher/services/app-service', () => ({
      getAutomaticTeacherSuggestion: getAutomatic,
    }))
    vi.doMock('../../miniprogram/subpackages/teacher/session/session', () => ({ getSession: () => session }))
    vi.stubGlobal('wx', {})
    let definition: { methods: Record<string, (this: PageContext, submissionId: string) => Promise<void>> } | undefined
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.resetModules()
    await import('../../miniprogram/subpackages/teacher/review-task/review-task')
    if (!definition) throw new Error('T-08 page unavailable')
    const page: PageContext = { data: { selectedSubmissionId: 'submission_demo',
      aiSuggestionOperationId: '', aiSuggestion: null, aiSuggestionAdopted: false,
      viewingHistory: false, readOnlyMode: false, publishedFeedback: null,
      comment: '保留教师手写内容' }, setData(patch) { Object.assign(this.data, patch) } }
    await definition.methods.loadAutomaticAiSuggestion.call(page, 'submission_demo')
    expect(page.data).toMatchObject({ aiAutomaticStatus: 'insufficient_evidence',
      comment: '保留教师手写内容', aiSuggestion: null })
  })
})
