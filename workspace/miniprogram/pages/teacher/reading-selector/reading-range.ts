import type { ReadingResource } from '../../../domain/types'

export interface OrderedReadingPage { id: string; label: string; chapterId: string }
export type ReadingRange = { mode: 'whole' }
  | { mode: 'chapter'; chapterId: string }
  | { mode: 'range'; fromIndex: number; toIndex: number }

export function orderedReadingPages(book: ReadingResource): OrderedReadingPage[] {
  return [...book.chapters].sort((a, b) => a.order - b.order).flatMap(chapter =>
    [...chapter.pages].sort((a, b) => a.order - b.order).map(page => ({
      id: page.id, chapterId: chapter.id, label: `${chapter.title}　第 ${page.pageNumber} 页`,
    })))
}

export function selectedReadingPageIds(book: ReadingResource, range: ReadingRange): string[] | null {
  const pages = orderedReadingPages(book)
  if (!pages.length || new Set(pages.map(page => page.id)).size !== pages.length) return null
  if (range.mode === 'whole') return pages.map(page => page.id)
  if (range.mode === 'chapter') {
    const chapterPages = pages.filter(page => page.chapterId === range.chapterId)
    return chapterPages.length ? chapterPages.map(page => page.id) : null
  }
  if (!Number.isSafeInteger(range.fromIndex) || !Number.isSafeInteger(range.toIndex)
    || range.fromIndex < 0 || range.toIndex < range.fromIndex || range.toIndex >= pages.length) return null
  return pages.slice(range.fromIndex, range.toIndex + 1).map(page => page.id)
}
