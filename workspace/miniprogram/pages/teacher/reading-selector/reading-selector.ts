import type { ReadingResource, TaskCatalogFacet, TaskCatalogFilters, TaskCatalogListItem } from '../../../domain/types'
import { getReadingResource, getTaskCatalogResource, listTaskCatalogFacets, listTaskCatalogResources, listTeacherTextbookClasses } from '../../../services/app-service'
import { getSession, setTeacherCatalogResultIds, setTeacherReadingSelection, takeTeacherCatalogInitialIds } from '../../../session/session'
import { orderedReadingPages, selectedReadingPageIds } from './reading-range'

const PAGE_SIZE = 20
type Category = TaskCatalogFilters['category'] | ''
const CATEGORIES: Array<{ value: Category; label: string }> = [
  { value: '', label: '全部' }, { value: 'original', label: '原版材料' },
  { value: 'synchronized', label: '同步课本' }, { value: 'picture_book', label: '绘本阅读' },
  { value: 'current_events', label: '时文阅读' }, { value: 'chapter_book', label: '英语章节阅读' },
]
type FilterOption = { value: string; label: string }
const ALL_GRADES: FilterOption = { value: '', label: '全部年级' }
const ALL_DIFFICULTIES: FilterOption = { value: '', label: '全部难度' }

