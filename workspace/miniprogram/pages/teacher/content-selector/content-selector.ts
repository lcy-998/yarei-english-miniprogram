import type { SchoolQuestionSummary, ServiceError, TaskCatalogFacet, TaskCatalogFilters, TaskCatalogListItem } from '../../../domain/types'
import { getReadingResource, getSchoolQuestion, getTaskCatalogResource, getVocabularyPack, listSchoolQuestions, listTaskCatalogFacets, listTaskCatalogResources } from '../../../services/app-service'
import { clearTeacherSelectedResourceIds, getSession, getTeacherSelectedResourceIds, setTeacherCatalogInitialIds, setTeacherCatalogResultIds, takeTeacherCatalogInitialIds } from '../../../session/session'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import type { RecordingPromptView } from '../../../domain/task-recording'
import { getRecordingPrompt, listRecordingPrompts } from '../../../services/task-recording-service'
import { catalogFacetOptions, catalogSource, type CatalogFacetOptions } from './catalog-facets'

type CatalogType = 'listening' | 'reading' | 'recording' | 'video' | 'vocabulary' | 'exercise' | 'dubbing'
type CatalogRow = { id: string; title: string; type: CatalogType; source: string; detail: string; selected: boolean }
type SelectedRow = Omit<CatalogRow, 'selected'> & { invalid?: boolean }

const READING_CATEGORY_NAMES: Record<NonNullable<TaskCatalogFilters['category']>, string> = {
  original: '原版材料', synchronized: '同步课本', picture_book: '绘本阅读',
  current_events: '时文阅读', chapter_book: '英语章节阅读',
}
const PAGE_SIZE = 20
type ReadingCategory = TaskCatalogFilters['category'] | ''
const READING_CATEGORIES: Array<{ value: ReadingCategory; label: string }> = [
  { value: '', label: '全部' }, { value: 'original', label: '原版材料' },
  { value: 'synchronized', label: '同步课本' }, { value: 'picture_book', label: '绘本阅读' },
  { value: 'current_events', label: '时文阅读' }, { value: 'chapter_book', label: '英语章节阅读' },
]
const TYPE_CHOICES: Array<{ value: CatalogType; label: string; locked: boolean; icon: string;
  tone: 'primary' | 'success' | 'warning' | 'ai' }> = [
  { value: 'listening', label: '听力', locked: true, icon: 'headphones', tone: 'primary' },
  { value: 'reading', label: '阅读', locked: false, icon: 'reading', tone: 'success' },
  { value: 'recording', label: '录音', locked: false, icon: 'microphone', tone: 'ai' },
  { value: 'video', label: '看视频', locked: true, icon: 'video', tone: 'success' },
  { value: 'vocabulary', label: '单词', locked: false, icon: 'vocabulary', tone: 'warning' },
  { value: 'exercise', label: '习题', locked: false, icon: 'exercise', tone: 'primary' },
  { value: 'dubbing', label: '视频配音', locked: true, icon: 'dubbing', tone: 'ai' },
]

function resourceRow(resource: TaskCatalogListItem): SelectedRow {
  const source = resource.type === 'reading' && resource.category
    ? READING_CATEGORY_NAMES[resource.category]
    : resource.source === 'synchronized_textbook' ? '同步学教材'
      : resource.source === 'reading_book' ? '阅读书籍' : '词包'
  return { id: resource.id, title: resource.title, type: resource.type, source,
    detail: [resource.grade, resource.textbook, resource.unit, resource.difficulty,
      `完成 ${resource.requiredCount} ${resource.type === 'reading' ? '页' : '词'}`].filter(Boolean).join('　') }
}

function questionRow(question: SchoolQuestionSummary): SelectedRow {
  return { id: question.id, title: question.title, type: 'exercise', source: '学校习题库',
    detail: [question.grade, question.textbook, question.unit, question.stemSummary].filter(Boolean).join('　') }
}

function recordingRow(prompt: RecordingPromptView): SelectedRow {
  return { id: prompt.id, title: prompt.title, type: 'recording', source: '文字录音提示',
    detail: [prompt.grade, prompt.unit, prompt.promptText].filter(Boolean).join('　') }
}

function visibleRows(rows: readonly SelectedRow[], selected: readonly SelectedRow[]): CatalogRow[] {
  const ids = new Set(selected.map(item => item.id))
  return rows.map(item => ({ id: item.id, title: item.title, type: item.type, source: item.source,
    detail: item.detail, selected: ids.has(item.id) }))
}

