import type { ActivityDailyCondition, ActivityDraftInput } from '../../../domain/types'

export interface ActivityConditionChoice {
  resourceId: string
  title: string
  kind: ActivityDailyCondition['kind']
  threshold: string
}

export interface ActivityFormValues {
  activityId?: string
  title: string
  description: string
  classId: string
  startsOn: string
  endsOn: string
  restDates: string[]
  conditions: ActivityConditionChoice[]
}

export type ActivityFormResult = { ok: true; draft: ActivityDraftInput } | { ok: false; message: string }

export const ACTIVITY_WEEKDAYS = [
  { day: 1, label: '周一' }, { day: 2, label: '周二' }, { day: 3, label: '周三' },
  { day: 4, label: '周四' }, { day: 5, label: '周五' }, { day: 6, label: '周六' },
  { day: 0, label: '周日' },
] as const

const DAY_MS = 86400000

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = Date.parse(`${date}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date
}

export function shiftActivityDate(date: string, days: number): string | null {
  if (!validDate(date) || !Number.isInteger(days)) return null
  const shifted = new Date(`${date}T00:00:00.000Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

export function weekdaysInActivityRange(startsOn: string, endsOn: string): number[] {
  if (!validDate(startsOn) || !validDate(endsOn) || endsOn < startsOn) return []
  const first = Date.parse(`${startsOn}T00:00:00.000Z`)
  const count = Math.min(7, Math.round((Date.parse(`${endsOn}T00:00:00.000Z`) - first) / DAY_MS) + 1)
  const present = new Set(Array.from({ length: count }, (_, index) => new Date(first + index * DAY_MS).getUTCDay()))
  return ACTIVITY_WEEKDAYS.map(item => item.day).filter(day => present.has(day))
}

export function restDatesForWeekdays(startsOn: string, endsOn: string, weekdays: readonly number[]): string[] | null {
  if (!validDate(startsOn) || !validDate(endsOn) || endsOn < startsOn
    || weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) return null
  const selected = new Set(weekdays)
  const dates: string[] = []
  for (let time = Date.parse(`${startsOn}T00:00:00.000Z`); time <= Date.parse(`${endsOn}T00:00:00.000Z`); time += DAY_MS) {
    const date = new Date(time)
    if (selected.has(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}

export function inferRestWeekdays(startsOn: string, endsOn: string, restDates: readonly string[]): number[] | null {
  if (!restDates.length) return []
  if (restDates.some(date => !validDate(date))) return null
  const days = [...new Set(restDates.map(date => new Date(`${date}T00:00:00.000Z`).getUTCDay()))]
  const repeated = restDatesForWeekdays(startsOn, endsOn, days)
  return repeated !== null && JSON.stringify(repeated) === JSON.stringify([...restDates].sort())
    ? ACTIVITY_WEEKDAYS.map(item => item.day).filter(day => days.includes(day)) : null
}

export function cycleEndsOn(startsOn: string, dayCount: 7 | 14 | 21 | 30): string | null {
  if (!validDate(startsOn)) return null
  const end = new Date(`${startsOn}T00:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() + dayCount - 1)
  return end.toISOString().slice(0, 10)
}

export function defaultActivityPeriod(now = new Date()): { startsOn: string; endsOn: string } {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const startsOn = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
  return { startsOn, endsOn: cycleEndsOn(startsOn, 7)! }
}

export function mergeActivityConditions(
  current: readonly ActivityConditionChoice[],
  selected: readonly { resourceId: string; title: string; kind: ActivityConditionChoice['kind'] }[],
): ActivityConditionChoice[] {
  const known = new Set<string>()
  return selected.filter(item => {
    if (known.has(item.resourceId)) return false
    known.add(item.resourceId)
    return true
  }).map(item => {
    const previous = current.find(candidate => candidate.resourceId === item.resourceId && candidate.kind === item.kind)
    return { resourceId: item.resourceId, title: item.title, kind: item.kind,
      threshold: previous?.threshold ?? '' }
  })
}

export function activityDraftFromForm(form: ActivityFormValues): ActivityFormResult {
  const title = form.title.trim()
  if (!title || title.length > 50) return { ok: false, message: '活动名称须为 1—50 字' }
  if (form.description.length > 300) return { ok: false, message: '活动说明最多 300 字' }
  if (!form.classId) return { ok: false, message: '请选择参与班级' }
  if (!validDate(form.startsOn) || !validDate(form.endsOn)) return { ok: false, message: '请设置有效的开始和结束日期' }
  if (form.endsOn <= form.startsOn) return { ok: false, message: '结束日期必须晚于开始日期' }
  if (new Set(form.restDates).size !== form.restDates.length || form.restDates.some(date =>
    !validDate(date) || date < form.startsOn || date > form.endsOn)) return { ok: false, message: '休息日必须在活动日期内且不能重复' }
  if (!form.conditions.length || new Set(form.conditions.map(item => item.resourceId)).size !== form.conditions.length) {
    return { ok: false, message: '请至少选择一项有效的每日条件' }
  }
  const conditions: ActivityDailyCondition[] = []
  for (const item of form.conditions) {
    if (!item.resourceId.trim()) return { ok: false, message: '条件资源无效，请重新选择' }
    if (item.kind === 'reading') conditions.push({ kind: 'reading', resourceId: item.resourceId })
    else if (item.kind === 'work') conditions.push({ kind: 'work', resourceId: item.resourceId })
    else if (item.kind === 'vocabulary') {
      const count = Number(item.threshold)
      if (!item.threshold.trim() || !Number.isSafeInteger(count) || count < 1) return { ok: false, message: `${item.title}的每日词数须为正整数` }
      conditions.push({ kind: 'vocabulary', resourceId: item.resourceId, requiredWordCount: count })
    } else {
      const score = Number(item.threshold)
      if (!item.threshold.trim() || !Number.isFinite(score) || score < 0 || score > 100) {
        return { ok: false, message: `${item.title}的最低分须为 0—100` }
      }
      conditions.push({ kind: 'exercise', resourceId: item.resourceId, minimumScore: score })
    }
  }
  return { ok: true, draft: { ...(form.activityId ? { activityId: form.activityId } : {}), title,
    description: form.description.trim(), classId: form.classId, startsOn: form.startsOn, endsOn: form.endsOn,
    restDates: [...form.restDates], conditions } }
}
