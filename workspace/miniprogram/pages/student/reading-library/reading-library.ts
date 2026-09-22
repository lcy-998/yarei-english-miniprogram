import { ReadingBookView, ReadingCategory, listReadingBooks, toggleReadingFavorite } from '../../../services/m1-app-service'
import { getSession, setCurrentBookId, takeReadingFavoritesOnly } from '../../../session/session'

const CATEGORY_LABELS: Record<ReadingCategory, string> = { original: '原版材料', textbook: '同步课本', picture: '绘本阅读', current: '时文阅读', chapter: '英语章节阅读' }

Component({
  data: { loading: true, error: '', books: [] as ReadingBookView[], visibleBooks: [] as ReadingBookView[], category: 'picture' as ReadingCategory, categories: Object.entries(CATEGORY_LABELS).map(([key, label]) => ({ key, label })), keyword: '', favoritesOnly: false, filterOpen: '', suppressClose: false, gradeFilter: '全部年级', difficultyFilter: '全部难度', themeFilter: '全部主题', filterOptions: { grade: ['全部年级', '三年级', '四年级'], difficulty: ['全部难度', '入门', '初级', '中级'], theme: ['全部主题', '动物', '生活', '自然'] } },
  lifetimes: { attached() { this.setData({ favoritesOnly: takeReadingFavoritesOnly() }, () => this.loadBooks()) } },
  pageLifetimes: { show() { this.loadBooks() } },
  methods: {
    async loadBooks() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await listReadingBooks(session.user.id, this.data.category, this.data.favoritesOnly)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const keyword = this.data.keyword.trim().toLowerCase()
      const books = result.data.filter(item => !keyword || item.title.toLowerCase().includes(keyword))
      this.setData({ loading: false, books, visibleBooks: this.applyFilters(books) })
    },
    setCategory(event: WechatMiniprogram.TouchEvent) { this.setData({ category: event.currentTarget.dataset.category as ReadingCategory }, () => this.loadBooks()) },
    onSearch(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }, () => this.loadBooks()) },
    closeFilter() { if (this.data.suppressClose) { this.setData({ suppressClose: false }); return } this.setData({ filterOpen: '' }) },
    toggleFilter(event: WechatMiniprogram.TouchEvent) { const key = event.currentTarget.dataset.key as string; this.setData({ filterOpen: this.data.filterOpen === key ? '' : key, suppressClose: true }) },
    chooseFilter(event: WechatMiniprogram.TouchEvent) {
      const key = event.currentTarget.dataset.key as 'grade' | 'difficulty' | 'theme'
      const value = event.currentTarget.dataset.value as string
      const next = key === 'grade' ? { gradeFilter: value } : key === 'difficulty' ? { difficultyFilter: value } : { themeFilter: value }
      this.setData({ ...next, filterOpen: '', suppressClose: true, visibleBooks: this.applyFilters(this.data.books) })
    },
    applyFilters(books: ReadingBookView[]): ReadingBookView[] {
      return books.filter(item => (this.data.gradeFilter === '全部年级' || item.grade === this.data.gradeFilter) && (this.data.difficultyFilter === '全部难度' || item.difficulty === this.data.difficultyFilter) && (this.data.themeFilter === '全部主题' || item.theme === this.data.themeFilter))
    },
    toggleFavorites() { this.setData({ favoritesOnly: !this.data.favoritesOnly }, () => this.loadBooks()) },
    async toggleFavorite(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      if (!session) return
      const result = await toggleReadingFavorite(session.user.id, event.currentTarget.dataset.id as string)
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      this.loadBooks()
    },
    openBook(event: WechatMiniprogram.TouchEvent) { setCurrentBookId(event.currentTarget.dataset.id as string); wx.navigateTo({ url: '/pages/student/reading-detail/reading-detail' }) },
  },
})

