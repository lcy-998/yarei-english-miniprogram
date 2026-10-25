import { MyTaskDubbingWorkPage, StudentWork, WorkMaterial } from '../domain/types'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { deleteWorkDraft, getWorkPlayback, listMyWorks, listWorkMaterials } from '../services/app-service'
import { getSession, setCurrentTaskId } from '../session/session'
import { clearDubbingLocalDraft, readDubbingLocalDraft } from '../shared/dubbing-local-draft'
import { preferDubbingMaterial } from '../shared/dubbing-navigation'
import { EMPTY_WRITE_INTENT, WriteIntentState, createPageOperationId, prepareWriteIntent } from '../shared/write-intent'
import { beginPronunciationScore, getMyPronunciationPlayback,
  listMyPronunciationWorks } from '../services/student-pronunciation-service'
import { getTaskDubbingPlayback, listMyTaskDubbingWorks } from '../services/task-media-service'
import { pronunciationWorkRow, type PronunciationWorkRow } from './pronunciation-work-view'

interface WorkRow { id: string; materialTitle: string; statusLabel: string; submittedLabel: string;
  durationLabel: string; note: string; mediaExpired: boolean; isDraft: boolean; work: StudentWork }
type TaskDubbingRow = MyTaskDubbingWorkPage['items'][number] & {
  statusLabel: string; submittedLabel: string; durationLabel: string
}
type WorkFilter = 'all' | 'draft' | 'submitted'

function taskDubbingRow(item: MyTaskDubbingWorkPage['items'][number]): TaskDubbingRow {
  return { ...item, statusLabel: item.status === 'formal' ? '已正式提交' : '作品已封存，待任务提交',
    submittedLabel: Number.isFinite(Date.parse(item.submittedAt))
      ? new Date(item.submittedAt).toLocaleString('zh-CN') : '提交时间未记录',
    durationLabel: `${Math.round(item.durationMs / 1000)} 秒` }
}

function visibleRows(rows: WorkRow[], filter: WorkFilter): WorkRow[] {
  return filter === 'all' ? rows : rows.filter(row => row.work.status === filter)
}

function sameStudentSession(userId: string, sessionId: string): boolean {
  const current = getSession()
  return current?.user.id === userId && current.sessionId === sessionId
    && (current.activeRole ?? current.user.role) === 'student'
}

let activeAudio: WechatMiniprogram.InnerAudioContext | null = null

