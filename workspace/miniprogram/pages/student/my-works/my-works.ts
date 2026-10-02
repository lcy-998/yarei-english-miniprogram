import { StudentWork, WorkMaterial } from '../../../domain/types'
import { deleteWorkDraft, getWorkPlayback, listMyWorks, listWorkMaterials } from '../../../services/app-service'
import { getSession } from '../../../session/session'
import { clearDubbingLocalDraft, readDubbingLocalDraft } from '../../../shared/dubbing-local-draft'
import { preferDubbingMaterial } from '../../../shared/dubbing-navigation'
import { EMPTY_WRITE_INTENT, WriteIntentState, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'

interface WorkRow { id: string; materialTitle: string; statusLabel: string; submittedLabel: string;
  durationLabel: string; note: string; mediaExpired: boolean; isDraft: boolean; work: StudentWork }
type WorkFilter = 'all' | 'draft' | 'submitted'

function visibleRows(rows: WorkRow[], filter: WorkFilter): WorkRow[] {
  return filter === 'all' ? rows : rows.filter(row => row.work.status === filter)
}

let activeAudio: WechatMiniprogram.InnerAudioContext | null = null

Component({
  data: { loading: true, error: '', rows: [] as WorkRow[], visibleRows: [] as WorkRow[],
    statusFilter: 'all' as WorkFilter, playingId: '', playbackError: '',
    deletingId: '', deleteError: '', deleteIntents: {} as Record<string, WriteIntentState> },
  lifetimes: { attached() { this.loadWorks() }, detached() { activeAudio?.destroy(); activeAudio = null } },
  pageLifetimes: { show() { this.loadWorks() } },
  methods: {
    async loadWorks() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const [works, materials] = await Promise.all([
        listMyWorks(session.user.id), listWorkMaterials(session.user.id),
      ])
      if (!works.ok) { this.setData({ loading: false, error: works.error.message }); return }
      const titles = new Map((materials.ok ? materials.data : [] as WorkMaterial[]).map(item => [item.id, item.title]))
      const rows = works.data.filter(work => !work.deletedAt)
        .sort((left, right) => (right.submittedAt ?? right.createdAt).localeCompare(left.submittedAt ?? left.createdAt))
        .map((work): WorkRow => ({ id: work.id, work, materialTitle: titles.get(work.materialId) ?? '配音作品',
          statusLabel: work.status === 'draft' ? '草稿'
            : work.mediaExpired ? '已提交　录音已过保留期' : '已提交',
          submittedLabel: work.status === 'draft'
            ? `创建于 ${new Date(work.createdAt).toLocaleString('zh-CN')}`
            : work.submittedAt ? new Date(work.submittedAt).toLocaleString('zh-CN') : '提交时间未记录',
          durationLabel: work.status === 'draft' ? ''
            : work.durationMs === null ? '时长未记录' : `${Math.round(work.durationMs / 1000)} 秒`,
          mediaExpired: Boolean(work.mediaExpired), isDraft: work.status === 'draft', note: work.note }))
      this.setData({ loading: false, rows, visibleRows: visibleRows(rows, this.data.statusFilter) })
    },
    chooseStatus(event: WechatMiniprogram.TouchEvent) {
      const filter = event.currentTarget.dataset.status as WorkFilter
      if (filter !== 'all' && filter !== 'draft' && filter !== 'submitted') return
      this.setData({ statusFilter: filter, visibleRows: visibleRows(this.data.rows, filter) })
    },
    openDubbing() { wx.navigateTo({ url: '/pages/student/dubbing/dubbing' }) },
    redoWork(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const row = this.data.rows.find(item => item.id === event.currentTarget.dataset.id)
      if (!session || !row) return
      preferDubbingMaterial(session.user.id, session.sessionId, row.work.materialId)
      this.openDubbing()
    },
    confirmDeleteDraft(event: WechatMiniprogram.TouchEvent) {
      const workId = event.currentTarget.dataset.id as string
      if (this.data.deletingId || !this.data.rows.some(row => row.id === workId && row.isDraft)) return
      wx.showModal({ title: '删除配音草稿？', content: '删除后将从作品列表隐藏。', confirmText: '删除',
        success: result => { if (result.confirm) this.deleteDraft(workId) } })
    },
    async deleteDraft(workId: string) {
      const session = getSession()
      const row = this.data.rows.find(item => item.id === workId && item.isDraft)
      if (!session || !row || this.data.deletingId) return
      const fingerprint = JSON.stringify({ workId, expectedVersion: row.work.version })
      const intent = prepareWriteIntent(this.data.deleteIntents[workId] ?? EMPTY_WRITE_INTENT, fingerprint,
        () => createPageOperationId('delete_work_draft'))
      this.setData({ deletingId: workId, deleteError: '',
        deleteIntents: { ...this.data.deleteIntents, [workId]: intent } })
      const result = await deleteWorkDraft(session.user.id, workId, row.work.version, intent.operationId)
      if (!result.ok) {
        this.setData({ deletingId: '', deleteError: result.error.message }); return
      }
      const local = readDubbingLocalDraft(session.user.id, session.sessionId)
      if (local?.draft?.id === workId) clearDubbingLocalDraft()
      const rows = this.data.rows.filter(item => item.id !== workId)
      const deleteIntents = { ...this.data.deleteIntents }
      delete deleteIntents[workId]
      this.setData({ rows, visibleRows: visibleRows(rows, this.data.statusFilter), deletingId: '',
        deleteError: '', deleteIntents })
    },
    async playWork(event: WechatMiniprogram.TouchEvent) {
      const workId = event.currentTarget.dataset.id as string
      const session = getSession()
      if (!session || !this.data.rows.some(row => row.id === workId && !row.isDraft && !row.mediaExpired)) return
      if (this.data.playingId === workId) {
        activeAudio?.stop(); activeAudio?.destroy(); activeAudio = null
        this.setData({ playingId: '' }); return
      }
      activeAudio?.destroy(); activeAudio = null
      this.setData({ playingId: '', playbackError: '' })
      const result = await getWorkPlayback(session.user.id, workId)
      if (!result.ok) { this.setData({ playbackError: result.error.message }); return }
      const audio = wx.createInnerAudioContext()
      activeAudio = audio
      audio.src = result.data.temporaryUrl
      audio.onEnded(() => { audio.destroy(); if (activeAudio === audio) activeAudio = null; this.setData({ playingId: '' }) })
      audio.onError(() => { audio.destroy(); if (activeAudio === audio) activeAudio = null;
        this.setData({ playingId: '', playbackError: '作品播放失败，请重试' }) })
      this.setData({ playingId: workId })
      audio.play()
    },
  },
})
