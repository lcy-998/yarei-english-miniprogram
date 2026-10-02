import type { ClassTextbookConfig, ClassTextbookItem, TeacherTextbookClass, TextbookSummary } from '../../../domain/types'
import { getReadingResource, getSynchronizedTextbook, getTaskCatalogResource, getTeacherTextbookClass, saveClassTextbooks } from '../../../services/app-service'
import { getSession, setTeacherCatalogResultIds, setTeacherReadingSelection, takeTeacherTextbookSelectedIds } from '../../../session/session'
import { selectedReadingPageIds } from '../reading-selector/reading-range'

interface BookRow { id: string; item: ClassTextbookItem; book: TextbookSummary | null; title: string; valid: boolean;
  chapters: Array<{ id: string; title: string; lessons: Array<{ id: string; title: string }> }> }
function makeRow(item: ClassTextbookItem, book: TextbookSummary | null): BookRow {
  const chapters = book ? item.chapterIds.map(id => book.chapters.find(chapter => chapter.id === id))
    .filter((chapter): chapter is TextbookSummary['chapters'][number] => chapter !== undefined)
    .map(chapter => ({ id: chapter.id, title: chapter.title,
      lessons: item.lessonIds.map(id => chapter.lessons.find(lesson => lesson.id === id))
        .filter((lesson): lesson is { id: string; title: string } => lesson !== undefined) })) : []
  return { id: item.textbookId, item, book, title: book?.title ?? item.textbookId,
    valid: book !== null && book.contentVersion === item.contentVersion
      && chapters.length === item.chapterIds.length
      && book.chapters.length === item.chapterIds.length
      && new Set(item.chapterIds).size === item.chapterIds.length
      && new Set(item.lessonIds).size === item.lessonIds.length
      && book.chapters.flatMap(chapter => chapter.lessons).length === item.lessonIds.length
      && item.lessonIds.every(id => book.chapters.some(chapter => chapter.lessons.some(lesson => lesson.id === id))),
    chapters }
}
function newItem(book: TextbookSummary): ClassTextbookItem {
  return { textbookId: book.id, contentVersion: book.contentVersion,
    chapterIds: book.chapters.map(chapter => chapter.id),
    lessonIds: book.chapters.flatMap(chapter => chapter.lessons.map(lesson => lesson.id)) }
}
function move<T>(items: readonly T[], index: number, delta: number): T[] {
  const result = [...items]; const next = index + delta
  if (index < 0 || index >= result.length || next < 0 || next >= result.length) return result
  const item = result.splice(index, 1)[0]!; result.splice(next, 0, item); return result
}

