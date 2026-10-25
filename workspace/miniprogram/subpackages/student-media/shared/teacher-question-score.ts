import { parseReviewScoreInput } from './review-task-state'

export interface ReviewedQuestionScore {
  questionId: string
  verdict: string
  teacherScoreRequired: boolean
  teacherScoreInput: string
  teacherScoreError: string
}

export function withQuestionScoreDraft<T extends { questionId: string; verdict: string }>(
  questions: readonly T[], inputs: Readonly<Record<string, string>>): Array<T & ReviewedQuestionScore> {
  return questions.map(question => {
    const teacherScoreRequired = question.verdict === '待教师评分'
    const parsed = parseReviewScoreInput(inputs[question.questionId] ?? '')
    return { ...question, teacherScoreRequired,
      teacherScoreInput: parsed.input, teacherScoreError: parsed.error }
  })
}

/** Video objective questions keep their verified 0/100 result; only unanswered manual scores block the item total. */
export function previewVideoQuestionScore(questions: readonly ReviewedQuestionScore[]): number | null {
  if (!questions.length || new Set(questions.map(question => question.questionId)).size !== questions.length) return null
  let total = 0
  for (const question of questions) {
    if (question.teacherScoreRequired) {
      const parsed = parseReviewScoreInput(question.teacherScoreInput)
      if (parsed.score === null || parsed.error) return null
      total += parsed.score
    } else if (question.verdict === '正确') total += 100
    else if (question.verdict !== '错误') return null
  }
  return Math.round(total / questions.length)
}