function filterOptions(facets: readonly TaskCatalogFacet[], grade: string): {
  grades: FilterOption[]; difficulties: FilterOption[]
} {
  const grades = [...new Set(facets.map(item => item.grade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const difficulties = [...new Set(facets.filter(item => !grade || item.grade === grade)
    .map(item => item.difficulty).filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return { grades: [ALL_GRADES, ...grades.map(value => ({ value, label: value }))],
    difficulties: [ALL_DIFFICULTIES, ...difficulties.map(value => ({ value, label: value }))] }
}
Component({
  data: { categories: CATEGORIES, category: '' as Category, keyword: '', grade: '', difficulty: '',
    facets: [] as TaskCatalogFacet[], gradeOptions: [ALL_GRADES] as FilterOption[],
    difficultyOptions: [ALL_DIFFICULTIES] as FilterOption[], gradeIndex: 0, difficultyIndex: 0, facetsLoaded: false,
    initialized: false,
    loading: true, loadingMore: false, confirming: false, error: '', rows: [] as TaskCatalogListItem[],
    nextOffset: null as number | null, selectedId: '', selectedTitle: '',
    preview: null as ReadingResource | null, mode: 'whole' as 'whole' | 'chapter' | 'range',
    chapterId: '', pages: [] as Array<{ id: string; label: string; chapterId: string }>, fromIndex: 0, toIndex: 0,
    queryVersion: 0, returnToPublish: false, initialIds: [] as string[] },
  pageLifetimes: { show() {
    if (this.data.initialized) return
    const pages = getCurrentPages() as Array<{ route?: string; options?: Record<string, string> }>
    const current = pages[pages.length - 1]
    const previous = pages[pages.length - 2]
    const returnToPublish = current?.options?.source === 'publish'
      || previous?.route === 'pages/teacher/publish-task/publish-task'
    this.setData({ initialized: true, returnToPublish,
      initialIds: returnToPublish ? [...takeTeacherCatalogInitialIds()] : [] }, () => {
      this.loadFilterOptions()
      const previewId = current?.options?.previewId
      if (previewId) this.openBook(decodeURIComponent(previewId))
    })
  } },
  methods: {
    onNavigateBack() {
      if (this.data.confirming) return
      if (this.data.preview) { this.closePreview(); return }
      if (getCurrentPages().length > 1) wx.navigateBack()
      else wx.reLaunch({ url: '/pages/teacher/materials-home/materials-home' })
    },
    noop() {},
    chooseCategory(event: WechatMiniprogram.TouchEvent) {
      const value = event.currentTarget.dataset.value as Category
      if (!CATEGORIES.some(item => item.value === value)) return
      this.setData({ category: value, grade: '', difficulty: '', gradeIndex: 0, difficultyIndex: 0,
        difficultyOptions: filterOptions(this.data.facets, '').difficulties }, () => this.search())
    },
    input(event: WechatMiniprogram.Input) {
      if (event.currentTarget.dataset.key === 'keyword') this.setData({ keyword: event.detail.value })
    },
    retry() { if (this.data.facetsLoaded) this.search(); else this.loadFilterOptions() },
    async loadFilterOptions() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'teacher') {
        this.setData({ loading: false, error: '仅授权教师可选择阅读内容' }); return
      }
      this.setData({ loading: true, error: '' })
      const result = await listTaskCatalogFacets(session.user.id, 'reading')
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const { grades, difficulties } = filterOptions(result.data, this.data.grade)
      this.setData({ facets: result.data, facetsLoaded: true, gradeOptions: grades,
        difficultyOptions: difficulties }, () => this.search())
    },
    chooseGrade(event: WechatMiniprogram.PickerChange) {
      const index = Number(event.detail.value)
      const option = this.data.gradeOptions[index]
      if (!option) return
      this.setData({ grade: option.value, gradeIndex: index, difficulty: '', difficultyIndex: 0,
        difficultyOptions: filterOptions(this.data.facets, option.value).difficulties }, () => this.search())
    },
    chooseDifficulty(event: WechatMiniprogram.PickerChange) {
      const index = Number(event.detail.value)
      const option = this.data.difficultyOptions[index]
      if (!option) return
      this.setData({ difficulty: option.value, difficultyIndex: index }, () => this.search())
    },
    filters(): TaskCatalogFilters {
      return { type: 'reading', ...(this.data.category ? { category: this.data.category } : {}),
        ...(this.data.keyword.trim() ? { keyword: this.data.keyword.trim() } : {}),
        ...(this.data.grade.trim() ? { grade: this.data.grade.trim() } : {}),
        ...(this.data.difficulty.trim() ? { difficulty: this.data.difficulty.trim() } : {}) }
    },
    async search() {
      const session = getSession(); if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'teacher') { this.setData({ loading: false, error: '仅授权教师可选择阅读内容' }); return }
      const queryVersion = this.data.queryVersion + 1
      this.setData({ loading: true, loadingMore: false, error: '', queryVersion, rows: [], nextOffset: null })
      const result = await listTaskCatalogResources(session.user.id, this.filters(), PAGE_SIZE, 0)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, rows: result.data.items, nextOffset: result.data.nextOffset })
    },
    async loadMore() {
      const session = getSession(); const offset = this.data.nextOffset
      if (!session || offset === null || this.data.loadingMore || this.data.loading) return
      const queryVersion = this.data.queryVersion
      this.setData({ loadingMore: true, error: '' })
      const result = await listTaskCatalogResources(session.user.id, this.filters(), PAGE_SIZE, offset)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loadingMore: false, error: result.error.message }); return }
      const known = new Set(this.data.rows.map(item => item.id))
      this.setData({ loadingMore: false, rows: [...this.data.rows, ...result.data.items.filter(item => !known.has(item.id))],
        nextOffset: result.data.nextOffset })
    },
    async openBook(id: string) {
      const session = getSession(); if (!session || !id) return
      const result = await getReadingResource(session.user.id, id)
      if (!result.ok) { this.setData({ error: result.error.message }); return }
      const pages = orderedReadingPages(result.data)
      this.setData({ preview: result.data, pages, selectedId: id,
        selectedTitle: result.data.title, chapterId: result.data.chapters[0]?.id ?? '',
        fromIndex: 0, toIndex: Math.max(0, pages.length - 1), mode: 'whole', error: '' })
    },
    previewBook(event: WechatMiniprogram.TouchEvent) { this.openBook(event.currentTarget.dataset.id as string) },
    closePreview() { this.setData({ preview: null }) },
    chooseMode(event: WechatMiniprogram.TouchEvent) {
      const mode = event.currentTarget.dataset.mode as 'whole' | 'chapter' | 'range'
      if (['whole', 'chapter', 'range'].includes(mode)) this.setData({ mode })
    },
    chooseChapter(event: WechatMiniprogram.TouchEvent) {
      const chapterId = event.currentTarget.dataset.id as string
      if (this.data.preview?.chapters.some(chapter => chapter.id === chapterId)) this.setData({ chapterId })
    },
    chooseFrom(event: WechatMiniprogram.PickerChange) {
      const fromIndex = Number(event.detail.value)
      if (Number.isInteger(fromIndex) && fromIndex >= 0 && fromIndex < this.data.pages.length) {
        this.setData({ fromIndex, toIndex: Math.max(fromIndex, this.data.toIndex) })
      }
    },
    chooseTo(event: WechatMiniprogram.PickerChange) {
      const toIndex = Number(event.detail.value)
      if (Number.isInteger(toIndex) && toIndex >= this.data.fromIndex && toIndex < this.data.pages.length) this.setData({ toIndex })
    },
    async confirm() {
      const session = getSession(); const preview = this.data.preview
      if (!session || !preview || this.data.confirming) return
      const pageIds = selectedReadingPageIds(preview, this.data.mode === 'whole' ? { mode: 'whole' }
        : this.data.mode === 'chapter' ? { mode: 'chapter', chapterId: this.data.chapterId }
          : { mode: 'range', fromIndex: this.data.fromIndex, toIndex: this.data.toIndex })
      if (!pageIds) { this.setData({ error: '所选阅读范围没有可用页面' }); return }
      this.setData({ confirming: true, error: '' })
      const [resource, detail] = await Promise.all([
        getTaskCatalogResource(session.user.id, preview.id), getReadingResource(session.user.id, preview.id),
      ])
      if (!resource.ok || !detail.ok || resource.data.type !== 'reading'
        || detail.data.contentVersion !== preview.contentVersion
        || resource.data.contentVersion !== preview.contentVersion
        || pageIds.some(id => !orderedReadingPages(detail.data).some(page => page.id === id))) {
        this.setData({ confirming: false, error: '阅读资源已变更或不可引用，请重新选择' }); return
      }
      let targetClassId: string | undefined
      if (!this.data.returnToPublish) {
        const classes = await listTeacherTextbookClasses(session.user.id)
        if (!classes.ok) { this.setData({ confirming: false, error: classes.error.message }); return }
        for (const target of classes.data) {
          const available = await getTaskCatalogResource(session.user.id, preview.id, [target.id])
          if (available.ok) { targetClassId = target.id; break }
        }
        if (!targetClassId) { this.setData({ confirming: false, error: '当前无可布置此阅读内容的授权班级' }); return }
      }
      setTeacherReadingSelection({ resourceId: preview.id, ...(pageIds === undefined ? {} : { pageIds }),
        ...(targetClassId === undefined ? {} : { targetClassId }) })
      setTeacherCatalogResultIds([...this.data.initialIds, preview.id])
      this.setData({ confirming: false, preview: null })
      if (this.data.returnToPublish) wx.navigateBack()
      else wx.navigateTo({ url: '/pages/teacher/publish-task/publish-task' })
    },
  },
})
