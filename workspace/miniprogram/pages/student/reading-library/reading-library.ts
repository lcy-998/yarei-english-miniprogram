import { StudentCatalogFacet, StudentCatalogFilters, StudentCatalogItem } from '../../../domain/types'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { ReadingBookView, ReadingCategory, getReadingProgress as getMemoryReadingProgress, toggleReadingFavorite } from '../../../services/m1-app-service'
import { getReadingProgress, listStudentCatalog, listStudentCatalogFacets } from '../../../services/app-service'
import { getSession, setCurrentBookId, takeReadingFavoritesOnly } from '../../../session/session'

const CATEGORY_LABELS: Record<ReadingCategory, string> = { original: '原版材料', textbook: '同步课本', picture: '绘本阅读', current: '时文阅读', chapter: '英语章节阅读' }
const CATEGORY_WIRE: Record<ReadingCategory, NonNullable<StudentCatalogFilters['category']>> = {
  original: 'original', textbook: 'synchronized', picture: 'picture_book', current: 'current_events', chapter: 'chapter_book',
}
let readingCatalogRequest = 0
let readingSearchTimer: ReturnType<typeof setTimeout> | null = null

Component({
  data: { loading: true, error: '', books: [] as ReadingBookView[], visibleBooks: [] as ReadingBookView[], category: 'picture' as ReadingCategory, categories: Object.entries(CATEGORY_LABELS).map(([key, label]) => ({ key, label })), keyword: '', favoritesOnly: false, filterOpen: '', suppressClose: false, gradeFilter: '全部年级', difficultyFilter: '全部难度', themeFilter: '全部主题', filterOptions: { grade: ['全部年级'], difficulty: ['全部难度'], theme: ['全部主题'] }, resultTotal: 0, nextOffset: null as number | null, loadingMore: false, pageError: '', retryOffset: null as number | null },
  lifetimes: { attached() {
    const userId = getSession()?.user.id ?? ''
    const remembered = userId ? wx.getStorageSync(`reading_recent_category_${userId}`) as ReadingCategory : ''
    const category: ReadingCategory = typeof remembered === 'string'
      && Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, remembered)
      ? remembered as ReadingCategory : 'picture'
    this.setData({ category, favoritesOnly: takeReadingFavoritesOnly() }, () => this.loadBooks())
  },
    detached() { if (readingSearchTimer) clearTimeout(readingSearchTimer); readingCatalogRequest += 1 } },
  pageLifetimes: { show() { this.loadBooks() } },
  methods: {
    async loadBooks() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      const request = ++readingCatalogRequest
      this.setData({ loading: true, error: '' })
      const facets = await listStudentCatalogFacets(session.user.id, 'reading', CATEGORY_WIRE[this.data.category])
      if (request !== readingCatalogRequest) return
      if (!facets.ok) {
        this.setData(this.data.books.length ? { loading: false, pageError: facets.error.message, retryOffset: null }
          : { loading: false, error: facets.error.message })
        return
      }
      const filterOptions = readingCatalogOptions(facets.data)
      const filters = {
        grade: filterOptions.grade.includes(this.data.gradeFilter) ? this.data.gradeFilter : '全部年级',
        difficulty: filterOptions.difficulty.includes(this.data.difficultyFilter) ? this.data.difficultyFilter : '全部难度',
        theme: filterOptions.theme.includes(this.data.themeFilter) ? this.data.themeFilter : '全部主题',
      }
      this.setData({ filterOptions, gradeFilter: filters.grade, difficultyFilter: filters.difficulty,
        themeFilter: filters.theme })
      await this.loadBookPage(0)
    },
    setCategory(event: WechatMiniprogram.TouchEvent) {
      const category = event.currentTarget.dataset.category as ReadingCategory
      if (!Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)) return
      const userId = getSession()?.user.id
      if (userId) wx.setStorageSync(`reading_recent_category_${userId}`, category)
      this.setData({ category, gradeFilter: '全部年级', difficultyFilter: '全部难度', themeFilter: '全部主题',
        filterOpen: '', books: [], visibleBooks: [], resultTotal: 0, nextOffset: null }, () => this.loadBooks())
    },
    onSearch(event: WechatMiniprogram.Input) {
      this.setData({ keyword: event.detail.value })
      if (readingSearchTimer) clearTimeout(readingSearchTimer)
      readingSearchTimer = setTimeout(() => { void this.loadBookPage(0) }, 250)
    },
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
      }, () => { void this.loadBookPage(0) })
    },
    async loadBookPage(offset = 0) {
      const session = getSession()
      if (!session) return
      const request = ++readingCatalogRequest
      this.setData(offset === 0 ? { loading: true, error: '', pageError: '' } : { loadingMore: true, pageError: '' })
      const filters: StudentCatalogFilters = { type: 'reading', category: CATEGORY_WIRE[this.data.category],
        ...(this.data.gradeFilter === '全部年级' ? {} : { grade: this.data.gradeFilter }),
        ...(this.data.difficultyFilter === '全部难度' ? {} : { difficulty: this.data.difficultyFilter }),
        ...(this.data.themeFilter === '全部主题' ? {} : { theme: this.data.themeFilter }),
        ...(this.data.keyword.trim() ? { keyword: this.data.keyword.trim() } : {}) }
      const result = await listStudentCatalog(session.user.id, filters, 20, offset)
      if (request !== readingCatalogRequest) return
      if (!result.ok) {
        this.setData(offset === 0 && !this.data.books.length
          ? { loading: false, error: result.error.message }
          : { loading: false, loadingMore: false, pageError: result.error.message, retryOffset: offset })
        return
      }
      const mapped = await Promise.all(result.data.items.map(item => readingBookWithProgress(session.user.id, item)))
      if (request !== readingCatalogRequest) return
      const books = mapped.filter((item): item is ReadingBookView => item !== null)
      const allBooks = offset === 0 ? books : [...this.data.books, ...books]
      const visibleBooks = this.data.favoritesOnly ? allBooks.filter(book => book.favorite) : allBooks
      this.setData({ loading: false, loadingMore: false, error: '', books: allBooks, visibleBooks,
        resultTotal: result.data.total, nextOffset: result.data.nextOffset, retryOffset: null })
    },
    loadMoreBooks() { if (!this.data.loadingMore && this.data.nextOffset !== null) void this.loadBookPage(this.data.nextOffset) },
    retryCatalog() { if (this.data.retryOffset !== null) void this.loadBookPage(this.data.retryOffset)
      else void this.loadBooks() },
    clearFilters() { this.setData({ keyword: '', favoritesOnly: false, gradeFilter: '全部年级', difficultyFilter: '全部难度', themeFilter: '全部主题', filterOpen: '' }, () => { void this.loadBookPage(0) }) },
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

