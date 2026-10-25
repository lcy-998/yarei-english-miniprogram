// T-20: read-only media and per-question listening clip preview.
import type { TeacherAssetPreview } from '../../../domain/teacher-media'
import { previewTeacherAsset } from '../services/teacher-media-service'
import { getSession } from '../session/session'

let audio: ReturnType<typeof wx.createInnerAudioContext> | null = null
let pendingClipStartMs: number | null = null
let audioWaitTimer: ReturnType<typeof setTimeout> | null = null
function clearAudioWaitTimer(): void {
  if (audioWaitTimer) clearTimeout(audioWaitTimer)
  audioWaitTimer = null
}
function playbackFresh(asset: TeacherAssetPreview | null): boolean {
  return !!asset && Date.parse(asset.playback.expiresAt) > Date.now() + 5000
}
function timeLabel(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
type PreviewQuestion = TeacherAssetPreview['questions'][number] & { hasClip: boolean; clipLabel: string }

Component({
  data: { resourceId: '', targetClassIds: [] as string[], asset: null as TeacherAssetPreview | null,
    questions: [] as PreviewQuestion[], durationLabel: '',
    loading: true, error: '', playing: false, audioReady: false,
    clipEndMs: null as number | null, initialized: false },
  pageLifetimes: { show() {
    if (this.data.initialized) {
      if (this.data.asset && !playbackFresh(this.data.asset)) this.load()
      return
    }
    const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
    const options = pages[pages.length - 1]?.options ?? {}
    const resourceId = options.id ? decodeURIComponent(options.id) : ''
    const targetClassIds = options.targetClassIds
      ? decodeURIComponent(options.targetClassIds).split(',').filter(Boolean) : []
    this.setData({ initialized: true, resourceId, targetClassIds }, () => this.load())
  }, hide() {
    pendingClipStartMs = null
    clearAudioWaitTimer()
    audio?.pause()
    if (this.data.asset && this.data.asset.kind !== 'listening') wx.createVideoContext('teacher-preview-video', this).pause()
    this.setData({ playing: false, clipEndMs: null })
  } },
  lifetimes: { detached() { pendingClipStartMs = null; clearAudioWaitTimer(); audio?.destroy(); audio = null } },
  methods: {
    async load() {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'teacher' || !this.data.resourceId) {
        this.setData({ loading: false, error: '素材或教师授权无效' }); return
      }
      pendingClipStartMs = null
      clearAudioWaitTimer()
      audio?.pause(); audio?.destroy(); audio = null
      this.setData({ loading: true, error: '', playing: false, audioReady: false, clipEndMs: null })
      const result = await previewTeacherAsset(session.user.id, this.data.resourceId,
        this.data.targetClassIds.length ? this.data.targetClassIds : undefined)
      const currentSession = getSession()
      if (currentSession?.sessionId !== session.sessionId
        || (currentSession.activeRole ?? currentSession.user.role) !== 'teacher') {
        this.setData({ loading: false, asset: null,
          error: '教师预览权限已变化，请返回重新进入' }); return
      }
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      if (result.data.kind === 'listening') {
        const next = wx.createInnerAudioContext()
        audio = next
        next.onCanplay(() => { if (audio === next) this.setData({ audioReady: true }) })
        next.onSeeked(() => {
          if (pendingClipStartMs === null || audio !== next) return
          pendingClipStartMs = null
          next.play()
          this.setData({ playing: true, error: '' })
        })
        next.onEnded(() => { if (audio === next) {
          clearAudioWaitTimer(); pendingClipStartMs = null
          this.setData({ playing: false, clipEndMs: null })
        } })
        next.onError(() => { if (audio === next) {
          clearAudioWaitTimer(); this.setData({ playing: false, audioReady: false,
            error: '音频播放失败，请刷新试听地址' })
        } })
        next.onTimeUpdate(() => {
          if (audio !== next) return
          clearAudioWaitTimer()
          if (!this.data.audioReady) this.setData({ audioReady: true })
          if (this.data.clipEndMs !== null && next.currentTime * 1000 >= this.data.clipEndMs) {
            next.pause(); this.setData({ playing: false, clipEndMs: null })
          }
        })
        next.src = result.data.playback.temporaryUrl
      }
      const clips = new Map(result.data.clips.map(clip => [clip.questionId, clip]))
      const questions: PreviewQuestion[] = result.data.questions.map(question => {
        const clip = clips.get(question.questionId)
        return { ...question, hasClip: !!clip,
          clipLabel: clip ? `${(clip.startMs / 1000).toFixed(3)}—${(clip.endMs / 1000).toFixed(3)} 秒` : '' }
      })
      this.setData({ loading: false, asset: result.data, questions,
        durationLabel: timeLabel(result.data.durationMs) })
    },
    toggleAudio() {
      if (!audio || !this.data.asset || this.data.asset.kind !== 'listening') return
      if (!playbackFresh(this.data.asset)) {
        this.setData({ error: '试听地址已过期，请刷新后重试' }); return
      }
      if (this.data.playing) {
        clearAudioWaitTimer(); pendingClipStartMs = null; audio.pause()
        this.setData({ playing: false, clipEndMs: null })
      } else {
        const currentAudio = audio
        clearAudioWaitTimer()
        audioWaitTimer = setTimeout(() => {
          if (audio !== currentAudio || !this.data.playing) return
          currentAudio.pause()
          this.setData({ playing: false, error: '音频加载超时，请刷新试听地址后重试' })
        }, 12000)
        this.setData({ playing: true, clipEndMs: null, error: '' })
        audio.play()
      }
    },
    playClip(event: WechatMiniprogram.TouchEvent) {
      const questionId = event.currentTarget.dataset.questionId as string
      const clip = this.data.asset?.clips.find(item => item.questionId === questionId)
      if (!audio || !clip) { this.setData({ error: '本题试听片段尚不可用' }); return }
      if (!playbackFresh(this.data.asset)) {
        this.setData({ error: '试听地址已过期，请刷新后重试' }); return
      }
      if (!this.data.audioReady) {
        this.setData({ error: '请先播放整段音频，音频就绪后再试听片段' }); return
      }
      audio.pause()
      pendingClipStartMs = clip.startMs
      this.setData({ playing: false, clipEndMs: clip.endMs, error: '' })
      audio.seek(clip.startMs / 1000)
    },
    onMediaError() { this.setData({ playing: false, error: '视频播放失败或地址已过期，请刷新试听地址' }) },
  },
})
