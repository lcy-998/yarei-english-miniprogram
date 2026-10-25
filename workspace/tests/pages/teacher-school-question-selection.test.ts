import { describe, expect, it } from 'vitest'
import type { SchoolQuestionSummary } from '../../miniprogram/subpackages/teacher/domain/types'
import type { TaskDraftOptionsView } from '../../miniprogram/subpackages/teacher/services/app-service'
import { questionPackRows, questionRows, toggleQuestionSelection } from '../../miniprogram/subpackages/teacher/school-questions/school-question-state'
import { mergeSelectedQuestionResources } from '../../miniprogram/subpackages/teacher/publish-task/selected-question-resources'

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
  it('shows a complete related set as one library card', () => {
    const pack = Array.from({ length: 5 }, (_, index): SchoolQuestionSummary => ({
      id: `market_question_${index + 1}`, title: `Market story - Question ${index + 1}`,
      grade: '三年级', textbook: 'Market story', unit: 'Unit 1',
      exercisePackId: 'market_pack', questionType: 'single_choice',
      stemSummary: `Question ${index + 1}`, contentVersion: '1',
    }))
    expect(questionPackRows(pack, [])).toMatchObject([{
      id: 'pack:market_pack', title: 'Market story', questionIds: pack.map(item => item.id),
      stemSummary: '共 5 道相关题目',
    }])
    expect(questionPackRows(pack.slice(0, 4), [])).toEqual([])
    expect(questionPackRows(pack, [], { keyword: 'Question 5' })[0]?.questionIds)
      .toEqual(pack.map(item => item.id))
  })
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