function canRetry(error: ServiceError): boolean {
  return error.retryable || error.code === 'NETWORK_ERROR' || error.code === 'SERVICE_UNAVAILABLE'
}

Component({
  data: {
    types: TYPE_CHOICES,
    readingCategories: READING_CATEGORIES,
    activeType: 'reading' as CatalogType,
    readingCategory: '' as ReadingCategory,
    targetClassIds: [] as string[],
    catalogResources: [] as TaskCatalogListItem[],
    recordingPrompts: [] as RecordingPromptView[],
    questions: [] as SchoolQuestionSummary[],
    rows: [] as CatalogRow[],
    selected: [] as SelectedRow[],
    initialSelectedIds: [] as string[],
    keyword: '',
    source: '' as TaskCatalogFilters['source'] | '',
    grade: '',
    term: '',
    textbook: '',
    unit: '',
    difficulty: '',
    facets: [] as TaskCatalogFacet[],
    facetOptions: catalogFacetOptions([], {}) as CatalogFacetOptions,
    facetQueryVersion: 0,
    nextOffset: null as number | null,
    loading: true,
    catalogLoaded: false,
    loadingMore: false,
    confirming: false,
    error: '',
    emptyMessage: '',
    queryVersion: 0,
    initialized: false,
  },
  pageLifetimes: { show() {
    if (!this.data.initialized) {
      const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
      const raw = pages[pages.length - 1]?.options?.targetClassIds ?? ''
      const targetClassIds = raw ? decodeURIComponent(raw).split(',').filter(Boolean) : []
      this.setData({ initialized: true, targetClassIds }, () => this.loadCatalog())
      return
    }
    const ids = getTeacherSelectedResourceIds()
    if (ids.length && !this.data.loading) this.addQuestionsFromLibrary(ids)
  } },
  methods: {
    targetScope(): string[] | undefined { return this.data.targetClassIds.length ? this.data.targetClassIds : undefined },
    onNavigateBack() {
      if (this.data.confirming) return
      const initial = [...this.data.initialSelectedIds].sort().join('\u0000')
      const current = this.data.selected.map(item => item.id).sort().join('\u0000')
      const leave = () => {
        if (getCurrentPages().length > 1) wx.navigateBack()
        else wx.reLaunch({ url: '/pages/teacher/publish-task/publish-task' })
      }
      if (initial === current) { leave(); return }
      wx.showActionSheet({ itemList: ['保留所选并返回', '放弃更改'], success: result => {
        if (result.tapIndex === 0) { this.confirmSelection(); return }
        leave()
      } })
    },
    async loadCatalog() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'teacher') {
        this.setData({ loading: false, error: '请从授权教师的布置任务页选择内容' }); return
      }
      this.setData({ loading: true, error: '', catalogLoaded: false })
      const initialIds = takeTeacherCatalogInitialIds()
      const selected: SelectedRow[] = []
      for (const id of initialIds) {
        const resource = await getTaskCatalogResource(session.user.id, id, this.targetScope())
        if (resource.ok) { selected.push(resourceRow(resource.data)); continue }
        if (canRetry(resource.error)) {
          setTeacherCatalogInitialIds(initialIds)
          this.setData({ loading: false, error: resource.error.message }); return
        }
        const prompt = await getRecordingPrompt(session.user.id, id, this.targetScope())
        if (prompt.ok) { selected.push(recordingRow(prompt.data)); continue }
        if (canRetry(prompt.error)) {
          setTeacherCatalogInitialIds(initialIds)
          this.setData({ loading: false, error: prompt.error.message }); return
        }
        const question = await getSchoolQuestion(session.user.id, id, this.targetScope())
        if (!question.ok && canRetry(question.error)) {
          setTeacherCatalogInitialIds(initialIds)
          this.setData({ loading: false, error: question.error.message }); return
        }
        selected.push(question.ok ? questionRow(question.data) : {
          id, title: id, type: 'exercise', source: '学校习题库', detail: '资源已下架或无权引用', invalid: true,
        })
      }
      const activeType = selected[0]?.type ?? 'reading'
      this.setData({ selected, initialSelectedIds: [...initialIds], activeType, loading: false, catalogLoaded: true }, () => this.loadFacetOptions())
    },
    retry() { if (!this.data.catalogLoaded) this.loadCatalog()
      else if ((this.data.activeType === 'reading' || this.data.activeType === 'vocabulary') && !this.data.facets.length) this.loadFacetOptions()
      else this.loadRows() },
    chooseType(event: WechatMiniprogram.TouchEvent) {
      const type = event.currentTarget.dataset.type as CatalogType
      if (!TYPE_CHOICES.some(item => item.value === type)) return
      this.setData({ activeType: type, readingCategory: '', keyword: '', source: '', grade: '', term: '', textbook: '', unit: '', difficulty: '',
        facets: [], facetOptions: catalogFacetOptions([], {}), facetQueryVersion: this.data.facetQueryVersion + 1,
        queryVersion: this.data.queryVersion + 1, loadingMore: false,
        questions: [], catalogResources: [], recordingPrompts: [], rows: [], nextOffset: null }, () => this.loadFacetOptions())
    },
    chooseReadingCategory(event: WechatMiniprogram.TouchEvent) {
      if (this.data.activeType !== 'reading') return
      const readingCategory = event.currentTarget.dataset.value as ReadingCategory
      if (!READING_CATEGORIES.some(item => item.value === readingCategory) || readingCategory === this.data.readingCategory) return
      this.setData({ readingCategory, source: '', grade: '', term: '', textbook: '', unit: '', difficulty: '',
        facetOptions: catalogFacetOptions(this.data.facets, {}), rows: [], nextOffset: null }, () => this.loadRows())
    },
    async loadFacetOptions() {
      const type = this.data.activeType
      if (type !== 'reading' && type !== 'vocabulary') { this.loadRows(); return }
      const session = getSession()
      if (!session) return
      const facetQueryVersion = this.data.facetQueryVersion + 1
      this.setData({ facetQueryVersion, loading: true, error: '' })
      const result = await listTaskCatalogFacets(session.user.id, type, this.targetScope())
      if (facetQueryVersion !== this.data.facetQueryVersion) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ facets: result.data, facetOptions: catalogFacetOptions(result.data, {}), loading: false }, () => this.loadRows())
    },
    chooseFacet(event: WechatMiniprogram.PickerChange) {
      const key = event.currentTarget.dataset.key as 'source' | 'grade' | 'term' | 'textbook' | 'unit' | 'difficulty'
      const options = this.data.facetOptions[key === 'source' ? 'sources' : key === 'grade' ? 'grades'
        : key === 'term' ? 'terms' : key === 'textbook' ? 'textbooks' : key === 'unit' ? 'units' : 'difficulties']
      const index = Number(event.detail.value)
      if (!Number.isInteger(index) || index < 0 || index >= options.length) return
      const value = options[index]!.value
      const changes = key === 'source' ? { source: catalogSource(value), readingCategory: '' as ReadingCategory,
        grade: '', term: '', textbook: '', unit: '', difficulty: '' }
        : key === 'grade' ? { grade: value, term: '', textbook: '', unit: '', difficulty: '' }
          : key === 'term' ? { term: value, textbook: '', unit: '', difficulty: '' }
            : key === 'textbook' ? { textbook: value, unit: '', difficulty: '' }
              : key === 'unit' ? { unit: value, difficulty: '' } : { difficulty: value }
      const selected = Object.assign({ source: this.data.source, grade: this.data.grade, term: this.data.term,
        textbook: this.data.textbook, unit: this.data.unit, difficulty: this.data.difficulty }, changes)
      this.setData({ ...changes, facetOptions: catalogFacetOptions(this.data.facets, selected), rows: [], nextOffset: null },
        () => this.loadRows())
    },
    catalogFilters(): Partial<TaskCatalogFilters> {
      const { source, readingCategory, grade, term, textbook, unit, difficulty, keyword } = this.data
      return { ...(source ? { source } : {}), ...(this.data.activeType === 'reading' && readingCategory ? { category: readingCategory } : {}),
        ...(grade ? { grade } : {}), ...(term ? { term } : {}),
        ...(textbook ? { textbook } : {}), ...(unit ? { unit } : {}), ...(difficulty ? { difficulty } : {}),
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}) }
    },
    onKeyword(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }) },
    search() { if (!this.data.loading && !this.data.loadingMore) this.loadRows() },
    async loadRows() {
      const type = this.data.activeType
      const queryVersion = this.data.queryVersion + 1
      if (type === 'listening' || type === 'video' || type === 'dubbing') {
        this.setData({ queryVersion, loading: false, rows: [], nextOffset: null,
          emptyMessage: '该类型的任务发布将在 M3 开放，当前不可加入任务。', error: '' })
        return
      }
      if (type === 'recording') {
        const session = getSession()
        if (!session) return
        this.setData({ queryVersion, loading: true, error: '', recordingPrompts: [], rows: [], nextOffset: null })
        const result = await listRecordingPrompts(session.user.id, this.targetScope(),
          this.data.keyword.trim(), PAGE_SIZE, 0)
        if (queryVersion !== this.data.queryVersion) return
        if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
        this.setData({ loading: false, recordingPrompts: result.data.items,
          rows: visibleRows(result.data.items.map(recordingRow), this.data.selected),
          nextOffset: result.data.nextOffset, emptyMessage: '当前没有已授权的文字录音提示。' })
        return
      }
      const session = getSession()
      if (!session) return
      this.setData({ queryVersion, loading: true, loadingMore: false, error: '',
        catalogResources: [], questions: [], rows: [], nextOffset: null })
      if (type === 'reading' || type === 'vocabulary') {
        const result = await listTaskCatalogResources(session.user.id, { type,
          ...this.catalogFilters(),
          ...(this.targetScope() ? { targetClassIds: this.data.targetClassIds } : {}),
        }, PAGE_SIZE, 0)
        if (queryVersion !== this.data.queryVersion) return
        if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
        this.setData({ loading: false, catalogResources: result.data.items,
          rows: visibleRows(result.data.items.map(resourceRow), this.data.selected),
          nextOffset: result.data.nextOffset, emptyMessage: '当前条件下暂无授权资源，可调整关键词。' })
        return
      }
      const result = await listSchoolQuestions(session.user.id, {
        ...(this.data.keyword.trim() ? { keyword: this.data.keyword.trim() } : {}),
        ...(this.targetScope() ? { targetClassIds: this.data.targetClassIds } : {}),
      }, PAGE_SIZE, 0)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, questions: result.data.items, rows: visibleRows(result.data.items.map(questionRow), this.data.selected),
        nextOffset: result.data.nextOffset, emptyMessage: '当前条件下暂无授权习题，可调整关键词或进入学校习题库筛选。' })
    },
    async loadMore() {
      const offset = this.data.nextOffset
      if (offset === null || this.data.loading || this.data.loadingMore) return
      const session = getSession()
      if (!session) return
      const queryVersion = this.data.queryVersion
      this.setData({ loadingMore: true, error: '' })
      if (this.data.activeType === 'reading' || this.data.activeType === 'vocabulary') {
        const result = await listTaskCatalogResources(session.user.id, { type: this.data.activeType,
          ...this.catalogFilters(),
          ...(this.targetScope() ? { targetClassIds: this.data.targetClassIds } : {}),
        }, PAGE_SIZE, offset)
        if (queryVersion !== this.data.queryVersion) return
        if (!result.ok) { this.setData({ loadingMore: false, error: result.error.message }); return }
        const known = new Set(this.data.catalogResources.map(item => item.id))
        const catalogResources = [...this.data.catalogResources, ...result.data.items.filter(item => !known.has(item.id))]
        this.setData({ loadingMore: false, catalogResources,
          rows: visibleRows(catalogResources.map(resourceRow), this.data.selected), nextOffset: result.data.nextOffset })
        return
      }
      if (this.data.activeType === 'recording') {
        const result = await listRecordingPrompts(session.user.id, this.targetScope(),
          this.data.keyword.trim(), PAGE_SIZE, offset)
        if (queryVersion !== this.data.queryVersion) return
        if (!result.ok) { this.setData({ loadingMore: false, error: result.error.message }); return }
        const known = new Set(this.data.recordingPrompts.map(item => item.id))
        const recordingPrompts = [...this.data.recordingPrompts, ...result.data.items.filter(item => !known.has(item.id))]
        this.setData({ loadingMore: false, recordingPrompts,
          rows: visibleRows(recordingPrompts.map(recordingRow), this.data.selected), nextOffset: result.data.nextOffset })
        return
      }
      const result = await listSchoolQuestions(session.user.id, {
        ...(this.data.keyword.trim() ? { keyword: this.data.keyword.trim() } : {}),
        ...(this.targetScope() ? { targetClassIds: this.data.targetClassIds } : {}),
      }, PAGE_SIZE, offset)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loadingMore: false, error: result.error.message }); return }
      const known = new Set(this.data.questions.map(item => item.id))
      const questions = [...this.data.questions, ...result.data.items.filter(item => !known.has(item.id))]
      this.setData({ loadingMore: false, questions, rows: visibleRows(questions.map(questionRow), this.data.selected),
        nextOffset: result.data.nextOffset })
    },
    toggleRow(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const row = this.data.rows.find(item => item.id === id)
      if (!row) return
      const selected = this.data.selected.some(item => item.id === id)
        ? this.data.selected.filter(item => item.id !== id)
        : [...this.data.selected, { id: row.id, title: row.title, type: row.type, source: row.source, detail: row.detail }]
      this.setData({ selected, rows: visibleRows(this.data.rows, selected), error: '' })
    },
    removeSelected(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const selected = this.data.selected.filter(item => item.id !== id)
      this.setData({ selected, rows: visibleRows(this.data.rows, selected), error: '' })
    },
    async addQuestionsFromLibrary(ids: readonly string[]) {
      const session = getSession()
      if (!session) return
      const selected = [...this.data.selected]
      for (const id of ids) {
        if (selected.some(item => item.id === id)) continue
        const result = await getSchoolQuestion(session.user.id, id, this.targetScope())
        if (!result.ok) { this.setData({ error: '所选习题已失效，请重新选择' }); return }
        selected.push(questionRow(result.data))
      }
      clearTeacherSelectedResourceIds()
      this.setData({ selected, rows: visibleRows(this.data.rows, selected), error: '' })
    },
    openQuestionLibrary() {
      const scope = this.targetScope()
      wx.navigateTo({ url: '/pages/teacher/school-questions/school-questions?source=catalog'
        + (scope ? `&targetClassIds=${encodeURIComponent(scope.join(','))}` : '') })
    },
    async previewRow(event: WechatMiniprogram.TouchEvent) {
      const row = this.data.rows.find(item => item.id === event.currentTarget.dataset.id)
      const session = getSession()
      if (!row || !session) return
      if (row.type === 'exercise') {
        const result = await getSchoolQuestion(session.user.id, row.id, this.targetScope())
        if (!result.ok) { this.setData({ error: result.error.message }); return }
        wx.showModal({ title: result.data.title, content: `${result.data.stem}\n${result.data.options.join('\n')}\n答案：${String(result.data.correctAnswer)}`, showCancel: false })
      } else if (row.type === 'reading') {
        if (getRepositoryMode() === 'memory') {
          wx.showModal({ title: row.title, content: `${row.source}　${row.detail}`, showCancel: false })
          return
        }
        const result = await getReadingResource(session.user.id, row.id)
        if (!result.ok) { this.setData({ error: result.error.message }); return }
        wx.showModal({ title: result.data.title, content: `${result.data.grade}　${result.data.chapters.length} 章`, showCancel: false })
      } else if (row.type === 'vocabulary') {
        const result = await getVocabularyPack(session.user.id, row.id)
        if (!result.ok) { this.setData({ error: result.error.message }); return }
        wx.showModal({ title: result.data.title, content: `${result.data.grade}　${result.data.unit}　${result.data.words.length} 词`, showCancel: false })
      } else if (row.type === 'recording') {
        const result = await getRecordingPrompt(session.user.id, row.id, this.targetScope())
        if (!result.ok) { this.setData({ error: result.error.message }); return }
        wx.showModal({ title: result.data.title, content: result.data.promptText, showCancel: false })
      }
    },
    async confirmSelection() {
      const session = getSession()
      if (!session || this.data.confirming) return
      if (!this.data.selected.length) { this.setData({ error: '请至少选择一项任务内容' }); return }
      this.setData({ confirming: true, error: '' })
      for (const selected of this.data.selected) {
        if (selected.invalid || !['reading', 'vocabulary', 'exercise', 'recording'].includes(selected.type)) {
          this.setData({ confirming: false, error: '已选内容包含不可发布或失效资源，请先移除' }); return
        }
        if (selected.type === 'exercise') {
          const question = await getSchoolQuestion(session.user.id, selected.id, this.targetScope())
          if (!question.ok) { this.setData({ confirming: false,
            error: canRetry(question.error) ? '资源验证暂时失败，已保留选择，请重试' : `${selected.title}已不可引用，请先移除` }); return }
        } else if (selected.type === 'reading' || selected.type === 'vocabulary') {
          const resource = await getTaskCatalogResource(session.user.id, selected.id, this.targetScope())
          if (!resource.ok || resource.data.type !== selected.type) {
            this.setData({ confirming: false, error: !resource.ok && canRetry(resource.error)
              ? '资源验证暂时失败，已保留选择，请重试' : `${selected.title}已不可引用，请先移除` }); return
          }
        } else {
          const prompt = await getRecordingPrompt(session.user.id, selected.id, this.targetScope())
          if (!prompt.ok) { this.setData({ confirming: false, error: canRetry(prompt.error)
            ? '录音提示验证暂时失败，已保留选择，请重试' : `${selected.title}已不可引用，请先移除` }); return }
        }
      }
      setTeacherCatalogResultIds(this.data.selected.map(item => item.id))
      this.setData({ confirming: false })
      wx.navigateBack()
    },
  },
})
