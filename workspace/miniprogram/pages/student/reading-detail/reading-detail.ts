import { ReadingProgressView, getReadingProgress, setReadingPage, toggleReadingFavorite } from '../../../services/m1-app-service'
import { getCurrentBookId, getSession, setCurrentTaskId } from '../../../session/session'
import { TeacherReviewRoute, loadTeacherReviewItem, teacherReviewRoute } from '../../../shared/teacher-review-item'

Component({
  data: { initialized: false, loading: true, saving: false, imageLoading: true, imageError: false, showHighRes: true, zoomed: false, error: '', saveError: '', reading: null as ReadingProgressView | null,
    displayPageNumber: 1, displayChapterNumber: 1, displayImageUrl: '', displayThumbnailUrl: '', pendingPageNumber: 0,
    bookId: '', taskMode: false, checkinMode: false, taskRequiredPageCount: 0, taskStartPageNumber: 0,
    teacherReviewMode: false, teacherReviewRoute: null as TeacherReviewRoute | null,
    reviewPageIndex: 0, reviewPageVisited: [] as boolean[], reviewSubmissionVersion: 0,
    returnUrl: '/pages/student/reading-library/reading-library' },
  pageLifetimes: { show() {
    if (this.data.initialized) return
    const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
    const options = pages[pages.length - 1]?.options
    if (options?.teacherReview === '1') {
      const route = teacherReviewRoute(options)
      this.setData({ initialized: true, teacherReviewMode: true, teacherReviewRoute: route,
        returnUrl: '/pages/teacher/review-task/review-task' }, () => this.loadReading())
      return
    }
    const taskId = options?.taskId ?? ''
    const activityId = options?.activityId ?? ''
    const requiredPageCount = Number(options?.requiredPageCount ?? 0)
    const startPageNumber = Number(options?.startPageNumber ?? 0)
    if (taskId) setCurrentTaskId(taskId)
    this.setData({ initialized: true, bookId: options?.bookId ?? '', taskMode: Boolean(taskId), checkinMode: Boolean(activityId), taskRequiredPageCount: Number.isSafeInteger(requiredPageCount) && requiredPageCount > 0 ? requiredPageCount : 0,
      taskStartPageNumber: Number.isSafeInteger(startPageNumber) && startPageNumber > 0 ? startPageNumber : 0,
      returnUrl: activityId ? `/pages/student/checkin-detail/checkin-detail?activityId=${encodeURIComponent(activityId)}`
        : taskId ? '/pages/student/task-detail/task-detail' : '/pages/student/reading-library/reading-library' }, () => this.loadReading())
  } },
  methods: {
    async loadReading() {
      if (this.data.teacherReviewMode) { await this.loadTeacherReview(); return }
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '', imageError: false })
      const bookId = this.data.bookId || getCurrentBookId()
      if (!bookId) { this.setData({ loading: false, error: '未找到阅读内容，请返回任务重新打开' }); return }
      const result = await getReadingProgress(session.user.id, bookId)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const startPage = this.data.taskStartPageNumber
        ? result.data.pages.find(page => page.pageNumber === this.data.taskStartPageNumber) : undefined
      this.setData({ loading: false, reading: result.data, imageLoading: true, imageError: false, showHighRes: true, zoomed: false,
        displayPageNumber: startPage?.pageNumber ?? result.data.pageNumber,
        displayChapterNumber: startPage?.chapterNumber ?? result.data.chapterNumber,
        displayImageUrl: startPage?.imageUrl ?? result.data.pageImageUrl,
        displayThumbnailUrl: startPage?.thumbnailUrl ?? result.data.thumbnailImageUrl,
        pendingPageNumber: startPage?.pageNumber ?? 0, saveError: '' })
    },
    async loadTeacherReview() {
      const route = this.data.teacherReviewRoute
      if (!route) { this.setData({ loading: false, error: '缺少要查看的作业记录。' }); return }
      this.setData({ loading: true, error: '', imageError: false })
      const result = await loadTeacherReviewItem(route, 'reading')
      if (!result.ok) { this.setData({ loading: false, error: result.message }); return }
      const pages = result.submission.readingPages?.filter(page => page.itemId === route.itemId) ?? []
      if (!pages.length) { this.setData({ loading: false, error: '本次提交缺少可定位的阅读页图，无法还原原作业。' }); return }
      const answer = result.submission.answers.find(entry => entry.itemId === route.itemId)?.value
      const structured = answer !== null && typeof answer === 'object' && !Array.isArray(answer)
        ? answer as Record<string, unknown> : null
      const events = Array.isArray(structured?.verifiedPageEvents) ? structured.verifiedPageEvents : []
      const visited = pages.map(page => events.some(entry => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false
        const event = entry as Record<string, unknown>
        return event.pageId === page.pageId && event.pageNumber === page.pageNumber
          && typeof event.visitedAt === 'string' && Number.isFinite(Date.parse(event.visitedAt))
      }))
      const chapterTitles = [...new Set(pages.map(page => page.chapterTitle))]
      const pageViews = pages.map(page => ({ pageNumber: page.pageNumber,
        chapterNumber: chapterTitles.indexOf(page.chapterTitle) + 1,
        imageUrl: page.imageAssetKey, thumbnailUrl: page.thumbnailAssetKey }))
      const first = pageViews[0]
      const progressPercent = Math.round(visited.filter(Boolean).length * 100 / pages.length)
      const reading: ReadingProgressView = {
        book: { id: route.itemId, title: result.item.title, category: 'picture', grade: '', difficulty: '', theme: '',
          progressPercent, favorite: false, pageCount: pages.length },
        hasSavedProgress: visited.some(Boolean), chapterNumber: first.chapterNumber,
        chapterCount: chapterTitles.length, pageNumber: first.pageNumber, pageCount: pages.length,
        progressPercent, pageImageUrl: first.imageUrl, thumbnailImageUrl: first.thumbnailUrl, pages: pageViews,
      }
      this.setData({ loading: false, reading, reviewPageIndex: 0, reviewPageVisited: visited,
        reviewSubmissionVersion: result.submission.submissionVersion,
        displayPageNumber: first.pageNumber, displayChapterNumber: first.chapterNumber,
        displayImageUrl: first.imageUrl, displayThumbnailUrl: first.thumbnailUrl,
        imageLoading: Boolean(first.imageUrl), imageError: !first.imageUrl && !first.thumbnailUrl,
        pendingPageNumber: 0, saveError: '', showHighRes: Boolean(first.imageUrl), zoomed: false })
    },
    async imageLoaded() {
      this.setData({ imageLoading: false, imageError: false })
      if (this.data.teacherReviewMode) return
      await this.saveVisiblePage()
    },
    async saveVisiblePage() {
      if (this.data.teacherReviewMode) return
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
      if (this.data.teacherReviewMode) {
        if (!reading) return
        const reviewPageIndex = this.data.reviewPageIndex + delta
        const page = reading.pages[reviewPageIndex]
        if (!page) return
        this.setData({ reviewPageIndex, displayPageNumber: page.pageNumber,
          displayChapterNumber: page.chapterNumber, displayImageUrl: page.imageUrl,
          displayThumbnailUrl: page.thumbnailUrl, pendingPageNumber: 0, saving: false,
          imageLoading: Boolean(page.imageUrl), imageError: !page.imageUrl && !page.thumbnailUrl,
          showHighRes: Boolean(page.imageUrl), zoomed: false })
        return
      }
      if (!reading || this.data.saving || this.data.pendingPageNumber || this.data.imageLoading || this.data.imageError || this.data.saveError) return
      const nextPageNumber = this.data.displayPageNumber + delta
      const nextPage = reading.pages.find(page => page.pageNumber === nextPageNumber)
      if (!nextPage) return
      this.setData({ displayPageNumber: nextPage.pageNumber, displayChapterNumber: nextPage.chapterNumber,
        displayImageUrl: nextPage.imageUrl, displayThumbnailUrl: nextPage.thumbnailUrl, pendingPageNumber: nextPage.pageNumber,
        imageLoading: true, imageError: false, showHighRes: false, zoomed: false }, () => this.setData({ showHighRes: true }))
    },
    async toggleFavorite() {
      if (this.data.teacherReviewMode) return
      const session = getSession()
      const reading = this.data.reading
      if (!session || !reading || this.data.saving || this.data.pendingPageNumber) return
      const result = await toggleReadingFavorite(session.user.id, reading.book.id)
      if (result.ok) this.setData({ 'reading.book.favorite': result.data.favorite })
    },
    returnToCheckin() {
      if (this.data.teacherReviewMode) { wx.navigateBack(); return }
      if (this.data.reading && (this.data.imageLoading || this.data.saving || this.data.pendingPageNumber || this.data.saveError)) {
        wx.showToast({ title: this.data.imageError ? '页图加载失败，请重试'
          : this.data.saveError ? '阅读进度未保存，请重试' : '当前页面正在保存，请稍候', icon: 'none' })
        return
      }
      if (getCurrentPages().length > 1) wx.navigateBack()
      else wx.reLaunch({ url: this.data.returnUrl })
    },
  },
})

