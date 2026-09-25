import { describe, expect, it } from 'vitest'
import { ReadingBookView } from '../../miniprogram/repositories/m1-app-repository'
import { filterReadingBooks, readingFilterOptions } from '../../miniprogram/shared/reading-filters'

const book: ReadingBookView = {
  id: 'book_zoo', title: 'A Day at the Zoo', category: 'picture', grade: '三年级', difficulty: '基础', theme: '英语',
  progressPercent: 0, favorite: false, pageCount: 2,
}

describe('filterReadingBooks', () => {
  it('only offers filter values found in the current authorized list', () => {
    expect(readingFilterOptions([book])).toEqual({ grade: ['全部年级', '三年级'], difficulty: ['全部难度', '基础'], theme: ['全部主题', '英语'] })
  })
  it('restores the available book when a selected grade is cleared to all', () => {
    expect(filterReadingBooks([book], { grade: '四年级', difficulty: '全部难度', theme: '全部主题' })).toEqual([])
    expect(filterReadingBooks([book], { grade: '全部年级', difficulty: '全部难度', theme: '全部主题' })).toEqual([book])
  })
})
