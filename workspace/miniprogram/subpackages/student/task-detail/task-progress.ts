import type { TaskAssignment } from '../../../domain/types'

export interface ProgressInput {
  itemId: string
  type: 'reading' | 'vocabulary' | 'exercise' | 'recording'
  requiredCount: number
  completedPageCount: string
  completedWordCount: string
  answeredQuestionCount: string
  exerciseQuestion?: { questionId: string; questionType: string }
  exerciseResponse: string
  exerciseSelectedOptions: string[]
  recordingId: string
}

function count(value: string): number {
  const number = Number(value)
  return /^\d+$/.test(value) && Number.isSafeInteger(number) ? number : 0
}

export function taskProgress(inputs: readonly ProgressInput[], status: TaskAssignment['status']): {
  percent: number
  completedCount: number
  byItem: Record<string, { complete: boolean; label: string }>
} {
  const submitted = status === 'awaiting_review' || status === 'completed'
  const byItem: Record<string, { complete: boolean; label: string }> = {}
  let totalFraction = 0
  let completedCount = 0
  for (const item of inputs) {
    const required = Math.max(1, item.requiredCount)
    const achieved = item.type === 'reading' ? count(item.completedPageCount)
      : item.type === 'vocabulary' ? count(item.completedWordCount)
        : item.type === 'recording' ? Number(Boolean(item.recordingId))
          : item.exerciseQuestion ? Number(item.exerciseQuestion.questionType === 'multiple_choice'
            ? item.exerciseSelectedOptions.length > 0 : Boolean(item.exerciseResponse.trim()))
            : count(item.answeredQuestionCount)
    const fraction = submitted ? 1 : Math.min(1, achieved / (item.exerciseQuestion ? 1 : required))
    totalFraction += fraction
    const complete = fraction === 1
    if (complete) completedCount += 1
    byItem[item.itemId] = { complete, label: complete ? '已完成' : achieved > 0 ? `${Math.min(achieved, required)}/${required}` : '未完成' }
  }
  return { percent: submitted ? 100 : inputs.length ? Math.round(totalFraction * 100 / inputs.length) : 0,
    completedCount, byItem }
}
