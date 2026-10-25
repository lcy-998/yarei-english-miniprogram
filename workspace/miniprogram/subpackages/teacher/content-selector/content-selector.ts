import type { SchoolQuestionFacet, SchoolQuestionSummary, SchoolQuestionType, ServiceError, TaskCatalogFacet, TaskCatalogFilters, TaskCatalogListItem } from '../../../domain/types'
import { getSchoolQuestion, getTaskCatalogResource, listSchoolQuestionFacets, listSchoolQuestions, listTaskCatalogFacets, listTaskCatalogResources } from '../services/app-service'
import { clearTeacherSelectedResourceIds, getSession, getTeacherSelectedResourceIds, setTeacherCatalogInitialIds, setTeacherCatalogResultIds, setTeacherMediaInitialIds, takeTeacherCatalogInitialIds } from '../session/session'
import type { RecordingPromptFacet, RecordingPromptView } from '../../../domain/task-recording'
import { getRecordingPrompt, listRecordingPromptFacets, listRecordingPrompts } from '../services/task-recording-service'
import { catalogFacetOptions, catalogSource, mediaFacetOptions, questionFacetOptions,
  recordingFacetOptions, selectorFacetFields, type CatalogFacetOptions,
  type SelectorFacetSelection } from './catalog-facets'
import type { TeacherAssetFacet, TeacherAssetListItem } from '../../../domain/teacher-media'
import { listTeacherAssetFacets, listTeacherAssets, previewTeacherAsset } from '../services/teacher-media-service'
import { exercisePackTitle, exerciseQuestionPackKey } from '../shared/exercise-pack-title'

type CatalogType = 'listening' | 'reading' | 'recording' | 'video' | 'vocabulary' | 'exercise' | 'dubbing'
type CatalogRow = { id: string; title: string; type: CatalogType; source: string; detail: string;
  selected: boolean; questionIds?: string[] }
type SelectedRow = Omit<CatalogRow, 'selected'> & { invalid?: boolean; exercisePackId?: string }

const READING_CATEGORY_NAMES: Record<NonNullable<TaskCatalogFilters['category']>, string> = {
  original: '原版材料', synchronized: '同步课本', picture_book: '绘本阅读',
  current_events: '时文阅读', chapter_book: '英语章节阅读',
}
const PAGE_SIZE = 20
const EXERCISE_PAGE_SIZE = 50
type ReadingCategory = TaskCatalogFilters['category'] | ''
const READING_CATEGORIES: Array<{ value: ReadingCategory; label: string }> = [
  { value: '', label: '全部' }, { value: 'original', label: '原版材料' },
  { value: 'synchronized', label: '同步课本' }, { value: 'picture_book', label: '绘本阅读' },
  { value: 'current_events', label: '时文阅读' }, { value: 'chapter_book', label: '英语章节阅读' },
]
const TYPE_CHOICES: Array<{ value: CatalogType; label: string; locked: boolean; icon: string;
  tone: 'primary' | 'success' | 'warning' | 'ai' }> = [
  { value: 'listening', label: '听力', locked: false, icon: 'headphones', tone: 'primary' },
  { value: 'reading', label: '阅读', locked: false, icon: 'reading', tone: 'success' },
  { value: 'recording', label: '录音', locked: false, icon: 'microphone', tone: 'ai' },
  { value: 'video', label: '看视频', locked: false, icon: 'video', tone: 'success' },
  { value: 'vocabulary', label: '单词', locked: false, icon: 'vocabulary', tone: 'warning' },
  { value: 'exercise', label: '习题', locked: false, icon: 'exercise', tone: 'primary' },
  { value: 'dubbing', label: '视频配音', locked: false, icon: 'dubbing', tone: 'ai' },
]

function mediaRow(asset: TeacherAssetListItem): SelectedRow {
  return { id: asset.id, title: asset.title, type: asset.kind, source: '后台音视频资产库',
    detail: [asset.grade, asset.textbook, asset.unit,
      `${Math.ceil(asset.durationMs / 1000)} 秒`, asset.questionCount ? `${asset.questionCount} 题` : '无配套题']
      .filter(Boolean).join('　') }
}

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
  const packId = exerciseQuestionPackKey(question)
  return { id: question.id, title: question.title, type: 'exercise', source: '学校习题库',
    detail: [question.grade, question.textbook, question.unit, question.stemSummary].filter(Boolean).join('　'),
    ...(packId ? { exercisePackId: packId } : {}) }
}

