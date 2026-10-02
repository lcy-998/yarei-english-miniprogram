import type { TextbookSummary } from '../../../domain/types'

export type TextbookFilterKey = 'grade' | 'term' | 'edition' | 'unit' | 'lesson'
export type TextbookFilterValues = Record<TextbookFilterKey, string>
export type TextbookFilterOptions = Record<TextbookFilterKey, string[]>

const FILTER_LABELS: Record<TextbookFilterKey, string> = {
  grade: '全部年级', term: '全部学期', edition: '全部版本', unit: '全部单元', lesson: '全部课次',
}
const FILTER_KEYS: TextbookFilterKey[] = ['grade', 'term', 'edition', 'unit', 'lesson']

function choices(values: string[], key: TextbookFilterKey): string[] {
  return [FILTER_LABELS[key], ...[...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))]
}

export function textbookFilterOptions(books: readonly TextbookSummary[], selected: TextbookFilterValues): TextbookFilterOptions {
  const byGrade = books.filter(book => !selected.grade || book.grade === selected.grade)
  const byTerm = byGrade.filter(book => !selected.term || book.term === selected.term)
  const byEdition = byTerm.filter(book => !selected.edition || book.edition === selected.edition)
  const chapters = byEdition.flatMap(book => book.chapters)
  const byUnit = chapters.filter(chapter => !selected.unit || chapter.title === selected.unit)
  return {
    grade: choices(books.map(book => book.grade), 'grade'),
    term: choices(byGrade.map(book => book.term), 'term'),
    edition: choices(byTerm.map(book => book.edition), 'edition'),
    unit: choices(chapters.map(chapter => chapter.title), 'unit'),
    lesson: choices(byUnit.flatMap(chapter => chapter.lessons.map(lesson => lesson.title)), 'lesson'),
  }
}

export function selectTextbookFilter(current: TextbookFilterValues, key: TextbookFilterKey,
  optionIndex: number, options: TextbookFilterOptions): TextbookFilterValues | null {
  const value = options[key][optionIndex]
  if (value === undefined) return null
  const next = { ...current, [key]: optionIndex === 0 ? '' : value }
  for (const downstream of FILTER_KEYS.slice(FILTER_KEYS.indexOf(key) + 1)) next[downstream] = ''
  return next
}
