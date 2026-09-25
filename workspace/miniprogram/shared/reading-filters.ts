import { ReadingBookView } from '../repositories/m1-app-repository'

export interface ReadingFilters {
  readonly grade: string
  readonly difficulty: string
  readonly theme: string
}

export function readingFilterOptions(books: readonly ReadingBookView[]): { grade: string[]; difficulty: string[]; theme: string[] } {
  return {
    grade: ['全部年级', ...new Set(books.map(book => book.grade).filter(Boolean))],
    difficulty: ['全部难度', ...new Set(books.map(book => book.difficulty).filter(Boolean))],
    theme: ['全部主题', ...new Set(books.map(book => book.theme).filter(Boolean))],
  }
}

export function filterReadingBooks(books: readonly ReadingBookView[], filters: ReadingFilters): ReadingBookView[] {
  return books.filter(item => (filters.grade === '全部年级' || item.grade === filters.grade)
    && (filters.difficulty === '全部难度' || item.difficulty === filters.difficulty)
    && (filters.theme === '全部主题' || item.theme === filters.theme))
}
