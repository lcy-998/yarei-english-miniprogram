import { describe, expect, it } from 'vitest'
import { applyPhonicsAnswer } from '../../miniprogram/shared/phonics-progress'
import type { PhonicsAnswerView, PhonicsCourseState } from '../../miniprogram/domain/types'

const state: PhonicsCourseState = { courseId: 'course_short_a', contentVersion: 'demo-v1',
  currentRound: 1, completedCount: 0, firstCorrectCount: 0, score: null, history: [], wrongQuestionIds: [], questions: [
    { questionId: 'question_cat', firstCorrect: null, lastCorrect: null, version: 0 },
    { questionId: 'question_bag', firstCorrect: null, lastCorrect: null, version: 0 },
  ] }
const answer: PhonicsAnswerView = { round: 1, questionId: 'question_cat', selectedOptionId: 'sun', correctOptionId: 'map',
  explanation: '短元音', isCorrect: false, firstAttempt: true, attemptNumber: 1, attemptedAt: '2026-09-27T09:00:00+08:00' }

describe('phonics answer progress from trusted receipts', () => {
  it('preserves first correctness while a later correct retry removes a wrong question', () => {
    const first = applyPhonicsAnswer(state, answer)
    expect(first).toMatchObject({ completedCount: 1, firstCorrectCount: 0,
      wrongQuestionIds: ['question_cat'] })
    if (!first) throw new Error('first answer expected')
    const corrected = applyPhonicsAnswer(first, { ...answer, isCorrect: true,
      firstAttempt: false, attemptNumber: 2, selectedOptionId: 'map' })
    expect(corrected).toMatchObject({ completedCount: 1, firstCorrectCount: 0,
      wrongQuestionIds: [], questions: [{ questionId: 'question_cat', firstCorrect: false, version: 2 },
        { questionId: 'question_bag', firstCorrect: null }] })
    if (!corrected) throw new Error('correction expected')
    const completed = applyPhonicsAnswer(corrected, { ...answer, questionId: 'question_bag', selectedOptionId: 'hat',
      isCorrect: true })
    expect(completed).toMatchObject({ completedCount: 2, firstCorrectCount: 1, score: 50,
      history: [{ round: 1, score: 50 }] })
    if (!completed) throw new Error('completed round expected')
    expect(applyPhonicsAnswer(completed, { ...answer, round: 2, selectedOptionId: 'map', isCorrect: true }))
      .toMatchObject({ currentRound: 2, completedCount: 1, score: null,
        history: [{ round: 1, score: 50 }] })
  })
  it('does not guess the first result when another device already answered', () => {
    expect(applyPhonicsAnswer(state, { ...answer, firstAttempt: false, attemptNumber: 2 })).toBeNull()
  })
})
