import type { TaskTemplateView } from '../../../domain/types'
import type { StructuredTaskDraft } from '../../../services/app-service'

export function templateItemRefsFromDraft(items: readonly StructuredTaskDraft['items'][number][]): TaskTemplateView['itemRefs'] {
  return items.map((item, index) => ({ id: item.id, resourceId: item.resourceId,
    completionRule: item.type === 'reading' ? { kind: 'reading_pages', requiredPageCount: item.requiredCount,
      ...(item.pageIds === undefined ? {} : { pageIds: [...item.pageIds] }) }
      : item.type === 'vocabulary' ? { kind: 'vocabulary_words', requiredWordCount: item.requiredCount }
        : item.type === 'recording' ? { kind: 'recording_upload' }
          : { kind: 'exercise_questions', requiredQuestionCount: item.requiredCount },
    scoringRule: { kind: item.scoringKind ?? 'manual', maxScore: item.maxScore,
      ...(item.weightPercent === undefined ? {} : { weightPercent: item.weightPercent }) },
    order: index + 1 }))
}
