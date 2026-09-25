import { describe, expect, it } from 'vitest'
import { formatTaskDueAt, localDateTimeFields, parseTaskSchedule } from '../../miniprogram/shared/task-schedule'

describe('task schedule', () => {
  it('round trips the local date and time into offset-aware ISO timestamps', () => {
    const start = localDateTimeFields('2026-09-24T09:30:00+08:00')!
    const due = localDateTimeFields('2026-09-25T09:30:00+08:00')!
    const result = parseTaskSchedule(start, due)
    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(localDateTimeFields(result.startsAt)).toEqual(start)
      expect(localDateTimeFields(result.dueAt)).toEqual(due)
    }
  })

  it('rejects an earlier or invalid deadline', () => {
    expect(parseTaskSchedule({ date: '2026-09-24', time: '09:30' }, { date: '2026-09-24', time: '09:30' })).toEqual({ ok: false, message: '截止时间必须晚于开始时间' })
    expect(parseTaskSchedule({ date: '2026-02-30', time: '09:30' }, { date: '2026-03-01', time: '10:00' })).toEqual({ ok: false, message: '请选择有效的开始和截止时间' })
  })

  it('formats the stored deadline rather than a fixed clock label', () => {
    const due = new Date('2026-09-25T09:30:00+08:00')
    const localTime = `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`
    expect(formatTaskDueAt(due.toISOString(), new Date('2026-09-24T00:00:00+08:00'))).toContain(localTime)
  })
})