export function groupedQuestionRows(questions: readonly SchoolQuestionSummary[]): SelectedRow[] {
  const packs = new Map<string, SchoolQuestionSummary[]>()
  for (const question of questions) {
    const key = exerciseQuestionPackKey(question) ?? question.id
    packs.set(key, [...(packs.get(key) ?? []), question])
  }
  return [...packs.entries()].map(([packId, members]) => {
    if (!exerciseQuestionPackKey(members[0]!)) return questionRow(members[0]!)
    const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id))
    const first = sorted[0]!
    const title = exercisePackTitle(first.title)
    return { id: `pack:${packId}`, title, type: 'exercise' as const, source: '学校习题库',
      detail: [first.grade, first.textbook, first.unit, `${sorted.length} 道相关题目`].filter(Boolean).join('　'),
      exercisePackId: packId, questionIds: sorted.map(item => item.id) }
  }).filter(row => !row.exercisePackId || (row.questionIds?.length ?? 0) >= 5)
}

export function matchingQuestionGroups(questions: readonly SchoolQuestionSummary[], filters: {
  keyword: string; knowledgePoint: string; questionType: SchoolQuestionType | ''; difficulty: string
}): SelectedRow[] {
  const keyword = filters.keyword.trim().toLocaleLowerCase()
  return groupedQuestionRows(questions).filter(row => {
    const members = questions.filter(question => row.questionIds?.includes(question.id) || row.id === question.id)
    return members.some(question => (!keyword || `${question.title} ${question.stemSummary} ${question.knowledgePoint ?? ''}`.toLocaleLowerCase().includes(keyword))
      && (!filters.knowledgePoint || question.knowledgePoint === filters.knowledgePoint)
      && (!filters.questionType || question.questionType === filters.questionType)
      && (!filters.difficulty || question.difficulty === filters.difficulty))
  })
}

function selectedDisplayRows(selected: readonly SelectedRow[]): Array<{ id: string; title: string; invalid?: boolean }> {
  const groups = new Map<string, SelectedRow[]>()
  for (const row of selected) {
    const key = row.exercisePackId ? `pack:${row.exercisePackId}` : row.id
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()].map(([id, rows]) => ({ id,
    title: rows[0]?.exercisePackId
      ? `${exercisePackTitle(rows[0]!.title)}（${rows.length} 题）`
      : rows[0]!.title,
    ...(rows.some(row => row.invalid) ? { invalid: true } : {}) }))
}

function recordingRow(prompt: RecordingPromptView): SelectedRow {
  return { id: prompt.id, title: prompt.title, type: 'recording', source: '文字录音提示',
    detail: [prompt.grade, prompt.unit, prompt.promptText].filter(Boolean).join('　') }
}

