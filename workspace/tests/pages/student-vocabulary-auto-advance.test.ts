import { afterEach, describe, expect, it, vi } from 'vitest'

const getWordAttemptState = vi.fn()
const submitWordAnswer = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/app-service', async importOriginal => ({
  ...await importOriginal<typeof import('../../miniprogram/subpackages/student/services/app-service')>(),
  getWordAttemptState, submitWordAnswer,
}))

describe('S-02 word task progression', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('moves after each saved answer and returns after the final word', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    const navigateBack = vi.fn()
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { navigateBack, showToast: vi.fn() })
    getWordAttemptState.mockImplementation(async (_userId, scope) => ({ ok: true,
      data: { wordId: scope.wordId, version: 0, firstCorrect: null, attempts: [] } }))
    submitWordAnswer.mockResolvedValue({ ok: true, data: { attemptNumber: 1, isCorrect: true } })
    await import('../../miniprogram/subpackages/student/vocabulary/vocabulary')
    if (!definition) throw new Error('S-02 page unavailable')
    const pack = { id: 'pack_demo', title: '虚构词包', contentVersion: 'v1', words: [
      { id: 'word_cat', word: 'cat', meaning: '猫' },
      { id: 'word_dog', word: 'dog', meaning: '狗' },
    ] }
    const context = { data: { ...definition.data, pack, trustedMode: true, userId: 'student_demo',
      taskId: 'task_demo', taskItemId: 'item_demo', questionType: 'spelling', spellingAnswer: 'cat' },
      setData(change: Record<string, unknown>, done?: () => void) { Object.assign(this.data, change); done?.() } }
    Object.assign(context, definition.methods)

    await context.submitAnswer()
    expect(context.data.wordIndex).toBe(1)
    expect(context.data.answered).toBe(false)
    expect(navigateBack).not.toHaveBeenCalled()

    context.setData({ spellingAnswer: 'dog' })
    await context.submitAnswer()
    expect(context.data.completedCount).toBe(2)
    expect(navigateBack).toHaveBeenCalledWith({ delta: 1 })
    expect(submitWordAnswer).toHaveBeenCalledTimes(2)
  })
})
