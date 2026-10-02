import { describe, expect, it } from 'vitest'
import type { ActivityView } from '../../miniprogram/domain/types'
import { activeActivityDay, schoolDate } from '../../miniprogram/domain/student-activity-feed'

const activity: ActivityView = {
  id: 'activity_demo', organizationId: 'org_demo', creatorTeacherId: 'teacher_demo', title: '阅读打卡',
  description: '', status: 'published', participants: [], conditionSnapshots: [], version: 2,
  createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
  publishedAt: '2026-09-29T00:00:00.000Z', closedAt: null,
  schedule: { classId: 'class_demo', schoolTimeZone: 'Asia/Shanghai', startsOn: '2026-09-30',
    endsOn: '2026-10-02', restDates: ['2026-10-01'], conditions: [{ kind: 'reading', resourceId: 'book_demo' }] },
}

describe('student checkin feed', () => {
  it('uses the school date and omits rest days and unpublished activities', () => {
    const now = new Date('2026-09-29T17:00:00.000Z')
    expect(schoolDate('Asia/Shanghai', now)).toBe('2026-09-30')
    expect(activeActivityDay(activity, now)).toBe('2026-09-30')
    expect(activeActivityDay(activity, new Date('2026-09-30T17:00:00.000Z'))).toBeNull()
    expect(activeActivityDay({ ...activity, publishedAt: null }, now)).toBeNull()
  })
})
