import { ReadingProgressView, getReadingProgress, setReadingPage, toggleReadingFavorite } from '../services/m1-app-service'
import { getCurrentBookId, getSession, setCurrentTaskId } from '../session/session'
import { TeacherReviewRoute, loadTeacherReviewItem, teacherReviewRoute } from '../shared/teacher-review-item'
import { displayPageImageUrl } from '../shared/reading-page-image'
import { getReadingPronunciationSegments, getTeacherPronunciationEvidence,
  type ReadingPronunciationSegment, type TeacherPronunciationEvidence } from '../services/student-pronunciation-service'
import { getHistoricalTaskLearning, getReadingAudioMap, getReadingResource } from '../services/app-service'
import type { ReadingAudioMapView, ReadingPronunciationSegmentsView, ReadingResource } from '../../../domain/types'
import { confirmedSeekTarget, LEARNING_SPEEDS, readLearningSpeed, saveLearningSpeed } from '../pages/student/student-media-preferences'
import { segmentsForPage, validDemonstrationAudio } from '../shared/reading-media-view'
import { chapterIdForPage, clampReadingAudioPosition, hotspotsForPage, nextPointreadPage,
  validReadingAudioMap, type ReadingHotspotView } from './reading-audio-map'
import { fitFullscreenImage, fitFullscreenImageToStage, fullscreenSwipeDelta, fullscreenViewport } from './reading-fullscreen'
import { teacherContentPreviewRoute } from '../shared/teacher-content-preview'
import { teacherReadingPreview } from './teacher-reading-preview'
import { scoreDisplay } from '../shared/pronunciation-state'

type TeacherReadingPronunciationSegment = Readonly<{ id: string; text: string; pageNumber?: number }>
type ReviewPagePronunciationSegment = TeacherReadingPronunciationSegment & Readonly<{
  demonstrationAudio?: ReadingPronunciationSegment['demonstrationAudio']
  teacherEvidenceState?: 'loading' | 'ready' | 'not_found' | 'error'
  teacherEvidence?: TeacherPronunciationEvidence
  teacherEvidenceStatusLabel?: string
  teacherEvidenceMessage?: string
}>
type TeacherPronunciationEvidenceEntry = Readonly<{
  state: 'loading' | 'ready' | 'not_found' | 'error'
  evidence?: TeacherPronunciationEvidence
  statusLabel?: string
  message?: string
}>

let activeReadingAudio: ReturnType<typeof wx.createInnerAudioContext> | null = null
let activeAudioSourceKey = ''
let audioMapRequest = 0
const imageLoadTimers = new WeakMap<object, ReturnType<typeof setTimeout>>()
const fullscreenGestureStates = new WeakMap<object, {
  startX: number; startY: number; suppressTapUntil: number
}>()

function clearImageLoadTimer(owner: object) {
  const timer = imageLoadTimers.get(owner)
  if (timer !== undefined) clearTimeout(timer)
  imageLoadTimers.delete(owner)
}

function audioBookmarkKey(userId: string, resourceId: string, chapterId: string): string {
  return `reading_audio_${userId}_${resourceId}_${chapterId}`
}

function sameReadingViewerSession(userId: string, sessionId: string, teacherPreview: boolean): boolean {
  const current = getSession()
  return current?.user.id === userId && current.sessionId === sessionId
    && (current.activeRole ?? current.user.role) === (teacherPreview ? 'teacher' : 'student')
}

function savedAudioPosition(userId: string, map: ReadingAudioMapView): number {
  if (typeof wx.getStorageSync !== 'function') return 0
  const value = wx.getStorageSync(audioBookmarkKey(userId, map.resourceId, map.chapterId)) as unknown
  return typeof value === 'number' ? clampReadingAudioPosition(value, map.durationMs ?? 0) : 0
}

function imageForPage(resource: ReadingResource, pageNumber: number): { imageUrl: string; thumbnailUrl: string } | null {
  for (const chapter of resource.chapters) {
    const page = chapter.pages.find(candidate => candidate.pageNumber === pageNumber)
    if (page) return { imageUrl: displayPageImageUrl(page.imageAssetKey),
      thumbnailUrl: displayPageImageUrl(page.thumbnailAssetKey || page.imageAssetKey) }
  }
  return null
}

