import { describe, expect, it } from 'vitest'
import type { SchoolQuestionFacet } from '../../miniprogram/domain/types'
import { questionFacetOptions, questionTypeLabel } from '../../miniprogram/pages/teacher/school-questions/school-question-facets'

const authorized: SchoolQuestionFacet[] = [
  { grade: '三年级', textbook: '演示教材甲', unit: 'Unit 3', knowledgePoint: '动物', questionType: 'single_choice', difficulty: '基础' },
  { grade: '三年级', textbook: '演示教材甲', unit: 'Unit 4', knowledgePoint: '颜色', questionType: 'fill', difficulty: '中等' },
  { grade: '四年级', textbook: '演示教材乙', unit: 'Unit 1', knowledgePoint: '天气', questionType: 'subjective', difficulty: '提高' },
]

describe('T-15 authorized facet choices', () => {
  it('narrows each later selector using only authorized catalog metadata', () => {
    expect(questionFacetOptions(authorized, {}).grades).toEqual(['三年级', '四年级'])
    expect(questionFacetOptions(authorized, { grade: '三年级' }).textbooks).toEqual(['演示教材甲'])
    expect(questionFacetOptions(authorized, { grade: '三年级', textbook: '演示教材甲' }).units).toEqual(['Unit 3', 'Unit 4'])
    expect(questionFacetOptions(authorized, { grade: '三年级', textbook: '演示教材甲', unit: 'Unit 3' }).knowledgePoints).toEqual(['动物'])
    expect(questionFacetOptions(authorized, { grade: '三年级', textbook: '演示教材甲', unit: 'Unit 3', knowledgePoint: '动物' }).questionTypes).toEqual(['single_choice'])
    expect(questionFacetOptions(authorized, { grade: '三年级', textbook: '演示教材甲', unit: 'Unit 3', knowledgePoint: '动物', questionType: 'single_choice' }).difficulties).toEqual(['基础'])
    expect(questionTypeLabel('single_choice')).toBe('单选题')
  })

  it('does not invent choices when the authorized catalog is empty', () => {
    expect(questionFacetOptions([], {})).toEqual({ grades: [], textbooks: [], units: [], knowledgePoints: [], questionTypes: [], difficulties: [] })
  })
})
