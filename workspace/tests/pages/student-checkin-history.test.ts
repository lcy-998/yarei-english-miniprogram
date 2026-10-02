import { describe, expect, it } from 'vitest'
import { activityHistoryDates, previousActivityDate } from '../../miniprogram/pages/student/checkin-leaderboard/history-dates'

describe('student activity history date paging', () => {
  it('walks backward across month boundaries and stops at the activity start', () => {
    expect(activityHistoryDates('2026-09-28', '2026-10-02')).toEqual([
      '2026-10-02', '2026-10-01', '2026-09-30', '2026-09-29', '2026-09-28',
    ])
    expect(previousActivityDate('2026-09-28')).toBe('2026-09-27')
    expect(activityHistoryDates('2026-09-28', '2026-09-27')).toEqual([])
  })
})
