import { VocabularyPack, VocabularyWord } from '../../../domain/types'
import { getVocabularyProgress, listVocabularyPacks, saveVocabularyProgress } from '../../../services/app-service'
import { getSession } from '../../../session/session'

type VocabularyMode = 'study' | 'practice' | 'wrong'

let vocabularyOperationSequence = 0
let vocabularySaveTail: Promise<void> = Promise.resolve()

Component({
  data: {
    loading: true,
    error: '',
    pack: null as VocabularyPack | null,
    mode: 'practice' as VocabularyMode,
    wordIndex: 0,
    selectedMeaning: '',
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
  lifetimes: { attached() { this.loadPack() } },
  methods: {
    async loadPack() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await listVocabularyPacks(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const pack = result.data[0] ?? null
      const saved = pack ? wx.getStorageSync(`vocabulary_progress_${session.user.id}_${pack.id}`) as { completedCount?: number; correctCount?: number; wrongWordIds?: string[]; version?: number; pending?: boolean } : null
      const remote = pack ? await getVocabularyProgress(session.user.id, pack.id) : null
      const useLocal = Boolean(saved?.pending) || remote === null || !remote.ok || remote.data === null
      const completedCount = useLocal ? (saved?.completedCount ?? 0) : (remote?.ok && remote.data ? remote.data.completedCount : 0)
      const correctCount = useLocal ? (saved?.correctCount ?? 0) : (remote?.ok && remote.data ? remote.data.correctCount : 0)
      const wrongWordIds = useLocal ? (saved?.wrongWordIds ?? []) : (remote?.ok && remote.data ? remote.data.wrongWordIds : [])
      const progressVersion = remote?.ok && remote.data ? remote.data.version : (saved?.version ?? 0)
      const wrongWords = pack?.words.filter(word => wrongWordIds.includes(word.id)) ?? []
      const correctRate = completedCount === 0 ? 0 : Math.round(correctCount * 100 / completedCount)
      this.setData({ loading: false, pack, userId: session.user.id, completedCount, correctCount, correctRate, progressVersion, wrongWords, syllableLabel: pack?.words[0]?.syllables.join(' · ') ?? '' })
      if (pack && saved?.pending) this.queueProgressSave(pack, completedCount, correctCount, wrongWords)
    },
    selectMode(event: WechatMiniprogram.TouchEvent) {
      this.setData({ mode: event.currentTarget.dataset.mode as VocabularyMode, selectedMeaning: '', answered: false, reviewingWrongId: '' })
    },
    chooseMeaning(event: WechatMiniprogram.TouchEvent) {
      if (this.data.answered) return
      this.setData({ selectedMeaning: event.currentTarget.dataset.meaning as string })
    },
    submitAnswer() {
      const pack = this.data.pack
      const word = pack?.words[this.data.wordIndex]
      if (!word || !this.data.selectedMeaning) { wx.showToast({ title: '请先选择一个答案', icon: 'none' }); return }
      const answerCorrect = this.data.selectedMeaning === word.meaning
      const wrongWords = answerCorrect && this.data.reviewingWrongId === word.id
        ? this.data.wrongWords.filter(item => item.id !== word.id)
        : answerCorrect || this.data.wrongWords.some(item => item.id === word.id)
          ? this.data.wrongWords
          : [...this.data.wrongWords, word]
      const isFirstAttempt = this.data.wordIndex >= this.data.completedCount
      const completedCount = Math.max(this.data.completedCount, this.data.wordIndex + 1)
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
      const wordIndex = (this.data.wordIndex + 1) % pack.words.length
      this.setData({ wordIndex, selectedMeaning: '', answered: false, answerCorrect: false, reviewingWrongId: '', syllableLabel: pack.words[wordIndex]?.syllables.join(' · ') ?? '' })
    },
    practiceWrong(event: WechatMiniprogram.TouchEvent) {
      const pack = this.data.pack
      const wordId = event.currentTarget.dataset.id as string
      const wordIndex = pack?.words.findIndex(item => item.id === wordId) ?? -1
      if (!pack || wordIndex < 0) return
      this.setData({ mode: 'practice', wordIndex, reviewingWrongId: wordId, selectedMeaning: '', answered: false, answerCorrect: false, syllableLabel: pack.words[wordIndex]?.syllables.join(' · ') ?? '' })
    },
    playWord() { wx.showToast({ title: 'M1 演示词包暂不含音频', icon: 'none' }) },
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
          wx.setStorageSync(storageKey, { completedCount, correctCount, wrongWordIds: wrongWords.map(item => item.id), version: this.data.progressVersion, pending: false })
          wx.showToast({ title: '进度已更新，请刷新后重试', icon: 'none' })
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
