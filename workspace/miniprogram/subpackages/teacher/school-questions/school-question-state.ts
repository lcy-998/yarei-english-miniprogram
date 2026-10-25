import type { SchoolQuestionSummary } from '../../../domain/types'
import { questionTypeLabel } from './school-question-facets'
import { exercisePackTitle, exerciseQuestionPackKey } from '../shared/exercise-pack-title'

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

export function questionPackRows(
  questions: readonly SchoolQuestionSummary[],
  selected: readonly SelectedQuestion[],
  filters: Readonly<{ keyword?: string; knowledgePoint?: string;
    questionType?: string; difficulty?: string }> = {},
): Array<SchoolQuestionSummary & { selected: boolean; typeLabel: string; questionIds: string[] }> {
  const packs = new Map<string, SchoolQuestionSummary[]>()
  for (const question of questions) {
    const key = exerciseQuestionPackKey(question)
    if (!key) continue
    packs.set(key, [...(packs.get(key) ?? []), question])
  }
  const selectedIds = new Set(selected.map(item => item.id))
  const keyword = filters.keyword?.trim().toLocaleLowerCase() ?? ''
  return [...packs.entries()].flatMap(([key, members]) => {
    if (members.length < 5 || !members.some(question =>
      (!keyword || `${question.title} ${question.stemSummary} ${question.knowledgePoint ?? ''}`
        .toLocaleLowerCase().includes(keyword))
      && (!filters.knowledgePoint || question.knowledgePoint === filters.knowledgePoint)
      && (!filters.questionType || question.questionType === filters.questionType)
      && (!filters.difficulty || question.difficulty === filters.difficulty))) return []
    const sorted = [...members].sort((left, right) => left.id.localeCompare(right.id))
    const first = sorted[0]!
    return [{ ...first, id: `pack:${key}`, title: exercisePackTitle(first.title),
      stemSummary: `共 ${sorted.length} 道相关题目`, typeLabel: '习题组',
      questionIds: sorted.map(question => question.id),
      selected: sorted.every(question => selectedIds.has(question.id)) }]
  })
}
