import { describe, expect, it } from 'vitest'
import type { TaskCatalogFacet } from '../../miniprogram/domain/types'
import { catalogFacetOptions } from '../../miniprogram/pages/teacher/content-selector/catalog-facets'

const facets: TaskCatalogFacet[] = [
  { source: 'reading_book', grade: '三年级', textbook: '__unlabeled_textbook__', difficulty: '入门' },
  { source: 'synchronized_textbook', grade: '三年级', term: '上学期', textbook: '演示同步教材', unit: 'Unit 3', difficulty: '基础' },
  { source: 'synchronized_textbook', grade: '四年级', term: '下学期', textbook: '演示新版教材', unit: 'Unit 1', difficulty: '进阶' },
]

describe('T-18 authorized catalog facets', () => {
  it('narrows each later choice from the selected source and hierarchy', () => {
    const initial = catalogFacetOptions(facets, {})
    expect(initial.sources.map(item => item.label)).toEqual(['全部来源', '阅读书籍', '同步学教材'])
    expect(initial.textbooks.map(item => item.label)).toContain('未标注教材')
    const narrowed = catalogFacetOptions(facets, { source: 'synchronized_textbook', grade: '三年级', term: '上学期' })
    expect(narrowed.textbooks.map(item => item.label)).toEqual(['全部教材', '演示同步教材'])
    expect(narrowed.units.map(item => item.value)).toEqual(['', 'Unit 3'])
    expect(narrowed.difficulties.map(item => item.value)).toEqual(['', '基础'])
  })
})
