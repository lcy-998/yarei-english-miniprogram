import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../miniprogram/services/app-service', () => ({
  getTaskDetail: vi.fn(), getPackAttemptSummary: vi.fn(), getVocabularyProgress: vi.fn(),
  saveDraft: vi.fn(), submitTask: vi.fn(),
}))
vi.mock('../../miniprogram/services/m1-app-service', () => ({ getReadingProgress: vi.fn() }))
vi.mock('../../miniprogram/repositories/repository-factory', () => ({ getRepositoryMode: () => 'cloudbase' }))
vi.mock('../../miniprogram/session/session', () => ({
  getCurrentTaskId: () => 'task_redo_demo', getSession: () => ({ user: { id: 'student_demo' } }),
  setCurrentBookId: vi.fn(),
}))
vi.mock('../../miniprogram/services/task-recording-service', () => ({
  beginTaskRecording: vi.fn(), getTaskRecordingMediaState: vi.fn(), getTaskRecordingPlayback: vi.fn(),
  listTaskRecordings: vi.fn(), submitTaskRecording: vi.fn(),
}))

describe('returned student task detail', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('starts a new exercise answer instead of carrying the returned answer into resubmission', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const service = await import('../../miniprogram/services/app-service')
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
    await import('../../miniprogram/pages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail page was not registered')
    const page = definition
    const context = {
      data: { ...page.data },
      setData(change: Record<string, unknown>, done?: () => void) { Object.assign(this.data, change); done?.() },
      refreshReadingCompletion: vi.fn(), refreshVocabularyCompletion: vi.fn(),
      refreshTaskRecordings: vi.fn(), refreshRecordingMediaStates: vi.fn(),
    }
    await page.methods.loadDetail!.call(context)
    expect(context.data.completionInputs).toMatchObject([{ exerciseResponse: '', exerciseSelectedOptions: [],
      exerciseChoices: [{ value: 'A', selected: false }, { value: 'B', selected: false }] }])
    expect(context.data.answer).toBe('')
    expect(context.data.submittedAnswerRows).toMatchObject([{ answer: 'A' }])
    expect(context.data.submissionAnswerVersion).toBe(1)
  })
})