Component({
  data: { initialized: false, loading: true, saving: false, error: '', classId: '', target: null as TeacherTextbookClass | null,
    rows: [] as BookRow[], savedRows: [] as BookRow[], note: '', pendingOperationId: '',
    pendingOperationKind: '' as '' | 'draft' | 'publish', dirty: false },
  pageLifetimes: { show() {
    if (!this.data.initialized) {
      const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
      const classId = pages[pages.length - 1]?.options?.classId ?? ''
      this.setData({ initialized: true, classId: decodeURIComponent(classId) }, () => this.load())
      return
    }
    const selected = takeTeacherTextbookSelectedIds()
    if (selected !== null && this.data.target) this.mergeSelected(selected)
  } },
  methods: {
    onNavigateBack() {
      if (this.data.saving) return
      const leave = () => {
        if (getCurrentPages().length > 1) wx.navigateBack()
        else wx.reLaunch({ url: '/pages/teacher/class-textbooks/class-textbooks' })
      }
      if (!this.data.dirty) { leave(); return }
      wx.showModal({ title: '放弃未保存的课本配置？', content: '当前修改尚未保存。', success: result => {
        if (result.confirm) leave()
      } })
    },
    async load() {
      const session = getSession(); if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await getTeacherTextbookClass(session.user.id, this.data.classId)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const rows: BookRow[] = []
      for (const item of result.data.config?.textbooks ?? []) {
        const book = await getSynchronizedTextbook(session.user.id, item.textbookId, this.data.classId)
        rows.push(makeRow(item, book.ok ? book.data : null))
      }
      this.setData({ loading: false, target: result.data, rows, savedRows: rows, note: result.data.config?.note ?? '', dirty: false,
        pendingOperationId: '', pendingOperationKind: '' })
    },
    changed(rows: BookRow[]) { this.setData({ rows, dirty: true, pendingOperationId: '', pendingOperationKind: '', error: '' }) },
    onNote(event: WechatMiniprogram.Input) {
      this.setData({ note: event.detail.value, dirty: true, pendingOperationId: '', pendingOperationKind: '' })
    },
    openCatalog() {
      wx.navigateTo({ url: `/pages/teacher/synchronized-textbooks/synchronized-textbooks?mode=config&classId=${encodeURIComponent(this.data.classId)}` })
    },
    async mergeSelected(ids: readonly string[]) {
      const session = getSession(); if (!session) return
      const rows = [...this.data.rows]
      for (const id of ids) {
        if (rows.some(row => row.item.textbookId === id)) continue
        const result = await getSynchronizedTextbook(session.user.id, id, this.data.classId)
        if (!result.ok) { this.setData({ error: `${id} 已不可配置：${result.error.message}` }); continue }
        rows.push(makeRow(newItem(result.data), result.data))
      }
      this.changed(rows)
    },
    removeBook(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      this.changed(this.data.rows.filter(row => row.item.textbookId !== id))
    },
    moveBook(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const delta = Number(event.currentTarget.dataset.delta)
      this.changed(move(this.data.rows, index, delta))
    },
    moveChapter(event: WechatMiniprogram.TouchEvent) {
      const bookIndex = Number(event.currentTarget.dataset.book)
      const index = Number(event.currentTarget.dataset.index)
      const delta = Number(event.currentTarget.dataset.delta)
      const rows = [...this.data.rows]; const row = rows[bookIndex]
      if (!row) return
      const chapterIds = move(row.item.chapterIds, index, delta)
      rows[bookIndex] = makeRow({ ...row.item, chapterIds }, row.book)
      this.changed(rows)
    },
    moveLesson(event: WechatMiniprogram.TouchEvent) {
      const bookIndex = Number(event.currentTarget.dataset.book)
      const chapterId = event.currentTarget.dataset.chapter as string
      const index = Number(event.currentTarget.dataset.index)
      const delta = Number(event.currentTarget.dataset.delta)
      const rows = [...this.data.rows]; const row = rows[bookIndex]
      const chapter = row?.book?.chapters.find(item => item.id === chapterId)
      if (!row || !chapter) return
      const localIds = row.item.lessonIds.filter(id => chapter.lessons.some(lesson => lesson.id === id))
      const reordered = move(localIds, index, delta)
      const lessonIds = [...row.item.lessonIds]
      let next = 0
      for (let position = 0; position < lessonIds.length; position += 1) {
        if (chapter.lessons.some(lesson => lesson.id === lessonIds[position])) lessonIds[position] = reordered[next++]!
      }
      rows[bookIndex] = makeRow({ ...row.item, lessonIds }, row.book)
      this.changed(rows)
    },
    previewBook(event: WechatMiniprogram.TouchEvent) {
      const row = this.data.rows.find(item => item.item.textbookId === event.currentTarget.dataset.id)
      if (!row?.book) return
      wx.showModal({ title: row.book.title, content: row.book.chapters.map(chapter =>
        `${chapter.title}${chapter.lessons.length ? `：${chapter.lessons.map(lesson => lesson.title).join('、')}` : ''}`).join('\n'), showCancel: false })
    },
    async useForTask(event: WechatMiniprogram.TouchEvent) {
      const session = getSession(); const id = event.currentTarget.dataset.id as string
      if (!session || !id) return
      const [resource, detail] = await Promise.all([
        getTaskCatalogResource(session.user.id, id, [this.data.classId]),
        getReadingResource(session.user.id, id),
      ])
      const pageIds = detail.ok ? selectedReadingPageIds(detail.data, { mode: 'whole' }) : null
      if (!resource.ok || resource.data.type !== 'reading' || !detail.ok || !pageIds
        || resource.data.contentVersion !== detail.data.contentVersion) {
        this.setData({ error: '该课本页图已变更或不可作为阅读任务引用' }); return
      }
      setTeacherReadingSelection({ resourceId: id, pageIds, targetClassId: this.data.classId })
      setTeacherCatalogResultIds([id])
      wx.navigateTo({ url: '/pages/teacher/publish-task/publish-task' })
    },
    async save(publish: boolean) {
      const session = getSession(); const target = this.data.target
      if (!session || !target || this.data.saving) return
      if (this.data.rows.some(row => !row.valid)) { this.setData({ error: '存在已失效课本，请移除后再保存' }); return }
      if (publish && !this.data.rows.length) { this.setData({ error: '至少选择一本课本后才能发布' }); return }
      const kind = publish ? 'publish' : 'draft'
      const operationId = this.data.pendingOperationKind === kind && this.data.pendingOperationId
        ? this.data.pendingOperationId : `classbook_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      this.setData({ saving: true, error: '', pendingOperationId: operationId, pendingOperationKind: kind })
      const result = await saveClassTextbooks(session.user.id, target.id, this.data.rows.map(row => row.item),
        this.data.note, target.config?.version ?? 0, operationId, publish)
      if (!result.ok) { this.setData({ saving: false, error: result.error.message }); return }
      this.setData({ saving: false, target: { ...target, config: result.data }, savedRows: this.data.rows,
        dirty: false, pendingOperationId: '', pendingOperationKind: '' })
      wx.showToast({ title: publish ? '已发布' : '草稿已保存', icon: 'success' })
    },
    saveDraft() { this.save(false) },
    publish() {
      wx.showModal({ title: '发布班级教材', content: '发布后学生可看到本次教材安排；已发布任务仍使用原快照。',
        success: result => { if (result.confirm) this.save(true) } })
    },
    undo() {
      const config: ClassTextbookConfig | null = this.data.target?.config ?? null
      this.setData({ rows: this.data.savedRows, note: config?.note ?? '', dirty: false,
        pendingOperationId: '', pendingOperationKind: '', error: '' })
    },
  },
})
