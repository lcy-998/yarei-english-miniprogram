import { afterEach, describe, expect, it, vi } from 'vitest'

const getTaskDetail = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({ getTaskDetail }))
vi.mock('../../miniprogram/repositories/repository-factory', () => ({ getRepositoryMode: () => 'cloudbase' }))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getCurrentTaskId: () => 'task_demo', getTeacherReviewScoreDraft: vi.fn(),
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
  setCurrentBookId: vi.fn(), setTeacherReviewScoreDraft: vi.fn(),
}))

describe('S-09 receives answers from dedicated exercise page', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); getTaskDetail.mockReset() })

  it('merges the current round answer into the whole task submission', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const key = 'task_exercise_answer_session_demo_task_demo_assignment_demo_1_exercise_demo'
    vi.stubGlobal('wx', { getStorageSync: (candidate: string) => candidate === key
      ? { response: 'B. Dog', selectedOptions: [], answeredQuestionCount: '1',
        savedAt: new Date().toISOString() } : null })
    getTaskDetail.mockResolvedValue({ ok: true, data: { task: { id: 'task_demo',
      status: 'active', version: 1, title: 'Demo task', description: '',
      startsAt: '2026-10-01T00:00:00Z', dueAt: '2099-01-01T00:00:00Z', items: [{
        id: 'exercise_demo', type: 'exercise', title: 'Animal question', completionRule: '完成 1 题',
        completionRuleData: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        exerciseQuestion: { questionId: 'q1', questionType: 'single_choice',
          stem: 'Which animal?', options: ['A. Cat', 'B. Dog'] },
      }] }, assignment: { id: 'assignment_demo', status: 'in_progress', redoCount: 1,
        progressPercent: 0, version: 1 }, submission: null } })
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('Task detail was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>, done?: () => void) {
        Object.assign(this.data, change); done?.()
      } }
    Object.assign(context, definition.methods)
    context.refreshReadingCompletion = vi.fn()
    context.refreshVocabularyCompletion = vi.fn()
    context.refreshTaskRecordings = vi.fn()
    context.refreshRecordingMediaStates = vi.fn()
    await context.loadDetail(true)
    expect(context.data.completionInputs[0]).toMatchObject({
      exerciseResponse: 'B. Dog', exerciseChoices: [
        { value: 'A. Cat', selected: false }, { value: 'B. Dog', selected: true },
      ],
    })
    expect(context.structuredAnswers(true)).toMatchObject([{ itemId: 'exercise_demo', value: {
      kind: 'exercise', questionResponses: [{ questionId: 'q1', response: 'B. Dog' }],
    } }])
  })
})
