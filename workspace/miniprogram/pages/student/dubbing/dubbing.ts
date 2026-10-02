import { StudentWork, WorkMaterial, WorkMaterialFacet, WorkMaterialFilters } from '../../../domain/types'
import { getRepositoryMode } from '../../../repositories/repository-factory'
import { beginWorkDraft, getMaterialPlayback, getWorkMaterial, listMyWorks, listWorkMaterialFacets, searchWorkMaterials, submitWork } from '../../../services/app-service'
import { getSession } from '../../../session/session'
import { clearDubbingLocalDraft, readDubbingLocalDraft, saveDubbingLocalDraft } from '../../../shared/dubbing-local-draft'
import { dubbingRecordingIssue } from '../../../shared/dubbing-recording-validation'
import { formatRecordingDuration } from '../../../shared/recording-duration'
import { takePreferredDubbingMaterial } from '../../../shared/dubbing-navigation'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'

type StopResult = { duration: number; fileSize: number; tempFilePath: string }
let activeRecorder: { stop: (result: StopResult) => void; error: () => void } | null = null
let recorderBound = false
const recorder = wx.getRecorderManager()
let recordingStartedAtMs: number | null = null
let recordingTimer: ReturnType<typeof setInterval> | null = null
let materialSearchTimer: ReturnType<typeof setTimeout> | null = null
let materialSearchRequest = 0

