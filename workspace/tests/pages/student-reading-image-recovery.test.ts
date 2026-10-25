import { afterEach, describe, expect, it, vi } from 'vitest'

const getReadingProgress = vi.fn(), setReadingPage = vi.fn()
const getReadingResource = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/m1-app-service', () => ({
  getReadingProgress, setReadingPage, toggleReadingFavorite: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({
  getReadingResource, getHistoricalTaskLearning: vi.fn(), getReadingAudioMap: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => ({ sessionId: 'session_demo', activeRole: 'student',
    user: { id: 'student_demo', role: 'student' } }),
  getCurrentBookId: () => 'book_demo', setCurrentTaskId: vi.fn(),
}))

const pages = [1, 2, 3].map(pageNumber => ({ pageNumber, chapterNumber: 1,
  imageUrl: `expired_${pageNumber}.jpg`, thumbnailUrl: `expired_thumb_${pageNumber}.jpg` }))
const reading = { book: { id: 'book_demo', title: '虚构绘本' }, hasSavedProgress: true,
  pageNumber: 1, chapterNumber: 1, pageCount: 3, progressPercent: 33,
  pageImageUrl: pages[0].imageUrl, thumbnailImageUrl: pages[0].thumbnailUrl, pages }

describe('S-04 failed page image recovery', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); getReadingProgress.mockReset();
    getReadingResource.mockReset(); setReadingPage.mockReset() })

  async function page() {
    getReadingResource.mockResolvedValue({ ok: false, error: {
      code: 'NETWORK_ERROR', message: '目录暂不可用', retryable: true,
    } })
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{}, {}])
    const navigateBack = vi.fn()
    const showModal = vi.fn(({ success }) => success({ confirm: true }))
    vi.stubGlobal('wx', { navigateBack, showToast: vi.fn(), showModal })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading page was not registered')
    const context = { data: { ...definition.data, reading, displayPageNumber: 2,
      displayChapterNumber: 1, displayImageUrl: pages[1].imageUrl,
      displayThumbnailUrl: pages[1].thumbnailUrl, pendingPageNumber: 2,
      imageLoading: true, showHighRes: true },
      setData(change: Record<string, unknown>, done?: () => void) { Object.assign(this.data, change); done?.() },
      selectAllComponents: () => [] }
    Object.assign(context, definition.methods, { loadReadingAudioMap: vi.fn(), rememberAudioPosition: vi.fn() })
    return { context, navigateBack, showModal }
  }

  it('renews expired signed page URLs instead of retrying the same URL', async () => {
    const { context } = await page()
    const freshPages = pages.map(item => ({ ...item, imageUrl: `fresh_${item.pageNumber}.jpg`,
      thumbnailUrl: `fresh_thumb_${item.pageNumber}.jpg` }))
    getReadingProgress.mockResolvedValue({ ok: true, data: { ...reading, pages: freshPages } })
    context.imageFailed()
    await vi.waitFor(() => expect(context.data.displayImageUrl).toBe('fresh_2.jpg'))
    expect(context.data).toMatchObject({ displayThumbnailUrl: 'fresh_thumb_2.jpg',
      imageError: false, imageRefreshAttempted: true })
    expect(getReadingProgress).toHaveBeenCalledWith('student_demo', 'book_demo', undefined)
    context.imageFailed({ currentTarget: { dataset: { page: 2, src: 'expired_2.jpg' } } })
    expect(context.data.imageError).toBe(false)
  })

  it('allows exit and another page when URL renewal fails without counting the failed page', async () => {
    const { context, navigateBack } = await page()
    getReadingProgress.mockResolvedValue({ ok: false, error: {
      code: 'NETWORK_ERROR', message: '网络暂不可用', retryable: true,
    } })
    context.imageFailed()
    await vi.waitFor(() => expect(context.data.imageErrorMessage).toContain('刷新失败'))
    context.returnToCheckin()
    expect(navigateBack).toHaveBeenCalledOnce()
    context.nextPage()
    expect(context.data.displayPageNumber).toBe(3)
    expect(context.data.pendingPageNumber).toBe(3)
  })

  it('offers a deliberate exit when progress saving failed', async () => {
    const { context, navigateBack, showModal } = await page()
    context.setData({ imageLoading: false, imageError: false, pendingPageNumber: 2,
      saveError: '阅读进度未保存，请重试' })
    context.returnToCheckin()
    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({ title: '阅读进度未保存' }))
    expect(navigateBack).toHaveBeenCalledOnce()
  })

  it('allows leaving while the first page is still loading', async () => {
    const { context, navigateBack } = await page()
    context.setData({ reading: null, imageLoading: true, pendingPageNumber: 0,
      imageError: false, saveError: '' })
    context.returnToCheckin()
    expect(navigateBack).toHaveBeenCalledOnce()
  })

  it('can renew the page directly when the separate progress query is unavailable', async () => {
    const { context } = await page()
    getReadingProgress.mockResolvedValue({ ok: false, error: {
      code: 'NETWORK_ERROR', message: '进度暂不可用', retryable: true,
    } })
    getReadingResource.mockResolvedValue({ ok: true, data: { id: 'book_demo', chapters: [{ pages: [{
      pageNumber: 2, imageAssetKey: 'https://example.invalid/fresh-page-2.jpg',
      thumbnailAssetKey: 'https://example.invalid/fresh-thumb-2.jpg',
    }] }] } })
    await context.retryImage()
    expect(context.data.displayImageUrl).toBe('https://example.invalid/fresh-page-2.jpg')
    expect(context.data.imageError).toBe(false)
  })

  it('releases the save lock when the progress request throws', async () => {
    const { context } = await page()
    context.setData({ imageLoading: false, imageError: false })
    setReadingPage.mockRejectedValue(new Error('network interrupted'))
    await context.saveVisiblePage()
    expect(context.data).toMatchObject({ saving: false, saveError: '阅读进度未保存，请重试' })
  })

  it('recovers when a thumbnail-only page also has an expired URL', async () => {
    const { context, navigateBack } = await page()
    context.setData({ displayImageUrl: '', displayThumbnailUrl: 'expired_thumb_2.jpg',
      imageLoading: false, imageError: false, showHighRes: false })
    getReadingProgress.mockResolvedValue({ ok: false, error: {
      code: 'NETWORK_ERROR', message: '网络暂不可用', retryable: true,
    } })
    context.thumbnailFailed()
    await vi.waitFor(() => expect(context.data.imageErrorMessage).toContain('刷新失败'))
    context.returnToCheckin()
    expect(navigateBack).toHaveBeenCalledOnce()
  })
})
