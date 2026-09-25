import { VocabularyPack, VocabularyWord } from '../../../domain/types'
import { getVocabularyProgress, listVocabularyPacks, saveVocabularyProgress } from '../../../services/app-service'
import { getSession } from '../../../session/session'
import { filterVocabularyPacks, vocabularyPackOptions } from '../../../shared/vocabulary-pack-filters'

type VocabularyMode = 'study' | 'practice' | 'wrong'

let vocabularyOperationSequence = 0
let vocabularySaveTail: Promise<void> = Promise.resolve()

Component({
  data: {
    loading: true,
    error: '',
    pack: null as VocabularyPack | null,
    packs: [] as VocabularyPack[],
    visiblePacks: [] as VocabularyPack[],
    packFilterOptions: { grades: [] as string[], textbooks: [] as string[], units: [] as string[] },
    gradeFilter: '全部年级',
    textbookFilter: '全部教材',
    unitFilter: '全部单元',
    packKeyword: '',
    packFilterOpen: '',
    taskPackId: '',
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
  },
  lifetimes: { attached() {
    const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
    const taskPackId = pages[pages.length - 1]?.options?.packId ?? ''
    this.setData({ taskPackId }, () => this.loadPack(taskPackId))
  } },
  methods: {
    async loadPack(packId = '') {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await listVocabularyPacks(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const rememberedPackId = wx.getStorageSync(`vocabulary_recent_pack_${session.user.id}`) as string
      const requestedPackId = typeof packId === 'string' && packId ? packId : this.data.taskPackId || this.data.selectedPackId || rememberedPackId
      const requestedPack = requestedPackId ? result.data.find(item => item.id === requestedPackId) : undefined
      if (this.data.taskPackId && !requestedPack) { this.setData({ loading: false, error: '任务词包不可用或没有访问权限' }); return }
      const pack = requestedPack ?? result.data[0] ?? null
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
      const filters = { grade: this.data.gradeFilter, textbook: this.data.textbookFilter, unit: this.data.unitFilter, keyword: this.data.packKeyword }
      this.setData({ loading: false, pack, packs: result.data, visiblePacks: filterVocabularyPacks(result.data, filters), packFilterOptions: vocabularyPackOptions(result.data, filters), selectedPackId: pack?.id ?? '', packSelectOpen: false, userId: session.user.id, wordIndex,
        completedCount, correctCount, correctRate, progressVersion, wrongWords,
        syllableLabel: pack?.words[wordIndex]?.syllables.join('-') ?? '', questionType: wordIndex % 2 === 0 ? 'meaning' : 'spelling',
        choiceOptions: pack ? meaningOptions(pack, wordIndex) : [], selectedMeaning: '', spellingAnswer: '', answered: false })
      if (pack && saved?.pending) this.queueProgressSave(pack, completedCount, correctCount, wrongWords)
    },
    selectMode(event: WechatMiniprogram.TouchEvent) {
      const mode = event.currentTarget.dataset.mode as VocabularyMode
      const pack = this.data.pack
      const wordIndex = mode === 'practice' && pack && this.data.completedCount < pack.words.length ? this.data.completedCount : this.data.wordIndex
      this.setData({ mode, wordIndex, selectedMeaning: '', spellingAnswer: '', answered: false, reviewingWrongId: '',
        syllableLabel: pack?.words[wordIndex]?.syllables.join('-') ?? '', questionType: wordIndex % 2 === 0 ? 'meaning' : 'spelling',
        choiceOptions: pack ? meaningOptions(pack, wordIndex) : [] })
    },
    togglePackSelect() { this.setData({ packSelectOpen: !this.data.packSelectOpen }) },
    onPackSearch(event: WechatMiniprogram.Input) {
      const filters = { grade: this.data.gradeFilter, textbook: this.data.textbookFilter, unit: this.data.unitFilter, keyword: event.detail.value }
      this.setData({ packKeyword: filters.keyword, visiblePacks: filterVocabularyPacks(this.data.packs, filters) })
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
        packFilterOpen: '', packFilterOptions: vocabularyPackOptions(this.data.packs, filters), visiblePacks: filterVocabularyPacks(this.data.packs, filters) })
    },
    clearPackFilters() {
      const filters = { grade: '全部年级', textbook: '全部教材', unit: '全部单元', keyword: '' }
      this.setData({ gradeFilter: filters.grade, textbookFilter: filters.textbook, unitFilter: filters.unit,
        packKeyword: '', packFilterOpen: '', packFilterOptions: vocabularyPackOptions(this.data.packs, filters), visiblePacks: filterVocabularyPacks(this.data.packs, filters) })
    },
    async selectPack(event: WechatMiniprogram.TouchEvent) {
      if (this.data.taskPackId) return
      const packId = event.currentTarget.dataset.id as string
      if (!this.data.packs.some(pack => pack.id === packId)) return
      await vocabularySaveTail.catch(() => undefined)
      await this.loadPack(packId)
      if (this.data.pack?.id === packId) wx.setStorageSync(`vocabulary_recent_pack_${this.data.userId}`, packId)
    },
    onSpelling(event: WechatMiniprogram.Input) { if (!this.data.answered) this.setData({ spellingAnswer: event.detail.value }) },
    chooseMeaning(event: WechatMiniprogram.TouchEvent) {
      if (this.data.answered) return
      this.setData({ selectedMeaning: event.currentTarget.dataset.meaning as string })
    },
    submitAnswer() {
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
    nextWord() {
      const pack = this.data.pack
      if (!pack) return
      const wordIndex = this.data.mode === 'practice' && this.data.completedCount < pack.words.length ? this.data.completedCount : (this.data.wordIndex + 1) % pack.words.length
      this.setData({ wordIndex, selectedMeaning: '', spellingAnswer: '', answered: false, answerCorrect: false, reviewingWrongId: '', syllableLabel: pack.words[wordIndex]?.syllables.join('-') ?? '',
        questionType: wordIndex % 2 === 0 ? 'meaning' : 'spelling', choiceOptions: meaningOptions(pack, wordIndex) })
    },
    practiceWrong(event: WechatMiniprogram.TouchEvent) {
      const pack = this.data.pack
      const wordId = event.currentTarget.dataset.id as string
      const wordIndex = pack?.words.findIndex(item => item.id === wordId) ?? -1
      if (!pack || wordIndex < 0) return
      this.setData({ mode: 'practice', wordIndex, reviewingWrongId: wordId, selectedMeaning: '', spellingAnswer: '', answered: false, answerCorrect: false,
        syllableLabel: pack.words[wordIndex]?.syllables.join('-') ?? '', questionType: wordIndex % 2 === 0 ? 'meaning' : 'spelling', choiceOptions: meaningOptions(pack, wordIndex) })
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