function readingCatalogOptions(facets: readonly StudentCatalogFacet[]): { grade: string[]; difficulty: string[]; theme: string[] } {
  return {
    grade: ['全部年级', ...new Set(facets.map(facet => facet.grade).filter(Boolean))],
    difficulty: ['全部难度', ...new Set(facets.map(facet => facet.difficulty).filter((value): value is string => Boolean(value)))],
    theme: ['全部主题', ...new Set(facets.map(facet => facet.theme).filter((value): value is string => Boolean(value)))],
  }
}

async function readingBookWithProgress(userId: string, item: StudentCatalogItem): Promise<ReadingBookView | null> {
  const category = Object.entries(CATEGORY_WIRE).find(([, wire]) => wire === item.category)?.[0] as ReadingCategory | undefined
  if (!category || item.itemCount < 1) return null
  if (getRepositoryMode() !== 'cloudbase') {
    const result = await getMemoryReadingProgress(userId, item.id)
    return result.ok ? result.data.book : null
  }
  const progress = await getReadingProgress(userId, item.id)
  if (!progress.ok) return null
  const pageNumber = progress.data?.pageNumber ?? 0
  return { id: item.id, title: item.title, category, grade: item.grade,
    difficulty: item.difficulty ?? '', theme: item.theme ?? '', pageCount: item.itemCount,
    ...(item.textbook === undefined ? {} : { textbook: item.textbook }),
    ...(item.unit === undefined ? {} : { unit: item.unit }),
    progressPercent: pageNumber === 0 ? 0 : Math.round(pageNumber * 100 / item.itemCount),
    favorite: progress.data?.favorite ?? false }
}

