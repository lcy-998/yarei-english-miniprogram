import { StudentCatalogFacet, StudentCatalogItem, VocabularyAttemptState, VocabularyPack, VocabularyWord, VocabularyWordAttemptSummary } from '../../../domain/types'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { getPackAttemptSummary, getTaskDetail, getVocabularyPack, getVocabularyProgress, getWordAttemptState, listStudentCatalog, listStudentCatalogFacets, saveVocabularyProgress, submitWordAnswer } from '../../../services/app-service'
import { getSession } from '../../../session/session'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'
import { TeacherReviewRoute, loadTeacherReviewItem, teacherReviewRoute } from '../../../shared/teacher-review-item'
import type { TeacherReviewSubmissionView } from '../../../services/cloudbase-app-service'

type VocabularyMode = 'study' | 'practice' | 'wrong'
type TeacherWordEvidence = NonNullable<TeacherReviewSubmissionView['vocabularyEvidence']>[number]

let vocabularyOperationSequence = 0
let vocabularySaveTail: Promise<void> = Promise.resolve()
let packCatalogRequest = 0
let packSearchTimer: ReturnType<typeof setTimeout> | null = null

Component({
  data: {
    loading: true,
    error: '',
    pack: null as VocabularyPack | null,
    visiblePacks: [] as StudentCatalogItem[],
    packFacets: [] as StudentCatalogFacet[],
    packTotal: 0,
    packNextOffset: null as number | null,
    packCatalogLoading: false,
    packCatalogError: '',
    packFilterOptions: { grades: [] as string[], textbooks: [] as string[], units: [] as string[] },
    gradeFilter: '全部年级',
    textbookFilter: '全部教材',
    unitFilter: '全部单元',
    packKeyword: '',
    packFilterOpen: '',
    taskPackId: '',
    taskId: '',
    taskItemId: '',
    teacherReviewMode: false,
    teacherReviewRoute: null as TeacherReviewRoute | null,
    teacherEvidence: [] as TeacherWordEvidence[],
    teacherCurrentEvidence: null as TeacherWordEvidence | null,
    teacherSubmissionVersion: 0,
    trustedMode: false,
    attemptSummaries: {} as Record<string, VocabularyWordAttemptSummary>,
    answerSubmitting: false,
    answerError: '',
    answerIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    answerExpectedVersion: 0,
    selectedPackId: '',
    packSelectOpen: false,
    mode: 'practice' as VocabularyMode,
    wordIndex: 0,
    selectedMeaning: '',
    spellingAnswer: '',
    questionType: 'meaning' as 'meaning' | 'spelling',
    choiceOptions: [] as string[],
    answered: false,
    answerCorrect: false,
    completedCount: 0,
    correctCount: 0,
    correctRate: 0,
    progressVersion: 0,
    progressEpoch: 0,
    wrongWords: [] as VocabularyWord[],
    reviewingWrongId: '',
    syllableLabel: '',
    userId: '',
    initialized: false,
  },
  pageLifetimes: { show() {
    if (this.data.initialized) return
    const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
    const options = pages[pages.length - 1]?.options
    if (options?.teacherReview === '1') {
      const route = teacherReviewRoute(options)
      this.setData({ initialized: true, teacherReviewMode: true, teacherReviewRoute: route }, () => this.loadPack())
      return
    }
    const taskPackId = options?.packId ?? ''
    const taskId = options?.taskId ?? ''
    const taskItemId = options?.itemId ?? ''
    this.setData({ initialized: true, taskPackId, taskId, taskItemId,
      trustedMode: getRepositoryMode() === 'cloudbase' }, () => this.loadPack(taskPackId))
  } },
  lifetimes: { detached() { if (packSearchTimer) clearTimeout(packSearchTimer); packCatalogRequest += 1 } },
  methods: {
    async loadPack(packId = '') {
      if (this.data.teacherReviewMode) { await this.loadTeacherReview(); return }
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      let pack: VocabularyPack | null = null
      let trustedMode = this.data.trustedMode
      if (this.data.trustedMode && this.data.taskId && this.data.taskItemId) {
        const detail = await getTaskDetail(session.user.id, this.data.taskId)
        if (!detail.ok) { this.setData({ loading: false, error: detail.error.message }); return }
        const taskItem = detail.data.task.items.find(item => item.id === this.data.taskItemId)
        if (!taskItem) { this.setData({ loading: false, error: '任务词包不可用或没有访问权限' }); return }
        if (taskItem?.snapshotSchemaVersion === 2) {
          const snapshot = taskItem.vocabularyPack
          if (!snapshot || snapshot.id !== this.data.taskPackId) {
            this.setData({ loading: false, error: '任务词包快照不可用，请返回任务详情重试' }); return
          }
          pack = snapshot
        } else {
          trustedMode = false
          this.setData({ trustedMode: false })
        }
      }
      const rememberedPackId = wx.getStorageSync(`vocabulary_recent_pack_${session.user.id}`) as string
      const requestedPackId = typeof packId === 'string' && packId ? packId : this.data.taskPackId || this.data.selectedPackId || rememberedPackId
      if (pack === null) {
        const selectedFromVisiblePage = !this.data.taskPackId && typeof packId === 'string' && packId.length > 0
          && this.data.visiblePacks.some(item => item.id === packId)
        if (!this.data.taskPackId && !selectedFromVisiblePage) {
          const facets = await listStudentCatalogFacets(session.user.id, 'vocabulary')
          if (!facets.ok) { this.setData({ loading: false, error: facets.error.message }); return }
          const filters = { grade: this.data.gradeFilter, textbook: this.data.textbookFilter, unit: this.data.unitFilter, keyword: this.data.packKeyword }
          this.setData({ packFacets: facets.data, packFilterOptions: catalogVocabularyOptions(facets.data, filters) })
          const catalog = await this.refreshPackCatalog()
          if (!catalog) { this.setData({ loading: false, error: this.data.packCatalogError }); return }
        }
        const firstId = this.data.visiblePacks[0]?.id ?? ''
        const targetId = requestedPackId || firstId
        const detail = targetId ? await getVocabularyPack(session.user.id, targetId) : null
        if (detail?.ok) pack = detail.data
        else if (this.data.taskPackId) { this.setData({ loading: false, error: '任务词包不可用或没有访问权限' }); return }
        else if (firstId && firstId !== targetId) {
          const fallback = await getVocabularyPack(session.user.id, firstId)
          if (!fallback.ok) { this.setData({ loading: false, error: fallback.error.message }); return }
          pack = fallback.data
        } else if (detail && !detail.ok) {
          if (this.data.pack && !this.data.taskPackId) {
            this.setData({ loading: false, error: '', packSelectOpen: true, packCatalogError: '该词包已不可用，请重新选择' })
          } else this.setData({ loading: false, error: detail.error.message })
          return
        }
      }
      if (pack && pack.words.length === 0) { this.setData({ loading: false, error: '词包内容暂不可用' }); return }
      if (trustedMode) {
        const summary = pack ? await getPackAttemptSummary(session.user.id, { packId: pack.id,
          ...(this.data.taskId && this.data.taskItemId ? { taskId: this.data.taskId, itemId: this.data.taskItemId } : {}) }) : null
        if (summary && !summary.ok) { this.setData({ loading: false, error: summary.error.message }); return }
        if (pack && summary?.ok && (summary.data.packId !== pack.id || summary.data.contentVersion !== pack.contentVersion
          || summary.data.words.length !== pack.words.length
          || !pack.words.every(word => summary.data.words.some(entry => entry.wordId === word.id)))) {
          this.setData({ loading: false, error: '词包内容已更新，请重新打开后练习' }); return
        }
        const attemptSummaries = Object.fromEntries(summary?.ok ? summary.data.words.map(word => [word.wordId, word] as const) : [])
        const progress = trustedProgress(pack, attemptSummaries)
        const wordIndex = pack ? firstUnattemptedIndex(pack, attemptSummaries) : 0
        this.setData({ loading: false, pack, selectedPackId: pack?.id ?? '', packSelectOpen: false,
          userId: session.user.id, attemptSummaries, wordIndex, ...progress,
          syllableLabel: pack?.words[wordIndex]?.syllables.join('-') ?? '', questionType: 'spelling',
          choiceOptions: [], selectedMeaning: '', spellingAnswer: '', answered: false, answerCorrect: false,
          answerError: '', answerIntent: clearWriteIntent(), answerExpectedVersion: 0 })
        return
      }
      const saved = pack ? wx.getStorageSync(`vocabulary_progress_${session.user.id}_${pack.id}`) as { completedCount?: number; correctCount?: number; wrongWordIds?: string[]; version?: number; pending?: boolean } : null
      const remote = pack ? await getVocabularyProgress(session.user.id, pack.id) : null
      const useLocal = Boolean(saved?.pending) || remote === null || !remote.ok || remote.data === null
      const completedCount = useLocal ? (saved?.completedCount ?? 0) : (remote?.ok && remote.data ? remote.data.completedCount : 0)
      const correctCount = useLocal ? (saved?.correctCount ?? 0) : (remote?.ok && remote.data ? remote.data.correctCount : 0)
      const wrongWordIds = useLocal ? (saved?.wrongWordIds ?? []) : (remote?.ok && remote.data ? remote.data.wrongWordIds : [])
      const progressVersion = remote?.ok && remote.data ? remote.data.version : (saved?.version ?? 0)
      const wrongWords = pack?.words.filter(word => wrongWordIds.includes(word.id)) ?? []
      const correctRate = completedCount === 0 ? 0 : Math.round(correctCount * 100 / completedCount)
      const wordIndex = pack && completedCount < pack.words.length ? completedCount : 0
      this.setData({ loading: false, pack, selectedPackId: pack?.id ?? '', packSelectOpen: false, userId: session.user.id, wordIndex,
        completedCount, correctCount, correctRate, progressVersion, wrongWords,
        syllableLabel: pack?.words[wordIndex]?.syllables.join('-') ?? '', questionType: wordIndex % 2 === 0 ? 'meaning' : 'spelling',
        choiceOptions: pack ? meaningOptions(pack, wordIndex) : [], selectedMeaning: '', spellingAnswer: '', answered: false })
      if (pack && saved?.pending) this.queueProgressSave(pack, completedCount, correctCount, wrongWords)
    },
    async loadTeacherReview() {
      const route = this.data.teacherReviewRoute
      if (!route) { this.setData({ loading: false, error: '缺少要查看的作业记录。' }); return }
      this.setData({ loading: true, error: '' })
      const result = await loadTeacherReviewItem(route, 'vocabulary')
      if (!result.ok) { this.setData({ loading: false, error: result.message }); return }
      const evidence = result.submission.vocabularyEvidence?.filter(entry => entry.itemId === route.itemId) ?? []
      if (!evidence.length) { this.setData({ loading: false, error: '本次提交缺少可逐词查看的原作答。' }); return }
      const words: VocabularyWord[] = evidence.map(entry => ({ id: entry.wordId, word: entry.targetWord,
        meaning: entry.meaning ?? '', example: entry.example ?? '', syllables: entry.syllables ?? [] }))
      const pack: VocabularyPack = { id: route.itemId, title: result.item.title, grade: '', unit: '',
        contentVersion: `submission-${result.submission.submissionVersion}`, words }
      const completedCount = evidence.filter(entry => entry.firstCorrect !== null).length
      const correctCount = evidence.filter(entry => entry.firstCorrect === true).length
      const correctRate = completedCount ? Math.round(correctCount * 100 / completedCount) : 0
      this.setData({ loading: false, pack, teacherEvidence: evidence,
        teacherSubmissionVersion: result.submission.submissionVersion, selectedPackId: pack.id,
        completedCount, correctCount, correctRate, wordIndex: 0, mode: 'practice',
        trustedMode: true, questionType: 'spelling', packSelectOpen: false }, () => this.showTeacherWord(0))
    },
    showTeacherWord(wordIndex: number) {
      const word = this.data.pack?.words[wordIndex]
      const evidence = this.data.teacherEvidence[wordIndex]
      if (!word || !evidence) return
      this.setData({ wordIndex, teacherCurrentEvidence: evidence,
        spellingAnswer: evidence.attempts[0]?.studentInput ?? '',
        answered: evidence.attempts.length > 0, answerCorrect: evidence.firstCorrect === true,
        syllableLabel: word.syllables.join('-'), selectedMeaning: '', answerError: '' })
    },
    previousTeacherWord() { if (this.data.teacherReviewMode) this.showTeacherWord(this.data.wordIndex - 1) },
    selectMode(event: WechatMiniprogram.TouchEvent) {
      if (this.data.teacherReviewMode) return
      if (this.data.answerSubmitting) return
      const mode = event.currentTarget.dataset.mode as VocabularyMode
      const pack = this.data.pack
      const wordIndex = mode === 'practice' && pack && this.data.completedCount < pack.words.length
        ? this.data.trustedMode ? firstUnattemptedIndex(pack, this.data.attemptSummaries) : this.data.completedCount : this.data.wordIndex
      this.setData({ mode, wordIndex, selectedMeaning: '', spellingAnswer: '', answered: false, reviewingWrongId: '', answerError: '', answerIntent: clearWriteIntent(),
        syllableLabel: pack?.words[wordIndex]?.syllables.join('-') ?? '', questionType: this.data.trustedMode ? 'spelling' : wordIndex % 2 === 0 ? 'meaning' : 'spelling',
        choiceOptions: pack ? meaningOptions(pack, wordIndex) : [] })
    },
    togglePackSelect() { if (!this.data.teacherReviewMode && !this.data.answerSubmitting) this.setData({ packSelectOpen: !this.data.packSelectOpen }) },
    onPackSearch(event: WechatMiniprogram.Input) {
      this.setData({ packKeyword: event.detail.value })
      if (packSearchTimer) clearTimeout(packSearchTimer)
      packSearchTimer = setTimeout(() => { void this.refreshPackCatalog() }, 250)
    },
    togglePackFilter(event: WechatMiniprogram.TouchEvent) {
      const key = event.currentTarget.dataset.key as string
      this.setData({ packFilterOpen: this.data.packFilterOpen === key ? '' : key })
    },
    choosePackFilter(event: WechatMiniprogram.TouchEvent) {
      const key = event.currentTarget.dataset.key as 'grade' | 'textbook' | 'unit'
      const value = event.currentTarget.dataset.value as string
      const filters = {
        grade: key === 'grade' ? value : this.data.gradeFilter,
        textbook: key === 'grade' ? '全部教材' : key === 'textbook' ? value : this.data.textbookFilter,
        unit: key === 'grade' || key === 'textbook' ? '全部单元' : value,
        keyword: this.data.packKeyword,
      }
      this.setData({ gradeFilter: filters.grade, textbookFilter: filters.textbook, unitFilter: filters.unit,
        packFilterOpen: '', packFilterOptions: catalogVocabularyOptions(this.data.packFacets, filters) }, () => { void this.refreshPackCatalog() })
    },
    clearPackFilters() {
      const filters = { grade: '全部年级', textbook: '全部教材', unit: '全部单元', keyword: '' }
      this.setData({ gradeFilter: filters.grade, textbookFilter: filters.textbook, unitFilter: filters.unit,
        packKeyword: '', packFilterOpen: '', packFilterOptions: catalogVocabularyOptions(this.data.packFacets, filters) }, () => { void this.refreshPackCatalog() })
    },
    async selectPack(event: WechatMiniprogram.TouchEvent) {
      if (this.data.taskPackId || this.data.answerSubmitting) return
      const packId = event.currentTarget.dataset.id as string
      if (!this.data.visiblePacks.some(pack => pack.id === packId)) return
      await vocabularySaveTail.catch(() => undefined)
      await this.loadPack(packId)
      if (this.data.pack?.id === packId) wx.setStorageSync(`vocabulary_recent_pack_${this.data.userId}`, packId)
    },
    async refreshPackCatalog(offset = 0): Promise<boolean> {
      const session = getSession()
      if (!session || this.data.taskPackId) return false
      const request = ++packCatalogRequest
      this.setData({ packCatalogLoading: true, packCatalogError: '' })
      const filters = { type: 'vocabulary' as const,
        ...(this.data.gradeFilter === '全部年级' ? {} : { grade: this.data.gradeFilter }),
        ...(this.data.textbookFilter === '全部教材' ? {} : { textbook: this.data.textbookFilter === '未标注教材' ? '__unlabeled_textbook__' : this.data.textbookFilter }),
        ...(this.data.unitFilter === '全部单元' ? {} : { unit: this.data.unitFilter }),
        ...(this.data.packKeyword.trim() ? { keyword: this.data.packKeyword.trim() } : {}) }
      const result = await listStudentCatalog(session.user.id, filters, 20, offset)
      if (request !== packCatalogRequest) return false
      if (!result.ok) { this.setData({ packCatalogLoading: false, packCatalogError: result.error.message }); return false }
      this.setData({ packCatalogLoading: false, visiblePacks: offset === 0 ? result.data.items : [...this.data.visiblePacks, ...result.data.items],
        packTotal: result.data.total, packNextOffset: result.data.nextOffset })
      return true
    },
    loadMorePacks() { if (!this.data.packCatalogLoading && this.data.packNextOffset !== null) void this.refreshPackCatalog(this.data.packNextOffset) },
    onSpelling(event: WechatMiniprogram.Input) { if (!this.data.teacherReviewMode && !this.data.answered && !this.data.answerSubmitting) this.setData({ spellingAnswer: event.detail.value, answerError: '', answerIntent: clearWriteIntent() }) },
    chooseMeaning(event: WechatMiniprogram.TouchEvent) {
      if (this.data.teacherReviewMode) return
      if (this.data.answered) return
      this.setData({ selectedMeaning: event.currentTarget.dataset.meaning as string })
    },
    async submitAnswer() {
      if (this.data.teacherReviewMode) return
      if (this.data.answerSubmitting || this.data.answered) return
      if (this.data.trustedMode) { await this.submitTrustedAnswer(); return }
      const pack = this.data.pack
      const word = pack?.words[this.data.wordIndex]
      const answeredValue = this.data.questionType === 'meaning' ? this.data.selectedMeaning : this.data.spellingAnswer.trim()
      if (!word || !answeredValue) { wx.showToast({ title: '请先作答', icon: 'none' }); return }
      const answerCorrect = this.data.questionType === 'meaning' ? answeredValue === word.meaning : answeredValue.toLowerCase() === word.word.toLowerCase()
      const wrongWords = answerCorrect && this.data.reviewingWrongId === word.id
        ? this.data.wrongWords.filter(item => item.id !== word.id)
        : answerCorrect || this.data.wrongWords.some(item => item.id === word.id)
          ? this.data.wrongWords
          : [...this.data.wrongWords, word]
      const isFirstAttempt = !this.data.reviewingWrongId && this.data.wordIndex === this.data.completedCount
      const completedCount = isFirstAttempt ? Math.min(pack!.words.length, this.data.completedCount + 1) : this.data.completedCount
      const correctCount = this.data.correctCount + (answerCorrect && isFirstAttempt ? 1 : 0)
      const correctRate = completedCount === 0 ? 0 : Math.round(correctCount * 100 / completedCount)
      this.setData({ answered: true, answerCorrect, wrongWords, completedCount, correctCount, correctRate })
      const cached = { completedCount, correctCount, wrongWordIds: wrongWords.map(item => item.id), version: this.data.progressVersion, pending: true }
      wx.setStorageSync(`vocabulary_progress_${this.data.userId}_${pack.id}`, cached)
      this.queueProgressSave(pack, completedCount, correctCount, wrongWords)
    },
    async submitTrustedAnswer() {
      if (this.data.teacherReviewMode) return
      const pack = this.data.pack
      const word = pack?.words[this.data.wordIndex]
      const studentInput = this.data.spellingAnswer.trim()
      if (!pack || !word || !studentInput) { wx.showToast({ title: '请先作答', icon: 'none' }); return }
      const scope = { packId: pack.id, wordId: word.id,
        ...(this.data.taskId && this.data.taskItemId ? { taskId: this.data.taskId, itemId: this.data.taskItemId } : {}) }
      const fingerprint = JSON.stringify({ ...scope, studentInput })
      let state = this.data.attemptSummaries[word.id]
      const retrying = this.data.answerIntent.operationId && this.data.answerIntent.fingerprint === fingerprint
      this.setData({ answerSubmitting: true, answerError: '' })
      if (!retrying && !state) {
        const loaded = await getWordAttemptState(this.data.userId, scope)
        if (!loaded.ok) { this.setData({ answerSubmitting: false, answerError: loaded.error.message }); return }
        state = summaryFromState(loaded.data)
      }
      const expectedVersion = retrying ? this.data.answerExpectedVersion : state?.version ?? 0
      const answerIntent = prepareWriteIntent(this.data.answerIntent, fingerprint, () => createPageOperationId('word_answer'))
      this.setData({ answerIntent, answerExpectedVersion: expectedVersion })
      const result = await submitWordAnswer(this.data.userId, { ...scope, studentInput }, expectedVersion, answerIntent.operationId)
      if (!result.ok) {
        if (result.error.code === 'CONFLICT') {
          const refreshed = await getWordAttemptState(this.data.userId, scope)
          const attemptSummaries = refreshed.ok ? { ...this.data.attemptSummaries, [word.id]: summaryFromState(refreshed.data) } : this.data.attemptSummaries
          this.setData({ attemptSummaries, ...trustedProgress(pack, attemptSummaries),
            answerIntent: clearWriteIntent(), answerExpectedVersion: 0 })
        }
        this.setData({ answerSubmitting: false, answerError: result.error.message })
        return
      }
      const attempt = result.data
      const previous = this.data.attemptSummaries[word.id] ?? state
      const nextSummary: VocabularyWordAttemptSummary = { wordId: word.id, version: attempt.attemptNumber,
        firstCorrect: previous?.firstCorrect ?? attempt.isCorrect, lastCorrect: attempt.isCorrect }
      const attemptSummaries = { ...this.data.attemptSummaries, [word.id]: nextSummary }
      this.setData({ answerSubmitting: false, answered: true, answerCorrect: attempt.isCorrect,
        attemptSummaries, ...trustedProgress(pack, attemptSummaries),
        answerError: '', answerIntent: clearWriteIntent(), answerExpectedVersion: 0 })
    },
    nextWord() {
      if (this.data.teacherReviewMode) { this.showTeacherWord(this.data.wordIndex + 1); return }
      if (this.data.answerSubmitting) return
      const pack = this.data.pack
      if (!pack) return
      const wordIndex = this.data.mode === 'practice' && this.data.completedCount < pack.words.length
        ? this.data.trustedMode ? firstUnattemptedIndex(pack, this.data.attemptSummaries) : this.data.completedCount
        : (this.data.wordIndex + 1) % pack.words.length
      this.setData({ wordIndex, selectedMeaning: '', spellingAnswer: '', answered: false, answerCorrect: false, reviewingWrongId: '', syllableLabel: pack.words[wordIndex]?.syllables.join('-') ?? '',
        answerError: '', answerIntent: clearWriteIntent(), questionType: this.data.trustedMode ? 'spelling' : wordIndex % 2 === 0 ? 'meaning' : 'spelling', choiceOptions: meaningOptions(pack, wordIndex) })
    },
    practiceWrong(event: WechatMiniprogram.TouchEvent) {
      if (this.data.teacherReviewMode) return
      if (this.data.answerSubmitting) return
      const pack = this.data.pack
      const wordId = event.currentTarget.dataset.id as string
      const wordIndex = pack?.words.findIndex(item => item.id === wordId) ?? -1
      if (!pack || wordIndex < 0) return
      this.setData({ mode: 'practice', wordIndex, reviewingWrongId: wordId, selectedMeaning: '', spellingAnswer: '', answered: false, answerCorrect: false,
        answerError: '', answerIntent: clearWriteIntent(), syllableLabel: pack.words[wordIndex]?.syllables.join('-') ?? '', questionType: this.data.trustedMode ? 'spelling' : wordIndex % 2 === 0 ? 'meaning' : 'spelling', choiceOptions: meaningOptions(pack, wordIndex) })
    },
    queueProgressSave(pack: VocabularyPack, completedCount: number, correctCount: number, wrongWords: VocabularyWord[]) {
      const queuedEpoch = this.data.progressEpoch
      vocabularySaveTail = vocabularySaveTail.catch(() => undefined).then(async () => {
        if (queuedEpoch !== this.data.progressEpoch) return
        const command = {
          operationId: `vocabulary_${Date.now()}_${++vocabularyOperationSequence}`,
          expectedVersion: this.data.progressVersion,
          packId: pack.id,
          completedCount,
          correctCount,
          wrongWordIds: wrongWords.map(item => item.id),
        }
        const result = await saveVocabularyProgress(this.data.userId, command)
        if (!result.ok && result.error.code === 'CONFLICT') {
          const refreshed = await getVocabularyProgress(this.data.userId, pack.id)
          const storageKey = `vocabulary_progress_${this.data.userId}_${pack.id}`
          const nextEpoch = this.data.progressEpoch + 1
          if (refreshed.ok && refreshed.data) {
            const remoteWrongWords = pack.words.filter(word => refreshed.data?.wrongWordIds.includes(word.id))
            this.setData({
              completedCount: refreshed.data.completedCount,
              correctCount: refreshed.data.correctCount,
              correctRate: refreshed.data.correctRate,
              wrongWords: remoteWrongWords,
              progressVersion: refreshed.data.version,
              progressEpoch: nextEpoch,
            })
            wx.setStorageSync(storageKey, {
              completedCount: refreshed.data.completedCount,
              correctCount: refreshed.data.correctCount,
              wrongWordIds: refreshed.data.wrongWordIds,
              version: refreshed.data.version,
              pending: false,
            })
            wx.showToast({ title: '进度已在其他设备更新，已刷新', icon: 'none' })
            return
          }
          this.setData({ progressEpoch: nextEpoch })
          wx.setStorageSync(storageKey, { completedCount, correctCount, wrongWordIds: wrongWords.map(item => item.id), version: this.data.progressVersion, pending: true })
          wx.showToast({ title: '进度暂未同步，已保留本机记录', icon: 'none' })
          return
        }
        const storageKey = `vocabulary_progress_${this.data.userId}_${pack.id}`
        if (result.ok) {
          this.setData({ progressVersion: result.data.version })
          wx.setStorageSync(storageKey, { completedCount, correctCount, wrongWordIds: wrongWords.map(item => item.id), version: result.data.version, pending: false })
          return
        }
        wx.setStorageSync(storageKey, { completedCount, correctCount, wrongWordIds: wrongWords.map(item => item.id), version: this.data.progressVersion, pending: true })
        wx.showToast({ title: '已离线保存，稍后自动同步', icon: 'none' })
      })
      return vocabularySaveTail
    },
  },
})

