import { describe, expect, it } from 'vitest'
import type { TaskCatalogFacet } from '../../miniprogram/subpackages/teacher/domain/types'
import { catalogFacetOptions, mediaFacetOptions, questionFacetOptions, recordingFacetOptions,
  selectorFacetFields } from '../../miniprogram/subpackages/teacher/content-selector/catalog-facets'

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

  it('shows the same picker bar with only fields relevant to each other task type', () => {
    expect(selectorFacetFields('exercise')).toMatchObject({ grade: true, textbook: true,
      knowledgePoint: true, questionType: true, source: false })
    expect(selectorFacetFields('recording')).toMatchObject({ grade: true, unit: true,
      textbook: false, difficulty: false })
    expect(selectorFacetFields('video')).toMatchObject({ grade: true, textbook: true,
      unit: true, questionType: false })
  })

  it('narrows question, recording and media choices from authorized facet records', () => {
    const questions = questionFacetOptions([
      { grade: '三年级', textbook: '教材甲', unit: 'Unit 1', knowledgePoint: '动物',
        questionType: 'single_choice', difficulty: '基础' },
      { grade: '四年级', textbook: '教材乙', unit: 'Unit 2', knowledgePoint: '颜色',
        questionType: 'fill', difficulty: '进阶' },
    ], { grade: '三年级' })
    expect(questions.textbooks.map(item => item.value)).toEqual(['', '教材甲'])
    expect(questions.questionTypes.map(item => item.label)).toEqual(['全部题型', '单选题'])
    expect(recordingFacetOptions([{ grade: '三年级', unit: 'Unit 1' },
      { grade: '四年级', unit: 'Unit 2' }], { grade: '四年级' }).units.map(item => item.value))
      .toEqual(['', 'Unit 2'])
    const media = mediaFacetOptions([{ grade: '三年级', textbook: null, unit: 'Unit 1' }], {})
    expect(media.textbooks).toContainEqual({ value: '__unlabeled_textbook__', label: '未标注教材' })
  })
})
