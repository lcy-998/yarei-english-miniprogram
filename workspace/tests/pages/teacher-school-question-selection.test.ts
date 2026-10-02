import { describe, expect, it } from 'vitest'
import type { SchoolQuestionSummary } from '../../miniprogram/domain/types'
import type { TaskDraftOptionsView } from '../../miniprogram/services/app-service'
import { questionRows, toggleQuestionSelection } from '../../miniprogram/pages/teacher/school-questions/school-question-state'
import { mergeSelectedQuestionResources } from '../../miniprogram/pages/teacher/publish-task/selected-question-resources'

const first: SchoolQuestionSummary = {
  id: 'res_exercise_bird_demo', title: '动物选择题', grade: '三年级', questionType: 'single_choice',
  stemSummary: 'Which animal can fly?', contentVersion: 'demo-v1',
}
const second: SchoolQuestionSummary = {
  id: 'res_exercise_lion_demo', title: '动物填空题', grade: '三年级', questionType: 'fill',
  stemSummary: 'The lion is _____.', contentVersion: 'demo-v1',
}

const options: TaskDraftOptionsView = {
  selectedClassName: '三年级 2 班',
  resources: [
    { id: first.id, title: first.title, type: 'exercise', requiredCount: 1, allowedClassIds: ['cls_grade3_2'] },
    { id: second.id, title: second.title, type: 'exercise', requiredCount: 1, allowedClassIds: ['cls_grade3_2'] },
  ],
  structuredDraft: {
    items: [], target: { type: 'classes', classIds: ['cls_grade3_2'] }, startsAt: '2026-09-26T08:00:00+08:00',
    dueAt: '2026-09-27T08:00:00+08:00', latePolicy: { allowLate: true, lateDays: 7 },
  },
}

describe('T-15 selection and T-06 citation handoff', () => {
  it('keeps selected questions across result filters and pages', () => {
    const selectedFirst = toggleQuestionSelection([], first)
    expect(questionRows([second], selectedFirst)).toEqual([{ ...second, selected: false, typeLabel: '填空题' }])
    const selectedBoth = toggleQuestionSelection(selectedFirst, second)
    expect(questionRows([first], selectedBoth)[0]?.selected).toBe(true)
    expect(selectedBoth.map(item => item.id)).toEqual([first.id, second.id])
    expect(toggleQuestionSelection(selectedBoth, first).map(item => item.id)).toEqual([second.id])
  })

  it('merges selected questions once and refuses offline or cross-class references without mutating draft', () => {
    const merged = mergeSelectedQuestionResources(options, [first.id, second.id, first.id], ['cls_grade3_2'])
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.options.structuredDraft.items.map(item => item.resourceId)).toEqual([first.id, second.id])
    expect(options.structuredDraft.items).toEqual([])
    expect(mergeSelectedQuestionResources(merged.options, [first.id], ['cls_grade3_2']))
      .toMatchObject({ ok: true, options: { structuredDraft: { items: merged.options.structuredDraft.items } } })
    expect(mergeSelectedQuestionResources(options, ['res_deleted'], ['cls_grade3_2']))
      .toMatchObject({ ok: false, message: expect.stringContaining('下架') })
    expect(mergeSelectedQuestionResources(options, [first.id], ['cls_grade4_1']))
      .toMatchObject({ ok: false, message: expect.stringContaining('布置对象') })
    const collision = mergeSelectedQuestionResources({ ...options, structuredDraft: { ...options.structuredDraft,
      items: [{ id: 'item_res_exercise_bird_demo', resourceId: 'other_resource', type: 'exercise', requiredCount: 1, maxScore: 100 }],
    } }, [first.id], ['cls_grade3_2'])
    expect(collision.ok && collision.options.structuredDraft.items.map(item => item.id))
      .toEqual(['item_res_exercise_bird_demo', 'item_res_exercise_bird_demo_2'])
  })
})
