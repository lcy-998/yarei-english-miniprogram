import type { TaskCatalogListItem, TeacherTextbookClass, TextbookSummary } from '../../../domain/types'
import { getSynchronizedTextbook, getTeacherTextbookCenterSettings, listSchoolQuestions, listTaskCatalogResources, listTeacherTextbookClasses, listSynchronizedTextbooks } from '../services/app-service'
import { getSession, setTeacherSelectedResourceIds } from '../session/session'
import { listTeacherAssets } from '../services/teacher-media-service'
import type { TeacherAssetListItem } from '../../../domain/teacher-media'

Component({
  data: { loading: true, searching: false, error: '', keyword: '', searchedKeyword: '', searchVersion: 0, loadVersion: 0,
    classes: [] as TeacherTextbookClass[],
    configuredCount: 0,
    classTextbooksEnabled: true, synchronizedTextbooksEnabled: true,
    recentBooks: [] as TextbookSummary[], books: [] as TextbookSummary[],
    readings: [] as TaskCatalogListItem[], questions: [] as Array<{ id: string; title: string }>,
    media: [] as TeacherAssetListItem[], mediaSearchError: '' },
  pageLifetimes: { show() { this.load() } },
  methods: {
    async load() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'teacher') { this.setData({ loading: false, error: '仅授权教师可使用教材中心' }); return }
      const loadVersion = this.data.loadVersion + 1
      this.setData({ loading: true, error: '', loadVersion })
      const settings = await getTeacherTextbookCenterSettings(session.user.id)
      if (loadVersion !== this.data.loadVersion) return
      if (!settings.ok) { this.setData({ loading: false, error: settings.error.message }); return }
      const classTextbooksEnabled = settings.data.classTextbooksEnabled && settings.data.visibleClassIds.length > 0
      const synchronizedTextbooksEnabled = settings.data.synchronizedTextbooksEnabled && settings.data.visibleClassIds.length > 0
      const [classes, books] = await Promise.all([
        classTextbooksEnabled ? listTeacherTextbookClasses(session.user.id) : Promise.resolve({ ok: true as const, data: [] as TeacherTextbookClass[] }),
        synchronizedTextbooksEnabled ? listSynchronizedTextbooks(session.user.id, {}, 20, 0)
          : Promise.resolve({ ok: true as const, data: { items: [] as TextbookSummary[], nextOffset: null } }),
      ])
      if (loadVersion !== this.data.loadVersion) return
      if (!classes.ok) { this.setData({ loading: false, error: classes.error.message }); return }
      if (!books.ok) { this.setData({ loading: false, error: books.error.message }); return }
      const recentIds = [...new Set(classes.data.flatMap(item => item.config?.textbooks.map(book => book.textbookId) ?? []))]
      const recentResults = await Promise.all(recentIds.slice(0, 3).map(id =>
        getSynchronizedTextbook(session.user.id, id)))
      if (loadVersion !== this.data.loadVersion) return
      this.setData({ loading: false, classes: classes.data, books: books.data.items,
        configuredCount: classes.data.filter(item => Boolean(item.config?.publishedTextbooks.length)).length,
        classTextbooksEnabled,
        synchronizedTextbooksEnabled,
        recentBooks: recentResults.filter((result): result is { ok: true; data: TextbookSummary } => result.ok)
          .map(result => result.data) }, () => {
        if (this.data.searchedKeyword) this.search()
      })
    },
    onKeyword(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }) },
    async search() {
      const session = getSession(); if (!session) return
      const keyword = this.data.keyword.trim()
      if (!keyword) { this.setData({ searchVersion: this.data.searchVersion + 1,
        searching: false, searchedKeyword: '', readings: [], questions: [], media: [], mediaSearchError: '' }); return }
      const searchVersion = this.data.searchVersion + 1
      this.setData({ searching: true, error: '', searchVersion })
      const [books, readings, questions, mediaResults] = await Promise.all([
        this.data.synchronizedTextbooksEnabled ? listSynchronizedTextbooks(session.user.id, { keyword }, 10, 0)
          : Promise.resolve({ ok: true as const, data: { items: [] as TextbookSummary[], nextOffset: null } }),
        listTaskCatalogResources(session.user.id, { type: 'reading', keyword }, 10, 0),
        listSchoolQuestions(session.user.id, { keyword }, 10, 0),
        Promise.all((['listening', 'video', 'dubbing'] as const)
          .map(kind => listTeacherAssets(session.user.id, { kind, keyword }, 10, 0))),
      ])
      if (searchVersion !== this.data.searchVersion) return
      if (!books.ok || !readings.ok || !questions.ok) {
        const message = !books.ok ? books.error.message : !readings.ok ? readings.error.message : !questions.ok ? questions.error.message : ''
        this.setData({ searching: false, error: message }); return
      }
      this.setData({ searching: false, searchedKeyword: keyword,
        books: books.data.items, readings: readings.data.items,
        questions: questions.data.items.map(item => ({ id: item.id, title: item.title })),
        media: mediaResults.flatMap(result => result.ok ? result.data.items : []),
        mediaSearchError: mediaResults.some(result => !result.ok) ? '部分音视频结果暂不可用，请进入材料库重试' : '' })
    },
    openClasses() { wx.navigateTo({ url: '/subpackages/teacher/class-textbooks/class-textbooks' }) },
    openSynchronized() { wx.navigateTo({ url: '/subpackages/teacher/synchronized-textbooks/synchronized-textbooks' }) },
    openQuestions() { wx.navigateTo({ url: '/subpackages/teacher/school-questions/school-questions' }) },
    openMedia() { wx.navigateTo({ url: '/subpackages/teacher/media-library/media-library' }) },
    openBook(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      wx.navigateTo({ url: `/subpackages/teacher/synchronized-textbooks/synchronized-textbooks?previewId=${encodeURIComponent(id)}` })
    },
    openReadingResult(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      wx.navigateTo({ url: `/subpackages/teacher/reading-selector/reading-selector?previewId=${encodeURIComponent(id)}` })
    },
    openQuestionResult(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      setTeacherSelectedResourceIds([id]); wx.navigateTo({ url: '/subpackages/teacher/publish-task/publish-task' })
    },
    openMediaResult(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (!this.data.media.some(item => item.id === id)) return
      wx.navigateTo({ url: `/subpackages/teacher/media-preview/media-preview?id=${encodeURIComponent(id)}` })
    },
  },
})
