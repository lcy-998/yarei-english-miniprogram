import { afterEach, describe, expect, it, vi } from 'vitest'

const getVocabularyPack = vi.fn()
const saveVocabularyProgress = vi.fn()
const submitWordAnswer = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/app-service', async importOriginal => ({
  ...await importOriginal<typeof import('../../miniprogram/subpackages/student/services/app-service')>(),
  getVocabularyPack, saveVocabularyProgress, submitWordAnswer,
}))

describe('S-02 teacher content preview', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('shows the student word cards without creating practice attempts', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { getStorageSync: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
      user: { id: 'teacher_demo', role: 'teacher' } }) })
    getVocabularyPack.mockResolvedValue({ ok: true, data: { id: 'pack_demo', title: '虚构词包',
      grade: '三年级', unit: 'Unit 1', contentVersion: 'v1', words: [
        { id: 'word_cat', word: 'cat', meaning: '猫', example: 'A cat.', syllableDisplay: 'cat' },
        { id: 'word_dog', word: 'dog', meaning: '狗', example: 'A dog.', syllableDisplay: 'dog' },
      ] } })
    await import('../../miniprogram/subpackages/student/vocabulary/vocabulary')
    if (!definition) throw new Error('S-02 page unavailable')
    const context = { data: { ...definition.data, teacherPreviewMode: true,
      teacherPreviewResourceId: 'pack_demo' },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadTeacherPreview()
    expect(context.data).toMatchObject({ mode: 'study', wordIndex: 0,
      completedCount: 0, teacherPreviewSessionId: 'teacher_session' })
    context.nextWord()
    await context.submitAnswer()
    expect(context.data.wordIndex).toBe(1)
    expect(saveVocabularyProgress).not.toHaveBeenCalled()
    expect(submitWordAnswer).not.toHaveBeenCalled()
  })
})
