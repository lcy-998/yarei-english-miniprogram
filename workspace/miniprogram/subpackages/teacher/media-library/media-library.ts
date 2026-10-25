// T-19: central media catalog and entry to the teacher's private videos.
import type { TeacherAssetFacet, TeacherAssetFilters, TeacherAssetListItem } from '../../../domain/teacher-media'
import type { TeacherPrivateVideo } from '../../../domain/teacher-private-video'
import { mediaFacetOptions } from '../content-selector/catalog-facets'
import { listTeacherAssetFacets, listTeacherAssets } from '../services/teacher-media-service'
import { getMyVideoAvailability, listMyVideos } from '../services/teacher-private-video-service'
import { getSession, setTeacherCatalogResultIds, takeTeacherMediaInitialIds } from '../session/session'

type MediaKind = TeacherAssetFilters['kind']
type MediaRow = TeacherAssetListItem & { durationLabel: string; questionLabel: string; selected: boolean }
type PrivateVideoRow = TeacherPrivateVideo & { durationLabel: string; selected: boolean }
const KINDS: Array<{ value: MediaKind; label: string }> = [
  { value: 'listening', label: '听力' }, { value: 'video', label: '看视频' },
  { value: 'dubbing', label: '视频配音' },
]

function mediaRow(item: TeacherAssetListItem, selectedIds: readonly string[]): MediaRow {
  const seconds = Math.ceil(item.durationMs / 1000)
  const durationLabel = seconds < 60 ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
  return { ...item, durationLabel,
    questionLabel: item.questionCount ? `${item.questionCount} 题` : '无配套题',
    selected: selectedIds.includes(item.id) }
}

