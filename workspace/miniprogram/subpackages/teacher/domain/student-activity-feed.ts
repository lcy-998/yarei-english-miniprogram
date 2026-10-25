import type { ActivityView } from '../../../domain/types'

export function schoolDate(timeZone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const value = (kind: 'year' | 'month' | 'day') => parts.find(part => part.type === kind)?.value ?? ''
    return `${value('year')}-${value('month')}-${value('day')}`
  } catch {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }
}

export function activityLifecycleLabel(activity: ActivityView, now = new Date()): string {
  if (activity.status === 'draft') return '草稿'
  if (activity.status === 'closed') return '已关闭'
  const today = schoolDate(activity.schedule.schoolTimeZone, now)
  if (today < activity.schedule.startsOn) return '待开始'
  if (today > activity.schedule.endsOn) return '已过期'
  return '进行中'
}

export function activeActivityDay(activity: ActivityView, now = new Date()): string | null {
  if (!activity.publishedAt || activity.status !== 'published') return null
  const date = schoolDate(activity.schedule.schoolTimeZone, now)
  return date >= activity.schedule.startsOn && date <= activity.schedule.endsOn
    && !activity.schedule.restDates.includes(date) ? date : null
}
