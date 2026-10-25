import { WordPracticeView, getWordPractice } from '../services/m1-app-service'
import { getSession } from '../session/session'
import { syllableLabel, syllablesAvailable } from '../pages/student/student-syllables'

type WordTab = 'learn' | 'practice' | 'wrong'

Component({
  data: { loading: true, error: '', word: null as WordPracticeView | null, syllableLabel: '',
    tab: 'practice' as WordTab, selected: '', answered: false, correct: false },
  lifetimes: { attached() { this.loadWord() } },
  methods: {
    async loadWord() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await getWordPractice(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      if (!syllablesAvailable([{ word: result.data.word,
        syllables: result.data.syllableParts, syllableDisplay: result.data.syllables }])) {
        this.setData({ loading: false, error: '当前三年级词条缺少已核对的音节数据，暂不可练习' }); return
      }
      this.setData({ loading: false, word: result.data,
        syllableLabel: syllableLabel({ syllables: result.data.syllableParts }) })
    },
    setTab(event: WechatMiniprogram.TouchEvent) { this.setData({ tab: event.currentTarget.dataset.tab as WordTab, answered: false, selected: '' }) },
    selectOption(event: WechatMiniprogram.TouchEvent) { if (!this.data.answered) this.setData({ selected: event.currentTarget.dataset.option as string }) },
    submitAnswer() {
      if (!this.data.selected) { wx.showToast({ title: '请先选择答案', icon: 'none' }); return }
      const correct = this.data.selected === this.data.word?.correctOption
      this.setData({ answered: true, correct })
    },
    nextWord() { this.setData({ answered: false, selected: '' }); wx.showToast({ title: '学习记录已保存', icon: 'success' }) },
    choosePack() { wx.showToast({ title: '当前使用三年级 Unit 3', icon: 'none' }) },
  },
})

