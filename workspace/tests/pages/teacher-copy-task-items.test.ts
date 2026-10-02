import { describe, expect, it } from 'vitest'
import { copyTaskItems } from '../../miniprogram/pages/teacher/publish-task/copy-task-items'
import type { TeacherTaskCopy } from '../../miniprogram/session/session'

const source: TeacherTaskCopy = {
  title: '指定阅读与拼写', description: '按要求完成',
  items: [
    { resourceId: 'book_a', title: '原阅读快照', type: 'reading' },
    { resourceId: 'pack_a', title: '原单词快照', type: 'vocabulary' },
  ],
  itemRefs: [
    { id: 'read_1', resourceId: 'book_a', order: 1,
      completionRule: { kind: 'reading_pages', requiredPageCount: 2, pageIds: ['page_2', 'page_3'] },
      scoringRule: { kind: 'automatic', maxScore: 100, weightPercent: 25 } },
    { id: 'words_1', resourceId: 'pack_a', order: 2,
      completionRule: { kind: 'vocabulary_words', requiredWordCount: 4 },
      scoringRule: { kind: 'automatic', maxScore: 100, weightPercent: 75 } },
  ],
}

const available = [
  { id: 'book_a', title: '现阅读标题', type: 'reading' as const, requiredCount: 30, allowedClassIds: ['class_a'] },
  { id: 'pack_a', title: '现单词标题', type: 'vocabulary' as const, requiredCount: 20, allowedClassIds: ['class_a'] },
]

describe('再次布置任务内容', () => {
  it('沿用发布快照的指定页、完成数量、顺序和计分权重，而非当前资源默认值', () => {
    const result = copyTaskItems(source, available)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual([
      { id: 'copy_0_read_1', resourceId: 'book_a', type: 'reading', requiredCount: 2,
        maxScore: 100, scoringKind: 'automatic', weightPercent: 25, pageIds: ['page_2', 'page_3'] },
      { id: 'copy_1_words_1', resourceId: 'pack_a', type: 'vocabulary', requiredCount: 4,
        maxScore: 100, scoringKind: 'automatic', weightPercent: 75 },
    ])
    result.items[0]!.pageIds!.push('changed')
    expect(source.itemRefs[0]!.completionRule!.pageIds).toEqual(['page_2', 'page_3'])
  })

  it('不为缺失规则或已变更类型的资源推断新规则', () => {
    const incomplete: TeacherTaskCopy = { ...source,
      itemRefs: [{ ...source.itemRefs[0]!, completionRule: undefined }, source.itemRefs[1]!] }
    expect(copyTaskItems(incomplete, available).ok).toBe(false)
    expect(copyTaskItems(source, [{ ...available[0]!, type: 'exercise' as const }, available[1]!]).ok).toBe(false)
  })
})
