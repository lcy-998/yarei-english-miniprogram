import { describe, expect, it } from 'vitest'
import { evaluateMemoryExercise } from '../../miniprogram/domain/memory-exercise-rules'
import type { SchoolQuestionDetail } from '../../miniprogram/domain/types'

const question: SchoolQuestionDetail = {
  id: 'res_exercise_bird_demo', title: '动物选择题', grade: '三年级', questionType: 'single_choice',
  stemSummary: 'Which animal can fly?', contentVersion: 'demo-v1', stem: 'Which animal can fly?',
  options: ['A. bird', 'B. lion'], correctAnswer: 'A. bird', explanation: 'Birds can fly.',
}

describe('memory fallback M2 exercise evaluation', () => {
  it('derives objective correctness from the private snapshot', () => {
    expect(evaluateMemoryExercise(question, { kind: 'exercise', answeredQuestionCount: 1,
      questionResponses: [{ questionId: question.id, response: 'B. lion' }] })).toMatchObject({
        automaticScore: 0, canonical: { correctQuestionCount: 0, questionResponses: [{ isCorrect: false }] },
      })
  })

  it('rejects fake counts, forged correctness, and answers outside the published choices', () => {
    expect(evaluateMemoryExercise(question, { kind: 'exercise', answeredQuestionCount: 1 })).toBeNull()
    expect(evaluateMemoryExercise(question, { kind: 'exercise', answeredQuestionCount: 1,
      questionResponses: [{ questionId: question.id, response: 'A. bird', isCorrect: true }] })).toBeNull()
    expect(evaluateMemoryExercise(question, { kind: 'exercise', answeredQuestionCount: 1,
      questionResponses: [{ questionId: question.id, response: 'C. fox' }] })).toBeNull()
  })
})
