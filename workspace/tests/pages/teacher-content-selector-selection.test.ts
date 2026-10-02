import { describe, expect, it } from 'vitest'
import type { TaskDraftOptionsView } from '../../miniprogram/services/app-service'
import { replaceSelectedCatalogResources } from '../../miniprogram/pages/teacher/publish-task/selected-catalog-resources'

const options: TaskDraftOptionsView = {
  selectedClassName: '三年级 2 班',
  resources: [
    { id: 'book_zoo', title: '阅读书籍', type: 'reading', requiredCount: 4, allowedClassIds: ['class_a'] },
    { id: 'vocab_animals', title: '动物词包', type: 'vocabulary', requiredCount: 2, allowedClassIds: ['class_a'] },
  ],
  structuredDraft: {
    items: [
      { id: 'existing_reading', resourceId: 'book_zoo', type: 'reading', requiredCount: 3, maxScore: 70 },
      { id: 'existing_vocabulary', resourceId: 'vocab_animals', type: 'vocabulary', requiredCount: 2, maxScore: 30 },
    ],
    target: { type: 'classes', classIds: ['class_a'] },
    startsAt: '2026-09-26T00:00:00.000Z', dueAt: '2026-09-27T00:00:00.000Z',
    latePolicy: { allowLate: true, lateDays: 7 },
  },
}

describe('T-18 selection returned to T-06', () => {
  it('removes deselected resources and keeps published rule edits for retained items', () => {
    const result = replaceSelectedCatalogResources(options, ['vocab_animals', 'res_exercise_bird_demo'], ['class_a'], [
      { id: 'res_exercise_bird_demo', title: '动物选择题', type: 'exercise', requiredCount: 1, allowedClassIds: ['class_a'] },
    ])
    expect(result).toMatchObject({ ok: true, options: { structuredDraft: { items: [
      { id: 'existing_vocabulary', resourceId: 'vocab_animals', requiredCount: 2, maxScore: 30 },
      { id: 'item_res_exercise_bird_demo', resourceId: 'res_exercise_bird_demo', requiredCount: 1 },
    ] } } })
    expect(options.structuredDraft.items).toHaveLength(2)
    expect(options.resources).toHaveLength(2)
  })

  it('rejects stale, duplicate and out-of-class references before changing the form', () => {
    expect(replaceSelectedCatalogResources(options, ['missing'], ['class_a'])).toMatchObject({ ok: false })
    expect(replaceSelectedCatalogResources(options, ['book_zoo', 'book_zoo'], ['class_a'])).toMatchObject({ ok: false })
    expect(replaceSelectedCatalogResources(options, ['book_zoo'], ['class_b'])).toMatchObject({ ok: false })
    expect(replaceSelectedCatalogResources(options, [], ['class_a'])).toMatchObject({ ok: false })
  })
})
