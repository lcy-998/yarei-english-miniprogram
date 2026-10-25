import { describe, expect, it } from 'vitest'
import type { ActivityView } from '../../miniprogram/domain/types'
import { activityLifecycleLabel } from '../../miniprogram/subpackages/teacher/domain/student-activity-feed'

const activity = (status: ActivityView['status']): ActivityView => ({
  id: 'activity_demo', organizationId: 'org_demo', creatorTeacherId: 'teacher_demo',
  title: '虚构阅读打卡', description: '', status,
  schedule: { classId: 'class_demo', startsOn: '2026-10-23', endsOn: '2026-10-25', restDates: [],
    conditions: [{ kind: 'reading', resourceId: 'read_demo' }], schoolTimeZone: 'Asia/Shanghai' },
  participants: [], conditionSnapshots: [], dailyInstances: [], version: 1,
  createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z',
  publishedAt: status === 'draft' ? null : '2026-10-22T00:00:00.000Z', closedAt: null,
})

describe('teacher activity lifecycle label', () => {
  it('derives scheduled, active and expired labels from the school-local date', () => {
    const published = activity('published')
    expect(activityLifecycleLabel(published, new Date('2026-10-22T15:59:59.000Z'))).toBe('待开始')
    expect(activityLifecycleLabel(published, new Date('2026-10-22T16:00:00.000Z'))).toBe('进行中')
    expect(activityLifecycleLabel(published, new Date('2026-10-25T16:00:00.000Z'))).toBe('已过期')
  })

  it('keeps draft and explicitly closed states independent of the date window', () => {
    expect(activityLifecycleLabel(activity('draft'), new Date('2026-10-24T00:00:00.000Z'))).toBe('草稿')
    expect(activityLifecycleLabel(activity('closed'), new Date('2026-10-24T00:00:00.000Z'))).toBe('已关闭')
  })
})
