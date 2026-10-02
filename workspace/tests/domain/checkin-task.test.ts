import { describe, expect, it } from 'vitest'
import type { ActivityDayView, ActivityView, TaskDetailView } from '../../miniprogram/domain/types'
import { checkinConditionRows } from '../../miniprogram/domain/checkin-task'

const activity = { id: 'activity_demo', schedule: { classId: 'class_demo', startsOn: '2026-09-30',
  endsOn: '2026-10-02', schoolTimeZone: 'Asia/Shanghai', restDates: [], conditions: [
    { kind: 'reading', resourceId: 'book_demo' },
    { kind: 'exercise', resourceId: 'question_demo', minimumScore: 80 },
  ] } } as ActivityView
const day = { activityId: 'activity_demo', date: '2026-09-30', restDay: false,
  complete: false, evidenceStatus: 'available', verifiedConditions: 1, totalConditions: 2,
  completedAt: null, supplemented: false, conditionProgress: [
    { index: 0, kind: 'reading', resourceId: 'book_demo', complete: true, completedAt: '2026-09-30T09:00:00+08:00' },
    { index: 1, kind: 'exercise', resourceId: 'question_demo', complete: false, completedAt: null },
  ] } as ActivityDayView

describe('student checkin task rows', () => {
  it('shows per-condition evidence and opens an assigned exercise task', () => {
    const tasks = [{ task: { id: 'task_question', status: 'active', items: [
      { id: 'item_question', type: 'exercise', resourceId: 'question_demo' }] },
      assignment: { classId: 'class_demo', status: 'not_started' } }] as TaskDetailView[]
    expect(checkinConditionRows(activity, day, tasks, true)).toMatchObject([
      { kind: 'reading', complete: true, statusLabel: '已完成', canOpen: true },
      { kind: 'exercise', complete: false, statusLabel: '待完成', taskId: 'task_question', canOpen: true },
    ])
  })

  it('does not offer a dead exercise link or active actions on a rest day', () => {
    expect(checkinConditionRows(activity, day, [], true)[1]).toMatchObject({
      taskId: '', canOpen: false, iconName: 'exercise',
    })
    expect(checkinConditionRows(activity, null, [], false)[0]).toMatchObject({
      statusLabel: '非打卡日', canOpen: false,
    })
  })

  it('reserves future audio and listening rows without enabling navigation or completion', () => {
    const future = { ...activity, schedule: { ...activity.schedule, conditions: [
      { kind: 'listening', resourceId: 'audio_demo' }, { kind: 'audio', resourceId: 'recording_demo' },
    ] } } as unknown as ActivityView
    expect(checkinConditionRows(future, null, [], true)).toMatchObject([
      { label: '听力任务', statusLabel: '后续开放', iconName: 'headphones', canOpen: false },
      { label: '音频任务', statusLabel: '后续开放', iconName: 'headphones', canOpen: false },
    ])
  })
})
