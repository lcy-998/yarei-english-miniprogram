import type { TeacherTaskCopy } from '../../../session/session'
import type { StructuredTaskDraft, TaskDraftOptionsView } from '../../../services/app-service'

type DraftItem = StructuredTaskDraft['items'][number]

export function copyTaskItems(source: TeacherTaskCopy, resources: readonly TaskDraftOptionsView['resources'][number][]):
  { ok: true; items: DraftItem[] } | { ok: false; message: string } {
  if (!source.itemRefs.length || source.itemRefs.length !== source.items.length) {
    return { ok: false, message: '原任务内容快照不完整，无法再次布置' }
  }
  const ordered = [...source.itemRefs].sort((left, right) => left.order - right.order)
  const ids = new Set<string>()
  const items: DraftItem[] = []
  for (const [index, reference] of ordered.entries()) {
    const resource = resources.find(candidate => candidate.id === reference.resourceId)
    const original = source.items.find(candidate => candidate.resourceId === reference.resourceId)
    if (!resource || !original || resource.type !== original.type) {
      return { ok: false, message: '原任务有内容已下架、无权限或类型变化，无法再次布置' }
    }
    const rule = reference.completionRule
    const scoring = reference.scoringRule
    const expectedKind = original.type === 'reading' ? 'reading_pages'
      : original.type === 'vocabulary' ? 'vocabulary_words'
        : original.type === 'recording' ? 'recording_upload' : 'exercise_questions'
    if (!rule || rule.kind !== expectedKind || !scoring
      || (scoring.kind !== 'automatic' && scoring.kind !== 'manual')) {
      return { ok: false, message: '原任务完成或计分规则不完整，无法再次布置' }
    }
    const count = original.type === 'reading' ? rule.requiredPageCount
      : original.type === 'vocabulary' ? rule.requiredWordCount
        : original.type === 'recording' ? 1 : rule.requiredQuestionCount
    const pageIds = original.type === 'reading' && Array.isArray(rule.pageIds) ? rule.pageIds : undefined
    if (!Number.isSafeInteger(count) || Number(count) < 1
      || (pageIds && (!pageIds.length || pageIds.length !== count
        || pageIds.some(id => typeof id !== 'string' || !id.trim())
        || new Set(pageIds).size !== pageIds.length))
      || typeof scoring.maxScore !== 'number' || !Number.isFinite(scoring.maxScore)
      || scoring.maxScore < 0 || scoring.maxScore > 100
      || (scoring.weightPercent !== undefined && (typeof scoring.weightPercent !== 'number'
        || !Number.isFinite(scoring.weightPercent)))) {
      return { ok: false, message: '原任务完成或计分规则不完整，无法再次布置' }
    }
    const id = `copy_${index}_${reference.id.replace(/[^a-zA-Z0-9_]/g, '_')}`
    if (ids.has(id)) return { ok: false, message: '原任务内容编号重复，无法再次布置' }
    ids.add(id)
    items.push({ id, resourceId: reference.resourceId, type: original.type,
      requiredCount: Number(count), maxScore: scoring.maxScore, scoringKind: scoring.kind,
      ...(scoring.weightPercent === undefined ? {} : { weightPercent: scoring.weightPercent }),
      ...(pageIds === undefined ? {} : { pageIds: [...pageIds] as string[] }) })
  }
  return { ok: true, items }
}
