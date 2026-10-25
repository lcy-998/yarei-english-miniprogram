import { afterEach, describe, expect, it, vi } from 'vitest'

const getTaskDetail = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({ getTaskDetail }))
vi.mock('../../miniprogram/repositories/repository-factory', () => ({ getRepositoryMode: () => 'cloudbase' }))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getCurrentTaskId: () => 'task_demo',
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
}))

describe('independent exercise task', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); getTaskDetail.mockReset() })

  it('stores the selected answer for the same assignment and redo round', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{ options: { taskId: 'task_demo', itemId: 'exercise_demo' } }])
    const saved = new Map<string, unknown>()
    vi.stubGlobal('wx', { getStorageSync: (key: string) => saved.get(key),
      setStorageSync: (key: string, value: unknown) => saved.set(key, value) })
    getTaskDetail.mockResolvedValue({ ok: true, data: {
      task: { id: 'task_demo', status: 'active', startsAt: '2026-10-01T00:00:00Z',
        dueAt: '2099-01-01T00:00:00Z', items: [{ id: 'exercise_demo', type: 'exercise',
          title: 'Animal question', completionRule: '完成 1 题', exerciseQuestion: {
            questionId: 'q1', questionType: 'single_choice', stem: 'Which animal?',
            options: ['A. Cat', 'B. Dog'],
          } }] }, assignment: { id: 'assignment_demo', status: 'in_progress', redoCount: 1 },
      submission: null,
    } })
    await import('../../miniprogram/subpackages/student/exercise-task/exercise-task')
    if (!definition) throw new Error('Exercise page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.load()
    context.chooseOption({ currentTarget: { dataset: { itemId: 'exercise_demo', value: 'B. Dog' } } })
    expect(context.data).toMatchObject({ cards: [{ choices: [
      { value: 'A. Cat', selected: false }, { value: 'B. Dog', selected: true },
    ] }] })
    expect(saved.get('task_exercise_answer_session_demo_task_demo_assignment_demo_1_exercise_demo'))
      .toMatchObject({ response: 'B. Dog' })
  })

  it('shows each exercise item in task order and keeps answers separate', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{ options: { taskId: 'task_demo', itemId: 'exercise_second' } }])
    const saved = new Map<string, unknown>()
    vi.stubGlobal('wx', { getStorageSync: (key: string) => saved.get(key),
      setStorageSync: (key: string, value: unknown) => saved.set(key, value) })
    getTaskDetail.mockResolvedValue({ ok: true, data: {
      task: { id: 'task_demo', title: 'Two questions', status: 'active',
        startsAt: '2026-10-01T00:00:00Z', dueAt: '2099-01-01T00:00:00Z', items: [
          { id: 'exercise_first', type: 'exercise', title: 'Choose one',
            exerciseQuestion: { questionId: 'q1', questionType: 'single_choice',
              stem: 'Which animal?', options: ['Cat', 'Dog'] } },
          { id: 'exercise_second', type: 'exercise', title: 'Write a sentence',
            exerciseQuestion: { questionId: 'q2', questionType: 'subjective',
              stem: 'What does it do?', options: [] } },
        ] }, assignment: { id: 'assignment_demo', status: 'in_progress', redoCount: 1 },
      submission: null,
    } })
    await import('../../miniprogram/subpackages/student/exercise-task/exercise-task')
    if (!definition) throw new Error('Exercise page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.load()
    expect(context.data).toMatchObject({ cards: [
      { number: 1, typeLabel: '单选题', highlighted: false },
      { number: 2, typeLabel: '问答题', highlighted: true },
    ], answeredCount: 0 })
    context.chooseOption({ currentTarget: { dataset: { itemId: 'exercise_first', value: 'Dog' } } })
    context.inputAnswer({ currentTarget: { dataset: { itemId: 'exercise_second' } },
      detail: { value: 'It runs.' } })
    expect(context.data).toMatchObject({ answeredCount: 2 })
    expect(saved.get('task_exercise_answer_session_demo_task_demo_assignment_demo_1_exercise_first'))
      .toMatchObject({ response: 'Dog' })
    expect(saved.get('task_exercise_answer_session_demo_task_demo_assignment_demo_1_exercise_second'))
      .toMatchObject({ response: 'It runs.' })
  })
})
