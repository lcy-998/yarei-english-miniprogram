import { describe, expect, it } from 'vitest'
import { teacherReadingPreview } from '../../miniprogram/subpackages/student/reading-detail/teacher-reading-preview'

describe('teacher preview on the student reading page', () => {
  it('keeps source page order and starts with no student progress', () => {
    const view = teacherReadingPreview({ id: 'book_demo', title: '虚构绘本',
      category: 'picture_book', grade: '三年级', difficulty: '基础', contentVersion: 'v1',
      presentation: 'page_images_only', textVisibility: { ocrExposed: false, standaloneBodyExposed: false },
      chapters: [{ id: 'chapter_1', title: '第一章', order: 1, pages: [
        { id: 'page_2', pageNumber: 2, order: 2, imageAssetKey: 'https://example.test/2.jpg',
          thumbnailAssetKey: 'https://example.test/2-thumb.jpg', width: 100, height: 100, assetVersion: 'v1' },
        { id: 'page_1', pageNumber: 1, order: 1, imageAssetKey: 'https://example.test/1.jpg',
          thumbnailAssetKey: 'https://example.test/1-thumb.jpg', width: 100, height: 100, assetVersion: 'v1' },
      ] }] })
    expect(view).toMatchObject({ book: { id: 'book_demo', category: 'picture', progressPercent: 0 },
      hasSavedProgress: false, pageNumber: 1, pages: [{ pageNumber: 1 }, { pageNumber: 2 }] })
  })
})
