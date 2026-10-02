import { describe, expect, it } from 'vitest'
import type { ReadingResource } from '../../miniprogram/domain/types'
import { orderedReadingPages, selectedReadingPageIds } from '../../miniprogram/pages/teacher/reading-selector/reading-range'

const book: ReadingResource = { id: 'reading_demo', title: '虚构阅读', category: 'picture_book',
  grade: '三年级', difficulty: '基础', contentVersion: 'v1', presentation: 'page_images_only',
  textVisibility: { ocrExposed: false, standaloneBodyExposed: false }, chapters: [
    { id: 'chapter_b', title: '第二章', order: 2, pages: [{ id: 'page_b2', pageNumber: 4, order: 2,
      thumbnailAssetKey: 'demo', imageAssetKey: 'demo', width: 750, height: 1000, assetVersion: 'v1' },
      { id: 'page_b1', pageNumber: 3, order: 1, thumbnailAssetKey: 'demo', imageAssetKey: 'demo',
        width: 750, height: 1000, assetVersion: 'v1' }] },
    { id: 'chapter_a', title: '第一章', order: 1, pages: [{ id: 'page_a1', pageNumber: 1, order: 1,
      thumbnailAssetKey: 'demo', imageAssetKey: 'demo', width: 750, height: 1000, assetVersion: 'v1' }] },
  ] };

describe('T-16 reading range selection', () => {
  it('uses stable published page IDs in chapter order for whole, chapter and contiguous range', () => {
    expect(orderedReadingPages(book).map(page => page.id)).toEqual(['page_a1', 'page_b1', 'page_b2'])
    expect(selectedReadingPageIds(book, { mode: 'whole' })).toEqual(['page_a1', 'page_b1', 'page_b2'])
    expect(selectedReadingPageIds(book, { mode: 'chapter', chapterId: 'chapter_b' })).toEqual(['page_b1', 'page_b2'])
    expect(selectedReadingPageIds(book, { mode: 'range', fromIndex: 1, toIndex: 2 })).toEqual(['page_b1', 'page_b2'])
  })
  it('rejects missing, inverted, duplicate or empty page selections', () => {
    expect(selectedReadingPageIds(book, { mode: 'chapter', chapterId: 'missing' })).toBeNull()
    expect(selectedReadingPageIds(book, { mode: 'range', fromIndex: 2, toIndex: 1 })).toBeNull()
    expect(selectedReadingPageIds(book, { mode: 'range', fromIndex: 0, toIndex: 9 })).toBeNull()
    expect(selectedReadingPageIds({ ...book, chapters: [] }, { mode: 'whole' })).toBeNull()
    const duplicate = { ...book, chapters: [{ ...book.chapters[0]!, pages: [
      book.chapters[0]!.pages[0]!, { ...book.chapters[0]!.pages[1]!, id: 'page_b2' },
    ] }, book.chapters[1]!] }
    expect(selectedReadingPageIds(duplicate, { mode: 'whole' })).toBeNull()
  })
})
