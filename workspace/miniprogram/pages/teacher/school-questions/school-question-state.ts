import type { SchoolQuestionSummary } from '../../../domain/types'
import { questionTypeLabel } from './school-question-facets'

export interface SelectedQuestion extends SchoolQuestionSummary {
  selected: true
}

export function toggleQuestionSelection(
  selected: readonly SelectedQuestion[],
  question: SchoolQuestionSummary,
): SelectedQuestion[] {
  return selected.some(item => item.id === question.id)
    ? selected.filter(item => item.id !== question.id)
    : [...selected, { ...question, selected: true }]
}

export function questionRows(
  questions: readonly SchoolQuestionSummary[],
  selected: readonly SelectedQuestion[],
): Array<SchoolQuestionSummary & { selected: boolean; typeLabel: string }> {
  const selectedIds = new Set(selected.map(item => item.id))
  return questions.map(question => ({
    ...question,
    selected: selectedIds.has(question.id),
    typeLabel: questionTypeLabel(question.questionType),
  }))
}
