import { PhonicsAnswerView, PhonicsCourseListItem, PhonicsCourseState, PhonicsCourseView } from '../../../domain/types'
import { getPhonicsAudio, getPhonicsCourse, getPhonicsState, listPhonicsCourses, submitPhonicsAnswer } from '../../../services/app-service'
import { getSession } from '../../../session/session'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'
import { applyPhonicsAnswer } from '../../../shared/phonics-progress'

type PhonicsMode = 'catalog' | 'lesson' | 'practice' | 'wrong'
let activeAudio: WechatMiniprogram.InnerAudioContext | null = null

Component({
  data: {
    loading: true,
    error: '',
    courses: [] as PhonicsCourseListItem[],
    visibleCourses: [] as PhonicsCourseListItem[],
    grades: ['全部'] as string[],
    gradeFilter: '全部',
    mode: 'catalog' as PhonicsMode,
    course: null as PhonicsCourseView | null,
    state: null as PhonicsCourseState | null,
    practiceRound: 1,
    currentQuestionIndex: 0,
    currentQuestion: null as PhonicsCourseView['questions'][number] | null,
    selectedOptionId: '',
    answerResult: null as PhonicsAnswerView | null,
    wrongQuestions: [] as PhonicsCourseView['questions'],
    submitting: false,
    answerError: '',
    answerIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    answerExpectedVersion: 0,
  },
  lifetimes: { attached() { this.loadCourses() }, detached() { activeAudio?.destroy(); activeAudio = null } },
  methods: {
    async loadCourses() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await listPhonicsCourses(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const grades = ['全部', ...new Set(result.data.map(item => item.grade))]
      this.setData({ loading: false, courses: result.data, grades,
        visibleCourses: this.data.gradeFilter === '全部' ? result.data
          : result.data.filter(item => item.grade === this.data.gradeFilter) })
    },
    chooseGrade(event: WechatMiniprogram.TouchEvent) {
      const gradeFilter = event.currentTarget.dataset.grade as string
      if (!this.data.grades.includes(gradeFilter)) return
      this.setData({ gradeFilter, visibleCourses: gradeFilter === '全部' ? this.data.courses
        : this.data.courses.filter(item => item.grade === gradeFilter) })
    },
    async openCourse(event: WechatMiniprogram.TouchEvent) {
      const courseId = event.currentTarget.dataset.id as string
      if (!this.data.courses.some(item => item.id === courseId)) return
      const session = getSession()
      if (!session) return
      this.setData({ loading: true, error: '' })
      const [courseResult, stateResult] = await Promise.all([
        getPhonicsCourse(session.user.id, courseId), getPhonicsState(session.user.id, courseId),
      ])
      if (!courseResult.ok) { this.setData({ loading: false, error: courseResult.error.message }); return }
      if (!stateResult.ok) { this.setData({ loading: false, error: stateResult.error.message }); return }
      if (courseResult.data.contentVersion !== stateResult.data.contentVersion) {
        this.setData({ loading: false, error: '课程内容已更新，请重新打开' }); return
      }
      const currentQuestionIndex = Math.max(0, courseResult.data.questions.findIndex(question =>
        stateResult.data.questions.find(item => item.questionId === question.id)?.firstCorrect === null))
      const course = { ...courseResult.data, phonemes: courseResult.data.phonemes.map(item => ({
        ...item, exampleLabel: item.examples.join('、') })) }
      this.setData({ loading: false, mode: 'lesson', course, state: stateResult.data,
        practiceRound: stateResult.data.currentRound,
        currentQuestionIndex, currentQuestion: courseResult.data.questions[currentQuestionIndex] ?? null,
        wrongQuestions: courseResult.data.questions.filter(question => stateResult.data.wrongQuestionIds.includes(question.id)),
        selectedOptionId: '', answerResult: null, answerError: '', answerIntent: clearWriteIntent() })
    },
    backToCourses() {
      if (this.data.submitting) return
      activeAudio?.destroy(); activeAudio = null
      this.setData({ mode: 'catalog', course: null, state: null, selectedOptionId: '', answerResult: null,
        answerError: '', answerIntent: clearWriteIntent() })
    },
    backToLesson() { if (this.data.course && !this.data.submitting) this.setData({ mode: 'lesson' }) },
    async playPhoneme(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const course = this.data.course
      const phonemeId = event.currentTarget.dataset.id as string
      if (!session || !course || !course.phonemes.some(item => item.id === phonemeId && item.audioAvailable)) return
      const result = await getPhonicsAudio(session.user.id, course.id, phonemeId)
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      activeAudio?.destroy()
      const audio = wx.createInnerAudioContext()
      activeAudio = audio
      audio.src = result.data.temporaryUrl
      audio.onEnded(() => { audio.destroy(); if (activeAudio === audio) activeAudio = null })
      audio.onError(() => { audio.destroy(); if (activeAudio === audio) activeAudio = null;
        wx.showToast({ title: '音频播放失败，请重试', icon: 'none' }) })
      audio.play()
    },
    startPractice() {
      const course = this.data.course
      const state = this.data.state
      if (!course || !state || this.data.submitting) return
      const practiceRound = state.score === null ? state.currentRound : state.currentRound + 1
      const currentQuestionIndex = state.score === null ? Math.max(0, course.questions.findIndex(question =>
        state.questions.find(item => item.questionId === question.id)?.firstCorrect === null)) : 0
      this.setData({ practiceRound }, () => this.showQuestion('practice', currentQuestionIndex))
    },
    openWrong() {
      if (!this.data.course || this.data.submitting) return
      this.setData({ mode: 'wrong', selectedOptionId: '', answerResult: null, answerError: '' })
    },
    practiceWrong(event: WechatMiniprogram.TouchEvent) {
      const course = this.data.course
      const questionId = event.currentTarget.dataset.id as string
      const index = course?.questions.findIndex(question => question.id === questionId) ?? -1
      if (index >= 0) this.setData({ practiceRound: this.data.state?.currentRound ?? 1 },
        () => this.showQuestion('practice', index))
    },
    showQuestion(mode: PhonicsMode, index: number) {
      if (this.data.submitting) return
      const question = this.data.course?.questions[index] ?? null
      this.setData({ mode, currentQuestionIndex: index, currentQuestion: question,
        selectedOptionId: '', answerResult: null, answerError: '', answerIntent: clearWriteIntent() })
    },
    chooseOption(event: WechatMiniprogram.TouchEvent) {
      if (this.data.submitting || this.data.answerResult) return
      this.setData({ selectedOptionId: event.currentTarget.dataset.id as string,
        answerError: '', answerIntent: clearWriteIntent() })
    },
    async submitAnswer() {
      const session = getSession()
      const course = this.data.course
      const question = this.data.currentQuestion
      if (!session || !course || !question || this.data.submitting || this.data.answerResult) return
      if (!this.data.selectedOptionId) { wx.showToast({ title: '请先选择答案', icon: 'none' }); return }
      const current = this.data.state?.questions.find(item => item.questionId === question.id)
      const fingerprint = JSON.stringify({ courseId: course.id, questionId: question.id,
        selectedOptionId: this.data.selectedOptionId, round: this.data.practiceRound })
      const retrying = this.data.answerIntent.operationId && this.data.answerIntent.fingerprint === fingerprint
      const expectedVersion = retrying ? this.data.answerExpectedVersion
        : this.data.practiceRound > (this.data.state?.currentRound ?? 1) ? 0 : current?.version ?? 0
      const answerIntent = prepareWriteIntent(this.data.answerIntent, fingerprint,
        () => createPageOperationId('phonics_answer'))
      this.setData({ submitting: true, answerError: '', answerIntent, answerExpectedVersion: expectedVersion })
      const result = await submitPhonicsAnswer(session.user.id, { courseId: course.id,
        questionId: question.id, selectedOptionId: this.data.selectedOptionId,
        round: this.data.practiceRound }, expectedVersion, answerIntent.operationId)
      if (!result.ok) {
        if (result.error.code === 'CONFLICT') {
          const refreshed = await getPhonicsState(session.user.id, course.id)
          if (refreshed.ok) this.setData({ state: refreshed.data,
            practiceRound: refreshed.data.currentRound,
            wrongQuestions: course.questions.filter(item => refreshed.data.wrongQuestionIds.includes(item.id)) })
          this.setData({ answerIntent: clearWriteIntent(), answerExpectedVersion: 0 })
        }
        this.setData({ submitting: false, answerError: result.error.message }); return
      }
      const refreshed = await getPhonicsState(session.user.id, course.id)
      const trustedLocal = this.data.state ? applyPhonicsAnswer(this.data.state, result.data) : null
      const nextState = refreshed.ok ? refreshed.data : trustedLocal
      this.setData({ submitting: false, answerResult: result.data, answerError: refreshed.ok ? '' : '作答已保存，进度暂未同步',
        ...(nextState ? { state: nextState, practiceRound: nextState.currentRound,
          wrongQuestions: course.questions.filter(item => nextState.wrongQuestionIds.includes(item.id)) } : {}),
        answerIntent: clearWriteIntent(), answerExpectedVersion: 0 })
    },
    nextQuestion() {
      const course = this.data.course
      const state = this.data.state
      if (!course || !state) return
      if (state.score !== null) { this.startPractice(); return }
      const unanswered = course.questions.findIndex(question =>
        state.questions.find(item => item.questionId === question.id)?.firstCorrect === null)
      const index = unanswered >= 0 ? unanswered : (this.data.currentQuestionIndex + 1) % course.questions.length
      this.showQuestion('practice', index)
    },
  },
})
