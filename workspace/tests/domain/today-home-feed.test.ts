import { describe, expect, it } from 'vitest'
import type { ActivityDayView, ActivityView, HomeTaskSummary } from '../../miniprogram/domain/types'
import { todayHomeItems } from '../../miniprogram/domain/today-home-feed'

const now = new Date('2026-09-30T10:00:00+08:00')
const task = (taskId: string, status: HomeTaskSummary['status'], dueAt: string,
  redoDueAt: string | null = null): HomeTaskSummary => ({
  taskId, title: taskId, status, startsAt: '2026-09-30T08:00:00+08:00', dueAt, redoDueAt,
})
const activity = (id: string): ActivityView => ({ id, title: id,
  schedule: { startsOn: '2026-09-29', endsOn: '2026-10-03' } } as ActivityView)

describe('student today feed', () => {
  it('orders redo, due soon, in progress, checkin, other and completed items', () => {
    const items = todayHomeItems([
      task('later', 'not_started', '2026-10-02T20:00:00+08:00'),
      task('done', 'completed', '2026-09-30T18:00:00+08:00'),
      task('progress', 'in_progress', '2026-10-02T19:00:00+08:00'),
      task('soon', 'not_started', '2026-09-30T19:00:00+08:00'),
      task('redo', 'redo_required', '2026-09-28T19:00:00+08:00', '2026-10-01T19:00:00+08:00'),
    ], [{ activity: activity('checkin'), day: null }], now)
    expect(items.map(item => item.key)).toEqual([
      'task:redo', 'task:soon', 'task:progress', 'activity:checkin', 'task:later', 'task:done',
    ])
    expect(items.find(item => item.key === 'activity:checkin')).toMatchObject({
      kind: 'activity', statusLabel: '进度待确认', completed: false,
    })
  })

  it('keeps one row per task or activity and moves completed checkins to the end', () => {
    const completedDay: ActivityDayView = { activityId: 'a', date: '2026-09-30', restDay: false,
      complete: true, evidenceStatus: 'available', verifiedConditions: 1, totalConditions: 1,
      completedAt: '2026-09-30T09:00:00+08:00', supplemented: false }
    const items = todayHomeItems([task('one', 'in_progress', '2026-10-02T19:00:00+08:00'),
      task('one', 'in_progress', '2026-10-02T19:00:00+08:00')], [
      { activity: activity('a'), day: completedDay },
      { activity: activity('a'), day: completedDay },
    ], now)
    expect(items.map(item => item.key)).toEqual(['task:one', 'activity:a'])
    expect(items[1]).toMatchObject({ completed: true, statusLabel: '今日已打卡' })
  })
})