Component({
  data: {
    kinds: KINDS, kind: 'listening' as MediaKind, keyword: '', grade: '', textbook: '', unit: '',
    facets: [] as TeacherAssetFacet[], filterOptions: mediaFacetOptions([], {}), filterOpen: '',
    facetLoading: false, facetError: '', facetQueryVersion: 0, suppressClose: false,
    targetClassIds: [] as string[], fromTask: false, initialSelectedIds: [] as string[],
    privateVideos: [] as PrivateVideoRow[], privateVideosLoading: false, privateVideosError: '',
    items: [] as MediaRow[], nextOffset: null as number | null,
    loading: false, loadingMore: false, error: '', initialized: false, queryVersion: 0,
    myVideosReady: false,
  },
  pageLifetimes: { show() {
    this.checkMyVideos()
    if (this.data.initialized) return
    const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
    const options = pages[pages.length - 1]?.options ?? {}
    const kind = KINDS.find(item => item.value === options.kind)?.value ?? 'listening'
    const targetClassIds = options.targetClassIds
      ? decodeURIComponent(options.targetClassIds).split(',').filter(Boolean) : []
    const fromTask = options.fromTask === '1'
    this.setData({ initialized: true, kind, targetClassIds, fromTask,
      initialSelectedIds: fromTask ? [...takeTeacherMediaInitialIds()] : [] },
      () => { void this.loadFilterOptions(); void this.load(); void this.loadPrivateVideos() })
  } },
  methods: {
    async checkMyVideos() {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'teacher') {
        this.setData({ myVideosReady: false }); return
      }
      const result = await getMyVideoAvailability(session.user.id)
      this.setData({ myVideosReady: result.ok && result.data.enabled })
    },
    openMyVideos() {
      if (this.data.myVideosReady) wx.navigateTo({ url: '/subpackages/teacher/my-videos/my-videos' })
    },
    chooseKind(event: WechatMiniprogram.TouchEvent) {
      const kind = event.currentTarget.dataset.kind as MediaKind
      if (!KINDS.some(item => item.value === kind) || kind === this.data.kind) return
      this.setData({ kind, grade: '', textbook: '', unit: '', filterOpen: '',
        items: [], nextOffset: null, error: '', facets: [], filterOptions: mediaFacetOptions([], {}),
        privateVideos: [], privateVideosError: '' },
      () => { void this.loadFilterOptions(); void this.load(); void this.loadPrivateVideos() })
    },
    onKeyword(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }) },
    closeFilter() {
      if (this.data.suppressClose) { this.setData({ suppressClose: false }); return }
      this.setData({ filterOpen: '' })
    },
    toggleFilter(event: WechatMiniprogram.TouchEvent) {
      const key = event.currentTarget.dataset.key as string
      if (!['grade', 'textbook', 'unit'].includes(key)) return
      this.setData({ filterOpen: this.data.filterOpen === key ? '' : key, suppressClose: true })
    },
    chooseFilter(event: WechatMiniprogram.TouchEvent) {
      const key = event.currentTarget.dataset.key as 'grade' | 'textbook' | 'unit'
      const value = event.currentTarget.dataset.value as string
      const grade = key === 'grade' ? value : this.data.grade
      const textbook = key === 'grade' ? '' : key === 'textbook' ? value : this.data.textbook
      const unit = key === 'grade' || key === 'textbook' ? '' : key === 'unit' ? value : this.data.unit
      const selected = { grade, textbook, unit }
      const filterOptions = mediaFacetOptions(this.data.facets, selected)
      this.setData({ ...selected, filterOptions, filterOpen: '', suppressClose: true }, () => this.load())
    },
    async loadFilterOptions() {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'teacher') return
      const facetQueryVersion = this.data.facetQueryVersion + 1
      const { kind, targetClassIds } = this.data
      this.setData({ facetQueryVersion, facetLoading: true, facetError: '' })
      const result = await listTeacherAssetFacets(session.user.id, kind,
        targetClassIds.length ? targetClassIds : undefined)
      if (facetQueryVersion !== this.data.facetQueryVersion) return
      if (!result.ok) {
        this.setData({ facetLoading: false, facetError: result.error.message,
          facets: [], filterOptions: mediaFacetOptions([], {}) })
        return
      }
      const facets = result.data
      const grade = this.data.grade && facets.some(item => item.grade === this.data.grade) ? this.data.grade : ''
      const options = mediaFacetOptions(facets, { grade, textbook: this.data.textbook, unit: this.data.unit })
      const textbook = options.textbooks.some(item => item.value === this.data.textbook) ? this.data.textbook : ''
      const resolvedOptions = mediaFacetOptions(facets, { grade, textbook, unit: this.data.unit })
      const unit = resolvedOptions.units.some(item => item.value === this.data.unit) ? this.data.unit : ''
      this.setData({ facetLoading: false, facets, grade, textbook, unit,
        filterOptions: mediaFacetOptions(facets, { grade, textbook, unit }) })
    },
    retryFilterOptions() { void this.loadFilterOptions() },
    async loadPrivateVideos() {
      if (this.data.kind !== 'video') {
        this.setData({ privateVideos: [], privateVideosError: '', privateVideosLoading: false })
        return
      }
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'teacher') return
      this.setData({ privateVideosLoading: true, privateVideosError: '' })
      const result = await listMyVideos(session.user.id)
      if (this.data.kind !== 'video' || getSession()?.sessionId !== session.sessionId) return
      if (!result.ok) {
        this.setData({ privateVideosLoading: false, privateVideosError: result.error.message })
        return
      }
      const privateVideos = result.data.filter(item => item.status === 'published').map(item => ({
        ...item,
        durationLabel: `${Math.ceil(item.durationMs / 60000)} 分钟`,
        selected: this.data.initialSelectedIds.includes(item.id),
      }))
      this.setData({ privateVideos, privateVideosLoading: false, privateVideosError: '' })
    },
    usePrivateVideo(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (!this.data.privateVideos.some(item => item.id === id && item.status === 'published')) return
      setTeacherCatalogResultIds([...this.data.initialSelectedIds, id])
      if (this.data.fromTask && getCurrentPages().length > 2) wx.navigateBack({ delta: 2 })
      else wx.navigateTo({ url: '/subpackages/teacher/publish-task/publish-task' })
    },
    search() { this.load() },
    async load() {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'teacher') {
        this.setData({ error: '请使用授权教师账号查看教学素材', loading: false }); return
      }
      const kind = this.data.kind
      const keyword = this.data.keyword.trim()
      const grade = this.data.grade
      const textbook = this.data.textbook
      const unit = this.data.unit
      const queryVersion = this.data.queryVersion + 1
      this.setData({ queryVersion, loading: true, loadingMore: false, error: '', items: [], nextOffset: null })
      const result = await listTeacherAssets(session.user.id, { kind,
        ...(keyword ? { keyword } : {}),
        ...(grade ? { grade } : {}), ...(textbook ? { textbook } : {}), ...(unit ? { unit } : {}),
        ...(this.data.targetClassIds.length ? { targetClassIds: this.data.targetClassIds } : {}),
      }, 20, 0)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false,
        items: result.data.items.map(item => mediaRow(item, this.data.initialSelectedIds)),
        nextOffset: result.data.nextOffset })
    },
    async loadMore() {
      const offset = this.data.nextOffset
      const session = getSession()
      if (!session || offset === null || this.data.loading || this.data.loadingMore) return
      const kind = this.data.kind
      const keyword = this.data.keyword.trim()
      const grade = this.data.grade
      const textbook = this.data.textbook
      const unit = this.data.unit
      const queryVersion = this.data.queryVersion
      this.setData({ loadingMore: true, error: '' })
      const result = await listTeacherAssets(session.user.id, { kind,
        ...(keyword ? { keyword } : {}),
        ...(grade ? { grade } : {}), ...(textbook ? { textbook } : {}), ...(unit ? { unit } : {}),
        ...(this.data.targetClassIds.length ? { targetClassIds: this.data.targetClassIds } : {}),
      }, 20, offset)
      if (queryVersion !== this.data.queryVersion) return
      if (!result.ok) { this.setData({ loadingMore: false, error: result.error.message }); return }
      const known = new Set(this.data.items.map(item => item.id))
      this.setData({ loadingMore: false,
        items: [...this.data.items, ...result.data.items.filter(item => !known.has(item.id))
          .map(item => mediaRow(item, this.data.initialSelectedIds))],
        nextOffset: result.data.nextOffset })
    },
    preview(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (!this.data.items.some(item => item.id === id)) return
      const scope = this.data.targetClassIds.length
        ? `&targetClassIds=${encodeURIComponent(this.data.targetClassIds.join(','))}` : ''
      wx.navigateTo({ url: `/subpackages/teacher/media-preview/media-preview?id=${encodeURIComponent(id)}${scope}` })
    },
    useAsset(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (!getSession() || !this.data.items.some(item => item.id === id)) return
      setTeacherCatalogResultIds(this.data.fromTask ? [...this.data.initialSelectedIds, id] : [id])
      if (this.data.fromTask && getCurrentPages().length > 2) wx.navigateBack({ delta: 2 })
      else wx.navigateTo({ url: '/subpackages/teacher/publish-task/publish-task' })
    },
  },
})