function meaningOptions(pack: VocabularyPack, wordIndex: number): string[] {
  const correct = pack.words[wordIndex]?.meaning
  if (!correct) return []
  const alternatives = [...pack.words.map(word => word.meaning), '雨天', '森林', '天空'].filter((item, index, values) => item !== correct && values.indexOf(item) === index)
  const choices = [correct, ...alternatives.slice(0, 2)]
  const offset = (wordIndex + 1) % choices.length
  return [...choices.slice(offset), ...choices.slice(0, offset)]
}

function catalogVocabularyOptions(facets: readonly StudentCatalogFacet[], filters: {
  grade: string; textbook: string; unit: string;
}): { grades: string[]; textbooks: string[]; units: string[] } {
  const grades = [...new Set(facets.map(facet => facet.grade))]
  const byGrade = facets.filter(facet => filters.grade === '全部年级' || facet.grade === filters.grade)
  const textbooks = [...new Set(byGrade.map(facet => facet.textbook || '未标注教材'))]
  const byTextbook = byGrade.filter(facet => filters.textbook === '全部教材'
    || (facet.textbook || '未标注教材') === filters.textbook)
  const units = [...new Set(byTextbook.map(facet => facet.unit).filter((unit): unit is string => Boolean(unit)))]
  return { grades, textbooks, units }
}

function firstUnattemptedIndex(pack: VocabularyPack, states: Record<string, VocabularyWordAttemptSummary>): number {
  return Math.max(0, pack.words.findIndex(word => states[word.id]?.firstCorrect === null || states[word.id] === undefined))
}

function trustedProgress(pack: VocabularyPack | null, states: Record<string, VocabularyWordAttemptSummary>) {
  const completedCount = Object.values(states).filter(state => state.firstCorrect !== null).length
  const correctCount = Object.values(states).filter(state => state.firstCorrect === true).length
  const wrongWords = pack?.words.filter(word => {
    return states[word.id]?.lastCorrect === false
  }) ?? []
  return { completedCount, correctCount, correctRate: completedCount ? Math.round(correctCount * 100 / completedCount) : 0, wrongWords }
}

function summaryFromState(state: VocabularyAttemptState): VocabularyWordAttemptSummary {
  return { wordId: state.wordId, firstCorrect: state.firstCorrect,
    lastCorrect: state.attempts[state.attempts.length - 1]?.isCorrect ?? null, version: state.version }
}