function filterOptions(facets: readonly WorkMaterialFacet[], filters: { grade: string; textbook: string; unit: string }) {
  const grades = [...new Set(facets.map(facet => facet.grade || '未标注年级'))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const byGrade = facets.filter(facet => filters.grade === '全部年级'
    || (facet.grade || '未标注年级') === filters.grade)
  const textbooks = [...new Set(byGrade.map(facet => facet.textbook || '未标注教材'))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const byTextbook = byGrade.filter(facet => filters.textbook === '全部教材'
    || (facet.textbook || '未标注教材') === filters.textbook)
  const units = [...new Set(byTextbook.map(facet => facet.unit || '未标注单元'))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return { grades, textbooks, units }
}

function catalogFilters(grade: string, textbook: string, unit: string): WorkMaterialFilters {
  return {
    ...(grade === '全部年级' ? {} : { grade: grade === '未标注年级' ? '__unlabeled_grade__' : grade }),
    ...(textbook === '全部教材' ? {} : { textbook: textbook === '未标注教材' ? '__unlabeled_textbook__' : textbook }),
    ...(unit === '全部单元' ? {} : { unit: unit === '未标注单元' ? '__unlabeled_unit__' : unit }),
  }
}

function stopRecordingTimer(): void {
  if (recordingTimer !== null) clearInterval(recordingTimer)
  recordingTimer = null
  recordingStartedAtMs = null
}

function startRecordingTimer(onTick: () => void): void {
  stopRecordingTimer()
  recordingStartedAtMs = Date.now()
  recordingTimer = setInterval(onTick, 250)
}

function bindRecorder(): void {
  if (recorderBound) return
  recorderBound = true
  recorder.onStop(result => activeRecorder?.stop(result))
  recorder.onError(() => activeRecorder?.error())
}

Component({
  data: {
    loading: true,
    error: '',
    submitError: '',
    materials: [] as WorkMaterial[],
    hasAuthorizedMaterials: false,
    materialTotal: 0,
    materialNextOffset: null as number | null,
    materialKeyword: '',
    materialSelectOpen: false,
    materialSearchLoading: false,
    materialSearchError: '',
    materialFacets: [] as WorkMaterialFacet[],
    hasMaterialFilters: false,
    materialFilterOptions: { grades: [] as string[], textbooks: [] as string[], units: [] as string[] },
    gradeFilter: '全部年级',
    textbookFilter: '全部教材',
    unitFilter: '全部单元',
    materialFilterOpen: '',
    selectedMaterialId: '',
    selectedMaterial: null as WorkMaterial | null,
    demonstrationUrl: '',
    demonstrationSpeed: 1,
    recordingState: 'idle' as 'idle' | 'recording' | 'local' | 'uploading' | 'submitted',
    recordingIssue: '',
    localPath: '',
    durationMs: 0,
    durationLabel: '00:00',
    fileSize: 0,
    note: '',
    draft: null as StudentWork | null,
    submittedWork: null as StudentWork | null,
    submitting: false,
    beginIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    submitIntent: EMPTY_WRITE_INTENT as WriteIntentState,
  },
  lifetimes: {
    attached() {
      bindRecorder()
      activeRecorder = { stop: result => this.onRecorderStopped(result), error: () => this.onRecorderFailed() }
      this.loadMaterials()
    },
    detached() {
      this.rememberLocalDraft()
      stopRecordingTimer()
      if (materialSearchTimer) clearTimeout(materialSearchTimer)
      materialSearchRequest += 1
      activeRecorder = null
      if (this.data.recordingState === 'recording') recorder.stop()
    },
  },
  methods: {
    async loadMaterials() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const [result, facets] = await Promise.all([
        searchWorkMaterials(session.user.id, '', 20, 0), listWorkMaterialFacets(session.user.id),
      ])
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const saved = readDubbingLocalDraft(session.user.id, session.sessionId)
      const preferredMaterialId = takePreferredDubbingMaterial(session.user.id, session.sessionId)
      const remembered = wx.getStorageSync(`dubbing_recent_material_${session.user.id}`) as unknown
      const recentMaterialId = typeof remembered === 'string' ? remembered : ''
      const hasLocalRecording = Boolean(saved?.localPath || this.data.localPath)
      let selectedMaterialId = saved?.materialId || preferredMaterialId
        || this.data.selectedMaterialId || recentMaterialId || result.data.items[0]?.id || ''
      const listedMaterial = result.data.items.find(item => item.id === selectedMaterialId)
      const selectedResult = selectedMaterialId && !listedMaterial
        ? await getWorkMaterial(session.user.id, selectedMaterialId) : null
      let authorizedMaterial = listedMaterial ?? (selectedResult?.ok ? selectedResult.data : null)
      if (!authorizedMaterial && !saved?.materialId && !preferredMaterialId && !hasLocalRecording) {
        authorizedMaterial = result.data.items[0] ?? null
        selectedMaterialId = authorizedMaterial?.id ?? ''
      }
      const needsPreferredTitle = preferredMaterialId && saved?.localPath && saved.materialId !== preferredMaterialId
      const preferredListed = needsPreferredTitle
        ? result.data.items.find(item => item.id === preferredMaterialId) : undefined
      const preferredLookup = needsPreferredTitle && !preferredListed
        ? await getWorkMaterial(session.user.id, preferredMaterialId) : null
      const preferredTitle = preferredListed?.title ?? (preferredLookup?.ok ? preferredLookup.data.title : '指定素材')
      const materialVersion = saved?.materialVersion ?? this.data.draft?.materialVersion
      const selectedMaterial = authorizedMaterial && (!hasLocalRecording || !materialVersion
        || authorizedMaterial.contentVersion === materialVersion) ? authorizedMaterial : null
      this.setData({ loading: false, materials: result.data.items, hasAuthorizedMaterials: result.data.total > 0,
        materialTotal: result.data.total,
        materialNextOffset: result.data.nextOffset, materialKeyword: '', materialSelectOpen: false,
        materialSearchLoading: false, materialSearchError: '', selectedMaterialId, selectedMaterial,
        materialFacets: facets.ok ? facets.data : [],
        hasMaterialFilters: facets.ok && facets.data.some(item => Boolean(item.grade || item.textbook || item.unit)),
        materialFilterOptions: filterOptions(facets.ok ? facets.data : [],
          { grade: '全部年级', textbook: '全部教材', unit: '全部单元' }),
        gradeFilter: '全部年级', textbookFilter: '全部教材', unitFilter: '全部单元', materialFilterOpen: '',
        ...(saved ? { localPath: saved.localPath, durationMs: saved.durationMs,
          durationLabel: formatRecordingDuration(saved.durationMs), fileSize: saved.fileSize, note: saved.note,
          recordingIssue: dubbingRecordingIssue(saved.durationMs, saved.fileSize, saved.localPath),
          draft: saved.draft, beginIntent: saved.beginIntent, submitIntent: saved.submitIntent,
          recordingState: 'local' as const } : {}),
        ...(preferredMaterialId && saved?.localPath && saved.materialId !== preferredMaterialId
          ? { submitError: `本次打卡需使用“${preferredTitle}”；当前保留了另一素材的录音，请先切换素材。` }
          : hasLocalRecording && !selectedMaterial
          ? { submitError: '原配音素材已不可用或已更新，录音仍保留；请重新选择素材并录制' }
          : preferredMaterialId && !selectedMaterial
            ? { submitError: '原配音素材已不可用，请选择其他素材' } : {}) },
      () => this.loadDemonstration())
    },
    async loadDemonstration() {
      const material = this.data.selectedMaterial
      const session = getSession()
      if (!material || !session || getRepositoryMode() !== 'cloudbase') { this.setData({ demonstrationUrl: '' }); return }
      const result = await getMaterialPlayback(session.user.id, material.id)
      if (this.data.selectedMaterialId !== material.id) return
      this.setData({ demonstrationUrl: result.ok ? result.data.temporaryUrl : '' })
    },
    selectMaterial(event: WechatMiniprogram.TouchEvent) {
      const materialId = event.currentTarget.dataset.id as string
      if (!this.data.materials.some(item => item.id === materialId)
        || (materialId === this.data.selectedMaterialId && this.data.selectedMaterial !== null)
        || this.data.recordingState === 'recording' || this.data.submitting) return
      const select = () => { clearDubbingLocalDraft(); const session = getSession()
        if (session) wx.setStorageSync(`dubbing_recent_material_${session.user.id}`, materialId)
        this.setData({ selectedMaterialId: materialId,
        selectedMaterial: this.data.materials.find(item => item.id === materialId) ?? null,
        materialSelectOpen: false,
        demonstrationUrl: '', localPath: '',
        durationMs: 0, durationLabel: '00:00', fileSize: 0, recordingState: 'idle', recordingIssue: '',
        draft: null, submittedWork: null,
        beginIntent: clearWriteIntent(), submitIntent: clearWriteIntent(), submitError: '' }, () => this.loadDemonstration()) }
      if (!this.data.localPath) { select(); return }
      wx.showModal({ title: '切换配音素材？', content: '当前未提交的录音会从页面清除。',
        confirmText: '切换', success: result => { if (result.confirm) select() } })
    },
    toggleMaterialSelect() {
      if (this.data.recordingState === 'recording' || this.data.submitting) return
      this.setData({ materialSelectOpen: !this.data.materialSelectOpen })
    },
    onMaterialSearch(event: WechatMiniprogram.Input) {
      this.setData({ materialKeyword: event.detail.value })
      if (materialSearchTimer) clearTimeout(materialSearchTimer)
      materialSearchTimer = setTimeout(() => { void this.refreshMaterialCatalog() }, 250)
    },
    clearMaterialSearch() {
      if (materialSearchTimer) clearTimeout(materialSearchTimer)
      const filters = { grade: '全部年级', textbook: '全部教材', unit: '全部单元' }
      this.setData({ materialKeyword: '', gradeFilter: filters.grade, textbookFilter: filters.textbook,
        unitFilter: filters.unit, materialFilterOpen: '',
        materialFilterOptions: filterOptions(this.data.materialFacets, filters) },
      () => { void this.refreshMaterialCatalog() })
    },
    toggleMaterialFilter(event: WechatMiniprogram.TouchEvent) {
      const key = event.currentTarget.dataset.key as string
      if (key !== 'grade' && key !== 'textbook' && key !== 'unit') return
      this.setData({ materialFilterOpen: this.data.materialFilterOpen === key ? '' : key })
    },
    chooseMaterialFilter(event: WechatMiniprogram.TouchEvent) {
      const key = event.currentTarget.dataset.key as 'grade' | 'textbook' | 'unit'
      const value = event.currentTarget.dataset.value as string
      if (!['grade', 'textbook', 'unit'].includes(key) || !value) return
      const filters = { grade: key === 'grade' ? value : this.data.gradeFilter,
        textbook: key === 'grade' ? '全部教材' : key === 'textbook' ? value : this.data.textbookFilter,
        unit: key === 'grade' || key === 'textbook' ? '全部单元' : value }
      this.setData({ gradeFilter: filters.grade, textbookFilter: filters.textbook, unitFilter: filters.unit,
        materialFilterOpen: '', materialFilterOptions: filterOptions(this.data.materialFacets, filters) },
      () => { void this.refreshMaterialCatalog() })
    },
    async refreshMaterialCatalog(offset = 0) {
      const session = getSession()
      if (!session) return
      const request = ++materialSearchRequest
      this.setData({ materialSearchLoading: true, materialSearchError: '' })
      const result = await searchWorkMaterials(session.user.id, this.data.materialKeyword.trim(), 20, offset,
        catalogFilters(this.data.gradeFilter, this.data.textbookFilter, this.data.unitFilter))
      if (request !== materialSearchRequest) return
      if (!result.ok) {
        this.setData({ materialSearchLoading: false, materialSearchError: result.error.message }); return
      }
      this.setData({ materialSearchLoading: false,
        materials: offset === 0 ? result.data.items : [...this.data.materials, ...result.data.items],
        materialTotal: result.data.total, materialNextOffset: result.data.nextOffset })
    },
    loadMoreMaterials() {
      if (!this.data.materialSearchLoading && this.data.materialNextOffset !== null) {
        void this.refreshMaterialCatalog(this.data.materialNextOffset)
      }
    },
    cycleSpeed() {
      const speeds = [0.75, 1, 1.25, 1.5, 2]
      const index = speeds.indexOf(this.data.demonstrationSpeed)
      const speed = speeds[(index + 1) % speeds.length]!
      this.setData({ demonstrationSpeed: speed })
      wx.createVideoContext('demonstration', this).playbackRate(speed)
    },
    async startRecording() {
      if (!this.data.selectedMaterial) {
        this.setData({ submitError: '请先选择可用的配音素材' }); return
      }
      if (this.data.recordingState === 'recording' || this.data.submitting || this.data.localPath
        || !this.data.selectedMaterialId) return
      try { await wx.authorize({ scope: 'scope.record' }) }
      catch (_error: unknown) { this.setData({ submitError: '请在微信设置中允许使用麦克风后重试' }); return }
      this.setData({ recordingState: 'recording', materialSelectOpen: false, durationMs: 0, durationLabel: '00:00',
        recordingIssue: '', submitError: '', submittedWork: null })
      try {
        recorder.start({ duration: 300000, sampleRate: 16000, encodeBitRate: 64000,
          numberOfChannels: 1, format: 'mp3' })
        startRecordingTimer(() => {
          if (this.data.recordingState !== 'recording' || recordingStartedAtMs === null) {
            stopRecordingTimer()
            return
          }
          const durationMs = Math.min(300000, Math.max(0, Date.now() - recordingStartedAtMs))
          const durationLabel = formatRecordingDuration(durationMs)
          if (durationLabel !== this.data.durationLabel) this.setData({ durationMs, durationLabel })
        })
      } catch (_error: unknown) {
        stopRecordingTimer()
        this.setData({ recordingState: 'idle', durationMs: 0, durationLabel: '00:00',
          recordingIssue: '录音未能开始，请重新录制', submitError: '' })
      }
    },
    stopRecording() { if (this.data.recordingState === 'recording') { stopRecordingTimer(); recorder.stop() } },
    onRecorderStopped(result: StopResult) {
      if (this.data.recordingState !== 'recording') return
      stopRecordingTimer()
      const recordingIssue = dubbingRecordingIssue(result.duration, result.fileSize, result.tempFilePath)
      this.setData({ recordingState: result.tempFilePath ? 'local' : 'idle', localPath: result.tempFilePath,
        durationMs: result.duration, durationLabel: formatRecordingDuration(result.duration),
        fileSize: result.fileSize, recordingIssue, submitIntent: clearWriteIntent(), submitError: '' })
      this.rememberLocalDraft()
    },
    onRecorderFailed() {
      if (this.data.recordingState === 'recording') {
        stopRecordingTimer()
        this.setData({ recordingState: 'idle', durationMs: 0, durationLabel: '00:00',
          recordingIssue: '录音失败，请重新录制', submitError: '' })
      }
    },
    playRecording() {
      if (!this.data.localPath) return
      const audio = wx.createInnerAudioContext()
      audio.src = this.data.localPath
      audio.onEnded(() => audio.destroy())
      audio.onError(() => { audio.destroy(); wx.showToast({ title: '试听失败，请重试', icon: 'none' }) })
      audio.play()
    },
    redoRecording() {
      if (!this.data.localPath || this.data.submitting) return
      wx.showModal({ title: '重新录制？', content: '当前录音会从页面清除。', confirmText: '重录',
        success: result => { if (result.confirm) { clearDubbingLocalDraft(); this.setData({ localPath: '', durationMs: 0,
          durationLabel: '00:00', fileSize: 0, recordingState: 'idle', recordingIssue: '',
          submitError: '', submittedWork: null,
          ...(this.data.draft?.status === 'submitted' ? { draft: null, beginIntent: clearWriteIntent() } : {}),
          submitIntent: clearWriteIntent() }) } } })
    },
    onNote(event: WechatMiniprogram.Input) {
      this.setData({ note: event.detail.value, submitIntent: clearWriteIntent(), submitError: '' })
      this.rememberLocalDraft()
    },
    rememberLocalDraft() {
      const session = getSession()
      const materialVersion = this.data.selectedMaterial?.contentVersion
        ?? readDubbingLocalDraft(session?.user.id ?? '', session?.sessionId ?? '')?.materialVersion
        ?? this.data.draft?.materialVersion ?? ''
      if (!session || !this.data.localPath || this.data.recordingState === 'submitted') return
      saveDubbingLocalDraft({ ownerUserId: session.user.id, ownerSessionId: session.sessionId,
        materialId: this.data.selectedMaterialId,
        materialVersion, localPath: this.data.localPath, durationMs: this.data.durationMs,
        fileSize: this.data.fileSize, note: this.data.note, draft: this.data.draft,
        beginIntent: this.data.beginIntent, submitIntent: this.data.submitIntent })
    },
    async submitRecording() {
      const session = getSession()
      if (!session || this.data.submitting || this.data.recordingState !== 'local'
        || !this.data.localPath || this.data.recordingIssue) return
      if (!this.data.selectedMaterial || this.data.selectedMaterial.id !== this.data.selectedMaterialId) {
        this.setData({ submitError: '原配音素材已不可用，请重新选择素材并录制' }); return
      }
      const recordingIssue = dubbingRecordingIssue(this.data.durationMs, this.data.fileSize, this.data.localPath)
      if (recordingIssue) { this.setData({ recordingIssue, submitError: '' }); return }
      this.setData({ submitting: true, recordingState: 'uploading', submitError: '' })
      let draft = this.data.draft
      if (!draft || draft.status !== 'draft' || draft.materialId !== this.data.selectedMaterialId) {
        const beginIntent = prepareWriteIntent(this.data.beginIntent, this.data.selectedMaterialId,
          () => createPageOperationId('begin_work'))
        this.setData({ beginIntent })
        const begun = await beginWorkDraft(session.user.id, this.data.selectedMaterialId, beginIntent.operationId)
        if (!begun.ok) { this.setData({ submitting: false, recordingState: 'local', submitError: begun.error.message });
          this.rememberLocalDraft(); return }
        draft = begun.data
        this.setData({ draft, beginIntent: clearWriteIntent() })
      }
      let stagingFileId: string
      try {
        const uploaded = await wx.cloud.uploadFile({ cloudPath: draft.stagingPath, filePath: this.data.localPath })
        stagingFileId = uploaded.fileID
      } catch (_error: unknown) {
        this.setData({ submitting: false, recordingState: 'local', submitError: '上传失败，录音已保留，可重试' })
        this.rememberLocalDraft()
        return
      }
      const fingerprint = JSON.stringify({ workId: draft.id, stagingFileId, note: this.data.note.trim(), version: draft.version })
      const submitIntent = prepareWriteIntent(this.data.submitIntent, fingerprint,
        () => createPageOperationId('submit_work'))
      this.setData({ submitIntent })
      const submitted = await submitWork(session.user.id, { workId: draft.id, stagingFileId,
        note: this.data.note.trim() }, draft.version, submitIntent.operationId)
      if (!submitted.ok) {
        const verified = await listMyWorks(session.user.id)
        const committed = verified.ok ? verified.data.find(work => work.id === draft.id && work.status === 'submitted') : null
        if (committed) {
          clearDubbingLocalDraft()
          this.setData({ submitting: false, recordingState: 'submitted', submittedWork: committed,
            draft: committed, submitError: '', submitIntent: clearWriteIntent() })
          wx.showToast({ title: '作品已提交', icon: 'success' })
          return
        }
        if (submitted.error.code === 'MEDIA_INVALID') {
          this.setData({ submitting: false, recordingState: 'local',
            recordingIssue: '', submitError: '云端未通过本次录音核验，录音已保留；可重试，仍失败时请重新录制',
            submitIntent: clearWriteIntent() })
          this.rememberLocalDraft()
          return
        }
        if (submitted.error.code === 'NOT_FOUND' && verified.ok
          && !verified.data.some(work => work.id === draft.id)) {
          this.setData({ submitting: false, recordingState: 'local', draft: null,
            beginIntent: clearWriteIntent(), submitIntent: clearWriteIntent(),
            submitError: '原草稿已删除或不可用，录音仍保留；请重新提交' })
          this.rememberLocalDraft()
          return
        }
        this.setData({ submitting: false, recordingState: 'local', submitError: `${submitted.error.message}，录音已保留，可重试` })
        this.rememberLocalDraft()
        return
      }
      clearDubbingLocalDraft()
      this.setData({ submitting: false, recordingState: 'submitted', submittedWork: submitted.data,
        draft: submitted.data, submitError: '', submitIntent: clearWriteIntent() })
      wx.showToast({ title: '作品已提交', icon: 'success' })
    },
    openMyWorks() { wx.navigateTo({ url: '/pages/student/my-works/my-works' }) },
  },
})
