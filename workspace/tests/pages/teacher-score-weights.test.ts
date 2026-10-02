import { describe, expect, it } from 'vitest'
import { defaultItemWeights, itemWeightError, updateItemWeight } from '../../miniprogram/pages/teacher/publish-task/score-weights'

const items = ['read', 'words', 'quiz'].map(id => ({ id, resourceId: id,
  type: 'reading' as const, requiredCount: 1, maxScore: 100 }))

describe('T-06 multi-item scoring weights', () => {
  it('displays exact equal defaults and requires edited weights to total 100%', () => {
    expect(defaultItemWeights(items)).toEqual([33.33, 33.33, 33.34])
    expect(itemWeightError(items)).toBeNull()
    const changed = updateItemWeight(items, 'read', '50')!
    expect(changed.map(item => item.weightPercent)).toEqual([50, 33.33, 33.34])
    expect(itemWeightError(changed)).toContain('116.67%')
    const balanced = updateItemWeight(updateItemWeight(changed, 'words', '25')!, 'quiz', '25')!
    expect(itemWeightError(balanced)).toBeNull()
  })

  it('rejects empty, zero, excessive and over-precision input', () => {
    for (const raw of ['', '0', '101', '12.345', '1e2', '-5']) {
      expect(updateItemWeight(items, 'read', raw)).toBeNull()
    }
  })
})
