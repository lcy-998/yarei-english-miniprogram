import type { ActivityView } from './types'

export function schoolDate(timeZone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const value = (kind: 'year' | 'month' | 'day') => parts.find(part => part.type === kind)?.value ?? ''
    return `${value('year')}-${value('month')}-${value('day')}`
  } catch {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }
}

export function activeActivityDay(activity: ActivityView, now = new Date()): string | null {
  if (!activity.publishedAt || activity.status !== 'published') return null
  const date = schoolDate(activity.schedule.schoolTimeZone, now)
  return date >= activity.schedule.startsOn && date <= activity.schedule.endsOn
    && !activity.schedule.restDates.includes(date) ? date : null
}