Component({
  data: { loading: true, error: '', rows: [] as WorkRow[], visibleRows: [] as WorkRow[],
    statusFilter: 'all' as WorkFilter, playingId: '', playbackError: '',
    pronunciationRows: [] as PronunciationWorkRow[], pronunciationCursor: null as string | null,
    pronunciationLoading: false, pronunciationError: '', pronunciationLoaded: false,
    playingPronunciationId: '', retryingPronunciationId: '', pronunciationRetryError: '',
    taskDubbingRows: [] as TaskDubbingRow[], taskDubbingNextOffset: null as number | null,
    taskDubbingLoading: false, taskDubbingError: '', taskDubbingLoaded: false,
    taskDubbingOwnerKey: '', playingTaskDubbingId: '',
    deletingId: '', deleteError: '', deleteIntents: {} as Record<string, WriteIntentState> },
  lifetimes: { attached() { this.loadWorks(); this.loadPronunciationWorks(); this.loadTaskDubbingWorks() },
    detached() { activeAudio?.destroy(); activeAudio = null } },
  pageLifetimes: { show() { this.loadWorks(); this.loadPronunciationWorks(); this.loadTaskDubbingWorks() },
    hide() { activeAudio?.pause(); this.setData({ playingId: '', playingPronunciationId: '',
      playingTaskDubbingId: '' }) } },
  methods: {
    async loadTaskDubbingWorks(offset = 0) {
      const session = getSession()
      if (!session) return
      const ownerKey = `${session.user.id}:${session.sessionId}`
      if (this.data.taskDubbingOwnerKey !== ownerKey) {
        if (this.data.taskDubbingOwnerKey) { activeAudio?.destroy(); activeAudio = null }
        this.setData({ taskDubbingOwnerKey: ownerKey, taskDubbingRows: [],
          taskDubbingNextOffset: null, taskDubbingLoaded: false,
          taskDubbingLoading: false, taskDubbingError: '',
          playingTaskDubbingId: '' })
      }
      if (this.data.taskDubbingLoading) return
      if (getRepositoryMode() !== 'cloudbase') {
        this.setData({ taskDubbingLoaded: true, taskDubbingRows: [],
          taskDubbingNextOffset: null, taskDubbingError: '' }); return
      }
      this.setData({ taskDubbingLoading: true, taskDubbingError: '' })
      const result = await listMyTaskDubbingWorks(session.user.id, offset, 20)
      if (!sameStudentSession(session.user.id, session.sessionId)
        || this.data.taskDubbingOwnerKey !== ownerKey) return
      if (!result.ok) {
        this.setData({ taskDubbingLoading: false, taskDubbingError: result.error.message }); return
      }
      const rows = result.data.items.map(taskDubbingRow)
      this.setData({ taskDubbingLoading: false, taskDubbingLoaded: true,
        taskDubbingRows: offset === 0 ? rows : [...this.data.taskDubbingRows, ...rows],
        taskDubbingNextOffset: result.data.nextOffset })
    },
    loadMoreTaskDubbingWorks() {
      if (this.data.taskDubbingNextOffset !== null && !this.data.taskDubbingLoading) {
        void this.loadTaskDubbingWorks(this.data.taskDubbingNextOffset)
      }
    },
    retryTaskDubbingWorks() { void this.loadTaskDubbingWorks() },
    openTaskDubbingTask(event: WechatMiniprogram.TouchEvent) {
      const taskId = event.currentTarget.dataset.taskId as string
      if (!this.data.taskDubbingRows.some(row => row.taskId === taskId)) return
      setCurrentTaskId(taskId)
      wx.navigateTo({ url: '/subpackages/student/task-detail/task-detail' })
    },
    async playTaskDubbing(event: WechatMiniprogram.TouchEvent) {
      const workId = event.currentTarget.dataset.id as string
      const row = this.data.taskDubbingRows.find(item => item.workId === workId && item.playbackAvailable)
      const session = getSession()
      if (!session || !row) return
      if (this.data.playingTaskDubbingId === workId) {
        activeAudio?.stop(); activeAudio?.destroy(); activeAudio = null
        this.setData({ playingTaskDubbingId: '' }); return
      }
      activeAudio?.destroy(); activeAudio = null
      this.setData({ playingId: '', playingPronunciationId: '', playingTaskDubbingId: '', playbackError: '' })
      const result = await getTaskDubbingPlayback(session.user.id, workId)
      if (!sameStudentSession(session.user.id, session.sessionId)) return
      if (!result.ok) { this.setData({ playbackError: result.error.message }); return }
      if (!result.data.temporaryUrl.startsWith('https://')
        || Date.parse(result.data.expiresAt) <= Date.now()) {
        this.setData({ playbackError: '任务配音试听地址已失效，请重试' }); return
      }
      const audio = wx.createInnerAudioContext()
      activeAudio = audio
      audio.src = result.data.temporaryUrl
      audio.onEnded(() => { audio.destroy(); if (activeAudio === audio) activeAudio = null
        this.setData({ playingTaskDubbingId: '' }) })
      audio.onError(() => { audio.destroy(); if (activeAudio === audio) activeAudio = null
        this.setData({ playingTaskDubbingId: '', playbackError: '任务配音试听失败，请重试' }) })
      this.setData({ playingTaskDubbingId: workId })
      audio.play()
    },
    async loadPronunciationWorks(cursor: string | null = null) {
      const session = getSession()
      if (!session || this.data.pronunciationLoading) return
      this.setData({ pronunciationLoading: true, pronunciationError: '' })
      const result = await listMyPronunciationWorks(session.user.id, cursor, 20)
      if (!sameStudentSession(session.user.id, session.sessionId)) return
      if (!result.ok) {
        this.setData({ pronunciationLoading: false, pronunciationError: result.error.message }); return
      }
      const rows = result.data.items.map(pronunciationWorkRow)
      this.setData({ pronunciationLoading: false, pronunciationLoaded: true,
        pronunciationRows: cursor === null ? rows : [...this.data.pronunciationRows, ...rows],
        pronunciationCursor: result.data.nextCursor })
    },
    loadMorePronunciationWorks() {
      if (this.data.pronunciationCursor && !this.data.pronunciationLoading) {
        void this.loadPronunciationWorks(this.data.pronunciationCursor)
      }
    },
    retryPronunciationWorks() { void this.loadPronunciationWorks() },
    async retryPronunciationScore(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const scoreId = event.currentTarget.dataset.id as string
      const row = this.data.pronunciationRows.find(item => item.id === scoreId && item.canRetry)
      if (!session || !row || this.data.retryingPronunciationId) return
      this.setData({ retryingPronunciationId: scoreId, pronunciationRetryError: '' })
      const result = await beginPronunciationScore(session.user.id, row.recordingId,
        createPageOperationId('retry_pronunciation'), row.expectedVersion)
      if (!sameStudentSession(session.user.id, session.sessionId)) return
      this.setData({ retryingPronunciationId: '' })
      if (!result.ok) {
        this.setData({ pronunciationRetryError: `${result.error.message}；原录音仍保留，可重试` }); return
      }
      wx.showToast({ title: result.data.status === 'processing' ? '已重新排队评分' : '评分状态已更新', icon: 'none' })
      void this.loadPronunciationWorks()
    },
    async loadWorks() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const [works, materials] = await Promise.all([
        listMyWorks(session.user.id), listWorkMaterials(session.user.id),
      ])
      if (!sameStudentSession(session.user.id, session.sessionId)) return
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
    openDubbing() { wx.navigateTo({ url: '/subpackages/student-media/dubbing/dubbing' }) },
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
      wx.showModal({ title: '删除配音草稿？', content: '删除后无法恢复，请确认是否删除。', confirmText: '删除',
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
      this.setData({ playingId: '', playingPronunciationId: '', playingTaskDubbingId: '', playbackError: '' })
      const result = await getWorkPlayback(session.user.id, workId)
      if (!sameStudentSession(session.user.id, session.sessionId)) return
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
    async playPronunciation(event: WechatMiniprogram.TouchEvent) {
      const scoreId = event.currentTarget.dataset.id as string
      const row = this.data.pronunciationRows.find(item => item.id === scoreId && item.canPlay)
      const session = getSession()
      if (!session || !row) return
      if (this.data.playingPronunciationId === scoreId) {
        activeAudio?.stop(); activeAudio?.destroy(); activeAudio = null
        this.setData({ playingPronunciationId: '' }); return
      }
      activeAudio?.destroy(); activeAudio = null
      this.setData({ playingId: '', playingPronunciationId: '', playingTaskDubbingId: '', playbackError: '' })
      const result = await getMyPronunciationPlayback(session.user.id, row.recordingId)
      if (!sameStudentSession(session.user.id, session.sessionId)) return
      if (!result.ok) { this.setData({ playbackError: result.error.message }); return }
      const playback = result.data.playback
      if (result.data.mediaExpired === true || !playback
        || !playback.temporaryUrl.startsWith('https://')
        || Date.parse(playback.expiresAt) <= Date.now()) {
        this.setData({ playbackError: result.data.mediaExpired === true
          ? '录音已过保留期，评分记录仍保留' : '试听地址暂不可用，请稍后重试' })
        return
      }
      const audio = wx.createInnerAudioContext()
      activeAudio = audio
      audio.src = playback.temporaryUrl
      audio.onEnded(() => { audio.destroy(); if (activeAudio === audio) activeAudio = null
        this.setData({ playingPronunciationId: '' }) })
      audio.onError(() => { audio.destroy(); if (activeAudio === audio) activeAudio = null
        this.setData({ playingPronunciationId: '', playbackError: '跟读录音试听失败，请重试' }) })
      this.setData({ playingPronunciationId: scoreId })
      audio.play()
    },
  },
})
