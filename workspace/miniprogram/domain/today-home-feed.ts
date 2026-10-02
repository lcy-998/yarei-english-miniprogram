import type { ActivityDayView, ActivityView, HomeTaskSummary } from './types'

export interface TodayHomeItem {
  key: string
  kind: 'task' | 'activity'
  id: string
  title: string
  statusLabel: string
  dueAt: string
  completed: boolean
  priority: number
}

export interface TodayActivityEntry {
  activity: ActivityView
  day: ActivityDayView | null
}

export function todayHomeItems(tasks: readonly HomeTaskSummary[], activities: readonly TodayActivityEntry[],
  now = new Date()): TodayHomeItem[] {
  const seen = new Set<string>()
  const taskRows = tasks.flatMap((task): TodayHomeItem[] => {
    const key = `task:${task.taskId}`
    if (seen.has(key)) return []
    seen.add(key)
    const completed = task.status === 'awaiting_review' || task.status === 'completed'
    const redo = task.status === 'redo_required' || (!completed && Boolean(task.redoDueAt))
    const dueAt = redo ? task.redoDueAt || task.dueAt : task.dueAt
    const dueMs = Date.parse(dueAt)
    const soon = Number.isFinite(dueMs) && dueMs <= now.getTime() + 24 * 60 * 60 * 1000
    const priority = redo ? 0 : task.status === 'overdue' ? 1 : completed ? 6
      : soon ? 2 : task.status === 'in_progress' ? 3 : 5
    return [{ key, kind: 'task', id: task.taskId, title: task.title, dueAt, completed, priority,
      statusLabel: task.status === 'redo_required' ? '退回重做' : redo ? '重做中'
        : task.status === 'overdue' ? '已过期' : task.status === 'awaiting_review' ? '待检查'
          : task.status === 'completed' ? '已完成' : task.status === 'in_progress' ? '进行中' : '待完成' }]
  })
  const activityRows = activities.flatMap(({ activity, day }): TodayHomeItem[] => {
    const key = `activity:${activity.id}`
    if (seen.has(key)) return []
    seen.add(key)
    const completed = day?.complete === true
    return [{ key, kind: 'activity', id: activity.id, title: activity.title,
      dueAt: `${activity.schedule.endsOn}T23:59:59`, completed, priority: completed ? 6 : 4,
      statusLabel: completed ? '今日已打卡' : day ? '今日待打卡' : '进度待确认' }]
  })
  return [...taskRows, ...activityRows].sort((left, right) => left.priority - right.priority
    || Date.parse(left.dueAt) - Date.parse(right.dueAt) || left.key.localeCompare(right.key))
}
