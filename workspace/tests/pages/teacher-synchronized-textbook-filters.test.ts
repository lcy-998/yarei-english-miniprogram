import { describe, expect, it } from 'vitest'
import type { TextbookSummary } from '../../miniprogram/domain/types'
import { selectTextbookFilter, textbookFilterOptions } from '../../miniprogram/pages/teacher/synchronized-textbooks/textbook-filter-options'

const books: TextbookSummary[] = [
  { id: 'demo_book_a', title: '演示英语 A', grade: '三年级', term: '上学期', edition: '演示版 A', contentVersion: 'v1',
    chapters: [{ id: 'unit_1', title: 'Unit 1', lessons: [{ id: 'lesson_1', title: 'Lesson 1' }] }] },
  { id: 'demo_book_b', title: '演示英语 B', grade: '四年级', term: '下学期', edition: '演示版 B', contentVersion: 'v1',
    chapters: [{ id: 'unit_2', title: 'Unit 2', lessons: [{ id: 'lesson_2', title: 'Lesson 2' }] }] },
]

describe('同步学教材下拉筛选', () => {
  it('按年级和单元收窄选项，并在更改上级条件时清空下级条件', () => {
    const empty = { grade: '', term: '', edition: '', unit: '', lesson: '' }
    const all = textbookFilterOptions(books, empty)
    expect(all.grade).toEqual(['全部年级', '三年级', '四年级'])
    const selected = selectTextbookFilter(empty, 'grade', all.grade.indexOf('三年级'), all)!
    expect(textbookFilterOptions(books, selected).term).toEqual(['全部学期', '上学期'])
    const withUnit = { ...selected, term: '上学期', edition: '演示版 A', unit: 'Unit 1', lesson: 'Lesson 1' }
    const reset = selectTextbookFilter(withUnit, 'grade', all.grade.indexOf('四年级'), all)
    expect(reset).toEqual({ grade: '四年级', term: '', edition: '', unit: '', lesson: '' })
    expect(textbookFilterOptions(books, withUnit).lesson).toEqual(['全部课次', 'Lesson 1'])
  })
})
