import type { ParentTaskListFilters, ParentTaskListPage, ParentTaskListView } from './parent-task-types'

const LEGACY_CURSOR_PREFIX = 'legacy:'

export function isUnsupportedParentTaskFilter(error: Readonly<{
  code: string; fieldErrors?: Readonly<Record<string, string>>
}>): boolean {
  if (error.code !== 'VALIDATION_ERROR') return false
  return Object.entries(error.fieldErrors ?? {}).some(([field, message]) =>
    ['filters.startsOn', 'filters.endsOn', 'filters.statusGroup'].includes(field)
    && message === '不支持的字段。')
}

export function isLegacyParentTaskCursor(cursor: string | undefined): boolean {
  return cursor?.startsWith(LEGACY_CURSOR_PREFIX) ?? false
}

export function legacyParentTaskPage(items: readonly ParentTaskListView[], filters: ParentTaskListFilters,
  page: Readonly<{ limit: number; cursor?: string }>): ParentTaskListPage | null {
  const offset = page.cursor === undefined ? 0
    : /^legacy:(0|[1-9]\d*)$/.test(page.cursor) ? Number(page.cursor.slice(LEGACY_CURSOR_PREFIX.length)) : NaN
  if (!Number.isSafeInteger(offset) || offset < 0) return null
  const filtered = items.filter(item => {
    const dueTime = Date.parse(item.dueAt)
    if (!Number.isFinite(dueTime)) return false
    const dueOn = new Date(dueTime + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
    if (dueOn < filters.startsOn || dueOn > filters.endsOn) return false
    if (filters.statusGroup === 'active') return item.status !== 'awaiting_review' && item.status !== 'completed'
    return filters.statusGroup === undefined || item.status === filters.statusGroup
  })
  const selected = filtered.slice(offset, offset + page.limit)
  const next = offset + selected.length
  return { items: selected, total: filtered.length,
    nextCursor: next < filtered.length ? `${LEGACY_CURSOR_PREFIX}${next}` : null }
}
