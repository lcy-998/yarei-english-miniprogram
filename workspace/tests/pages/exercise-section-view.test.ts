import { describe, expect, it } from 'vitest'
import { arrangeExerciseSections } from '../../miniprogram/shared/exercise-section-view'

describe('exercise sections in a frozen task', () => {
  it('orders questions by big question and small question while showing shared material once', () => {
    const cards = [
      { itemId: 'q3', number: 3, exerciseSection: { id: 'reading', title: '大题二：阅读',
        instruction: '读短文', studentMaterial: 'A complete passage.', order: 2, questionOrder: 1, points: 2 } },
      { itemId: 'q2', number: 2, exerciseSection: { id: 'language', title: '大题一：语言',
        instruction: '选择', studentMaterial: '', order: 1, questionOrder: 2, points: 2 } },
      { itemId: 'q1', number: 1, exerciseSection: { id: 'language', title: '大题一：语言',
        instruction: '选择', studentMaterial: '', order: 1, questionOrder: 1, points: 2 } },
    ]
    expect(arrangeExerciseSections(cards).map(card => [card.itemId, card.sectionStart, card.localNumber]))
      .toEqual([['q1', true, 1], ['q2', false, 2], ['q3', true, 1]])
    expect(arrangeExerciseSections(cards)[2]?.sectionMaterial).toBe('A complete passage.')
  })

  it('keeps legacy flat questions in published order', () => {
    expect(arrangeExerciseSections([{ itemId: 'first', number: 1 }, { itemId: 'second', number: 2 }])
      .map(card => [card.itemId, card.sectionStart, card.localNumber]))
      .toEqual([['first', false, 1], ['second', false, 2]])
  })
})
