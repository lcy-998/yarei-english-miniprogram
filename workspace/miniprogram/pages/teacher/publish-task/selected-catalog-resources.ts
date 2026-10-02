import type { TaskDraftOptionsView } from '../../../services/app-service'

type Resource = TaskDraftOptionsView['resources'][number]
type SelectionResult = { ok: true; options: TaskDraftOptionsView } | { ok: false; message: string }

export function replaceSelectedCatalogResources(
  options: TaskDraftOptionsView,
  resourceIds: readonly string[],
  targetClassIds: readonly string[],
  additionalResources: readonly Resource[] = [],
): SelectionResult {
  if (!resourceIds.length) return { ok: false, message: '请至少选择一项任务内容' }
  if (new Set(resourceIds).size !== resourceIds.length) return { ok: false, message: '任务内容不能重复' }
  const resources = [...options.resources]
  for (const item of additionalResources) if (!resources.some(resource => resource.id === item.id)) resources.push(item)
  const items: TaskDraftOptionsView['structuredDraft']['items'] = []
  const itemIds = new Set<string>()
  for (const resourceId of resourceIds) {
    const resource = resources.find(item => item.id === resourceId)
    if (!resource) return { ok: false, message: '所选资源已失效，请重新选择' }
    if (resource.allowedClassIds && targetClassIds.some(classId => !resource.allowedClassIds?.includes(classId))) {
      return { ok: false, message: '所选资源不适用于当前布置对象' }
    }
    const previous = options.structuredDraft.items.find(item => item.resourceId === resourceId && item.type === resource.type)
    const baseId = previous?.id ?? `item_${resourceId.replace(/[^a-zA-Z0-9_]/g, '_')}`
    let itemId = baseId
    for (let suffix = 2; itemIds.has(itemId); suffix += 1) itemId = `${baseId}_${suffix}`
    itemIds.add(itemId)
    items.push(previous ? { ...previous, id: itemId } : {
      id: itemId,
      resourceId,
      type: resource.type,
      requiredCount: resource.requiredCount,
      maxScore: 100,
    })
  }
  return { ok: true, options: { ...options, resources, structuredDraft: { ...options.structuredDraft, items } } }
}