Component({
  data: { initialized: false, loading: true, saving: false, imageLoading: true, imageError: false,
    imageRefreshAttempted: false, imageErrorMessage: '', showHighRes: true, zoomed: false,
    error: '', saveError: '', reading: null as ReadingProgressView | null,
    displayPageNumber: 1, displayChapterNumber: 1, displayImageUrl: '', displayThumbnailUrl: '', pendingPageNumber: 0,
    bookId: '', taskId: '', taskItemId: '', taskMode: false, checkinMode: false, taskRequiredPageCount: 0, taskStartPageNumber: 0,
    teacherReviewMode: false, teacherReviewRoute: null as TeacherReviewRoute | null,
    teacherPreviewMode: false, teacherPreviewResourceId: '', teacherPreviewSessionId: '',
    teacherPreviewLoadedAtMs: 0,
    reviewPageIndex: 0, reviewPageVisited: [] as boolean[], reviewSubmissionVersion: 0,
    reviewTaskId: '', reviewAssignmentId: '', teacherEvidenceRequestId: 0,
    teacherPronunciationSegments: [] as TeacherReadingPronunciationSegment[],
    teacherPronunciationEvidence: {} as Record<string, TeacherPronunciationEvidenceEntry>,
    mediaSegments: [] as ReadingPronunciationSegment[], pageSegments: [] as ReviewPagePronunciationSegment[],
    pronunciationCompletedByPage: {} as Record<number, string[]>,
    followReadingBlocked: false, followReadingChecking: false, followReadingProgress: '',
    pointreadPageNumbers: [] as number[], nextPointreadPageNumber: 0,
    readingResource: null as ReadingResource | null, audioMap: null as ReadingAudioMapView | null,
    historicalAudioMaps: [] as ReadingAudioMapView[],
    historicalPronunciation: null as ReadingPronunciationSegmentsView | null,
    audioMapReady: false, pageHotspots: [] as ReadingHotspotView[],
    audioMode: 'none' as 'none' | 'chapter' | 'demo' | 'pointread',
    chapterPositionMs: 0, furthestChapterPositionMs: 0, activeHotspotId: '', pointreadEndMs: 0, pendingAudioSeekMs: -1,
    mediaSpeed: 1, earMode: false, mediaPlaying: false, mediaLoading: false, followReadingRecording: false,
    activeSegmentId: '', mediaError: '', audioMapError: '', audioMapRetryable: false,
    pronunciationError: '', mediaProgress: 0,
    fullscreenStyle: '', fullscreenViewportWidth: 0,
    fullscreenImageStyle: 'width: 1px; height: 1px;', fullscreenNaturalWidth: 0,
    fullscreenNaturalHeight: 0, subtitleInChinese: false,
    mediaCurrentLabel: '00:00', mediaDurationLabel: '00:00',
    returnUrl: '/subpackages/student/reading-library/reading-library' },
  observers: {
    'imageLoading, showHighRes, displayImageUrl'(loading: boolean, showHighRes: boolean, url: string) {
      clearImageLoadTimer(this)
      if (!loading || !showHighRes || !url) return
      const pageNumber = this.data.displayPageNumber
      const timer = setTimeout(() => {
        imageLoadTimers.delete(this)
        if (this.data.imageLoading && this.data.showHighRes
          && this.data.displayImageUrl === url && this.data.displayPageNumber === pageNumber) this.imageFailed()
      }, 12000)
      imageLoadTimers.set(this, timer)
    },
  },
  lifetimes: { detached() { clearImageLoadTimer(this); this.rememberAudioPosition(); activeReadingAudio?.destroy(); activeReadingAudio = null
    activeAudioSourceKey = ''; audioMapRequest++ } },
  pageLifetimes: { hide() { this.rememberAudioPosition(); activeReadingAudio?.pause(); this.setData({ mediaPlaying: false }) }, resize() {
    fullscreenGestureStates.delete(this)
    if (this.data.zoomed) this.updateFullscreenLayout()
  }, show() {
    if (this.data.initialized) {
      if (this.data.teacherPreviewMode && (getSession()?.sessionId !== this.data.teacherPreviewSessionId
        || Date.now() - this.data.teacherPreviewLoadedAtMs > 50 * 60 * 1000)) {
        this.setData({ reading: null }, () => this.loadTeacherPreview())
      }
      return
    }
    const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
    const options = pages[pages.length - 1]?.options
    if (options?.teacherPreview === '1') {
      const route = teacherContentPreviewRoute(options)
      this.setData({ initialized: true, teacherPreviewMode: true,
        teacherPreviewResourceId: route?.type === 'reading' ? route.resourceId : '',
        returnUrl: '/subpackages/teacher/content-selector/content-selector' }, () => this.loadReading())
      return
    }
    if (options?.teacherReview === '1') {
      const route = teacherReviewRoute(options)
      this.setData({ initialized: true, teacherReviewMode: true, teacherReviewRoute: route,
        returnUrl: '/subpackages/teacher/review-task/review-task' }, () => this.loadReading())
      return
    }
    const taskId = options?.taskId ?? ''
    const activityId = options?.activityId ?? ''
    const requiredPageCount = Number(options?.requiredPageCount ?? 0)
    const startPageNumber = Number(options?.startPageNumber ?? 0)
    if (taskId) setCurrentTaskId(taskId)
    this.setData({ initialized: true, bookId: options?.bookId ?? '', taskId, taskItemId: options?.itemId ?? '', taskMode: Boolean(taskId), checkinMode: Boolean(activityId), taskRequiredPageCount: Number.isSafeInteger(requiredPageCount) && requiredPageCount > 0 ? requiredPageCount : 0,
      taskStartPageNumber: Number.isSafeInteger(startPageNumber) && startPageNumber > 0 ? startPageNumber : 0,
      returnUrl: activityId ? `/subpackages/student/checkin-detail/checkin-detail?activityId=${encodeURIComponent(activityId)}`
        : taskId ? '/subpackages/student/task-detail/task-detail' : '/subpackages/student/reading-library/reading-library' }, () => this.loadReading())
  } },
  methods: {
    async loadReading() {
      if (this.data.teacherPreviewMode) { await this.loadTeacherPreview(); return }
      if (this.data.teacherReviewMode) { await this.loadTeacherReview(); return }
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      activeReadingAudio?.destroy(); activeReadingAudio = null
      activeAudioSourceKey = ''; audioMapRequest++
      this.setData({ loading: true, error: '', imageError: false, imageRefreshAttempted: false,
        imageErrorMessage: '',
        mediaSegments: [], pageSegments: [], pointreadPageNumbers: [], nextPointreadPageNumber: 0,
        readingResource: null, audioMap: null,
        audioMapReady: false, pageHotspots: [], audioMode: 'none', earMode: false,
        mediaPlaying: false, followReadingRecording: false, activeSegmentId: '', activeHotspotId: '', mediaError: '',
        audioMapError: '', audioMapRetryable: false, pronunciationError: '' })
      const bookId = this.data.bookId || getCurrentBookId()
      if (!bookId) { this.setData({ loading: false, error: '未找到阅读内容，请返回任务重新打开' }); return }
      const result = await getReadingProgress(session.user.id, bookId,
        this.data.taskMode && this.data.taskId && this.data.taskItemId
          ? { taskId: this.data.taskId, itemId: this.data.taskItemId } : undefined)
      if (!sameReadingViewerSession(session.user.id, session.sessionId, this.data.teacherPreviewMode)) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const startPage = this.data.taskStartPageNumber
        ? result.data.pages.find(page => page.pageNumber === this.data.taskStartPageNumber) : undefined
      const pageImageUrl = startPage?.imageUrl ?? result.data.pageImageUrl
      const thumbnailUrl = startPage?.thumbnailUrl ?? result.data.thumbnailImageUrl
      this.setData({ loading: false, reading: result.data, imageLoading: Boolean(pageImageUrl),
        followReadingBlocked: (this.data.taskMode || this.data.checkinMode) && ['picture', 'picture_book'].includes(result.data.book.category),
        followReadingChecking: (this.data.taskMode || this.data.checkinMode) && ['picture', 'picture_book'].includes(result.data.book.category),
        imageError: !pageImageUrl && !thumbnailUrl,
        imageRefreshAttempted: false, imageErrorMessage: '', showHighRes: Boolean(pageImageUrl), zoomed: false,
        displayPageNumber: startPage?.pageNumber ?? result.data.pageNumber,
        displayChapterNumber: startPage?.chapterNumber ?? result.data.chapterNumber,
        displayImageUrl: pageImageUrl,
        displayThumbnailUrl: thumbnailUrl,
        pendingPageNumber: startPage?.pageNumber ?? 0, saveError: '',
        mediaSpeed: readLearningSpeed(session.user.id) },
      () => { if (!pageImageUrl && !thumbnailUrl) void this.retryImage() })
      if (this.data.taskMode) {
        void this.loadHistoricalTaskLearning(result.data.book.id,
          startPage?.pageNumber ?? result.data.pageNumber)
      } else {
        void this.loadPronunciationSegments(result.data.book.id)
        void this.loadReadingAudioMap(result.data.book.id,
          startPage?.pageNumber ?? result.data.pageNumber)
      }
    },
    async loadHistoricalTaskLearning(resourceId: string, pageNumber: number) {
      const session = getSession()
      if (!session || !this.data.taskId || !this.data.taskItemId) return
      const result = await getHistoricalTaskLearning(session.user.id,
        this.data.taskId, this.data.taskItemId)
      if (!sameReadingViewerSession(session.user.id, session.sessionId, false)
        || this.data.reading?.book.id !== resourceId) return
      if (!result.ok || result.data.resourceId !== resourceId || !result.data.reading) {
        this.setData({ audioMapError: '历史任务音频暂不可用，请核对后继续阅读',
          audioMapRetryable: true, pronunciationError: '' }, () =>
          this.updateFollowReadingGate(this.data.pageSegments, undefined, undefined, true)); return
      }
      this.setData({ readingResource: result.data.reading,
        historicalAudioMaps: result.data.audioMaps ?? [],
        historicalPronunciation: result.data.pronunciation ?? null },
      () => {
        void this.loadPronunciationSegments(resourceId)
        void this.loadReadingAudioMap(resourceId, pageNumber)
      })
    },
    async loadTeacherPreview() {
      const session = getSession()
      const resourceId = this.data.teacherPreviewResourceId
      if (!session || (session.activeRole ?? session.user.role) !== 'teacher' || !resourceId) {
        this.setData({ loading: false, reading: null, error: '仅授权教师可预览阅读内容' }); return
      }
      activeReadingAudio?.destroy(); activeReadingAudio = null
      activeAudioSourceKey = ''; audioMapRequest++
      this.setData({ loading: true, error: '', reading: null, readingResource: null,
        audioMap: null, audioMapReady: false, pageHotspots: [], mediaSegments: [], pageSegments: [],
        pointreadPageNumbers: [], nextPointreadPageNumber: 0,
        mediaPlaying: false, mediaError: '', audioMapError: '', pronunciationError: '' })
      const result = await getReadingResource(session.user.id, resourceId)
      if (getSession()?.sessionId !== session.sessionId) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      const reading = teacherReadingPreview(result.data)
      if (!reading) { this.setData({ loading: false, error: '阅读内容没有可预览的页面' }); return }
      const first = reading.pages[0]!
      this.setData({ loading: false, reading, readingResource: result.data,
        teacherPreviewSessionId: session.sessionId, teacherPreviewLoadedAtMs: Date.now(), reviewPageIndex: 0,
        displayPageNumber: first.pageNumber, displayChapterNumber: first.chapterNumber,
        displayImageUrl: first.imageUrl, displayThumbnailUrl: first.thumbnailUrl,
        imageLoading: Boolean(first.imageUrl), imageError: !first.imageUrl && !first.thumbnailUrl,
        imageRefreshAttempted: false, imageErrorMessage: '',
        showHighRes: Boolean(first.imageUrl), pendingPageNumber: 0, saveError: '', zoomed: false },
      () => { void this.loadPronunciationSegments(resourceId)
        void this.loadReadingAudioMap(resourceId, first.pageNumber) })
    },
    async loadReadingAudioMap(resourceId: string, pageNumber: number) {
      const session = getSession()
      if (!session || this.data.teacherReviewMode) return
      const request = ++audioMapRequest
      const resourceResult = this.data.readingResource?.id === resourceId
        ? { ok: true as const, data: this.data.readingResource }
        : await getReadingResource(session.user.id, resourceId)
      if (request !== audioMapRequest || this.data.reading?.book.id !== resourceId
        || !sameReadingViewerSession(session.user.id, session.sessionId, this.data.teacherPreviewMode)) return
      if (!resourceResult.ok) { this.setData({ audioMap: null, audioMapReady: false, pageHotspots: [],
        audioMapError: '阅读音频资源暂未能核对，页图仍可阅读；请重试',
        audioMapRetryable: true }); return }
      const resource = resourceResult.data
      const chapterId = chapterIdForPage(resource, pageNumber)
      if (!chapterId) { this.setData({ readingResource: resource, audioMap: null,
        audioMapReady: false, pageHotspots: [], audioMapError: '', audioMapRetryable: false }); return }
      if (this.data.taskMode) {
        const map = this.data.historicalAudioMaps.find(item => item.chapterId === chapterId)
        if (!map || !validReadingAudioMap(map, resource, chapterId)) {
          this.setData({ audioMap: null, audioMapReady: false,
            audioMapError: '历史任务音频地址已失效，请重试', audioMapRetryable: true }); return
        }
        const positionMs = savedAudioPosition(session.user.id, map)
        this.setData({ readingResource: resource, audioMap: map, audioMapReady: true,
          audioMapError: '', audioMapRetryable: false,
          pageHotspots: hotspotsForPage(map, this.data.displayPageNumber),
          chapterPositionMs: positionMs, furthestChapterPositionMs: positionMs,
          mediaProgress: map.durationMs ? Math.round(positionMs * 100 / map.durationMs) : 0,
          mediaCurrentLabel: formatAudioTime(positionMs / 1000),
          mediaDurationLabel: formatAudioTime((map.durationMs ?? 0) / 1000) })
        return
      }
      if (!this.data.taskMode && this.data.audioMap?.chapterId === chapterId
        && this.data.audioMap.sourceVersion === resource.contentVersion) {
        this.setData({ readingResource: resource, audioMapError: '', audioMapRetryable: false,
          pageHotspots: hotspotsForPage(this.data.audioMap, this.data.displayPageNumber) })
        return
      }
      let result = await getReadingAudioMap(session.user.id, resourceId, chapterId)
      if (request !== audioMapRequest || this.data.reading?.book.id !== resourceId
        || !sameReadingViewerSession(session.user.id, session.sessionId, this.data.teacherPreviewMode)) return
      if (!result.ok && result.error.retryable) {
        result = await getReadingAudioMap(session.user.id, resourceId, chapterId)
        if (request !== audioMapRequest || this.data.reading?.book.id !== resourceId
          || !sameReadingViewerSession(session.user.id, session.sessionId, this.data.teacherPreviewMode)) return
      }
      if (result.ok && result.data.resourceId === resource.id
        && result.data.sourceVersion === resource.contentVersion && result.data.chapterId === chapterId
        && result.data.playback === null && result.data.durationMs === null
        && result.data.segments.length === 0) {
        this.setData({ readingResource: resource, audioMap: null, audioMapReady: false,
          pageHotspots: [], audioMapError: '这本阅读内容暂未开放点读、跟读与示范音频，可继续阅读页图。',
          audioMapRetryable: false }); return
      }
      if (!result.ok || !validReadingAudioMap(result.data, resource, chapterId)) {
        this.setData({ readingResource: resource, audioMap: null, audioMapReady: false,
          pageHotspots: [], audioMapError: !result.ok && result.error.code === 'NOT_FOUND'
            ? '' : '章节音频或点读映射暂不可用，页图仍可阅读；请重试',
          audioMapRetryable: result.ok || result.error.code !== 'NOT_FOUND' }); return
      }
      const positionMs = this.data.teacherPreviewMode ? 0 : savedAudioPosition(session.user.id, result.data)
      this.setData({ readingResource: resource, audioMap: result.data, audioMapReady: true,
        audioMapError: '', audioMapRetryable: false,
        pageHotspots: hotspotsForPage(result.data, this.data.displayPageNumber),
        chapterPositionMs: positionMs, furthestChapterPositionMs: positionMs,
        mediaProgress: result.data.durationMs ? Math.round(positionMs * 100 / result.data.durationMs) : 0,
        mediaCurrentLabel: formatAudioTime(positionMs / 1000),
        mediaDurationLabel: formatAudioTime((result.data.durationMs ?? 0) / 1000) })
    },
    retryReadingAudioMap() {
      const resourceId = this.data.reading?.book.id
      if (resourceId && this.data.audioMapRetryable) {
        if (this.data.taskMode) void this.loadHistoricalTaskLearning(resourceId, this.data.displayPageNumber)
        else void this.loadReadingAudioMap(resourceId, this.data.displayPageNumber)
      }
    },
    retryPronunciationSegments() {
      const resourceId = this.data.reading?.book.id
      if (resourceId) {
        if (this.data.taskMode) void this.loadHistoricalTaskLearning(resourceId, this.data.displayPageNumber)
        else void this.loadPronunciationSegments(resourceId)
      }
    },
    rememberAudioPosition() {
      const session = getSession(), map = this.data.audioMap
      if (!session || !map || this.data.teacherPreviewMode || this.data.audioMode === 'demo'
        || typeof wx.setStorageSync !== 'function') return
      wx.setStorageSync(audioBookmarkKey(session.user.id, map.resourceId, map.chapterId),
        clampReadingAudioPosition(this.data.chapterPositionMs, map.durationMs ?? 0))
    },
    async loadPronunciationSegments(resourceId: string) {
      const session = getSession()
      if (!session || this.data.teacherReviewMode) return
      if (this.data.taskMode) {
        const result = this.data.historicalPronunciation
        const segments = result?.resourceId === resourceId
          ? result.segments.filter(segment => validDemonstrationAudio(segment, Date.now())) : []
        this.setData({ mediaSegments: segments,
          pageSegments: segmentsForPage(segments, this.data.displayPageNumber),
          pronunciationError: result && segments.length === 0
            ? '历史示范音地址已失效，请重试' : '' }, () =>
          this.updateFollowReadingGate(this.data.pageSegments))
        return
      }
      const resourceResult = this.data.readingResource?.id === resourceId
        ? { ok: true as const, data: this.data.readingResource }
        : await getReadingResource(session.user.id, resourceId)
      if (!sameReadingViewerSession(session.user.id, session.sessionId, this.data.teacherPreviewMode)
        || this.data.reading?.book.id !== resourceId) return
      if (!resourceResult.ok) { this.setData({ mediaSegments: [], pageSegments: [],
        pointreadPageNumbers: [], nextPointreadPageNumber: 0,
        pronunciationError: '跟读资源版本暂未能核对，页图仍可阅读；请重试' }, () =>
        this.updateFollowReadingGate(this.data.pageSegments, undefined, undefined, true)); return }
      const result = await getReadingPronunciationSegments(session.user.id, resourceId)
      if (this.data.reading?.book.id !== resourceId
        || !sameReadingViewerSession(session.user.id, session.sessionId, this.data.teacherPreviewMode)) return
      if (!result.ok || result.data.resourceId !== resourceId
        || result.data.sourceVersion !== resourceResult.data.contentVersion) {
        this.setData({ mediaSegments: [], pageSegments: [], pointreadPageNumbers: [],
          nextPointreadPageNumber: 0, mediaError: '',
          pronunciationError: !result.ok && result.error.code === 'NOT_FOUND'
            ? '' : '跟读句段版本或授权暂未能核对，页图仍可阅读；请重试' }, () =>
          this.updateFollowReadingGate(this.data.pageSegments, undefined, undefined,
            !result.ok && result.error.code !== 'NOT_FOUND')); return
      }
      const segments = result.data.segments.filter(segment => segment
        && typeof segment.id === 'string' && typeof segment.text === 'string'
        && typeof segment.pageNumber === 'number'
        && segment.demonstrationAudio && typeof segment.demonstrationAudio.temporaryUrl === 'string'
        && typeof segment.demonstrationAudio.expiresAt === 'string'
        && validDemonstrationAudio(segment, Date.now()))
      const pointreadPageNumbers = [...new Set(segments.map(segment => segment.pageNumber!))]
        .sort((left, right) => left - right)
      this.setData({ mediaSegments: segments, pointreadPageNumbers,
        nextPointreadPageNumber: nextPointreadPage(pointreadPageNumbers, this.data.displayPageNumber) ?? 0,
        pronunciationError: result.data.segments.length > 0 && segments.length === 0
          ? '示范音频地址暂不可用，页图仍可阅读；请重试' : '',
        pageSegments: segmentsForPage(segments, this.data.displayPageNumber) }, () =>
        this.updateFollowReadingGate(this.data.pageSegments))
    },
    playDemonstration(event: WechatMiniprogram.TouchEvent) {
      if (this.data.followReadingRecording) return
      void this.playSegmentById(event.currentTarget.dataset.id as string)
    },
    retryMedia() {
      if (this.data.followReadingRecording) return
      if (this.data.audioMapReady) {
        activeReadingAudio?.destroy(); activeReadingAudio = null; activeAudioSourceKey = ''
        this.setData({ mediaPlaying: false, mediaError: '' })
        void this.toggleChapterPlayback()
        return
      }
      const segmentId = this.data.activeSegmentId || this.data.pageSegments[0]?.id
      activeReadingAudio?.destroy(); activeReadingAudio = null
      activeAudioSourceKey = ''
      this.setData({ mediaPlaying: false, mediaError: '', activeSegmentId: '' })
      if (segmentId) void this.playSegmentById(segmentId)
    },
    async chapterAudioContext(): Promise<ReturnType<typeof wx.createInnerAudioContext> | null> {
      const session = getSession(), resource = this.data.readingResource
      const initialMap = this.data.audioMap
      if (!session || !resource || !initialMap || !this.data.audioMapReady
        || this.data.teacherReviewMode) return null
      let map: ReadingAudioMapView = initialMap
      if (Date.parse(map.playback?.expiresAt ?? '') <= Date.now() + 5000) {
        let refreshedMap: ReadingAudioMapView | null = null
        let refreshedResource: ReadingResource = resource
        let historicalMaps: ReadingAudioMapView[] | null = null
        if (this.data.taskMode) {
          if (!this.data.taskId || !this.data.taskItemId) {
            this.setData({ mediaError: '任务音频授权信息不完整，请返回任务重新进入' }); return null
          }
          const refreshed = await getHistoricalTaskLearning(session.user.id,
            this.data.taskId, this.data.taskItemId)
          if (refreshed.ok && refreshed.data.resourceId === map.resourceId && refreshed.data.reading) {
            refreshedResource = refreshed.data.reading
            historicalMaps = refreshed.data.audioMaps ?? []
            refreshedMap = historicalMaps.find(item => item.chapterId === map.chapterId) ?? null
          }
        } else {
          const refreshed = await getReadingAudioMap(session.user.id, map.resourceId, map.chapterId)
          if (refreshed.ok) refreshedMap = refreshed.data
        }
        if (!sameReadingViewerSession(session.user.id, session.sessionId, this.data.teacherPreviewMode)) return null
        if (!this.data.audioMap || this.data.audioMap.chapterId !== map.chapterId
          || this.data.reading?.book.id !== map.resourceId) return null
        if (!refreshedMap || !validReadingAudioMap(refreshedMap, refreshedResource, map.chapterId)
          || Date.parse(refreshedMap.playback?.expiresAt ?? '') <= Date.now()) {
          this.setData({ mediaError: '章节音频地址已失效，请稍后重试' }); return null
        }
        map = refreshedMap
        this.setData({ audioMap: map,
          ...(historicalMaps ? { readingResource: refreshedResource, historicalAudioMaps: historicalMaps } : {}) })
        activeReadingAudio?.destroy(); activeReadingAudio = null; activeAudioSourceKey = ''
      }
      const sourceKey = `chapter:${map.resourceId}:${map.chapterId}:${map.sourceVersion}`
      if (activeReadingAudio && activeAudioSourceKey === sourceKey) return activeReadingAudio
      this.rememberAudioPosition()
      activeReadingAudio?.destroy()
      const audio = wx.createInnerAudioContext()
      activeReadingAudio = audio
      activeAudioSourceKey = sourceKey
      audio.playbackRate = this.data.mediaSpeed
      audio.onCanplay(() => {
        if (activeReadingAudio !== audio || this.data.pendingAudioSeekMs < 0) return
        audio.seek(this.data.pendingAudioSeekMs / 1000)
        this.setData({ pendingAudioSeekMs: -1 })
      })
      audio.onTimeUpdate(() => {
        if (activeReadingAudio !== audio || !this.data.audioMap) return
        const currentMs = clampReadingAudioPosition(audio.currentTime * 1000, this.data.audioMap.durationMs ?? 0)
        if (this.data.audioMode === 'pointread' && currentMs >= this.data.pointreadEndMs) {
          audio.pause()
          this.setData({ mediaPlaying: false, activeHotspotId: '', audioMode: 'none',
            mediaCurrentLabel: formatAudioTime(this.data.chapterPositionMs / 1000),
            mediaProgress: Math.round(this.data.chapterPositionMs * 100 / (this.data.audioMap.durationMs ?? 1)) })
          return
        }
        if (this.data.audioMode === 'chapter') {
          this.setData({ chapterPositionMs: currentMs,
            furthestChapterPositionMs: Math.max(this.data.furthestChapterPositionMs, currentMs),
            mediaCurrentLabel: formatAudioTime(currentMs / 1000),
            mediaProgress: Math.round(currentMs * 100 / (this.data.audioMap.durationMs ?? 1)) })
        }
      })
      audio.onEnded(() => {
        if (activeReadingAudio !== audio) return
        const durationMs = this.data.audioMap?.durationMs ?? 0
        if (this.data.audioMode === 'pointread') {
          this.setData({ mediaPlaying: false, audioMode: 'none', activeHotspotId: '',
            mediaProgress: Math.round(this.data.chapterPositionMs * 100 / Math.max(1, durationMs)),
            mediaCurrentLabel: formatAudioTime(this.data.chapterPositionMs / 1000) })
          return
        }
        this.setData({ mediaPlaying: false, audioMode: 'none', activeHotspotId: '',
          chapterPositionMs: durationMs, furthestChapterPositionMs: durationMs, mediaProgress: 100,
          mediaCurrentLabel: formatAudioTime(durationMs / 1000) }, () => this.rememberAudioPosition())
      })
      audio.onError(() => {
        if (activeReadingAudio !== audio) return
        activeReadingAudio = null; activeAudioSourceKey = ''
        audio.destroy()
        this.setData({ mediaPlaying: false, audioMode: 'none', activeHotspotId: '',
          mediaError: '章节音频播放失败，已保留位置，可重试' })
      })
      audio.src = map.playback!.temporaryUrl
      return audio
    },
    async toggleChapterPlayback() {
      if (this.data.followReadingRecording) return
      if (this.data.mediaLoading) return
      const map = this.data.audioMap
      if (!map) return
      if (this.data.audioMode === 'chapter' && activeReadingAudio && this.data.mediaPlaying) {
        activeReadingAudio.pause(); this.setData({ mediaPlaying: false })
        this.rememberAudioPosition()
        return
      }
      const savedPositionMs = clampReadingAudioPosition(this.data.chapterPositionMs, map.durationMs ?? 0)
      const positionMs = savedPositionMs >= (map.durationMs ?? 0) ? 0 : savedPositionMs
      this.setData({ mediaLoading: true, mediaError: '', pendingAudioSeekMs: positionMs,
        chapterPositionMs: positionMs, mediaCurrentLabel: formatAudioTime(positionMs / 1000),
        mediaProgress: Math.round(positionMs * 100 / (map.durationMs ?? 1)) })
      const audio = await this.chapterAudioContext()
      if (!audio || this.data.audioMap?.chapterId !== map.chapterId || this.data.followReadingRecording) {
        this.setData({ mediaLoading: false }); return
      }
      audio.seek(positionMs / 1000)
      this.setData({ mediaLoading: false, mediaPlaying: true, audioMode: 'chapter',
        activeHotspotId: '', activeSegmentId: '' })
      audio.play()
    },
    async playPointread(event: WechatMiniprogram.TouchEvent) {
      if (this.data.followReadingRecording) return
      const segmentId = event.currentTarget.dataset.id as string
      let hotspot = this.data.pageHotspots.find(item => item.id === segmentId)
      if (!hotspot || !this.data.audioMapReady || this.data.earMode || this.data.mediaLoading) return
      if (hotspot.clipPlayback) {
        const session = getSession(), resource = this.data.readingResource, map = this.data.audioMap
        if (!session || !resource || !map) return
        this.setData({ mediaLoading: true, mediaError: '' })
        if (Date.parse(hotspot.clipPlayback.expiresAt) <= Date.now() + 5000) {
          const refreshed = await getReadingAudioMap(session.user.id, map.resourceId, map.chapterId)
          if (!sameReadingViewerSession(session.user.id, session.sessionId, this.data.teacherPreviewMode)
            || this.data.reading?.book.id !== map.resourceId) {
            this.setData({ mediaLoading: false }); return
          }
          if (!refreshed.ok || !validReadingAudioMap(refreshed.data, resource, map.chapterId)) {
            this.setData({ mediaLoading: false, mediaError: '点读音频地址已失效，请稍后重试' }); return
          }
          const pageHotspots = hotspotsForPage(refreshed.data, this.data.displayPageNumber)
          hotspot = pageHotspots.find(item => item.id === segmentId)
          this.setData({ audioMap: refreshed.data, pageHotspots })
        }
        if (this.data.followReadingRecording || !hotspot?.clipPlayback
          || Date.parse(hotspot.clipPlayback.expiresAt) <= Date.now()) {
          this.setData({ mediaLoading: false, mediaError: '点读音频暂不可用，请稍后重试' }); return
        }
        this.rememberAudioPosition()
        activeReadingAudio?.destroy()
        const audio = wx.createInnerAudioContext()
        activeReadingAudio = audio
        activeAudioSourceKey = `pointread:${map.resourceId}:${segmentId}`
        audio.playbackRate = this.data.mediaSpeed
        const endMs = hotspot.endMs
        const finish = () => {
          if (activeReadingAudio !== audio) return
          audio.destroy(); activeReadingAudio = null; activeAudioSourceKey = ''
          this.setData({ mediaPlaying: false, audioMode: 'none', activeHotspotId: '',
            mediaCurrentLabel: formatAudioTime(this.data.chapterPositionMs / 1000),
            mediaProgress: Math.round(this.data.chapterPositionMs * 100 / (this.data.audioMap?.durationMs ?? 1)) })
        }
        audio.onTimeUpdate(() => {
          if (activeReadingAudio === audio && audio.currentTime * 1000 >= endMs) finish()
        })
        audio.onEnded(finish)
        audio.onError(() => {
          if (activeReadingAudio !== audio) return
          finish()
          this.setData({ mediaError: '点读音频播放失败，请重试' })
        })
        const startMs = hotspot.startMs
        if (startMs > 0) audio.onCanplay(() => {
          if (activeReadingAudio === audio) audio.seek(startMs / 1000)
        })
        audio.src = hotspot.clipPlayback.temporaryUrl
        this.setData({ mediaLoading: false, mediaPlaying: true, audioMode: 'pointread',
          activeHotspotId: segmentId, activeSegmentId: '', pointreadEndMs: endMs })
        audio.play()
        return
      }
      this.setData({ mediaLoading: true, mediaError: '', pendingAudioSeekMs: hotspot.startMs })
      this.rememberAudioPosition()
      activeReadingAudio?.destroy(); activeReadingAudio = null; activeAudioSourceKey = ''
      const audio = await this.chapterAudioContext()
      if (!audio || this.data.followReadingRecording || !this.data.pageHotspots.some(item => item.id === segmentId)) {
        this.setData({ mediaLoading: false }); return
      }
      audio.seek(hotspot.startMs / 1000)
      this.setData({ mediaLoading: false, mediaPlaying: true, audioMode: 'pointread',
        activeHotspotId: segmentId, activeSegmentId: '', pointreadEndMs: hotspot.endMs })
      audio.play()
    },
    async playSegmentById(segmentId: string) {
      if (this.data.followReadingRecording) return
      const selected = this.data.pageSegments.find(segment => segment.id === segmentId)
      if (!selected?.demonstrationAudio || this.data.mediaLoading) return
      if (this.data.activeSegmentId === segmentId && activeReadingAudio) {
        if (this.data.mediaPlaying) { activeReadingAudio.pause(); this.setData({ mediaPlaying: false }) }
        else { activeReadingAudio.play(); this.setData({ mediaPlaying: true }) }
        return
      }
      const session = getSession(), resourceId = this.data.reading?.book.id
      if (!session || !resourceId) return
      this.setData({ mediaLoading: true, mediaError: '' })
      let segment = selected as ReadingPronunciationSegment
      if (!validDemonstrationAudio(segment, Date.now() + 5000)) {
        const refreshed = await getReadingPronunciationSegments(session.user.id, resourceId)
        if (!sameReadingViewerSession(session.user.id, session.sessionId, this.data.teacherPreviewMode)) {
          this.setData({ mediaLoading: false }); return
        }
        if (!refreshed.ok) { this.setData({ mediaLoading: false, mediaError: refreshed.error.message }); return }
        segment = refreshed.data.segments.find(item => item.id === segmentId
          && item.pageNumber === this.data.displayPageNumber) ?? selected as ReadingPronunciationSegment
      }
      if (this.data.followReadingRecording || !validDemonstrationAudio(segment, Date.now())) {
        this.setData({ mediaLoading: false, mediaError: '示范音频暂不可用，请稍后重试' }); return
      }
      if (!this.data.pageSegments.some(item => item.id === segmentId)) {
        this.setData({ mediaLoading: false }); return
      }
      this.rememberAudioPosition()
      activeReadingAudio?.destroy()
      const audio = wx.createInnerAudioContext()
      activeReadingAudio = audio
      activeAudioSourceKey = `demo:${segmentId}`
      audio.src = segment.demonstrationAudio.temporaryUrl
      audio.playbackRate = this.data.mediaSpeed
      audio.onEnded(() => { if (activeReadingAudio === audio) { audio.destroy(); activeReadingAudio = null
        this.setData({ mediaPlaying: false, activeSegmentId: '', mediaProgress: 100 }) } })
      audio.onError(() => { if (activeReadingAudio === audio) { audio.destroy(); activeReadingAudio = null
        this.setData({ mediaPlaying: false, mediaLoading: false, mediaError: '示范音频播放失败，请重试' }) } })
      audio.onTimeUpdate(() => {
        if (activeReadingAudio !== audio) return
        const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0
        this.setData({ mediaCurrentLabel: formatAudioTime(current),
          mediaDurationLabel: formatAudioTime(duration),
          mediaProgress: duration > 0 ? Math.min(100, Math.round(current * 100 / duration)) : 0 })
      })
      this.setData({ mediaPlaying: true, mediaLoading: false, activeSegmentId: segmentId,
        activeHotspotId: '', audioMode: 'demo',
        mediaProgress: 0, mediaCurrentLabel: '00:00', mediaDurationLabel: '00:00' })
      audio.play()
    },
    cycleMediaSpeed() {
      wx.showActionSheet({ itemList: LEARNING_SPEEDS.map(speed =>
        `${speed === 1 || speed === 2 ? speed.toFixed(1) : speed}×`),
        success: result => {
          const selected = LEARNING_SPEEDS[result.tapIndex]
          if (!selected) return
          let speed = selected
          try { if (activeReadingAudio) activeReadingAudio.playbackRate = speed }
          catch (_error: unknown) {
            speed = 1
            try { if (activeReadingAudio) activeReadingAudio.playbackRate = 1 }
            catch (_fallbackError: unknown) { this.setData({ mediaError: '音频播放器暂不可调速，请重试' }); return }
            wx.showToast({ title: '当前设备不支持该倍速，已恢复 1 倍', icon: 'none' })
          }
          this.setData({ mediaSpeed: speed })
          const session = getSession()
          if (session) saveLearningSpeed(session.user.id, speed)
        } })
    },
    async seekMedia(event: WechatMiniprogram.CustomEvent<{ value: number }>) {
      if (this.data.followReadingRecording || this.data.mediaLoading) return
      if (this.data.audioMapReady && this.data.audioMap?.durationMs) {
        const percent = event.detail.value
        if (!Number.isFinite(percent)) return
        const requested = this.data.audioMap.durationMs * percent / 100
        const positionMs = clampReadingAudioPosition(this.data.taskMode
          ? Math.min(requested, this.data.furthestChapterPositionMs) : requested,
        this.data.audioMap.durationMs)
        if (this.data.taskMode && requested > this.data.furthestChapterPositionMs) {
          wx.showToast({ title: '任务音频只能拖回已播放位置', icon: 'none' })
        }
        this.setData({ pendingAudioSeekMs: positionMs })
        const audio = await this.chapterAudioContext()
        if (!audio || this.data.followReadingRecording) return
        audio.seek(positionMs / 1000)
        this.setData({ chapterPositionMs: positionMs, audioMode: 'chapter',
          activeHotspotId: '', mediaCurrentLabel: formatAudioTime(positionMs / 1000),
          mediaProgress: Math.round(positionMs * 100 / this.data.audioMap.durationMs) },
        () => this.rememberAudioPosition())
        return
      }
      const audio = activeReadingAudio
      if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return
      const requested = audio.duration * event.detail.value / 100
      audio.seek(confirmedSeekTarget(requested, audio.duration, audio.duration, false))
    },
    async enterEarMode() {
      if (this.data.followReadingRecording) return
      const chapterId = this.data.audioMap?.chapterId
      if (!chapterId || !this.data.audioMapReady || this.data.earMode || this.data.mediaLoading) return
      this.setData({ earMode: true, zoomed: false })
      if (this.data.audioMode !== 'chapter' || !this.data.mediaPlaying) {
        await this.toggleChapterPlayback()
      }
      if (this.data.audioMap?.chapterId !== chapterId || !this.data.mediaPlaying) {
        this.setData({ mediaError: this.data.mediaError || '章节音频暂未能播放，请重试' })
      }
    },
    exitEarMode() { this.setData({ earMode: false, zoomed: false }) },
    onFollowReadingRecordingStart() {
      this.rememberAudioPosition()
      activeReadingAudio?.pause()
      this.setData({ followReadingRecording: true, mediaPlaying: false })
    },
    onFollowReadingRecordingEnd() { this.setData({ followReadingRecording: false }) },
    confirmFollowReadingLeave(onConfirmed: () => void) {
      const panels = (this.selectAllComponents?.('.inline-pronunciation') ?? []) as Array<{
        hasActiveRecording?: () => boolean; hasUnsubmittedRecording?: () => boolean;
        rememberDraft?: () => void; discardLocalDraft?: () => void;
      }>
      if (panels.some(panel => panel.hasActiveRecording?.())) {
        wx.showToast({ title: '请先结束录音或等待上传', icon: 'none' }); return
      }
      const pending = panels.filter(panel => panel.hasUnsubmittedRecording?.())
      if (!pending.length) { onConfirmed(); return }
      wx.showActionSheet({ itemList: ['保存录音', '放弃录音'], success: result => {
        if (result.tapIndex === 0) pending.forEach(panel => panel.rememberDraft?.())
        else if (result.tapIndex === 1) pending.forEach(panel => panel.discardLocalDraft?.())
        else return
        onConfirmed()
      } })
    },
    async loadTeacherReview() {
      const route = this.data.teacherReviewRoute
      if (!route) { this.setData({ loading: false, error: '缺少要查看的作业记录。' }); return }
      this.setData({ loading: true, error: '', imageError: false })
      const result = await loadTeacherReviewItem(route, 'reading')
      if (!result.ok) { this.setData({ loading: false, error: result.message }); return }
      const pages = result.submission.readingPages?.filter(page => page.itemId === route.itemId) ?? []
      if (!pages.length) { this.setData({ loading: false, error: '本次提交缺少可定位的阅读页图，无法还原原作业。' }); return }
      const answer = result.submission.answers.find(entry => entry.itemId === route.itemId)?.value
      const structured = answer !== null && typeof answer === 'object' && !Array.isArray(answer)
        ? answer as Record<string, unknown> : null
      const events = Array.isArray(structured?.verifiedPageEvents) ? structured.verifiedPageEvents : []
      const visited = pages.map(page => events.some(entry => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false
        const event = entry as Record<string, unknown>
        return event.pageId === page.pageId && event.pageNumber === page.pageNumber
          && typeof event.visitedAt === 'string' && Number.isFinite(Date.parse(event.visitedAt))
      }))
      const chapterTitles = [...new Set(pages.map(page => page.chapterTitle))]
      const pageViews = pages.map(page => ({ pageNumber: page.pageNumber,
        chapterNumber: chapterTitles.indexOf(page.chapterTitle) + 1,
        imageUrl: displayPageImageUrl(page.imageAssetKey),
        thumbnailUrl: displayPageImageUrl(page.thumbnailAssetKey) }))
      const first = pageViews[0]
      const progressPercent = Math.round(visited.filter(Boolean).length * 100 / pages.length)
      const teacherPronunciationSegments = (result.submission.readingPronunciationSegments ?? [])
        .filter(segment => segment.itemId === route.itemId)
        .map(segment => ({ id: segment.segmentId, text: segment.text, pageNumber: segment.pageNumber }))
      const reading: ReadingProgressView = {
        book: { id: route.itemId, title: result.item.title, category: 'picture', grade: '', difficulty: '', theme: '',
          progressPercent, favorite: false, pageCount: pages.length },
        hasSavedProgress: visited.some(Boolean), chapterNumber: first.chapterNumber,
        chapterCount: chapterTitles.length, pageNumber: first.pageNumber, pageCount: pages.length,
        progressPercent, pageImageUrl: first.imageUrl, thumbnailImageUrl: first.thumbnailUrl, pages: pageViews,
      }
      this.setData({ loading: false, reading, reviewPageIndex: 0, reviewPageVisited: visited,
        reviewTaskId: result.submission.taskId, reviewAssignmentId: result.submission.assignmentId,
        teacherPronunciationSegments, teacherPronunciationEvidence: {},
        pageSegments: this.reviewPageSegments(first.pageNumber, teacherPronunciationSegments, {}),
        reviewSubmissionVersion: result.submission.submissionVersion,
        displayPageNumber: first.pageNumber, displayChapterNumber: first.chapterNumber,
        displayImageUrl: first.imageUrl, displayThumbnailUrl: first.thumbnailUrl,
        imageLoading: Boolean(first.imageUrl), imageError: !first.imageUrl && !first.thumbnailUrl,
        imageRefreshAttempted: false, imageErrorMessage: '',
        pendingPageNumber: 0, saveError: '', showHighRes: Boolean(first.imageUrl), zoomed: false },
      () => { if (teacherPronunciationSegments.length) void this.loadTeacherPronunciationEvidence(first.pageNumber) })
    },
    reviewPageSegments(pageNumber: number, segments?: readonly TeacherReadingPronunciationSegment[],
      evidenceMap?: Readonly<Record<string, TeacherPronunciationEvidenceEntry>>): ReviewPagePronunciationSegment[] {
      const all = segments ?? this.data.teacherPronunciationSegments ?? []
      const firstPageNumber = this.data.reading?.pages?.[0]?.pageNumber
      const map = evidenceMap ?? this.data.teacherPronunciationEvidence ?? {}
      return all.filter(segment => segment.pageNumber === pageNumber
        || (segment.pageNumber === undefined && pageNumber === firstPageNumber))
        .map(segment => {
          const evidence = map[segment.id]
          return { ...segment, teacherEvidenceState: evidence?.state ?? 'loading',
            teacherEvidence: evidence?.evidence ?? {} as TeacherPronunciationEvidence,
            teacherEvidenceStatusLabel: evidence?.statusLabel ?? '',
            teacherEvidenceMessage: evidence?.message ?? '' }
        })
    },
    async loadTeacherPronunciationEvidence(pageNumber: number, onlySegmentId?: string) {
      const session = getSession(), route = this.data.teacherReviewRoute
      if (!session || !route || !this.data.reviewTaskId || !this.data.reviewAssignmentId
        || !this.data.reviewSubmissionVersion) return
      const pageSegments = this.reviewPageSegments(pageNumber)
      const segments = onlySegmentId
        ? pageSegments.filter(segment => segment.id === onlySegmentId) : pageSegments
      if (!segments.length) return
      const requestId = this.data.teacherEvidenceRequestId + 1
      const evidenceMap = { ...this.data.teacherPronunciationEvidence }
      for (const segment of segments) evidenceMap[segment.id] = { state: 'loading' }
      this.setData({ teacherEvidenceRequestId: requestId, teacherPronunciationEvidence: evidenceMap,
        pageSegments: this.reviewPageSegments(pageNumber, undefined, evidenceMap) })
      const results = await Promise.all(segments.map(async segment => ({ segmentId: segment.id,
        result: await getTeacherPronunciationEvidence(session.user.id, {
          taskId: this.data.reviewTaskId, assignmentId: this.data.reviewAssignmentId,
          submissionVersion: this.data.reviewSubmissionVersion,
          itemId: route.itemId, segmentId: segment.id,
        }).catch(() => null) })))
      if (this.data.teacherEvidenceRequestId !== requestId
        || this.data.teacherReviewRoute?.submissionId !== route.submissionId
        || this.data.displayPageNumber !== pageNumber
        || getSession()?.sessionId !== session.sessionId) return
      const nextMap = { ...this.data.teacherPronunciationEvidence }
      for (const { segmentId, result } of results) {
        if (!result) { nextMap[segmentId] = { state: 'error', message: '跟读记录读取失败，可重试' }; continue }
        if (!result.ok) {
          nextMap[segmentId] = result.error.code === 'NOT_FOUND'
            ? { state: 'not_found' }
            : { state: 'error', message: result.error.message }
          continue
        }
        const display = scoreDisplay(result.data)
        nextMap[segmentId] = { state: 'ready', evidence: result.data,
          statusLabel: display.statusLabel, message: display.message }
      }
      this.setData({ teacherPronunciationEvidence: nextMap,
        pageSegments: this.reviewPageSegments(pageNumber, undefined, nextMap) })
    },
    refreshTeacherPronunciationEvidence(event: WechatMiniprogram.CustomEvent<{ segmentId: string }>) {
      void this.loadTeacherPronunciationEvidence(this.data.displayPageNumber, event.detail.segmentId)
    },
    async imageLoaded(event?: { currentTarget?: { dataset?: { page?: number; src?: string } };
      detail?: { width?: number; height?: number } }) {
      if (event?.currentTarget?.dataset?.page !== undefined
        && Number(event.currentTarget.dataset.page) !== this.data.displayPageNumber) return
      if (event?.currentTarget?.dataset?.src
        && event.currentTarget.dataset.src !== this.data.displayImageUrl) return
      clearImageLoadTimer(this)
      const imageSize = event?.detail?.width && event.detail.height
        ? { fullscreenNaturalWidth: event.detail.width, fullscreenNaturalHeight: event.detail.height } : {}
      this.setData({ imageLoading: false, imageError: false, ...imageSize }, () => {
        if (this.data.zoomed) this.updateFullscreenLayout()
      })
      if (this.data.teacherReviewMode || this.data.teacherPreviewMode) return
      await this.saveVisiblePage()
    },
    async thumbnailLoaded(event?: { currentTarget?: { dataset?: { page?: number; src?: string } } }) {
      if (event?.currentTarget?.dataset?.page !== undefined
        && Number(event.currentTarget.dataset.page) !== this.data.displayPageNumber) return
      if (event?.currentTarget?.dataset?.src
        && event.currentTarget.dataset.src !== this.data.displayThumbnailUrl) return
      if (this.data.displayImageUrl || this.data.imageError) return
      this.setData({ imageLoading: false })
      if (!this.data.teacherReviewMode && !this.data.teacherPreviewMode) await this.saveVisiblePage()
    },
    thumbnailFailed(event?: { currentTarget?: { dataset?: { page?: number; src?: string } } }) {
      if (event?.currentTarget?.dataset?.page !== undefined
        && Number(event.currentTarget.dataset.page) !== this.data.displayPageNumber) return
      if (event?.currentTarget?.dataset?.src
        && event.currentTarget.dataset.src !== this.data.displayThumbnailUrl) return
      if (!this.data.displayImageUrl) this.imageFailed()
    },
    async saveVisiblePage() {
      if (this.data.teacherReviewMode || this.data.teacherPreviewMode) return
      const session = getSession()
      const reading = this.data.reading
      if (!session || !reading || this.data.saving || this.data.imageError) return
      const target = this.data.pendingPageNumber || (!reading.hasSavedProgress ? reading.pageNumber : 0)
      if (!target) return
      this.setData({ saving: true })
      const saved = await setReadingPage(session.user.id, reading.book.id, target).catch(() => null)
      if (!saved) { this.setData({ saving: false, saveError: '阅读进度未保存，请重试' }); return }
      if (!saved.ok) { this.setData({ saving: false, saveError: '阅读进度未保存，请重试' }); return }
      this.setData({ saving: false, reading: saved.data, pendingPageNumber: 0, saveError: '' })
    },
    imageFailed(event?: { currentTarget?: { dataset?: { page?: number; src?: string } } }) {
      if (event?.currentTarget?.dataset?.page !== undefined
        && Number(event.currentTarget.dataset.page) !== this.data.displayPageNumber) return
      if (event?.currentTarget?.dataset?.src
        && event.currentTarget.dataset.src !== this.data.displayImageUrl) return
      if (this.data.imageError && !this.data.imageLoading) return
      clearImageLoadTimer(this)
      const autoRefresh = !this.data.imageRefreshAttempted
        && !this.data.teacherReviewMode && !this.data.teacherPreviewMode
      this.setData({ imageLoading: false, imageError: true,
        imageErrorMessage: '页图加载失败，可刷新、翻页或退出' })
      if (autoRefresh) void this.retryImage()
    },
    async retryImage() {
      const session = getSession(), reading = this.data.reading
      if (!session || !reading) return
      const pageNumber = this.data.displayPageNumber
      this.setData({ imageLoading: true, imageError: false, imageRefreshAttempted: true,
        imageErrorMessage: '', showHighRes: false })
      if (this.data.teacherReviewMode || this.data.teacherPreviewMode) {
        this.setData({ showHighRes: true })
        return
      }
      const result = await getReadingProgress(session.user.id, reading.book.id,
        this.data.taskMode && this.data.taskId && this.data.taskItemId
          ? { taskId: this.data.taskId, itemId: this.data.taskItemId } : undefined).catch(() => null)
      if (!sameReadingViewerSession(session.user.id, session.sessionId, false)
        || this.data.reading?.book.id !== reading.book.id || this.data.displayPageNumber !== pageNumber) return
      let page = result?.ok ? result.data.pages.find(item => item.pageNumber === pageNumber) : null
      let pages = result?.ok ? result.data.pages : reading.pages
      if (!page || (!page.imageUrl && !page.thumbnailUrl)) {
        const historical = this.data.taskMode && this.data.taskId && this.data.taskItemId
          ? await getHistoricalTaskLearning(session.user.id, this.data.taskId, this.data.taskItemId).catch(() => null) : null
        const current = !historical && !this.data.taskMode
          ? await getReadingResource(session.user.id, reading.book.id).catch(() => null) : null
        if (!sameReadingViewerSession(session.user.id, session.sessionId, false)
          || this.data.reading?.book.id !== reading.book.id || this.data.displayPageNumber !== pageNumber) return
        const resource = historical?.ok && historical.data.resourceId === reading.book.id
          ? historical.data.reading : current?.ok ? current.data : null
        const fallback = resource ? imageForPage(resource, pageNumber) : null
        if (fallback) {
          page = { pageNumber, chapterNumber: this.data.displayChapterNumber, ...fallback }
          pages = reading.pages.map(item => item.pageNumber === pageNumber ? { ...item, ...fallback } : item)
        }
      }
      if (!page || (!page.imageUrl && !page.thumbnailUrl)) {
        this.setData({ imageLoading: false, imageError: true,
          imageErrorMessage: '页图刷新失败，可翻页或退出；稍后重试' })
        return
      }
      this.setData({ reading: { ...reading, pages },
        displayImageUrl: page.imageUrl, displayThumbnailUrl: page.thumbnailUrl,
        imageLoading: Boolean(page.imageUrl), imageError: false,
        imageErrorMessage: '', showHighRes: false },
      () => { if (page.imageUrl) this.setData({ showHighRes: true }) })
    },
    returnToSavedPage() {
      const reading = this.data.reading
      if (!reading) return
      const sameChapter = Boolean(this.data.audioMap && this.data.readingResource
        && chapterIdForPage(this.data.readingResource, reading.pageNumber) === this.data.audioMap.chapterId)
      const keepChapterPlaying = sameChapter && this.data.audioMode === 'chapter'
      if (!keepChapterPlaying) {
        this.rememberAudioPosition()
        activeReadingAudio?.destroy(); activeReadingAudio = null; activeAudioSourceKey = ''
      }
      this.setData({ displayPageNumber: reading.pageNumber, displayChapterNumber: reading.chapterNumber,
        displayImageUrl: reading.pageImageUrl, displayThumbnailUrl: reading.thumbnailImageUrl,
        pendingPageNumber: 0, imageLoading: Boolean(reading.pageImageUrl),
        imageError: !reading.pageImageUrl && !reading.thumbnailImageUrl,
        imageRefreshAttempted: false, imageErrorMessage: '', saveError: '', showHighRes: false,
        pageSegments: segmentsForPage(this.data.mediaSegments, reading.pageNumber),
        pageHotspots: sameChapter && this.data.audioMap ? hotspotsForPage(this.data.audioMap, reading.pageNumber) : [],
        ...(sameChapter ? {} : { audioMap: null, audioMapReady: false, audioMode: 'none' as const }),
        mediaPlaying: keepChapterPlaying ? this.data.mediaPlaying : false,
        earMode: sameChapter ? this.data.earMode : false,
        activeSegmentId: '', activeHotspotId: '', mediaError: '' },
      () => { this.setData({ showHighRes: Boolean(reading.pageImageUrl) });
        if (!reading.pageImageUrl && !reading.thumbnailImageUrl) void this.retryImage()
        if (!sameChapter) void this.loadReadingAudioMap(reading.book.id, reading.pageNumber) })
    },
    previewPage() {
      if (this.data.earMode) return
      if (this.data.zoomed) { this.closeFullscreen(); return }
      this.setData({ zoomed: true, subtitleInChinese: false }, () => this.updateFullscreenLayout())
    },
    closeFullscreen() { this.setData({ zoomed: false, subtitleInChinese: false }) },
    updateFullscreenLayout() {
      if (!this.data.zoomed) return
      const systemInfo = wx.getSystemInfoSync()
      let sourceWidth = this.data.fullscreenNaturalWidth
      let sourceHeight = this.data.fullscreenNaturalHeight
      for (const chapter of this.data.readingResource?.chapters ?? []) {
        const page = chapter.pages.find(item => item.pageNumber === this.data.displayPageNumber)
        if (page) { sourceWidth = page.width; sourceHeight = page.height; break }
      }
      const viewport = fullscreenViewport(systemInfo.windowWidth, systemInfo.windowHeight)
      const size = fitFullscreenImage(viewport.width, viewport.height,
        sourceWidth, sourceHeight, this.data.pageSegments.length > 0)
      const pageNumber = this.data.displayPageNumber
      this.setData({ fullscreenStyle: viewport.style,
        fullscreenViewportWidth: viewport.width,
        fullscreenImageStyle: `width:${size.width}px;height:${size.height}px;` }, () => {
        this.createSelectorQuery().select('.reading-fullscreen-stage').boundingClientRect(rect => {
          if (!rect || Array.isArray(rect) || rect.width <= 0 || rect.height <= 0
            || !this.data.zoomed || this.data.displayPageNumber !== pageNumber
            || this.data.fullscreenStyle !== viewport.style) return
          const fitted = fitFullscreenImageToStage(rect.width, rect.height, sourceWidth, sourceHeight)
          this.setData({ fullscreenImageStyle: `width:${fitted.width}px;height:${fitted.height}px;` })
        }).exec()
      })
    },
    fullscreenImageLoaded(event: WechatMiniprogram.ImageLoad) {
      if (Number(event.currentTarget.dataset.page) !== this.data.displayPageNumber) return
      const width = event.detail.width, height = event.detail.height
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
      this.setData({ fullscreenNaturalWidth: width, fullscreenNaturalHeight: height },
        () => this.updateFullscreenLayout())
    },
    onFullscreenTouchStart(event: WechatMiniprogram.TouchEvent) {
      const touch = event.touches[0]
      if (!touch) return
      fullscreenGestureStates.set(this, { startX: touch.clientX, startY: touch.clientY,
        suppressTapUntil: 0 })
    },
    onFullscreenTouchEnd(event: WechatMiniprogram.TouchEvent) {
      const state = fullscreenGestureStates.get(this)
      const touch = event.changedTouches[0]
      if (!state || !touch) return
      const delta = fullscreenSwipeDelta(state.startX, state.startY,
        touch.clientX, touch.clientY, this.data.fullscreenViewportWidth)
      if (delta) {
        state.suppressTapUntil = Date.now() + 350
        fullscreenGestureStates.set(this, state)
        this.requestPageChange(delta)
      }
    },
    onFullscreenTap() {
      const state = fullscreenGestureStates.get(this)
      if (state && state.suppressTapUntil > Date.now()) {
        state.suppressTapUntil = 0
        fullscreenGestureStates.set(this, state)
        return
      }
      this.closeFullscreen()
    },
    toggleFullscreenSubtitle() { this.setData({ subtitleInChinese: !this.data.subtitleInChinese }) },
    noop() {},
    previousPage() { this.requestPageChange(-1) },
    nextPage() { this.requestPageChange(1) },
    jumpToPointreadPage() {
      if (this.data.taskMode || this.data.checkinMode || this.data.teacherReviewMode
        || this.data.teacherPreviewMode) return
      const target = this.data.nextPointreadPageNumber
      if (target > 0 && target !== this.data.displayPageNumber) {
        this.confirmFollowReadingLeave(() => { void this.changePage(target - this.data.displayPageNumber) })
      }
    },
    requestPageChange(delta: number) {
      if (this.data.teacherReviewMode || this.data.teacherPreviewMode) {
        void this.changePage(delta); return
      }
      const reading = this.data.reading
      if (!reading || this.data.saving
        || !reading.pages.some(page => page.pageNumber === this.data.displayPageNumber + delta)) return
      if (delta > 0 && (this.data.taskMode || this.data.checkinMode) && this.data.followReadingChecking) {
        wx.showToast({ title: '正在核对本页跟读内容，请稍候', icon: 'none' })
        return
      }
      if (delta > 0 && this.isFollowReadingIncomplete()) {
        wx.showToast({ title: `请先完成本页跟读（${this.completedFollowReadingCount()}/${this.data.pageSegments.length}）`, icon: 'none' })
        return
      }
      if (!this.data.saveError && !this.data.imageError && !this.data.imageRefreshAttempted
        && (this.data.imageLoading || this.data.pendingPageNumber > 0)) return
      const proceed = () => this.confirmFollowReadingLeave(() => { void this.changePage(delta) })
      if (this.data.saveError) {
        wx.showModal({ title: '本页进度未保存', content: '继续翻页不会记录本页进度，可以稍后返回重试。',
          confirmText: '继续翻页', cancelText: '留在本页',
          success: result => { if (result.confirm) proceed() } })
        return
      }
      proceed()
    },
    updateFollowReadingGate(pageSegments: readonly { id: string }[], pageNumber?: number,
      completedByPage?: Record<number, string[]>, unverified = false) {
      const resolvedPage = pageNumber ?? this.data.displayPageNumber
      const completed = (completedByPage ?? this.data.pronunciationCompletedByPage)[resolvedPage] ?? []
      const completedCount = pageSegments.filter(segment => completed.includes(segment.id)).length
      const blocked = (this.data.taskMode || this.data.checkinMode)
        && !this.data.teacherReviewMode && !this.data.teacherPreviewMode
        && ['picture', 'picture_book'].includes(this.data.reading?.book.category ?? '')
        && (unverified || Boolean(this.data.pronunciationError)
          || pageSegments.length > 0 && completedCount < pageSegments.length)
      this.setData({ followReadingBlocked: blocked, followReadingChecking: false,
        followReadingProgress: `已完成 ${completedCount} / ${pageSegments.length} 段` })
    },
    completedFollowReadingCount(): number {
      const completed = this.data.pronunciationCompletedByPage[this.data.displayPageNumber] ?? []
      return this.data.pageSegments.filter(segment => completed.includes(segment.id)).length
    },
    isFollowReadingIncomplete(): boolean {
      return (this.data.taskMode || this.data.checkinMode)
        && !this.data.teacherReviewMode && !this.data.teacherPreviewMode
        && ['picture', 'picture_book'].includes(this.data.reading?.book.category ?? '')
        && (this.data.followReadingChecking || this.data.followReadingBlocked)
    },
    onPronunciationFollowReadComplete(event: WechatMiniprogram.CustomEvent<{ segmentId: string }>) {
      const segmentId = event.detail.segmentId
      if (!segmentId || !this.data.pageSegments.some(segment => segment.id === segmentId)) return
      const pageNumber = this.data.displayPageNumber
      const pageCompleted = this.data.pronunciationCompletedByPage[pageNumber] ?? []
      if (pageCompleted.includes(segmentId)) return
      const pronunciationCompletedByPage = { ...this.data.pronunciationCompletedByPage,
        [pageNumber]: [...pageCompleted, segmentId] }
      this.setData({ pronunciationCompletedByPage }, () =>
        this.updateFollowReadingGate(this.data.pageSegments, pageNumber, pronunciationCompletedByPage))
    },
    async changePage(delta: number) {
      const reading = this.data.reading
      if (this.data.teacherReviewMode || this.data.teacherPreviewMode) {
        if (!reading) return
        const reviewPageIndex = this.data.reviewPageIndex + delta
        const page = reading.pages[reviewPageIndex]
        if (!page) return
        if (this.data.teacherPreviewMode) {
          activeReadingAudio?.destroy(); activeReadingAudio = null; activeAudioSourceKey = ''
          audioMapRequest++
        }
        this.setData({ reviewPageIndex, displayPageNumber: page.pageNumber,
          displayChapterNumber: page.chapterNumber, displayImageUrl: page.imageUrl,
          displayThumbnailUrl: page.thumbnailUrl, pendingPageNumber: 0, saving: false,
          imageLoading: Boolean(page.imageUrl), imageError: !page.imageUrl && !page.thumbnailUrl,
          imageRefreshAttempted: false, imageErrorMessage: '',
          showHighRes: Boolean(page.imageUrl), zoomed: this.data.zoomed,
          ...(this.data.teacherReviewMode ? { pageSegments: this.reviewPageSegments(page.pageNumber) } : {}),
          ...(this.data.teacherPreviewMode ? { pageHotspots: [], audioMapReady: false,
            audioMap: null, audioMode: 'none' as const, mediaPlaying: false,
            activeHotspotId: '', pageSegments: segmentsForPage(this.data.mediaSegments, page.pageNumber) } : {}) },
        () => {
          if (this.data.zoomed) this.updateFullscreenLayout()
          if (this.data.teacherReviewMode) void this.loadTeacherPronunciationEvidence(page.pageNumber)
          if (this.data.teacherPreviewMode) void this.loadReadingAudioMap(reading.book.id, page.pageNumber)
        })
        return
      }
      if (!reading || this.data.saving) return
      const nextPageNumber = this.data.displayPageNumber + delta
      const nextPage = reading.pages.find(page => page.pageNumber === nextPageNumber)
      if (!nextPage) return
      const sameChapter = Boolean(this.data.audioMap && this.data.readingResource
        && chapterIdForPage(this.data.readingResource, nextPage.pageNumber) === this.data.audioMap.chapterId)
      const keepChapterPlaying = sameChapter && this.data.audioMode === 'chapter'
      if (!keepChapterPlaying) {
        this.rememberAudioPosition()
        activeReadingAudio?.destroy(); activeReadingAudio = null; activeAudioSourceKey = ''
      }
      this.setData({ displayPageNumber: nextPage.pageNumber, displayChapterNumber: nextPage.chapterNumber,
        nextPointreadPageNumber: nextPointreadPage(this.data.pointreadPageNumbers, nextPage.pageNumber) ?? 0,
        displayImageUrl: nextPage.imageUrl, displayThumbnailUrl: nextPage.thumbnailUrl, pendingPageNumber: nextPage.pageNumber,
        imageLoading: Boolean(nextPage.imageUrl),
        imageError: !nextPage.imageUrl && !nextPage.thumbnailUrl, imageRefreshAttempted: false,
        imageErrorMessage: '', showHighRes: false, zoomed: this.data.zoomed,
        pageSegments: segmentsForPage(this.data.mediaSegments, nextPage.pageNumber),
        pageHotspots: sameChapter && this.data.audioMap ? hotspotsForPage(this.data.audioMap, nextPage.pageNumber) : [],
        ...(sameChapter ? {} : { audioMap: null, audioMapReady: false, audioMode: 'none' as const }),
        mediaPlaying: keepChapterPlaying ? this.data.mediaPlaying : false,
        earMode: sameChapter ? this.data.earMode : false,
        activeSegmentId: '', activeHotspotId: '', mediaError: '',
        ...(sameChapter ? {} : { mediaProgress: 0, mediaCurrentLabel: '00:00', mediaDurationLabel: '00:00' }) },
      () => { this.setData({ showHighRes: Boolean(nextPage.imageUrl) });
        if (this.data.zoomed) this.updateFullscreenLayout()
        this.updateFollowReadingGate(this.data.pageSegments, nextPage.pageNumber)
        if (!nextPage.imageUrl && !nextPage.thumbnailUrl) void this.retryImage()
        if (!sameChapter) void this.loadReadingAudioMap(reading.book.id, nextPage.pageNumber) })
    },
    async toggleFavorite() {
      if (this.data.teacherReviewMode || this.data.teacherPreviewMode) return
      const session = getSession()
      const reading = this.data.reading
      if (!session || !reading || this.data.saving || this.data.pendingPageNumber) return
      const result = await toggleReadingFavorite(session.user.id, reading.book.id)
      if (result.ok) this.setData({ 'reading.book.favorite': result.data.favorite })
    },
    returnToCheckin() {
      if (this.data.teacherReviewMode || this.data.teacherPreviewMode) { wx.navigateBack(); return }
      if (this.data.saving) {
        wx.showToast({ title: '当前页面正在保存，请稍候', icon: 'none' })
        return
      }
      const leave = () => this.confirmFollowReadingLeave(() => {
        if (getCurrentPages().length > 1) wx.navigateBack()
        else wx.reLaunch({ url: this.data.returnUrl })
      })
      if (this.data.saveError) {
        wx.showModal({ title: '阅读进度未保存', content: '离开后可重新打开本页重试保存。',
          confirmText: '离开', cancelText: '留在本页',
          success: result => { if (result.confirm) leave() } })
        return
      }
      leave()
    },
  },
})

function formatAudioTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

