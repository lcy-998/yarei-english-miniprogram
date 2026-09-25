export interface LocalDateTimeFields { date: string; time: string }

const pad = (value: number): string => String(value).padStart(2, '0')

export function localDateTimeFields(value: string): LocalDateTimeFields | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  }
}

function parseLocalDateTime(fields: LocalDateTimeFields): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fields.date)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(fields.time)
  if (!dateMatch || !timeMatch) return null
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const value = new Date(year, month - 1, day, hour, minute)
  if (value.getFullYear() !== year || value.getMonth() + 1 !== month || value.getDate() !== day || value.getHours() !== hour || value.getMinutes() !== minute) return null
  return value
}

export function parseTaskSchedule(start: LocalDateTimeFields, due: LocalDateTimeFields):
  { ok: true; startsAt: string; dueAt: string } | { ok: false; message: string } {
  const startsAt = parseLocalDateTime(start)
  const dueAt = parseLocalDateTime(due)
  if (!startsAt || !dueAt) return { ok: false, message: '请选择有效的开始和截止时间' }
  if (dueAt.getTime() <= startsAt.getTime()) return { ok: false, message: '截止时间必须晚于开始时间' }
  return { ok: true, startsAt: startsAt.toISOString(), dueAt: dueAt.toISOString() }
}

export function formatTaskDueAt(value: string, now: Date = new Date()): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '截止时间待确认'
  const year = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
