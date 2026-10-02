import type { TaskCatalogListItem, TeacherTextbookClass, TextbookSummary } from '../../../domain/types'
import { getSynchronizedTextbook, getTeacherTextbookCenterSettings, listSchoolQuestions, listTaskCatalogResources, listTeacherTextbookClasses, listSynchronizedTextbooks } from '../../../services/app-service'
import { getSession, setTeacherSelectedResourceIds } from '../../../session/session'

Component({
  data: { loading: true, searching: false, error: '', keyword: '', classes: [] as TeacherTextbookClass[],
    configuredCount: 0,
    classTextbooksEnabled: true, synchronizedTextbooksEnabled: true,
    recentBooks: [] as TextbookSummary[], books: [] as TextbookSummary[],
    readings: [] as TaskCatalogListItem[], questions: [] as Array<{ id: string; title: string }> },
  lifetimes: { attached() { this.load() } },
  methods: {
    async load() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'teacher') { this.setData({ loading: false, error: '仅授权教师可使用教材中心' }); return }
      this.setData({ loading: true, error: '' })
      const settings = await getTeacherTextbookCenterSettings(session.user.id)
      if (!settings.ok) { this.setData({ loading: false, error: settings.error.message }); return }
      const classTextbooksEnabled = settings.data.classTextbooksEnabled && settings.data.visibleClassIds.length > 0
      const synchronizedTextbooksEnabled = settings.data.synchronizedTextbooksEnabled && settings.data.visibleClassIds.length > 0
      const [classes, books] = await Promise.all([
        classTextbooksEnabled ? listTeacherTextbookClasses(session.user.id) : Promise.resolve({ ok: true as const, data: [] as TeacherTextbookClass[] }),
        synchronizedTextbooksEnabled ? listSynchronizedTextbooks(session.user.id, {}, 20, 0)
          : Promise.resolve({ ok: true as const, data: { items: [] as TextbookSummary[], nextOffset: null } }),
      ])
      if (!classes.ok) { this.setData({ loading: false, error: classes.error.message }); return }
      if (!books.ok) { this.setData({ loading: false, error: books.error.message }); return }
      const recentIds = [...new Set(classes.data.flatMap(item => item.config?.textbooks.map(book => book.textbookId) ?? []))]
      const recentResults = await Promise.all(recentIds.slice(0, 3).map(id =>
        getSynchronizedTextbook(session.user.id, id)))
      this.setData({ loading: false, classes: classes.data, books: books.data.items,
        configuredCount: classes.data.filter(item => Boolean(item.config?.publishedTextbooks.length)).length,
        classTextbooksEnabled,
        synchronizedTextbooksEnabled,
        recentBooks: recentResults.filter((result): result is { ok: true; data: TextbookSummary } => result.ok)
          .map(result => result.data) })
    },
    onKeyword(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }) },
    async search() {
      const session = getSession(); if (!session) return
      const keyword = this.data.keyword.trim()
      if (!keyword) { this.setData({ readings: [], questions: [] }); return }
      this.setData({ searching: true, error: '' })
      const [books, readings, questions] = await Promise.all([
        this.data.synchronizedTextbooksEnabled ? listSynchronizedTextbooks(session.user.id, { keyword }, 10, 0)
          : Promise.resolve({ ok: true as const, data: { items: [] as TextbookSummary[], nextOffset: null } }),
        listTaskCatalogResources(session.user.id, { type: 'reading', keyword }, 10, 0),
        listSchoolQuestions(session.user.id, { keyword }, 10, 0),
      ])
      if (!books.ok || !readings.ok || !questions.ok) {
        const message = !books.ok ? books.error.message : !readings.ok ? readings.error.message : !questions.ok ? questions.error.message : ''
        this.setData({ searching: false, error: message }); return
      }
      this.setData({ searching: false, books: books.data.items, readings: readings.data.items,
        questions: questions.data.items.map(item => ({ id: item.id, title: item.title })) })
    },
    openClasses() { wx.navigateTo({ url: '/pages/teacher/class-textbooks/class-textbooks' }) },
    openSynchronized() { wx.navigateTo({ url: '/pages/teacher/synchronized-textbooks/synchronized-textbooks' }) },
    openQuestions() { wx.navigateTo({ url: '/pages/teacher/school-questions/school-questions' }) },
    openMedia() { wx.showToast({ title: '音视频材料库将在 M3 开放', icon: 'none' }) },
    openBook(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      wx.navigateTo({ url: `/pages/teacher/synchronized-textbooks/synchronized-textbooks?previewId=${encodeURIComponent(id)}` })
    },
    openReadingResult(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      wx.navigateTo({ url: `/pages/teacher/reading-selector/reading-selector?previewId=${encodeURIComponent(id)}` })
    },
    openQuestionResult(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      setTeacherSelectedResourceIds([id]); wx.navigateTo({ url: '/pages/teacher/publish-task/publish-task' })
    },
  },
})
