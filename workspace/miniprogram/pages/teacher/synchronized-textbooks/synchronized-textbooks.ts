import type { TextbookFilters, TextbookSummary } from '../../../domain/types'
import { getReadingResource, getSynchronizedTextbook, getTaskCatalogResource, listSynchronizedTextbooks, listTeacherTextbookClasses } from '../../../services/app-service'
import { getSession, setTeacherCatalogResultIds, setTeacherReadingSelection, setTeacherTextbookSelectedIds, takeTeacherCatalogInitialIds } from '../../../session/session'
import { selectedReadingPageIds } from '../reading-selector/reading-range'
import { selectTextbookFilter, textbookFilterOptions, type TextbookFilterKey, type TextbookFilterOptions, type TextbookFilterValues } from './textbook-filter-options'

const PAGE_SIZE = 20
Component({
  data: { initialized: false, loading: true, loadingMore: false, confirming: false, error: '', mode: '', classId: '',
    keyword: '', grade: '', term: '', edition: '', unit: '', lesson: '',
    facetBooks: [] as TextbookSummary[],
    filterOptions: { grade: ['全部年级'], term: ['全部学期'], edition: ['全部版本'],
      unit: ['全部单元'], lesson: ['全部课次'] } as TextbookFilterOptions,
    rows: [] as TextbookSummary[], selectedIds: [] as string[], selectedLookup: {} as Record<string, boolean>, nextOffset: null as number | null,
    preview: null as TextbookSummary | null, queryVersion: 0, returnToPublish: false, initialIds: [] as string[] },
  pageLifetimes: { show() {
    if (this.data.initialized) return
    const pages = getCurrentPages() as Array<{ route?: string; options?: Record<string, string> }>
    const options = pages[pages.length - 1]?.options ?? {}
    const previous = pages[pages.length - 2]
    const returnToPublish = options.source === 'publish' || previous?.route === 'pages/teacher/publish-task/publish-task'
    this.setData({ initialized: true, mode: options.mode ?? '', classId: options.classId ? decodeURIComponent(options.classId) : '',
      returnToPublish, initialIds: returnToPublish ? [...takeTeacherCatalogInitialIds()] : [] },
      () => { this.search(); if (options.previewId) this.previewById(decodeURIComponent(options.previewId)) })
  } },
  methods: {
    onNavigateBack() {
      if (this.data.confirming) return
      if (this.data.preview) { this.closePreview(); return }
      const leave = () => {
        if (getCurrentPages().length > 1) wx.navigateBack()
        else wx.reLaunch({ url: '/pages/teacher/materials-home/materials-home' })
      }
      if (!this.data.selectedIds.length) { leave(); return }
      wx.showModal({ title: '放弃已选课本？', content: '尚未确认引用，返回后本次选择将清空。', success: result => {
        if (result.confirm) leave()
      } })
    },
    noop() {},
    filters(): TextbookFilters {
      const { keyword, grade, term, edition, unit, lesson } = this.data
      return { ...(keyword.trim() ? { keyword: keyword.trim() } : {}), ...(grade.trim() ? { grade: grade.trim() } : {}),
        ...(term.trim() ? { term: term.trim() } : {}), ...(edition.trim() ? { edition: edition.trim() } : {}),
        ...(unit.trim() ? { unit: unit.trim() } : {}), ...(lesson.trim() ? { lesson: lesson.trim() } : {}) }
    },
    input(event: WechatMiniprogram.Input) {
      if (event.currentTarget.dataset.key === 'keyword') this.setData({ keyword: event.detail.value })
    },
    clearFilters() {
      const selected: TextbookFilterValues = { grade: '', term: '', edition: '', unit: '', lesson: '' }
      this.setData({ keyword: '', ...selected, filterOptions: textbookFilterOptions(this.data.facetBooks, selected) },
        () => this.search())
    },
    chooseFilter(event: WechatMiniprogram.PickerChange) {
      const key = event.currentTarget.dataset.key as TextbookFilterKey
      if (!['grade', 'term', 'edition', 'unit', 'lesson'].includes(key)) return
      const current: TextbookFilterValues = { grade: this.data.grade, term: this.data.term,
        edition: this.data.edition, unit: this.data.unit, lesson: this.data.lesson }
      const selected = selectTextbookFilter(current, key, Number(event.detail.value), this.data.filterOptions)
      if (!selected) return
      this.setData({ ...selected, filterOptions: textbookFilterOptions(this.data.facetBooks, selected) },
        () => this.search())
    },
    async search() {
      const session = getSession(); if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'teacher') { this.setData({ loading: false, error: '仅授权教师可查看同步课本' }); return }
      const queryVersion = this.data.queryVersion + 1
      this.setData({ loading: true, error: '', queryVersion, rows: [], nextOffset: null })
      const result = await listSynchronizedTextbooks(session.user.id, this.filters(), PAGE_SIZE, 0, this.data.classId || undefined)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const known = new Map(this.data.facetBooks.map(book => [book.id, book]))
      result.data.items.forEach(book => known.set(book.id, book))
      const facetBooks = [...known.values()]
      const selected: TextbookFilterValues = { grade: this.data.grade, term: this.data.term,
        edition: this.data.edition, unit: this.data.unit, lesson: this.data.lesson }
      this.setData({ loading: false, rows: result.data.items, nextOffset: result.data.nextOffset,
        facetBooks, filterOptions: textbookFilterOptions(facetBooks, selected) })
    },
    async loadMore() {
      const session = getSession(); const offset = this.data.nextOffset
      if (!session || offset === null || this.data.loading || this.data.loadingMore) return
      const queryVersion = this.data.queryVersion
      this.setData({ loadingMore: true, error: '' })
      const result = await listSynchronizedTextbooks(session.user.id, this.filters(), PAGE_SIZE, offset, this.data.classId || undefined)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loadingMore: false, error: result.error.message }); return }
      const known = new Set(this.data.rows.map(item => item.id))
      const facetKnown = new Map(this.data.facetBooks.map(book => [book.id, book]))
      result.data.items.forEach(book => facetKnown.set(book.id, book))
      const facetBooks = [...facetKnown.values()]
      const selected: TextbookFilterValues = { grade: this.data.grade, term: this.data.term,
        edition: this.data.edition, unit: this.data.unit, lesson: this.data.lesson }
      this.setData({ loadingMore: false, rows: [...this.data.rows, ...result.data.items.filter(item => !known.has(item.id))],
        nextOffset: result.data.nextOffset, facetBooks, filterOptions: textbookFilterOptions(facetBooks, selected) })
    },
    select(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const selectedIds = this.data.selectedIds.includes(id) ? this.data.selectedIds.filter(item => item !== id)
        : this.data.mode === 'config' ? [...this.data.selectedIds, id] : [id]
      this.setData({ selectedIds, selectedLookup: Object.fromEntries(selectedIds.map(value => [value, true])), error: '' })
    },
    clearSelection() { this.setData({ selectedIds: [], selectedLookup: {}, error: '' }) },
    async previewById(id: string) {
      const session = getSession(); if (!session) return
      const result = await getSynchronizedTextbook(session.user.id, id, this.data.classId || undefined)
      if (!result.ok) { this.setData({ error: result.error.message }); return }
      this.setData({ preview: result.data })
    },
    preview(event: WechatMiniprogram.TouchEvent) { this.previewById(event.currentTarget.dataset.id as string) },
    closePreview() { this.setData({ preview: null }) },
    async confirm() {
      const session = getSession(); if (!session || this.data.confirming) return
      if (!this.data.selectedIds.length) { this.setData({ error: '请先选择至少一本课本' }); return }
      if (this.data.mode !== 'config' && this.data.selectedIds.length !== 1) {
        this.setData({ error: '布置阅读任务请一次选择一本课本；可返回继续添加其他内容' }); return
      }
      this.setData({ confirming: true, error: '' })
      for (const id of this.data.selectedIds) {
        const result = await getSynchronizedTextbook(session.user.id, id, this.data.classId || undefined)
        if (!result.ok) { this.setData({ confirming: false, error: `${id} 已不可引用：${result.error.message}` }); return }
        if (this.data.mode !== 'config') {
          const resource = await getTaskCatalogResource(session.user.id, id, this.data.classId ? [this.data.classId] : undefined)
          if (!resource.ok || resource.data.type !== 'reading') {
            this.setData({ confirming: false, error: '选中课本不可作为阅读任务引用' }); return
          }
        }
      }
      if (this.data.mode === 'config') {
        setTeacherTextbookSelectedIds(this.data.selectedIds)
        this.setData({ confirming: false }); wx.navigateBack(); return
      }
      let targetClassId = this.data.classId || undefined
      if (!targetClassId && !this.data.returnToPublish) {
        const classes = await listTeacherTextbookClasses(session.user.id)
        if (!classes.ok) { this.setData({ confirming: false, error: classes.error.message }); return }
        for (const target of classes.data) {
          const available = await Promise.all(this.data.selectedIds.map(id =>
            getTaskCatalogResource(session.user.id, id, [target.id])))
          if (available.every(result => result.ok)) { targetClassId = target.id; break }
        }
        if (!targetClassId) { this.setData({ confirming: false, error: '所选课本没有共同可布置的授权班级' }); return }
      }
      const selectedId = this.data.selectedIds[0]!
      const [detail, catalog] = await Promise.all([
        getReadingResource(session.user.id, selectedId),
        getTaskCatalogResource(session.user.id, selectedId, targetClassId ? [targetClassId] : undefined),
      ])
      const pageIds = detail.ok ? selectedReadingPageIds(detail.data, { mode: 'whole' }) : null
      if (!detail.ok || !catalog.ok || !pageIds || catalog.data.contentVersion !== detail.data.contentVersion) {
        this.setData({ confirming: false, error: '课本页图已变更或缺失，请重新选择' }); return
      }
      setTeacherReadingSelection({ resourceId: selectedId, pageIds,
        ...(targetClassId === undefined ? {} : { targetClassId }) })
      setTeacherCatalogResultIds([...this.data.initialIds, ...this.data.selectedIds])
      this.setData({ confirming: false })
      if (this.data.returnToPublish) wx.navigateBack()
      else wx.navigateTo({ url: '/pages/teacher/publish-task/publish-task' })
    },
  },
})