function visibleRows(rows: readonly SelectedRow[], selected: readonly SelectedRow[]): CatalogRow[] {
  const ids = new Set(selected.map(item => item.id))
  return rows.map(item => ({ id: item.id, title: item.title, type: item.type, source: item.source,
    detail: item.detail, ...(item.questionIds ? { questionIds: item.questionIds } : {}),
    selected: item.questionIds ? item.questionIds.every(id => ids.has(id)) : ids.has(item.id) }))
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
    mediaAssets: [] as TeacherAssetListItem[],
    rows: [] as CatalogRow[],
    selected: [] as SelectedRow[],
    selectedDisplay: [] as Array<{ id: string; title: string; invalid?: boolean }>,
    initialSelectedIds: [] as string[],
    keyword: '',
    source: '' as TaskCatalogFilters['source'] | '',
    grade: '',
    term: '',
    textbook: '',
    unit: '',
    difficulty: '',
    knowledgePoint: '',
    questionType: '' as SchoolQuestionType | '',
    questionTypeLabel: '',
    facets: [] as TaskCatalogFacet[],
    questionFacets: [] as SchoolQuestionFacet[],
    recordingFacets: [] as RecordingPromptFacet[],
    mediaFacets: [] as TeacherAssetFacet[],
    facetFields: selectorFacetFields('reading'),
    facetOptions: catalogFacetOptions([], {}) as CatalogFacetOptions,
    facetLoaded: false,
    facetError: '',
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
        else wx.reLaunch({ url: '/subpackages/teacher/publish-task/publish-task' })
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
        if (question.ok) { selected.push(questionRow(question.data)); continue }
        const media = await previewTeacherAsset(session.user.id, id, this.targetScope())
        if (media.ok) { selected.push(mediaRow(media.data)); continue }
        if (canRetry(media.error)) {
          setTeacherCatalogInitialIds(initialIds)
          this.setData({ loading: false, error: media.error.message }); return
        }
        selected.push({ id, title: id, type: 'exercise', source: '学校习题库',
          detail: '资源已下架或无权引用', invalid: true })
      }
      const activeType = selected[0]?.type ?? 'reading'
      this.setData({ selected, selectedDisplay: selectedDisplayRows(selected), initialSelectedIds: [...initialIds], activeType, loading: false, catalogLoaded: true }, () => this.loadFacetOptions())
    },
    retry() { if (!this.data.catalogLoaded) this.loadCatalog()
      else this.loadRows() },
    retryFacetOptions() { this.loadFacetOptions() },
    chooseType(event: WechatMiniprogram.TouchEvent) {
      const type = event.currentTarget.dataset.type as CatalogType
      if (!TYPE_CHOICES.some(item => item.value === type)) return
      this.setData({ activeType: type, readingCategory: '', keyword: '', source: '', grade: '', term: '', textbook: '', unit: '', difficulty: '',
        knowledgePoint: '', questionType: '', questionTypeLabel: '',
        facets: [], questionFacets: [], recordingFacets: [], mediaFacets: [],
        facetFields: selectorFacetFields(type), facetOptions: catalogFacetOptions([], {}), facetLoaded: false, facetError: '',
        facetQueryVersion: this.data.facetQueryVersion + 1,
        queryVersion: this.data.queryVersion + 1, loadingMore: false,
        questions: [], catalogResources: [], recordingPrompts: [], mediaAssets: [], rows: [], nextOffset: null }, () => this.loadFacetOptions())
    },
    chooseReadingCategory(event: WechatMiniprogram.TouchEvent) {
      if (this.data.activeType !== 'reading') return
      const readingCategory = event.currentTarget.dataset.value as ReadingCategory
      if (!READING_CATEGORIES.some(item => item.value === readingCategory) || readingCategory === this.data.readingCategory) return
      this.setData({ readingCategory, source: '', grade: '', term: '', textbook: '', unit: '', difficulty: '',
        knowledgePoint: '', questionType: '', questionTypeLabel: '',
        facets: [], facetOptions: catalogFacetOptions([], {}), facetLoaded: false, facetError: '', rows: [], nextOffset: null,
        queryVersion: this.data.queryVersion + 1 }, () => this.loadFacetOptions())
    },
    async loadFacetOptions() {
      const type = this.data.activeType
      const session = getSession()
      if (!session) return
      const facetQueryVersion = this.data.facetQueryVersion + 1
      this.setData({ facetQueryVersion, loading: true, facetLoaded: false, facetError: '' })
      const failed = (message: string) => this.setData({ loading: false, facetError: message,
        facetLoaded: false }, () => this.loadRows())
      if (type === 'reading' || type === 'vocabulary') {
        const result = await listTaskCatalogFacets(session.user.id, type, this.targetScope(),
          type === 'reading' ? this.data.readingCategory || undefined : undefined)
        if (facetQueryVersion !== this.data.facetQueryVersion) return
        if (!result.ok) { failed(result.error.message); return }
        this.setData({ facets: result.data, facetOptions: catalogFacetOptions(result.data, {}),
          facetLoaded: true, loading: false }, () => this.loadRows())
        return
      }
      if (type === 'exercise') {
        const result = await listSchoolQuestionFacets(session.user.id, this.targetScope())
        if (facetQueryVersion !== this.data.facetQueryVersion) return
        if (!result.ok) { failed(result.error.message); return }
        this.setData({ questionFacets: result.data, facetOptions: questionFacetOptions(result.data, {}),
          facetLoaded: true, loading: false }, () => this.loadRows())
        return
      }
      if (type === 'recording') {
        const result = await listRecordingPromptFacets(session.user.id, this.targetScope())
        if (facetQueryVersion !== this.data.facetQueryVersion) return
        if (!result.ok) { failed(result.error.message); return }
        this.setData({ recordingFacets: result.data, facetOptions: recordingFacetOptions(result.data, {}),
          facetLoaded: true, loading: false }, () => this.loadRows())
        return
      }
      const result = await listTeacherAssetFacets(session.user.id, type, this.targetScope())
      if (facetQueryVersion !== this.data.facetQueryVersion) return
      if (!result.ok) { failed(result.error.message); return }
      this.setData({ mediaFacets: result.data, facetOptions: mediaFacetOptions(result.data, {}),
        facetLoaded: true, loading: false }, () => this.loadRows())
    },
    currentFacetOptions(selected: SelectorFacetSelection): CatalogFacetOptions {
      const type = this.data.activeType
      if (type === 'reading' || type === 'vocabulary') return catalogFacetOptions(this.data.facets, selected)
      if (type === 'exercise') return questionFacetOptions(this.data.questionFacets, selected)
      if (type === 'recording') return recordingFacetOptions(this.data.recordingFacets, selected)
      return mediaFacetOptions(this.data.mediaFacets, selected)
    },
    chooseFacet(event: WechatMiniprogram.PickerChange) {
      const key = event.currentTarget.dataset.key as keyof typeof this.data.facetFields
      if (!this.data.facetFields[key]) return
      const optionKey = { source: 'sources', grade: 'grades', term: 'terms', textbook: 'textbooks',
        unit: 'units', difficulty: 'difficulties', knowledgePoint: 'knowledgePoints',
        questionType: 'questionTypes' } as const
      const options = this.data.facetOptions[optionKey[key]]
      const index = Number(event.detail.value)
      if (!Number.isInteger(index) || index < 0 || index >= options.length) return
      const value = options[index]!.value
      const changes: SelectorFacetSelection & { readingCategory?: ReadingCategory } = key === 'source'
        ? { source: catalogSource(value), readingCategory: '', grade: '', term: '', textbook: '',
          unit: '', difficulty: '', knowledgePoint: '', questionType: '' }
        : key === 'grade' ? { grade: value, term: '', textbook: '', unit: '',
          difficulty: '', knowledgePoint: '', questionType: '' }
          : key === 'term' ? { term: value, textbook: '', unit: '', difficulty: '' }
            : key === 'textbook' ? { textbook: value, unit: '', difficulty: '',
              knowledgePoint: '', questionType: '' }
              : key === 'unit' ? { unit: value, difficulty: '', knowledgePoint: '', questionType: '' }
                : key === 'knowledgePoint' ? { knowledgePoint: value, questionType: '', difficulty: '' }
                  : key === 'questionType' ? { questionType: value as SchoolQuestionType | '', difficulty: '' }
                    : { difficulty: value }
      const selected: SelectorFacetSelection = { source: this.data.source, grade: this.data.grade,
        term: this.data.term, textbook: this.data.textbook, unit: this.data.unit,
        difficulty: this.data.difficulty, knowledgePoint: this.data.knowledgePoint,
        questionType: this.data.questionType, ...changes }
      const refreshReadingFacets = key === 'source' && this.data.activeType === 'reading'
        && Boolean(this.data.readingCategory)
      this.setData({ ...changes, questionTypeLabel: selected.questionType
        ? this.data.facetOptions.questionTypes.find(item => item.value === selected.questionType)?.label ?? '' : '',
      facetOptions: this.currentFacetOptions(selected), rows: [], nextOffset: null },
      () => { if (refreshReadingFacets) this.loadFacetOptions(); else this.loadRows() })
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
        const session = getSession()
        if (!session) return
        this.setData({ queryVersion, loading: true, error: '', mediaAssets: [], rows: [], nextOffset: null })
        const result = await listTeacherAssets(session.user.id, { kind: type,
          ...(this.data.keyword.trim() ? { keyword: this.data.keyword.trim() } : {}),
          ...(this.data.grade.trim() ? { grade: this.data.grade.trim() } : {}),
          ...(this.data.textbook.trim() ? { textbook: this.data.textbook.trim() } : {}),
          ...(this.data.unit.trim() ? { unit: this.data.unit.trim() } : {}),
          ...(this.targetScope() ? { targetClassIds: this.data.targetClassIds } : {}),
        }, PAGE_SIZE, 0)
        if (queryVersion !== this.data.queryVersion) return
        if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
        this.setData({ loading: false, mediaAssets: result.data.items,
          rows: visibleRows(result.data.items.map(mediaRow), this.data.selected),
          nextOffset: result.data.nextOffset, emptyMessage: '当前没有满足发布条件的授权素材。' })
        return
      }
      if (type === 'recording') {
        const session = getSession()
        if (!session) return
        this.setData({ queryVersion, loading: true, error: '', recordingPrompts: [], rows: [], nextOffset: null })
        const result = await listRecordingPrompts(session.user.id, this.targetScope(),
          this.data.keyword.trim(), PAGE_SIZE, 0,
          { grade: this.data.grade || undefined, unit: this.data.unit || undefined })
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
        ...(this.data.grade ? { grade: this.data.grade } : {}),
        ...(this.data.textbook ? { textbook: this.data.textbook } : {}),
        ...(this.data.unit ? { unit: this.data.unit } : {}),
        ...(this.targetScope() ? { targetClassIds: this.data.targetClassIds } : {}),
      }, EXERCISE_PAGE_SIZE, 0)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, questions: result.data.items,
        rows: visibleRows(matchingQuestionGroups(result.data.items, this.data), this.data.selected),
        nextOffset: result.data.nextOffset, emptyMessage: '当前条件下暂无授权习题，可调整关键词或进入学校习题库筛选。' },
      () => { if (!this.data.rows.length && this.data.nextOffset !== null) this.loadMore() })
    },
    async loadMore() {
      const offset = this.data.nextOffset
      if (offset === null || this.data.loading || this.data.loadingMore) return
      const session = getSession()
      if (!session) return
      const queryVersion = this.data.queryVersion
      this.setData({ loadingMore: true, error: '' })
      if (this.data.activeType === 'listening' || this.data.activeType === 'video' || this.data.activeType === 'dubbing') {
        const result = await listTeacherAssets(session.user.id, { kind: this.data.activeType,
          ...(this.data.keyword.trim() ? { keyword: this.data.keyword.trim() } : {}),
          ...(this.data.grade.trim() ? { grade: this.data.grade.trim() } : {}),
          ...(this.data.textbook.trim() ? { textbook: this.data.textbook.trim() } : {}),
          ...(this.data.unit.trim() ? { unit: this.data.unit.trim() } : {}),
          ...(this.targetScope() ? { targetClassIds: this.data.targetClassIds } : {}),
        }, PAGE_SIZE, offset)
        if (queryVersion !== this.data.queryVersion) return
        if (!result.ok) { this.setData({ loadingMore: false, error: result.error.message }); return }
        const known = new Set(this.data.mediaAssets.map(item => item.id))
        const mediaAssets = [...this.data.mediaAssets, ...result.data.items.filter(item => !known.has(item.id))]
        this.setData({ loadingMore: false, mediaAssets,
          rows: visibleRows(mediaAssets.map(mediaRow), this.data.selected), nextOffset: result.data.nextOffset })
        return
      }
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
          this.data.keyword.trim(), PAGE_SIZE, offset,
          { grade: this.data.grade || undefined, unit: this.data.unit || undefined })
        if (queryVersion !== this.data.queryVersion) return
        if (!result.ok) { this.setData({ loadingMore: false, error: result.error.message }); return }
        const known = new Set(this.data.recordingPrompts.map(item => item.id))
        const recordingPrompts = [...this.data.recordingPrompts, ...result.data.items.filter(item => !known.has(item.id))]
        this.setData({ loadingMore: false, recordingPrompts,
          rows: visibleRows(recordingPrompts.map(recordingRow), this.data.selected), nextOffset: result.data.nextOffset })
        return
      }
      const result = await listSchoolQuestions(session.user.id, {
        ...(this.data.grade ? { grade: this.data.grade } : {}),
        ...(this.data.textbook ? { textbook: this.data.textbook } : {}),
        ...(this.data.unit ? { unit: this.data.unit } : {}),
        ...(this.targetScope() ? { targetClassIds: this.data.targetClassIds } : {}),
      }, EXERCISE_PAGE_SIZE, offset)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loadingMore: false, error: result.error.message }); return }
      const known = new Set(this.data.questions.map(item => item.id))
      const questions = [...this.data.questions, ...result.data.items.filter(item => !known.has(item.id))]
      this.setData({ loadingMore: false, questions,
        rows: visibleRows(matchingQuestionGroups(questions, this.data), this.data.selected),
        nextOffset: result.data.nextOffset },
      () => { if (!this.data.rows.length && this.data.nextOffset !== null) this.loadMore() })
    },
    toggleRow(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const row = this.data.rows.find(item => item.id === id)
      if (!row) return
      const questionIds = row.questionIds ?? [row.id]
      const selected = row.selected
        ? this.data.selected.filter(item => !questionIds.includes(item.id))
        : [...this.data.selected, ...questionIds.filter(questionId => !this.data.selected.some(item => item.id === questionId))
          .map(questionId => { const question = this.data.questions.find(item => item.id === questionId)
            return question ? questionRow(question) : { id: questionId, title: row.title, type: row.type,
              source: row.source, detail: row.detail } })]
      this.setData({ selected, selectedDisplay: selectedDisplayRows(selected),
        rows: visibleRows(this.data.rows, selected), error: '' })
    },
    removeSelected(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const selected = this.data.selected.filter(item => id.startsWith('pack:')
        ? item.exercisePackId !== id.slice(5) : item.id !== id)
      this.setData({ selected, selectedDisplay: selectedDisplayRows(selected),
        rows: visibleRows(this.data.rows, selected), error: '' })
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
      this.setData({ selected, selectedDisplay: selectedDisplayRows(selected),
        rows: visibleRows(this.data.rows, selected), error: '' })
    },
    openQuestionLibrary() {
      const scope = this.targetScope()
      wx.navigateTo({ url: '/subpackages/teacher/school-questions/school-questions?source=catalog'
        + (scope ? `&targetClassIds=${encodeURIComponent(scope.join(','))}` : '') })
    },
    openMediaLibrary() {
      const type = this.data.activeType
      if (type !== 'listening' && type !== 'video' && type !== 'dubbing') return
      setTeacherMediaInitialIds(this.data.selected.map(item => item.id))
      const scope = this.targetScope()
      wx.navigateTo({ url: `/subpackages/teacher/media-library/media-library?fromTask=1&kind=${type}`
        + (scope ? `&targetClassIds=${encodeURIComponent(scope.join(','))}` : '') })
    },
    async previewRow(event: WechatMiniprogram.TouchEvent) {
      const row = this.data.rows.find(item => item.id === event.currentTarget.dataset.id)
      const session = getSession()
      if (!row || !session || (session.activeRole ?? session.user.role) !== 'teacher') return
      const path = row.type === 'reading' ? '/subpackages/student/reading-detail/reading-detail'
        : row.type === 'vocabulary' ? '/subpackages/student/vocabulary/vocabulary'
          : row.type === 'dubbing' ? '/subpackages/student-media/dubbing/dubbing'
            : row.type === 'listening' ? '/subpackages/student-media/listening-task/listening-task'
              : row.type === 'video' ? '/subpackages/student-media/video-task/video-task'
                : row.type === 'exercise' ? '/subpackages/student/exercise-task/exercise-task'
                  : '/subpackages/student-media/recording-task/recording-task'
      const scope = this.targetScope()
      wx.navigateTo({ url: `${path}?teacherPreview=1&resourceId=${encodeURIComponent(row.questionIds?.[0] ?? row.id)}`
        + (row.questionIds ? `&resourceIds=${encodeURIComponent(row.questionIds.join(','))}` : '')
        + `&type=${encodeURIComponent(row.type)}`
        + (scope ? `&targetClassIds=${encodeURIComponent(scope.join(','))}` : '') })
    },
    async confirmSelection() {
      const session = getSession()
      if (!session || this.data.confirming) return
      if (!this.data.selected.length) { this.setData({ error: '请至少选择一项任务内容' }); return }
      const packs = new Map<string, number>()
      for (const row of this.data.selected) if (row.type === 'exercise' && row.exercisePackId) {
        packs.set(row.exercisePackId, (packs.get(row.exercisePackId) ?? 0) + 1)
      }
      if ([...packs.values()].some(count => count < 5)) {
        this.setData({ error: '习题请按完整题组选择，每组至少 5 道题' }); return
      }
      this.setData({ confirming: true, error: '' })
      for (const selected of this.data.selected) {
        if (selected.invalid) {
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
        } else if (selected.type === 'recording') {
          const prompt = await getRecordingPrompt(session.user.id, selected.id, this.targetScope())
          if (!prompt.ok) { this.setData({ confirming: false, error: canRetry(prompt.error)
            ? '录音提示验证暂时失败，已保留选择，请重试' : `${selected.title}已不可引用，请先移除` }); return }
        } else {
          const media = await previewTeacherAsset(session.user.id, selected.id, this.targetScope())
          if (!media.ok || media.data.kind !== selected.type) {
            this.setData({ confirming: false, error: !media.ok && canRetry(media.error)
              ? '媒体验证暂时失败，已保留选择，请重试' : `${selected.title}已不可引用，请先移除` }); return
          }
        }
      }
      setTeacherCatalogResultIds(this.data.selected.map(item => item.id))
      this.setData({ confirming: false })
      wx.navigateBack()
    },
  },
})
