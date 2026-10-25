import { describe, expect, it } from 'vitest'
import { exercisePackTitle, taskExerciseGroupKey } from '../../miniprogram/shared/exercise-pack-title'

describe('hierarchical exercise task grouping', () => {
  it('keeps different big questions under the same immutable pack ID', () => {
    const first = { id: 'item_1', title: '校园花园｜大题一：语言｜第 1 小题',
      exerciseQuestion: { exercisePackId: 'pack_g3_garden' } }
    const second = { id: 'item_2', title: '校园花园｜大题二：阅读｜第 1 小题',
      exerciseQuestion: { exercisePackId: 'pack_g3_garden' } }
    expect(taskExerciseGroupKey(first)).toBe(taskExerciseGroupKey(second))
    expect(exercisePackTitle(first.title)).toBe('校园花园')
    expect(exercisePackTitle(second.title)).toBe('校园花园')
  })
})
