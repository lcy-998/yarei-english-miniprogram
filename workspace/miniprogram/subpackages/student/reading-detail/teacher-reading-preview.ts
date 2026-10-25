import type { ReadingResource } from '../../../domain/types'
import type { ReadingProgressView } from '../../../repositories/m1-app-repository'
import { displayPageImageUrl } from '../shared/reading-page-image'

export function teacherReadingPreview(resource: ReadingResource): ReadingProgressView | null {
  const chapters = [...resource.chapters].sort((left, right) => left.order - right.order)
  const pages = chapters.flatMap((chapter, chapterIndex) => [...chapter.pages]
    .sort((left, right) => left.order - right.order)
    .map(page => ({ pageNumber: page.pageNumber, chapterNumber: chapterIndex + 1,
      imageUrl: displayPageImageUrl(page.imageAssetKey),
      thumbnailUrl: displayPageImageUrl(page.thumbnailAssetKey) })))
  const first = pages[0]
  if (!first) return null
  const category = resource.category === 'original' ? 'original' as const
    : resource.category === 'textbook' ? 'textbook' as const
      : resource.category === 'current' ? 'current' as const
        : resource.category === 'chapter' ? 'chapter' as const : 'picture' as const
  return { book: { id: resource.id, title: resource.title, category,
    grade: resource.grade, difficulty: resource.difficulty, theme: '',
    progressPercent: 0, favorite: false, pageCount: pages.length },
  hasSavedProgress: false, chapterNumber: first.chapterNumber, chapterCount: chapters.length,
  pageNumber: first.pageNumber, pageCount: pages.length, progressPercent: 0,
  pageImageUrl: first.imageUrl, thumbnailImageUrl: first.thumbnailUrl, pages }
}
