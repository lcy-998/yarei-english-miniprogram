import type { SchoolQuestionDetail, SchoolQuestionFacet, SchoolQuestionFilters, SchoolQuestionSummary, SchoolQuestionType } from '../../../domain/types'
import { getSchoolQuestion, listSchoolQuestionFacets, listSchoolQuestions } from '../../../services/app-service'
import { getSession, setTeacherSelectedResourceIds } from '../../../session/session'
import { questionFacetOptions, questionTypeLabel } from './school-question-facets'
import { questionRows, toggleQuestionSelection, type SelectedQuestion } from './school-question-state'

const PAGE_SIZE = 20
type FacetChanges = Partial<{ grade: string; textbook: string; unit: string; knowledgePoint: string; questionType: SchoolQuestionType | ''; difficulty: string }>

Component({
  data: {
    initialized: false,
    loading: true,
    loadingMore: false,
    confirming: false,
    error: '',
    previewError: '',
    source: '',
    targetClassIds: [] as string[],
    keyword: '',
    grade: '',
    textbook: '',
    unit: '',
    knowledgePoint: '',
    difficulty: '',
    questionType: '' as SchoolQuestionFilters['questionType'] | '',
    facets: [] as SchoolQuestionFacet[],
    facetOptions: {
      grades: ['全部年级'], textbooks: ['全部教材'], units: ['全部单元'],
      knowledgePoints: ['全部知识点'], difficulties: ['全部难度'],
    },
    typeChoices: [{ value: '', label: '全部题型' }] as Array<{ value: SchoolQuestionType | ''; label: string }>,
    questionTypeLabel: '全部题型',
    questionTypeIndex: 0,
    rawQuestions: [] as SchoolQuestionSummary[],
    questions: [] as Array<SchoolQuestionSummary & { selected: boolean; typeLabel: string }>,
    selected: [] as SelectedQuestion[],
    nextOffset: null as number | null,
    preview: null as SchoolQuestionDetail | null,
    answerLabel: '',
    queryVersion: 0,
  },
  pageLifetimes: { show() {
    if (this.data.initialized) return
    const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
    const options = pages[pages.length - 1]?.options ?? {}
    const targetClassIds = options.targetClassIds ? decodeURIComponent(options.targetClassIds).split(',').filter(Boolean) : []
    this.setData({ initialized: true, source: options.source ?? '', targetClassIds }, () => this.loadFacets())
  } },
  methods: {
    onNavigateBack() {
      if (this.data.confirming) return
      if (this.data.preview || this.data.previewError) { this.closePreview(); return }
      const leave = () => {
        if (getCurrentPages().length > 1) wx.navigateBack()
        else wx.reLaunch({ url: '/pages/teacher/materials-home/materials-home' })
      }
      if (!this.data.selected.length) { leave(); return }
      wx.showModal({ title: '放弃已选题目？', content: '尚未确认引用，返回后本次选择将清空。', success: result => {
        if (result.confirm) leave()
      } })
    },
    noop() {},
    reload() { if (this.data.facets.length) this.loadQuestions(); else this.loadFacets() },
    async loadFacets() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'teacher') { this.setData({ loading: false, error: '仅授权教师可查看学校习题库' }); return }
      this.setData({ loading: true, error: '' })
      const result = await listSchoolQuestionFacets(session.user.id, this.data.targetClassIds.length ? this.data.targetClassIds : undefined)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ facets: result.data }, () => { this.updateFacetOptions({}, false); this.loadQuestions() })
    },
    updateFacetOptions(changes: FacetChanges, reload = true) {
      const current = this.data
      const selected: SchoolQuestionFilters = {
        ...(changes.grade === undefined ? (current.grade ? { grade: current.grade } : {}) : changes.grade ? { grade: changes.grade } : {}),
        ...(changes.textbook === undefined ? (current.textbook ? { textbook: current.textbook } : {}) : changes.textbook ? { textbook: changes.textbook } : {}),
        ...(changes.unit === undefined ? (current.unit ? { unit: current.unit } : {}) : changes.unit ? { unit: changes.unit } : {}),
        ...(changes.knowledgePoint === undefined ? (current.knowledgePoint ? { knowledgePoint: current.knowledgePoint } : {}) : changes.knowledgePoint ? { knowledgePoint: changes.knowledgePoint } : {}),
        ...(changes.questionType === undefined ? (current.questionType ? { questionType: current.questionType } : {}) : changes.questionType ? { questionType: changes.questionType } : {}),
        ...(changes.difficulty === undefined ? (current.difficulty ? { difficulty: current.difficulty } : {}) : changes.difficulty ? { difficulty: changes.difficulty } : {}),
      }
      const available = questionFacetOptions(this.data.facets, selected)
      const typeChoices = [{ value: '' as const, label: '全部题型' },
        ...available.questionTypes.map(value => ({ value, label: questionTypeLabel(value) }))]
      const selectedType = changes.questionType === undefined ? current.questionType : changes.questionType
      this.setData({ ...changes,
        facetOptions: {
          grades: ['全部年级', ...available.grades], textbooks: ['全部教材', ...available.textbooks],
          units: ['全部单元', ...available.units], knowledgePoints: ['全部知识点', ...available.knowledgePoints],
          difficulties: ['全部难度', ...available.difficulties],
        },
        typeChoices, questionTypeLabel: typeChoices.find(item => item.value === selectedType)?.label ?? '全部题型',
        questionTypeIndex: Math.max(0, typeChoices.findIndex(item => item.value === selectedType)),
      }, () => { if (reload) this.loadQuestions() })
    },
    filters(): SchoolQuestionFilters {
      const { keyword, grade, textbook, unit, knowledgePoint, difficulty, questionType } = this.data
      return {
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        ...(grade.trim() ? { grade: grade.trim() } : {}),
        ...(textbook.trim() ? { textbook: textbook.trim() } : {}),
        ...(unit.trim() ? { unit: unit.trim() } : {}),
        ...(knowledgePoint.trim() ? { knowledgePoint: knowledgePoint.trim() } : {}),
        ...(difficulty.trim() ? { difficulty: difficulty.trim() } : {}),
        ...(questionType ? { questionType } : {}),
        ...(this.data.targetClassIds.length ? { targetClassIds: this.data.targetClassIds } : {}),
      }
    },
    onFilterInput(event: WechatMiniprogram.Input) {
      if (event.currentTarget.dataset.key === 'keyword') this.setData({ keyword: event.detail.value })
    },
    chooseFacet(event: WechatMiniprogram.PickerChange) {
      const key = event.currentTarget.dataset.key as 'grade' | 'textbook' | 'unit' | 'knowledgePoint' | 'difficulty'
      const index = Number(event.detail.value)
      const choices = key === 'grade' ? this.data.facetOptions.grades
        : key === 'textbook' ? this.data.facetOptions.textbooks
          : key === 'unit' ? this.data.facetOptions.units
            : key === 'knowledgePoint' ? this.data.facetOptions.knowledgePoints : this.data.facetOptions.difficulties
      if (!Number.isInteger(index) || index < 0 || index >= choices.length) return
      const value = index === 0 ? '' : choices[index]!
      const changes = key === 'grade' ? { grade: value, textbook: '', unit: '', knowledgePoint: '', questionType: '' as const, difficulty: '' }
        : key === 'textbook' ? { textbook: value, unit: '', knowledgePoint: '', questionType: '' as const, difficulty: '' }
          : key === 'unit' ? { unit: value, knowledgePoint: '', questionType: '' as const, difficulty: '' }
            : key === 'knowledgePoint' ? { knowledgePoint: value, questionType: '' as const, difficulty: '' }
              : { difficulty: value }
      this.updateFacetOptions(changes)
    },
    chooseQuestionTypePicker(event: WechatMiniprogram.PickerChange) {
      const index = Number(event.detail.value)
      const choice = this.data.typeChoices[index]
      if (!choice) return
      this.updateFacetOptions({ questionType: choice.value, difficulty: '' })
    },
    async loadQuestions() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'teacher') { this.setData({ loading: false, error: '仅授权教师可查看学校习题库' }); return }
      const queryVersion = this.data.queryVersion + 1
      this.setData({ loading: true, loadingMore: false, error: '', queryVersion,
        rawQuestions: [], questions: [], nextOffset: null })
      const result = await listSchoolQuestions(session.user.id, this.filters(), PAGE_SIZE, 0)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, rawQuestions: result.data.items, questions: questionRows(result.data.items, this.data.selected), nextOffset: result.data.nextOffset })
    },
    async loadMore() {
      const session = getSession()
      const offset = this.data.nextOffset
      if (!session || offset === null || this.data.loading || this.data.loadingMore) return
      const queryVersion = this.data.queryVersion
      this.setData({ loadingMore: true, error: '' })
      const result = await listSchoolQuestions(session.user.id, this.filters(), PAGE_SIZE, offset)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loadingMore: false, error: result.error.message }); return }
      const known = new Set(this.data.rawQuestions.map(item => item.id))
      const rawQuestions = [...this.data.rawQuestions, ...result.data.items.filter(item => !known.has(item.id))]
      this.setData({ loadingMore: false, rawQuestions, questions: questionRows(rawQuestions, this.data.selected), nextOffset: result.data.nextOffset })
    },
    toggleQuestion(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const question = this.data.rawQuestions.find(item => item.id === id) ?? this.data.selected.find(item => item.id === id)
      if (!question) return
      const selected = toggleQuestionSelection(this.data.selected, question)
      this.setData({ selected, questions: questionRows(this.data.rawQuestions, selected), error: '' })
    },
    clearSelected() { this.setData({ selected: [], questions: questionRows(this.data.rawQuestions, []) }) },
    async previewQuestion(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const id = event.currentTarget.dataset.id as string
      if (!session || !id) return
      this.setData({ preview: null, previewError: '' })
      const result = await getSchoolQuestion(session.user.id, id, this.data.targetClassIds.length ? this.data.targetClassIds : undefined)
      if (!result.ok) { this.setData({ previewError: result.error.message }); return }
      const answer = result.data.correctAnswer
      const answerLabel = Array.isArray(answer) ? answer.map(item => String(item)).join('、') : String(answer ?? '')
      this.setData({ preview: result.data, answerLabel })
    },
    closePreview() { this.setData({ preview: null, previewError: '' }) },
    async confirmCitation() {
      const session = getSession()
      if (!session || this.data.confirming) return
      if (!this.data.selected.length) { wx.showToast({ title: '请先选择题目', icon: 'none' }); return }
      this.setData({ confirming: true, error: '' })
      for (const item of this.data.selected) {
        const result = await getSchoolQuestion(session.user.id, item.id, this.data.targetClassIds.length ? this.data.targetClassIds : undefined)
        if (!result.ok) {
          this.setData({ confirming: false, error: `${item.title}已不可引用：${result.error.message}` })
          return
        }
      }
      setTeacherSelectedResourceIds(this.data.selected.map(item => item.id))
      this.setData({ confirming: false })
      if (this.data.source === 'publish' || this.data.source === 'catalog') wx.navigateBack()
      else wx.navigateTo({ url: '/pages/teacher/publish-task/publish-task' })
    },
  },
})
