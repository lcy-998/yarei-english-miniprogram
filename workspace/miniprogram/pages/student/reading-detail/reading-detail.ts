import { ReadingProgressView, getReadingProgress, setReadingPage, toggleReadingFavorite } from '../../../services/m1-app-service'
import { getCurrentBookId, getSession } from '../../../session/session'

Component({
  data: { loading: true, saving: false, imageLoading: true, imageError: false, error: '', reading: null as ReadingProgressView | null },
  lifetimes: { attached() { this.loadReading() } },
  methods: {
    async loadReading() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '', imageError: false })
      const result = await getReadingProgress(session.user.id, getCurrentBookId())
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, reading: result.data, imageLoading: true })
    },
    imageLoaded() { this.setData({ imageLoading: false, imageError: false }) },
    imageFailed() { this.setData({ imageLoading: false, imageError: true }) },
    retryImage() { this.setData({ imageLoading: true, imageError: false }) },
    previewPage() { const url = this.data.reading?.pageImageUrl; if (url) wx.previewImage({ urls: [url], current: url }) },
    previousPage() { this.changePage(-1) },
    nextPage() { this.changePage(1) },
    async changePage(delta: number) {
      const session = getSession()
      const reading = this.data.reading
      if (!session || !reading || this.data.saving) return
      this.setData({ saving: true })
      const result = await setReadingPage(session.user.id, reading.book.id, reading.pageNumber + delta)
      if (!result.ok) { this.setData({ saving: false, error: result.error.message }); return }
      this.setData({ saving: false, reading: result.data, imageLoading: true, imageError: false })
    },
    async toggleFavorite() {
      const session = getSession()
      const reading = this.data.reading
      if (!session || !reading) return
      const result = await toggleReadingFavorite(session.user.id, reading.book.id)
      if (result.ok) this.setData({ 'reading.book.favorite': result.data.favorite })
    },
  },
})

