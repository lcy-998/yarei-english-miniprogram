import type { TaskDetailView, TaskItem } from '../../../domain/types'
import { getSchoolQuestion, getTaskDetail } from '../services/app-service'
import { teacherContentPreviewRoute } from '../shared/teacher-content-preview'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { getCurrentTaskId, getSession } from '../session/session'
import { exerciseTaskDraftKey, readExerciseTaskDraft, writeExerciseTaskDraft,
  type ExerciseTaskDraft } from '../shared/exercise-task-draft'
import { taskWriteAvailability } from '../shared/task-detail-view'
import { teacherReviewRoute, loadTeacherReviewItem, teacherExerciseView,
  teacherReviewManualScoreRequired, type TeacherReviewRoute } from '../shared/teacher-review-item'
import { teacherReviewScoreState } from '../shared/teacher-review-student-page'
import { getTeacherReviewScoreDraft, setTeacherReviewScoreDraft } from '../session/session'
import { parseReviewScoreInput } from '../shared/review-task-state'
import { exercisePackTitle, exercisePackTitleKey, exerciseQuestionPackKey } from '../shared/exercise-pack-title'
import { arrangeExerciseSections } from '../shared/exercise-section-view'
import { exerciseReviewGroupFor } from '../shared/exercise-review-groups'

type Question = NonNullable<TaskItem['exerciseQuestion']>
type Choice = { value: string; selected: boolean }
interface ExerciseCard {
  itemId: string
  number: number
  title: string
  question: Question | null
  typeLabel: string
  choiceQuestion: boolean
  choices: Choice[]
  response: string
  selectedOptions: string[]
  answeredQuestionCount: string
  answerLabel: string
  correctLabel: string
  verdict: string
  explanation: string
  highlighted: boolean
  rubricText: string
  teacherScoreRequired?: boolean
  teacherScoreInput?: string
  teacherScoreError?: string
  exerciseSection?: Question['exerciseSection']
  sectionStart: boolean
  sectionTitle: string
  sectionInstruction: string
  sectionMaterial: string
  localNumber: number
}

function emptyDraft(): ExerciseTaskDraft {
  return { response: '', selectedOptions: [], answeredQuestionCount: '' }
}

function submittedDraft(detail: TaskDetailView, item: TaskItem): ExerciseTaskDraft {
  if ((detail.assignment.status === 'redo_required' || detail.assignment.redoDueAt)
    && detail.submission?.status === 'returned') return emptyDraft()
  const value = detail.submission?.answers.find(answer => answer.taskItemId === item.id)?.structuredValue
  if (value?.kind !== 'exercise') return emptyDraft()
  const response = item.exerciseQuestion
    ? value.questionResponses?.find(answer => answer.questionId === item.exerciseQuestion?.questionId)?.response
    : undefined
  return { response: typeof response === 'string' ? response : '',
    selectedOptions: Array.isArray(response) ? [...response] : [],
    answeredQuestionCount: String(value.answeredQuestionCount) }
}

function choices(question: Question | null, draft: ExerciseTaskDraft): Choice[] {
  return question?.options.map(value => ({ value,
    selected: question.questionType === 'multiple_choice'
      ? draft.selectedOptions.includes(value) : draft.response === value })) ?? []
}

function questionTypeLabel(question: Question | null): string {
  if (!question) return '完成记录'
  return question.questionType === 'single_choice' ? '单选题'
    : question.questionType === 'multiple_choice' ? '多选题'
      : question.questionType === 'fill' ? '填空题' : '问答题'
}

function card(itemId: string, number: number, title: string, question: Question | null,
  draft: ExerciseTaskDraft, highlighted: boolean): ExerciseCard {
  return { itemId, number, title, question, typeLabel: questionTypeLabel(question),
    choiceQuestion: question?.questionType === 'single_choice' || question?.questionType === 'multiple_choice',
    choices: choices(question, draft), response: draft.response,
    selectedOptions: draft.selectedOptions, answeredQuestionCount: draft.answeredQuestionCount,
    answerLabel: '', correctLabel: '', verdict: '', explanation: '', highlighted, rubricText: '',
    ...(question?.exerciseSection === undefined ? {} : { exerciseSection: question.exerciseSection }),
    sectionStart: false, sectionTitle: '', sectionInstruction: '', sectionMaterial: '', localNumber: number }
}

