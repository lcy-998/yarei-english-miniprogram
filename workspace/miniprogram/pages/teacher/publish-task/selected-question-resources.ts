import type { TaskDraftOptionsView } from '../../../services/app-service'

export type MergeSelectedQuestionResult =
  | { ok: true; options: TaskDraftOptionsView }
  | { ok: false; message: string }

export function mergeSelectedQuestionResources(
  options: TaskDraftOptionsView,
  selectedIds: readonly string[],
  targetClassIds: readonly string[],
): MergeSelectedQuestionResult {
  const resources = selectedIds.map(id => options.resources.find(resource => resource.id === id))
  if (resources.some(resource => !resource || resource.type !== 'exercise')) {
    return { ok: false, message: '题目已下架或不在当前授权内容中，请重新选择' }
  }
  if (resources.some(resource => targetClassIds.some(classId => !resource?.allowedClassIds?.includes(classId)))) {
    return { ok: false, message: '所选题目不适用于当前布置对象，请调整对象或重新选题' }
  }
  const items = [...options.structuredDraft.items]
  for (const resource of resources) {
    if (!resource || items.some(item => item.resourceId === resource.id)) continue
    const baseId = `item_${resource.id.replace(/[^a-zA-Z0-9_]/g, '_')}`
    let itemId = baseId
    let suffix = 2
    while (items.some(item => item.id === itemId)) itemId = `${baseId}_${suffix++}`
    items.push({ id: itemId, resourceId: resource.id,
      type: 'exercise', requiredCount: resource.requiredCount, maxScore: 100 })
  }
  return { ok: true, options: { ...options, structuredDraft: { ...options.structuredDraft, items } } }
}
