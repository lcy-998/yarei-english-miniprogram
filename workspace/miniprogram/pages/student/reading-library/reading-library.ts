import { ReadingBookView, ReadingCategory, listReadingBooks, toggleReadingFavorite } from '../../../services/m1-app-service'
import { getSession, setCurrentBookId, takeReadingFavoritesOnly } from '../../../session/session'
import { filterReadingBooks, readingFilterOptions } from '../../../shared/reading-filters'

const CATEGORY_LABELS: Record<ReadingCategory, string> = { original: '原版材料', textbook: '同步课本', picture: '绘本阅读', current: '时文阅读', chapter: '英语章节阅读' }

Component({
  data: { loading: true, error: '', books: [] as ReadingBookView[], visibleBooks: [] as ReadingBookView[], category: 'picture' as ReadingCategory, categories: Object.entries(CATEGORY_LABELS).map(([key, label]) => ({ key, label })), keyword: '', favoritesOnly: false, filterOpen: '', suppressClose: false, gradeFilter: '全部年级', difficultyFilter: '全部难度', themeFilter: '全部主题', filterOptions: { grade: ['全部年级'], difficulty: ['全部难度'], theme: ['全部主题'] } },
  lifetimes: { attached() { this.setData({ favoritesOnly: takeReadingFavoritesOnly() }, () => this.loadBooks()) } },
  pageLifetimes: { show() { this.loadBooks() } },
  methods: {
    async loadBooks() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await listReadingBooks(session.user.id, this.data.category, this.data.favoritesOnly)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const books = result.data
      const filterOptions = readingFilterOptions(books)
      const filters = {
        grade: filterOptions.grade.includes(this.data.gradeFilter) ? this.data.gradeFilter : '全部年级',
        difficulty: filterOptions.difficulty.includes(this.data.difficultyFilter) ? this.data.difficultyFilter : '全部难度',
        theme: filterOptions.theme.includes(this.data.themeFilter) ? this.data.themeFilter : '全部主题',
      }
      this.setData({ loading: false, books, filterOptions, gradeFilter: filters.grade, difficultyFilter: filters.difficulty,
        themeFilter: filters.theme, visibleBooks: this.applyFilters(books, filters) })
    },
    setCategory(event: WechatMiniprogram.TouchEvent) { this.setData({ category: event.currentTarget.dataset.category as ReadingCategory, gradeFilter: '全部年级', difficultyFilter: '全部难度', themeFilter: '全部主题', filterOpen: '' }, () => this.loadBooks()) },
    onSearch(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }, () => this.setData({ visibleBooks: this.applyFilters(this.data.books) })) },
    closeFilter() { if (this.data.suppressClose) { this.setData({ suppressClose: false }); return } this.setData({ filterOpen: '' }) },
    toggleFilter(event: WechatMiniprogram.TouchEvent) { const key = event.currentTarget.dataset.key as string; this.setData({ filterOpen: this.data.filterOpen === key ? '' : key, suppressClose: true }) },
    chooseFilter(event: WechatMiniprogram.TouchEvent) {
      const key = event.currentTarget.dataset.key as 'grade' | 'difficulty' | 'theme'
      const value = event.currentTarget.dataset.value as string
      const gradeFilter = key === 'grade' ? value : this.data.gradeFilter
      const difficultyFilter = key === 'difficulty' ? value : this.data.difficultyFilter
      const themeFilter = key === 'theme' ? value : this.data.themeFilter
      this.setData({
        gradeFilter,
        difficultyFilter,
        themeFilter,
        filterOpen: '',
        suppressClose: true,
        visibleBooks: this.applyFilters(this.data.books, { grade: gradeFilter, difficulty: difficultyFilter, theme: themeFilter }),
      })
    },
    applyFilters(books: ReadingBookView[], selected?: { grade: string; difficulty: string; theme: string }): ReadingBookView[] {
      const filtered = filterReadingBooks(books, selected ?? {
        grade: this.data.gradeFilter,
        difficulty: this.data.difficultyFilter,
        theme: this.data.themeFilter,
      })
      const keyword = this.data.keyword.trim().toLowerCase()
      return keyword ? filtered.filter(book => book.title.toLowerCase().includes(keyword)) : filtered
    },
    clearFilters() { this.setData({ keyword: '', gradeFilter: '全部年级', difficultyFilter: '全部难度', themeFilter: '全部主题', filterOpen: '', visibleBooks: this.data.books }) },
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