Component({
  data: {
    loading: true, error: '', initialized: false, sessionId: '',
    detail: null as TaskDetailView | null,
    title: '', editable: false, unavailableReason: '',
    teacherPreview: false, teacherReview: false,
    teacherReviewRoute: null as TeacherReviewRoute | null,
    teacherReviewVersion: 0, teacherScoreRequired: false, groupedTeacherReview: false,
    teacherScoreInput: '', teacherScoreError: '',
    cards: [] as ExerciseCard[], answeredCount: 0, draftError: '', hasSections: false,
  },
  pageLifetimes: { show() { const session = getSession()
    if ((this.data.teacherPreview || this.data.teacherReview)
      && (session?.activeRole ?? session?.user.role) !== 'teacher') {
      this.setData({ loading: false, error: '教师预览权限已变化，请返回重新进入' }); return
    }
    if (!this.data.initialized || session?.sessionId !== this.data.sessionId) void this.load() } },
  methods: {
    async load() {
      const session = getSession()
      const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
      const options = pages[pages.length - 1]?.options ?? {}
      if (options.teacherReview === '1') {
        const route = teacherReviewRoute(options)
        if (!route) { this.setData({ loading: false, error: '缺少要查看的习题提交' }); return }
        this.setData({ loading: true, error: '', initialized: true,
          sessionId: session?.sessionId ?? '', teacherReview: true, teacherReviewRoute: route,
          editable: false })
        const result = await loadTeacherReviewItem(route, 'exercise')
        if (getSession()?.sessionId !== session?.sessionId) return
        if (!result.ok) { this.setData({ loading: false, error: result.message }); return }
        const orderedItems = [...(result.submission.taskItems ?? [result.item])]
          .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        const group = options.group === '1' ? exerciseReviewGroupFor(orderedItems, route.itemId) : null
        const groupedItems = group && group.itemIds.length > 1
          ? group.itemIds.flatMap(id => orderedItems.find(item => item.id === id) ?? []) : [result.item]
        const draft = getTeacherReviewScoreDraft()
        const savedInputs = draft?.submissionId === route.submissionId ? draft.inputs ?? {} : {}
        const cards = groupedItems.map((item, index) => {
          const evidence = result.submission.exerciseEvidence?.find(entry => entry.itemId === item.id) ?? null
          const view = teacherExerciseView(evidence)
          const question = evidence ? { questionId: evidence.questionId,
            questionType: evidence.questionType, stem: evidence.stem, options: evidence.options,
            ...(evidence.exerciseSection === undefined ? {} : { exerciseSection: evidence.exerciseSection }) } : null
          const reviewCard = card(item.id, index + 1, item.title, question, emptyDraft(), false)
          reviewCard.choices = view.choices.map(choice => ({ value: choice.value, selected: choice.selected }))
          reviewCard.response = view.answerLabel
          reviewCard.answerLabel = view.answerLabel
          reviewCard.correctLabel = view.correctLabel
          reviewCard.verdict = view.verdict
          reviewCard.explanation = evidence?.explanation ?? ''
          reviewCard.rubricText = evidence?.rubric?.map(row => `${row.criterion}（${row.points} 分）`).join('；') ?? ''
          const required = teacherReviewManualScoreRequired(result.submission, item)
          const parsed = parseReviewScoreInput(savedInputs[item.id]
            ?? (draft?.submissionId === route.submissionId && draft.itemId === item.id ? draft.input : ''))
          reviewCard.teacherScoreRequired = required
          reviewCard.teacherScoreInput = parsed.input
          reviewCard.teacherScoreError = parsed.error
          return reviewCard
        })
        const groupedTeacherReview = cards.length > 1
        const groupNeedsManualScore = groupedTeacherReview && groupedItems.some(item =>
          teacherReviewManualScoreRequired(result.submission, item))
        const score = teacherReviewScoreState(route, result.submission)
        this.setData({ loading: false, title: groupedTeacherReview ? group?.title ?? result.item.title : result.item.title,
          cards: arrangeExerciseSections(cards), hasSections: cards.length > 0
            && cards.every(row => row.question?.exerciseSection !== undefined),
          answeredCount: cards.filter(row => row.verdict !== '本次提交未记录逐题作答').length,
          unavailableReason: groupedTeacherReview
            ? groupNeedsManualScore
              ? '教师只读查看整份习题；请在主观题下方逐题评分。'
              : '教师只读查看整份习题。'
            : cards[0]?.question ? '教师只读查看当前提交' : '本次提交缺少逐题证据，无法还原原作答。',
          teacherReviewVersion: result.submission.submissionVersion,
          ...score, groupedTeacherReview,
          teacherScoreRequired: !groupedTeacherReview && teacherReviewManualScoreRequired(result.submission, result.item) })
        return
      }
      if (options.teacherPreview === '1') {
        const route = teacherContentPreviewRoute(options)
        if (!session || (session.activeRole ?? session.user.role) !== 'teacher'
          || !route || route.type !== 'exercise') {
          this.setData({ loading: false, error: '仅授权教师可预览习题' }); return
        }
        this.setData({ loading: true, error: '', initialized: true,
          sessionId: session.sessionId, teacherPreview: true, editable: false })
        const requestedIds = options.resourceIds
          ? decodeURIComponent(options.resourceIds).split(',').filter(Boolean) : [route.resourceId]
        if (!requestedIds.length || requestedIds.length > 50 || new Set(requestedIds).size !== requestedIds.length
          || requestedIds[0] !== route.resourceId) {
          this.setData({ loading: false, error: '习题题组不可用，请返回重试' }); return
        }
        const previews = await Promise.all(requestedIds.map(id => getSchoolQuestion(session.user.id, id, route.targetClassIds)))
        if (getSession()?.sessionId !== session.sessionId) return
        const failed = previews.find(result => !result.ok)
        if (failed && !failed.ok) { this.setData({ loading: false, error: failed.error.message }); return }
        const questions = previews.filter(result => result.ok).map(result => result.data)
        if (questions.length > 1 && questions.some(question =>
          !exerciseQuestionPackKey(question)
          || exerciseQuestionPackKey(question) !== exerciseQuestionPackKey(questions[0]!))) {
          this.setData({ loading: false, error: '习题题组不一致，请返回重试' }); return
        }
        this.setData({ loading: false, title: questions[0] ? exercisePackTitle(questions[0].title) : '',
          cards: arrangeExerciseSections(questions.map((preview, index) => card(preview.id, index + 1, preview.title,
            { questionId: preview.id, questionType: preview.questionType,
              ...(preview.exercisePackId === undefined ? {} : { exercisePackId: preview.exercisePackId }),
              stem: preview.stem, options: preview.options,
              ...(preview.exerciseSection === undefined ? {} : { exerciseSection: preview.exerciseSection }) },
            emptyDraft(), false))), hasSections: questions.length > 0
              && questions.every(preview => preview.exerciseSection !== undefined),
          answeredCount: 0, unavailableReason: '教师只读预览，不保存作答' })
        return
      }
      const taskId = options.taskId || getCurrentTaskId(), itemId = options.itemId || ''
      if (!session || (session.activeRole ?? session.user.role) !== 'student' || !taskId || !itemId) {
        this.setData({ loading: false, error: '学生任务信息不可用，请从任务详情重新进入' }); return
      }
      this.setData({ loading: true, error: '', initialized: true, sessionId: session.sessionId })
      const result = await getTaskDetail(session.user.id, taskId)
      if (getSession()?.sessionId !== session.sessionId) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const detail = result.data
      const selectedItem = detail.task.items.find(entry => entry.id === itemId)
      if (!selectedItem || selectedItem.type !== 'exercise') {
        this.setData({ loading: false, error: '习题任务内容不可用，请返回任务详情' }); return
      }
      const packTitle = exercisePackTitleKey(selectedItem.title)
      const selectedPackId = selectedItem.exerciseQuestion?.exercisePackId
      const exerciseItems = detail.task.items.filter(item => item.type === 'exercise'
        && (selectedPackId ? item.exerciseQuestion?.exercisePackId === selectedPackId
          : !packTitle || exercisePackTitleKey(item.title) === packTitle))
      if (getRepositoryMode() === 'cloudbase'
        && exerciseItems.some(item => item.resourceId && !item.exerciseQuestion)) {
        this.setData({ loading: false, error: '习题发布快照缺少题目，请联系老师处理' }); return
      }
      const availability = taskWriteAvailability(detail.task, detail.assignment,
        new Date().toISOString(), getRepositoryMode() === 'memory')
      const cards = exerciseItems.map((item, index) => {
        const key = exerciseTaskDraftKey(session.sessionId, taskId, detail.assignment.id,
          detail.assignment.redoCount, item.id)
        const prior = submittedDraft(detail, item)
        const draft = availability.editable ? readExerciseTaskDraft(key) ?? prior : prior
        return card(item.id, index + 1, item.title, item.exerciseQuestion ?? null,
          draft, item.id === itemId)
      })
      this.setData({ loading: false, detail, title: detail.task.title,
        editable: availability.editable, unavailableReason: availability.reason,
        cards: arrangeExerciseSections(cards), hasSections: cards.length > 0
          && cards.every(row => row.exerciseSection !== undefined),
        answeredCount: cards.filter(row => this.hasAnswer(row)).length, draftError: '' })
    },
    hasAnswer(row: ExerciseCard): boolean {
      return row.question?.questionType === 'multiple_choice'
        ? row.selectedOptions.length > 0 : row.question
          ? row.response.trim().length > 0 : Number(row.answeredQuestionCount) > 0
    },
    persist(itemId: string, draft: ExerciseTaskDraft) {
      const session = getSession(), detail = this.data.detail
      if (!session || !detail || !this.data.editable) return
      const key = exerciseTaskDraftKey(session.sessionId, detail.task.id, detail.assignment.id,
        detail.assignment.redoCount, itemId)
      this.setData({ draftError: writeExerciseTaskDraft(key, draft) ? '' : '本机保存失败，请保持当前页面并重试' })
    },
    updateCard(itemId: string, draft: ExerciseTaskDraft) {
      const cards = this.data.cards.map(row => row.itemId === itemId
        ? { ...row, ...draft, choices: choices(row.question, draft) } : row)
      this.setData({ cards, answeredCount: cards.filter(row => this.hasAnswer(row)).length })
      this.persist(itemId, draft)
    },
    chooseOption(event: WechatMiniprogram.TouchEvent) {
      const itemId = event.currentTarget.dataset.itemId as string
      const value = event.currentTarget.dataset.value as string
      const row = this.data.cards.find(card => card.itemId === itemId)
      if (!this.data.editable || !row?.question || !row.choiceQuestion
        || !row.question.options.includes(value)) return
      const selectedOptions = row.question.questionType === 'multiple_choice'
        ? row.selectedOptions.includes(value)
          ? row.selectedOptions.filter(option => option !== value)
          : [...row.selectedOptions, value] : []
      const response = row.question.questionType === 'multiple_choice' ? '' : value
      this.updateCard(itemId, { response, selectedOptions, answeredQuestionCount: '1' })
    },
    inputAnswer(event: WechatMiniprogram.Input) {
      const itemId = event.currentTarget.dataset.itemId as string
      const row = this.data.cards.find(card => card.itemId === itemId)
      if (!this.data.editable || !row?.question || row.choiceQuestion) return
      this.updateCard(itemId, { response: event.detail.value, selectedOptions: [], answeredQuestionCount: '1' })
    },
    inputCount(event: WechatMiniprogram.Input) {
      const itemId = event.currentTarget.dataset.itemId as string
      const row = this.data.cards.find(card => card.itemId === itemId)
      if (!this.data.editable || !row || row.question) return
      this.updateCard(itemId, { response: '', selectedOptions: [], answeredQuestionCount: event.detail.value })
    },
    onTeacherReviewScore(event: WechatMiniprogram.Input) {
      const route = this.data.teacherReviewRoute
      if (!this.data.teacherReview || !route) return
      const itemId = event.currentTarget?.dataset.itemId as string || route.itemId
      if (!this.data.cards.some(row => row.itemId === itemId && row.teacherScoreRequired)) return
      const parsed = parseReviewScoreInput(event.detail.value)
      const previous = getTeacherReviewScoreDraft()
      const inputs = previous?.submissionId === route.submissionId ? { ...previous.inputs } : {}
      inputs[itemId] = parsed.input
      setTeacherReviewScoreDraft({ submissionId: route.submissionId, itemId,
        input: parsed.input, inputs })
      this.setData({ cards: this.data.cards.map(row => row.itemId === itemId
        ? { ...row, teacherScoreInput: parsed.input, teacherScoreError: parsed.error } : row),
      ...(itemId === route.itemId ? { teacherScoreInput: parsed.input, teacherScoreError: parsed.error } : {}) })
    },
    returnToTask() { wx.navigateBack() },
  },
})
