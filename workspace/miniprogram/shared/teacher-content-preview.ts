import type { TaskItem } from '../domain/types'

export type TeacherPreviewType = TaskItem['type']
export interface TeacherContentPreviewRoute {
  resourceId: string
  type: TeacherPreviewType
  targetClassIds?: string[]
}

const TYPES: readonly TeacherPreviewType[] = [
  'reading', 'vocabulary', 'exercise', 'recording', 'listening', 'video', 'dubbing',
]

export function teacherContentPreviewRoute(options?: Record<string, string>): TeacherContentPreviewRoute | null {
  if (options?.teacherPreview !== '1' || !options.resourceId || !options.type) return null
  const type = options.type as TeacherPreviewType
  if (!TYPES.includes(type)) return null
  let resourceId: string
  let targetClassIds: string[] | undefined
  try {
    resourceId = decodeURIComponent(options.resourceId)
    targetClassIds = options.targetClassIds
      ? decodeURIComponent(options.targetClassIds).split(',').filter(Boolean) : undefined
  } catch { return null }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(resourceId)
    || targetClassIds && (targetClassIds.length > 50
      || new Set(targetClassIds).size !== targetClassIds.length
      || targetClassIds.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id)))) return null
  return { resourceId, type,
    ...(targetClassIds === undefined ? {} : { targetClassIds }) }
}
