import type { PhonicsAnswerView, PhonicsCourseState } from '../domain/types'

export function applyPhonicsAnswer(state: PhonicsCourseState, answer: PhonicsAnswerView): PhonicsCourseState | null {
  if (answer.round !== state.currentRound && (answer.round !== state.currentRound + 1 || state.score === null)) return null
  const isNewRound = answer.round > state.currentRound
  const base = isNewRound ? state.questions.map(question => ({ ...question,
    firstCorrect: null, lastCorrect: null, version: 0 })) : state.questions
  const current = base.find(question => question.questionId === answer.questionId)
  if (!current || (current.firstCorrect === null && !answer.firstAttempt)) return null
  const questions = base.map(question => question.questionId === answer.questionId
    ? { ...question, firstCorrect: question.firstCorrect ?? answer.isCorrect,
      lastCorrect: answer.isCorrect, version: Math.max(question.version, answer.attemptNumber) }
    : question)
  const completedCount = questions.filter(question => question.firstCorrect !== null).length
  const firstCorrectCount = questions.filter(question => question.firstCorrect === true).length
  const score = completedCount === questions.length ? Math.round(firstCorrectCount * 100 / questions.length) : null
  const wrong = new Set(state.wrongQuestionIds)
  if (answer.isCorrect) wrong.delete(answer.questionId)
  else wrong.add(answer.questionId)
  const history = score === null ? state.history : [
    ...state.history.filter(item => item.round !== answer.round),
    { round: answer.round, score, completedAt: answer.attemptedAt },
  ]
  return { ...state, currentRound: answer.round, questions, completedCount, firstCorrectCount,
    score, history, wrongQuestionIds: [...wrong] }
}
