import { describe, expect, it } from 'vitest'
import { activityDraftFromForm, cycleEndsOn, defaultActivityPeriod, inferRestWeekdays, mergeActivityConditions,
  restDatesForWeekdays, shiftActivityDate, weekdaysInActivityRange } from '../../miniprogram/pages/teacher/checkin-activities/activity-form'

const form = { title: '动物阅读打卡', description: '', classId: 'cls_demo', startsOn: '2026-09-27', endsOn: '2026-10-03',
  restDates: ['2026-09-30'], conditions: [{ resourceId: 'res_reading', title: '动物绘本', kind: 'reading' as const, threshold: '' }] }

describe('T-09 activity form', () => {
  it('keeps thresholds while changing the selected catalog results', () => {
    const merged = mergeActivityConditions([{ resourceId: 'res_words', title: '旧词包', kind: 'vocabulary', threshold: '3' }], [
      { resourceId: 'res_words', title: '新词包标题', kind: 'vocabulary' },
      { resourceId: 'res_reading', title: '动物绘本', kind: 'reading' },
      { resourceId: 'res_reading', title: '重复资源', kind: 'reading' },
    ])
    expect(merged).toEqual([
      { resourceId: 'res_words', title: '新词包标题', kind: 'vocabulary', threshold: '3' },
      { resourceId: 'res_reading', title: '动物绘本', kind: 'reading', threshold: '' },
    ])
  })

  it('builds a typed draft and rejects invalid scores, counts and rest dates', () => {
    expect(cycleEndsOn('2026-09-27', 7)).toBe('2026-10-03')
    expect(activityDraftFromForm(form)).toMatchObject({ ok: true, draft: { conditions: [{ kind: 'reading', resourceId: 'res_reading' }] } })
    expect(activityDraftFromForm({ ...form, restDates: ['2026-09-30', '2026-09-30'] })).toMatchObject({ ok: false })
    expect(activityDraftFromForm({ ...form, conditions: [{ resourceId: 'res_words', title: '词包', kind: 'vocabulary', threshold: '1.5' }] }))
      .toMatchObject({ ok: false })
    expect(activityDraftFromForm({ ...form, conditions: [{ resourceId: 'res_question', title: '习题', kind: 'exercise', threshold: '101' }] }))
      .toMatchObject({ ok: false })
  })

  it('defaults a new activity to tomorrow for seven days across month end', () => {
    expect(defaultActivityPeriod(new Date(2026, 8, 30))).toEqual({ startsOn: '2026-10-01', endsOn: '2026-10-07' })
  })

  it('requires the start date to precede the end date, including across months', () => {
    expect(shiftActivityDate('2026-10-01', -1)).toBe('2026-09-30')
    expect(shiftActivityDate('2026-09-30', 1)).toBe('2026-10-01')
    expect(activityDraftFromForm({ ...form, endsOn: form.startsOn })).toMatchObject({
      ok: false, message: '结束日期必须晚于开始日期',
    })
  })

  it('expands selected weekdays into concrete rest dates without changing older irregular drafts', () => {
    const weekends = ['2026-10-03', '2026-10-04', '2026-10-10', '2026-10-11']
    expect(restDatesForWeekdays('2026-09-28', '2026-10-11', [6, 0])).toEqual(weekends)
    expect(restDatesForWeekdays('2026-09-28', '2026-10-04', [6, 0])).toEqual(weekends.slice(0, 2))
    expect(weekdaysInActivityRange('2026-09-28', '2026-09-29')).toEqual([1, 2])
    expect(inferRestWeekdays('2026-09-28', '2026-10-11', weekends)).toEqual([6, 0])
    expect(inferRestWeekdays('2026-09-28', '2026-10-11', [weekends[0]!])).toBeNull()
    expect(restDatesForWeekdays('2026-10-11', '2026-09-28', [6, 0])).toBeNull()
  })
})
