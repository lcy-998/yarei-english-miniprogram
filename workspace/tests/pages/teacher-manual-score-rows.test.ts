import { afterEach, describe, expect, it, vi } from 'vitest'

describe('T-08 manual item score selection', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('requires rows for recording and subjective exercises while leaving objective items automatic', async () => {
    vi.stubGlobal('Component', () => undefined)
    const { manualScoreRowsFor } = await import('../../miniprogram/pages/teacher/review-task/review-task')
    const items = [
      { id: 'record', title: '录音朗读', type: 'recording' as const, completionRule: { kind: 'recording_upload' } },
      { id: 'objective', title: '选择题', type: 'exercise' as const, completionRule: { kind: 'exercise_questions' } },
      { id: 'subjective', title: '简答题', type: 'exercise' as const, completionRule: { kind: 'exercise_questions' } },
    ]
    const answers = items.map(item => ({ itemId: item.id, value: { kind: item.type } }))
    const evidence = [
      { itemId: 'objective', questionId: 'q1', questionType: 'single_choice' as const,
        stem: '虚构选择题', options: ['A', 'B'], studentResponse: 'A', correctAnswer: 'A',
        explanation: '', isCorrect: true, recorded: true },
      { itemId: 'subjective', questionId: 'q2', questionType: 'subjective' as const,
        stem: '虚构简答题', options: [], studentResponse: '答', correctAnswer: '',
        explanation: '', isCorrect: null, recorded: true },
    ]
    expect(manualScoreRowsFor(items, answers, evidence, []).map(row => row.id)).toEqual(['record', 'subjective'])
    expect(manualScoreRowsFor(items, answers, evidence, [{ id: 'record', title: '录音朗读',
      input: '80', score: 80, error: '' }])[0]).toMatchObject({ id: 'record', input: '80', score: 80 })
  })
})
