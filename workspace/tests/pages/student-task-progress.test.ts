import { describe, expect, it } from 'vitest'
import { taskProgress, type ProgressInput } from '../../miniprogram/pages/student/task-detail/task-progress'

function input(overrides: Partial<ProgressInput> = {}): ProgressInput {
  return { itemId: 'reading', type: 'reading', requiredCount: 2, completedPageCount: '0',
    completedWordCount: '', answeredQuestionCount: '', exerciseResponse: '', exerciseSelectedOptions: [],
    recordingId: '', ...overrides }
}

describe('student task detail progress', () => {
  it('updates by completed learning items before submission and resets after a return', () => {
    const reading = input({ completedPageCount: '2' })
    const words = input({ itemId: 'words', type: 'vocabulary', requiredCount: 4, completedWordCount: '2' })
    expect(taskProgress([reading, words], 'in_progress')).toMatchObject({ percent: 75, completedCount: 1,
      byItem: { reading: { complete: true }, words: { label: '2/4' } } })
    expect(taskProgress([reading, words], 'awaiting_review')).toMatchObject({ percent: 100, completedCount: 2 })
    expect(taskProgress([input(), words], 'redo_required')).toMatchObject({ percent: 25, completedCount: 0 })
  })

  it('counts an answered question and uploaded recording', () => {
    const exercise = input({ itemId: 'question', type: 'exercise', requiredCount: 1,
      exerciseQuestion: { questionId: 'q1', questionType: 'single_choice' }, exerciseResponse: 'A' })
    const recording = input({ itemId: 'voice', type: 'recording', requiredCount: 1, recordingId: 'recording_1' })
    expect(taskProgress([exercise, recording], 'in_progress')).toMatchObject({ percent: 100, completedCount: 2 })
  })
})
