import { afterEach, describe, expect, it, vi } from 'vitest'

const getReadingProgress = vi.fn()
const setReadingPage = vi.fn()
vi.mock('../../miniprogram/services/m1-app-service', () => ({
  getReadingProgress, setReadingPage, toggleReadingFavorite: vi.fn(),
}))
vi.mock('../../miniprogram/session/session', () => ({
  getSession: () => ({ user: { id: 'student_demo' } }),
  getCurrentBookId: () => '', setCurrentTaskId: vi.fn(),
}))

const pages = [1, 2, 3].map(pageNumber => ({ pageNumber, chapterNumber: 1,
  imageUrl: `page_${pageNumber}.jpg`, thumbnailUrl: `thumb_${pageNumber}.jpg` }))
const savedLastPage = { book: { id: 'book_demo', title: '虚构绘本', favorite: false },
  hasSavedProgress: true, pageNumber: 3, chapterNumber: 1, pageCount: 3, progressPercent: 100,
  pageImageUrl: 'page_3.jpg', thumbnailImageUrl: 'thumb_3.jpg', pages }

describe('daily checkin reading', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules() })

  it('records every page today even when the book was previously saved at its last page', async () => {
    let definition: { data: Record<string, unknown>; pageLifetimes: { show: (this: unknown) => void };
      methods: Record<string, (this: unknown) => Promise<void> | void> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{}, { options: { bookId: 'book_demo', activityId: 'activity_demo', startPageNumber: '1' } }])
    const navigateBack = vi.fn()
    const showToast = vi.fn()
    vi.stubGlobal('wx', { navigateBack, showToast, reLaunch: vi.fn() })
    getReadingProgress.mockResolvedValue({ ok: true, data: savedLastPage })
    setReadingPage.mockImplementation(async (_userId: string, _bookId: string, pageNumber: number) => ({
      ok: true, data: { ...savedLastPage, pageNumber, progressPercent: pageNumber * 100 / 3,
        pageImageUrl: `page_${pageNumber}.jpg`, thumbnailImageUrl: `thumb_${pageNumber}.jpg` },
    }))

    await import('../../miniprogram/pages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading page was not registered')
    const page = { data: { ...definition.data }, setData(patch: Record<string, unknown>, callback?: () => void) {
      Object.assign(this.data, patch)
      callback?.()
    } }
    Object.assign(page, definition.methods)
    definition.pageLifetimes.show.call(page)
    await vi.waitFor(() => expect(page.data.reading).not.toBeNull())
    expect(page.data.displayPageNumber).toBe(1)
    expect(page.data.pendingPageNumber).toBe(1)

    definition.methods.returnToCheckin!.call(page)
    expect(navigateBack).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalled()

    for (const pageNumber of [1, 2, 3]) {
      if (pageNumber > 1) definition.methods.nextPage!.call(page)
      await definition.methods.imageLoaded!.call(page)
      expect(page.data.pendingPageNumber).toBe(0)
    }
    expect(setReadingPage.mock.calls.map(call => call[2])).toEqual([1, 2, 3])
    definition.methods.returnToCheckin!.call(page)
    expect(navigateBack).toHaveBeenCalledOnce()
  })
})
