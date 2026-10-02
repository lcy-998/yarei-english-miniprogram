import type { SchoolQuestionDetail, TaskCompletionValue } from './types'

export interface MemoryExerciseEvaluation {
  canonical: Extract<TaskCompletionValue, { kind: 'exercise' }>
  automaticScore: number | null
}

export function evaluateMemoryExercise(
  question: SchoolQuestionDetail,
  value: TaskCompletionValue,
): MemoryExerciseEvaluation | null {
  if (value.kind !== 'exercise' || value.answeredQuestionCount !== 1 || value.correctQuestionCount !== undefined
    || value.questionResponses?.length !== 1) return null
  const response = value.questionResponses[0]
  if (!response || response.questionId !== question.id || response.isCorrect !== undefined) return null
  const answer = response.response
  if (question.questionType === 'multiple_choice') {
    if (!Array.isArray(answer) || !answer.length || new Set(answer).size !== answer.length
      || answer.some(option => !question.options.includes(option))) return null
  } else if (typeof answer !== 'string' || !answer.trim()
    || (question.questionType === 'single_choice' && !question.options.includes(answer))) return null
  const isCorrect = question.questionType === 'subjective' ? null : sameAnswer(question, answer)
  return {
    canonical: { kind: 'exercise', answeredQuestionCount: 1,
      ...(isCorrect === null ? {} : { correctQuestionCount: isCorrect ? 1 : 0 }),
      questionResponses: [{ questionId: question.id, response: answer,
        ...(isCorrect === null ? {} : { isCorrect }) }] },
    automaticScore: isCorrect === null ? null : isCorrect ? 100 : 0,
  }
}

function sameAnswer(question: SchoolQuestionDetail, answer: string | string[]): boolean {
  const key = question.correctAnswer
  if (question.questionType === 'multiple_choice') {
    return Array.isArray(answer) && Array.isArray(key)
      && answer.length === key.length
      && answer.every(option => key.includes(option))
  }
  return typeof answer === 'string' && typeof key === 'string'
    && answer.trim().toLocaleLowerCase() === key.trim().toLocaleLowerCase()
}
