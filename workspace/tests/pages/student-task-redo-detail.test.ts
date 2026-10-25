import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({
  getTaskDetail: vi.fn(), getPackAttemptSummary: vi.fn(), getVocabularyProgress: vi.fn(),
  saveDraft: vi.fn(), submitTask: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/services/m1-app-service', () => ({ getReadingProgress: vi.fn() }))
vi.mock('../../miniprogram/repositories/repository-factory', () => ({ getRepositoryMode: () => 'cloudbase' }))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getCurrentTaskId: () => 'task_redo_demo', getSession: () => ({ user: { id: 'student_demo' } }),
  setCurrentBookId: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/services/task-recording-service', () => ({
  beginTaskRecording: vi.fn(), getTaskRecordingMediaState: vi.fn(), getTaskRecordingPlayback: vi.fn(),
  listTaskRecordings: vi.fn(), submitTaskRecording: vi.fn(),
}))

describe('returned student task detail', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('keeps status hidden until the server evidence finishes loading', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const service = await import('../../miniprogram/subpackages/student/services/app-service')
    vi.mocked(service.getTaskDetail).mockResolvedValue({ ok: true, data: {
      task: { id: 'task_redo_demo', title: '虚构媒体作业', version: 1, status: 'active',
        startsAt: '2026-10-01T08:00:00+08:00', dueAt: '2099-10-05T12:00:00+08:00',
        items: [{ id: 'media_1', type: 'video', title: '视频', completionRule: '完整观看',
          mediaSnapshot: { kind: 'video', mediaId: 'source_1', mediaVersion: 1,
            reviewVersion: 1, durationMs: 10000, questionIds: [], questions: [], clips: [],
            subtitleAvailable: false, continuousPlaybackEnforced: true } }] },
      assignment: { id: 'assignment_1', status: 'in_progress', redoCount: 0, version: 1 },
      submission: null, readingPageProgress: [],
    } } as Awaited<ReturnType<typeof service.getTaskDetail>>)
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail page was not registered')
    let finishEvidence: (() => void) | undefined
    const evidence = new Promise<void>(resolve => { finishEvidence = resolve })
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) },
      refreshReadingCompletion: vi.fn(), refreshVocabularyCompletion: vi.fn(),
      refreshTaskRecordings: vi.fn(), refreshRecordingMediaStates: vi.fn(),
      refreshMediaAvailability: vi.fn().mockImplementation(() => evidence),
    }
    const loading = definition.methods.loadDetail!.call(context)
    await vi.waitFor(() => expect(context.refreshMediaAvailability).toHaveBeenCalled())
    expect(context.data.loading).toBe(true)
    finishEvidence?.()
    await loading
    expect(context.data.loading).toBe(false)
  })

  it('starts a new exercise answer instead of carrying the returned answer into resubmission', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const service = await import('../../miniprogram/subpackages/student/services/app-service')
    vi.mocked(service.getTaskDetail).mockResolvedValue({ ok: true, data: {
      task: { id: 'task_redo_demo', title: '虚构订正练习', status: 'active',
        startsAt: '2026-10-01T08:00:00+08:00', dueAt: '2026-10-05T12:00:00+08:00',
        latePolicy: { allowLate: true, lateDays: 7 }, items: [{
        id: 'item_exercise', type: 'exercise', title: '单选题', completionRule: '完成 1 题',
        resourceId: 'question_demo', completionRuleData: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        exerciseQuestion: { questionId: 'question_1', questionType: 'single_choice', stem: '虚构题干', options: ['A', 'B'] },
      }] },
      assignment: { status: 'redo_required', redoDueAt: '2026-10-05T12:00:00+08:00', redoCount: 1, version: 3 },
      submission: { status: 'returned', version: 1, answers: [{ taskItemId: 'item_exercise',
        value: '旧答案', structuredValue: { kind: 'exercise', answeredQuestionCount: 1,
          questionResponses: [{ questionId: 'question_1', response: 'A' }] } }] },
      readingPageProgress: [],
    } } as Awaited<ReturnType<typeof service.getTaskDetail>>)
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail page was not registered')
    const page = definition
    const context = {
      data: { ...page.data },
      setData(change: Record<string, unknown>, done?: () => void) { Object.assign(this.data, change); done?.() },
      refreshReadingCompletion: vi.fn(), refreshVocabularyCompletion: vi.fn(),
      refreshTaskRecordings: vi.fn(), refreshRecordingMediaStates: vi.fn(),
      refreshMediaAvailability: vi.fn().mockResolvedValue(undefined),
    }
    await page.methods.loadDetail!.call(context)
    expect(context.data.completionInputs).toMatchObject([{ exerciseResponse: '', exerciseSelectedOptions: [],
      exerciseChoices: [{ value: 'A', selected: false }, { value: 'B', selected: false }] }])
    expect(context.data.answer).toBe('')
    expect(context.data).not.toHaveProperty('submittedAnswerRows')
  })
})
