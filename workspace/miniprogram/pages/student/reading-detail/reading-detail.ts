import { ReadingProgressView, getReadingProgress, setReadingPage, toggleReadingFavorite } from '../../../services/m1-app-service'
import { getCurrentBookId, getSession, setCurrentTaskId } from '../../../session/session'

Component({
  data: { loading: true, saving: false, imageLoading: true, imageError: false, showHighRes: true, zoomed: false, error: '', saveError: '', reading: null as ReadingProgressView | null,
    displayPageNumber: 1, displayChapterNumber: 1, displayImageUrl: '', displayThumbnailUrl: '', pendingPageNumber: 0,
    bookId: '', taskMode: false, taskRequiredPageCount: 0, returnUrl: '/pages/student/reading-library/reading-library' },
  lifetimes: { attached() {
    const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
    const options = pages[pages.length - 1]?.options
    const taskId = options?.taskId ?? ''
    const requiredPageCount = Number(options?.requiredPageCount ?? 0)
    if (taskId) setCurrentTaskId(taskId)
    this.setData({ bookId: options?.bookId ?? '', taskMode: Boolean(taskId), taskRequiredPageCount: Number.isSafeInteger(requiredPageCount) && requiredPageCount > 0 ? requiredPageCount : 0, returnUrl: taskId ? '/pages/student/task-detail/task-detail' : '/pages/student/reading-library/reading-library' }, () => this.loadReading())
  } },
  methods: {
    async loadReading() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '', imageError: false })
      const bookId = this.data.bookId || getCurrentBookId()
      if (!bookId) { this.setData({ loading: false, error: '未找到阅读内容，请返回任务重新打开' }); return }
      const result = await getReadingProgress(session.user.id, bookId)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, reading: result.data, imageLoading: true, imageError: false, showHighRes: true, zoomed: false,
        displayPageNumber: result.data.pageNumber, displayChapterNumber: result.data.chapterNumber,
        displayImageUrl: result.data.pageImageUrl, displayThumbnailUrl: result.data.thumbnailImageUrl, pendingPageNumber: 0, saveError: '' })
    },
    async imageLoaded() {
      this.setData({ imageLoading: false, imageError: false })
      await this.saveVisiblePage()
    },
    async saveVisiblePage() {
      const session = getSession()
      const reading = this.data.reading
      if (!session || !reading || this.data.saving || this.data.imageError) return
      const target = this.data.pendingPageNumber || (!reading.hasSavedProgress ? reading.pageNumber : 0)
      if (!target) return
      this.setData({ saving: true })
      const saved = await setReadingPage(session.user.id, reading.book.id, target)
      if (!saved.ok) { this.setData({ saving: false, saveError: '阅读进度未保存，请重试' }); return }
      this.setData({ saving: false, reading: saved.data, pendingPageNumber: 0, saveError: '' })
    },
    imageFailed() { this.setData({ imageLoading: false, imageError: true }) },
    retryImage() { this.setData({ imageLoading: true, imageError: false, showHighRes: false }, () => this.setData({ showHighRes: true })) },
    returnToSavedPage() {
      const reading = this.data.reading
      if (!reading) return
      this.setData({ displayPageNumber: reading.pageNumber, displayChapterNumber: reading.chapterNumber,
        displayImageUrl: reading.pageImageUrl, displayThumbnailUrl: reading.thumbnailImageUrl,
        pendingPageNumber: 0, imageLoading: true, imageError: false, saveError: '', showHighRes: false },
      () => this.setData({ showHighRes: true }))
    },
    previewPage() { this.setData({ zoomed: !this.data.zoomed }) },
    previousPage() { this.changePage(-1) },
    nextPage() { this.changePage(1) },
    async changePage(delta: number) {
      const reading = this.data.reading
      if (!reading || this.data.saving || this.data.pendingPageNumber || this.data.imageLoading || this.data.imageError || this.data.saveError) return
      const nextPageNumber = this.data.displayPageNumber + delta
      const nextPage = reading.pages.find(page => page.pageNumber === nextPageNumber)
      if (!nextPage) return
      this.setData({ displayPageNumber: nextPage.pageNumber, displayChapterNumber: nextPage.chapterNumber,
        displayImageUrl: nextPage.imageUrl, displayThumbnailUrl: nextPage.thumbnailUrl, pendingPageNumber: nextPage.pageNumber,
        imageLoading: true, imageError: false, showHighRes: false, zoomed: false }, () => this.setData({ showHighRes: true }))
    },
    async toggleFavorite() {
      const session = getSession()
      const reading = this.data.reading
      if (!session || !reading || this.data.saving || this.data.pendingPageNumber) return
      const result = await toggleReadingFavorite(session.user.id, reading.book.id)
      if (result.ok) this.setData({ 'reading.book.favorite': result.data.favorite })
    },
  },
})

