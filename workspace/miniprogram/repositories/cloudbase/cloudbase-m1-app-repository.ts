import { ServiceError, ServiceResponseMeta, ServiceResult } from '../../domain/types'
import { ChildView, M1AppRepository, ProfileView, ReadingBookView, ReadingCategory, ReadingProgressView, StudentDetailView, StudentListView, WordPracticeView } from '../m1-app-repository'
import { AuthV2AccountPort } from './auth-v2-account-port'
import { CloudFunctionInvoker, M1FunctionName, M1FunctionRequest } from './cloud-function-invoker'
import { displayPageImageUrl } from '../../shared/reading-page-image'

type JsonRecord = Record<string, unknown>
type Guard<T> = (value: unknown) => value is T
type RawReadingProgress = JsonRecord & Readonly<{
  resourceId: string
  chapterId: string
  pageId: string
  pageNumber: number
  favorite: boolean
  version: number
}>

export const M1_CLOUDBASE_ACTION_COVERAGE = {
  'P-03.requestPasswordCode': 'AuthV2AccountPort.requestPasswordCode',
  'P-03.resetPassword': 'AuthV2AccountPort.resetPassword',
  'P-04.getProfile': 'auth-session.getProfile',
  'P-04.saveProfile': 'auth-session.updateProfile',
  'S-02.getWordPractice': 'content-query.getVocabularyPack',
  'S-03.listReadingBooks': 'content-query.listReadingResources',
  'S-03.toggleReadingFavorite': 'learning-progress-command.saveReadingProgress',
  'S-04.getReadingProgress': 'content-query.getReadingResource + learning-progress-query.getReadingProgress',
  'S-04.setReadingPage': 'learning-progress-command.saveReadingProgress',
  'G-02.listChildren': 'parent-query.listChildren',
  'G-02.bindChild': 'relationship-command.bindChild',
  'G-02.chooseChild': 'client-session-only',
  'G-02.unbindChild': 'relationship-command.unbindChild',
  'T-02.listTeacherStudents': 'teacher-student-query.listStudents',
  'T-03.getTeacherStudent': 'teacher-student-query.getStudent',
} as const

const ERROR_CODES: ReadonlySet<ServiceError['code']> = new Set([
  'VALIDATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RESOURCE_OFFLINE',
  'TASK_NOT_SUBMITTABLE', 'REDO_LIMIT_REACHED', 'DUPLICATE_OPERATION', 'NETWORK_ERROR',
  'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR',
])

const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

function isMeta(value: unknown): value is ServiceResponseMeta {
  return isRecord(value) && isString(value.requestId) && isString(value.serverTime) && value.apiVersion === 'm1.v1'
}

function isError(value: unknown): value is ServiceError {
  if (!isRecord(value) || !isString(value.code) || !ERROR_CODES.has(value.code as ServiceError['code']) || !isString(value.message) || !isBoolean(value.retryable)) return false
  return value.fieldErrors === undefined || (isRecord(value.fieldErrors) && Object.values(value.fieldErrors).every(isString))
}

function fail<T>(code: ServiceError['code'], message: string, retryable = false): ServiceResult<T> {
  return { ok: false, error: { code, message, retryable } }
}

function isRawProfile(value: unknown): value is JsonRecord {
  if (!isRecord(value) || !isString(value.id) || !isString(value.displayName) || !isNumber(value.version)) return false
  if (value.role !== 'student' && value.role !== 'parent' && value.role !== 'teacher') return false
  if (!isRecord(value.organization) || !isString(value.organization.name) || !Array.isArray(value.classes)) return false
  return value.classes.every(item => isRecord(item) && isString(item.name))
}

function mapProfile(raw: JsonRecord): ProfileView {
  const organization = raw.organization as JsonRecord
  const classes = raw.classes as JsonRecord[]
  const role = raw.role as ProfileView['role']
  return {
    userId: raw.id as string,
    displayName: raw.displayName as string,
    maskedMobile: '未提供',
    role,
    roleLabel: role === 'student' ? '学生' : role === 'parent' ? '家长' : '教师',
    organization: organization.name as string,
    ...(classes[0] === undefined ? {} : { className: classes[0].name as string }),
    version: raw.version as number,
  }
}

function isRawVocabularyPack(value: unknown): value is JsonRecord {
  if (!isRecord(value) || !isString(value.id) || !isString(value.title) || !isString(value.grade) || !Array.isArray(value.words) || value.words.length === 0) return false
  return value.words.every(item => isRecord(item) && isString(item.id) && isString(item.word) && isString(item.meaning)
    && Array.isArray(item.syllables) && item.syllables.every(isString))
}

function mapVocabularyPack(raw: JsonRecord): WordPracticeView {
  const word = (raw.words as JsonRecord[])[0]
  const meaning = word.meaning as string
  const fallbackOptions = ['动物', '动物园', '雨天', '森林']
  const options = [meaning, ...fallbackOptions.filter((item) => item !== meaning)].slice(0, 3)
  return {
    packId: raw.id as string,
    packLabel: raw.title as string,
    todayCompleted: 0,
    todayTotal: (raw.words as JsonRecord[]).length,
    masteredPercent: 0,
    wordId: word.id as string,
    word: word.word as string,
    syllables: (word.syllables as string[]).join('-'),
    meaning,
    example: isString(word.example) ? word.example : '',
    options,
    correctOption: meaning,
    wrongCount: 0,
  }
}

function pageItems(value: unknown, itemGuard: Guard<JsonRecord>): JsonRecord[] | null {
  if (!isRecord(value) || !Array.isArray(value.items) || !value.items.every(itemGuard)) return null
  return value.items
}

const isRawResourceSummary: Guard<JsonRecord> = (value): value is JsonRecord => isRecord(value) && isString(value.id) && isString(value.title)
  && (isString(value.contentVersion) || isNumber(value.contentVersion))

function readingCategory(value: unknown): ReadingCategory | null {
  if (value === 'original') return 'original'
  if (value === 'synchronized') return 'textbook'
  if (value === 'picture_book') return 'picture'
  if (value === 'current_events') return 'current'
  if (value === 'chapter_book') return 'chapter'
  return null
}

function mapReadingList(raw: unknown): ReadingBookView[] | null {
  const items = Array.isArray(raw) && raw.every(isRawResourceSummary)
    ? raw
    : pageItems(raw, isRawResourceSummary)
  if (items === null) return null
  if (items.some(item => readingCategory(item.category) === null)) return null
  return items.map(item => ({
    id: item.id as string,
    title: item.title as string,
    category: readingCategory(item.category)!,
    grade: isString(item.grade) ? item.grade : '已授权',
    difficulty: isString(item.difficulty) ? item.difficulty : '基础',
    theme: '英语',
    progressPercent: 0,
    favorite: false,
    pageCount: 0,
  }))
}

type ReadingPageReference = Readonly<{ id: string; chapterId: string; pageNumber: number; chapterNumber: number; imageUrl: string; thumbnailUrl: string }>

function readingPageReferences(raw: JsonRecord): ReadingPageReference[] | null {
  if (!Array.isArray(raw.chapters)) return null
  const pages: ReadingPageReference[] = []
  for (const [chapterIndex, chapter] of raw.chapters.entries()) {
    if (!isRecord(chapter) || !isString(chapter.id) || !Array.isArray(chapter.pages)) return null
    for (const page of chapter.pages) {
      if (!isRecord(page) || !isString(page.id) || !isNumber(page.pageNumber) || !isString(page.imageAssetKey)) return null
      pages.push({ id: page.id, chapterId: chapter.id, pageNumber: page.pageNumber, chapterNumber: chapterIndex + 1,
        imageUrl: displayPageImageUrl(page.imageAssetKey), thumbnailUrl: displayPageImageUrl(isString(page.thumbnailAssetKey) ? page.thumbnailAssetKey : page.imageAssetKey) })
    }
  }
  return pages.length === 0 ? null : pages.sort((left, right) => left.pageNumber - right.pageNumber)
}

function isRawReadingResource(value: unknown): value is JsonRecord {
  return isRawResourceSummary(value) && readingPageReferences(value) !== null
}

function isRawReadingProgress(value: unknown): value is RawReadingProgress {
  return isRecord(value) && isString(value.resourceId) && isString(value.chapterId) && isString(value.pageId)
    && isNumber(value.pageNumber) && isBoolean(value.favorite) && isNumber(value.version)
}

function mapReadingResource(raw: JsonRecord, pageNumber: number, favorite = false): ReadingProgressView {
  const pages = readingPageReferences(raw)
  if (pages === null) throw new Error('阅读资源页数据无效')
  const safePage = Math.max(1, Math.min(pageNumber, pages.length))
  const page = pages[safePage - 1]
  if (!page) throw new Error('阅读资源页图无效')
  const chapterCount = (raw.chapters as unknown[]).length
  return {
    book: { id: raw.id as string, title: raw.title as string, category: readingCategory(raw.category) ?? 'picture', grade: isString(raw.grade) ? raw.grade : '已授权', difficulty: isString(raw.difficulty) ? raw.difficulty : '基础', theme: '英语', progressPercent: Math.round(safePage * 100 / pages.length), favorite, pageCount: pages.length },
    hasSavedProgress: false,
    chapterNumber: page.chapterNumber,
    chapterCount,
    pageNumber: safePage,
    pageCount: pages.length,
    progressPercent: Math.round(safePage * 100 / pages.length),
    pageImageUrl: page.imageUrl,
    thumbnailImageUrl: page.thumbnailUrl,
    pages: pages.map(item => ({ pageNumber: item.pageNumber, chapterNumber: item.chapterNumber, imageUrl: item.imageUrl, thumbnailUrl: item.thumbnailUrl })),
  }
}

const isRawChild: Guard<JsonRecord> = (value): value is JsonRecord => isRecord(value) && isString(value.childId) && isString(value.displayName) && isNumber(value.linkVersion)
const isRawBoundChild: Guard<JsonRecord> = (value): value is JsonRecord => isRecord(value) && isString(value.childId) && isString(value.displayName) && isNumber(value.version) && value.status === 'active'
const isRawUnbound: Guard<JsonRecord> = (value): value is JsonRecord => isRecord(value) && isString(value.childId) && isNumber(value.version) && value.status === 'revoked'

function isRawStudentSummary(value: unknown): value is JsonRecord {
  return isRecord(value) && isString(value.studentId) && isString(value.displayName) && isString(value.studentNumber)
    && (value.accountStatus === 'active' || value.accountStatus === 'disabled')
    && isRecord(value.classInfo) && isString(value.classInfo.name)
    && isRecord(value.performance) && isNumber(value.performance.completedCount) && isNumber(value.performance.assignedCount)
}

function mapStudentSummary(raw: JsonRecord): StudentListView {
  const performance = raw.performance as JsonRecord
  const completedCount = performance.completedCount as number
  const totalCount = performance.assignedCount as number
  const status = raw.accountStatus === 'disabled' ? 'disabled' : 'active'
  const classInfo = raw.classInfo as JsonRecord
  return {
    id: raw.studentId as string,
    displayName: raw.displayName as string,
    studentNumber: raw.studentNumber as string,
    className: classInfo.name as string,
    status,
    statusLabel: status === 'active' ? '正常' : '已停用',
    completedCount,
    totalCount,
    completionPercent: totalCount === 0 ? 0 : Math.round(completedCount * 100 / totalCount),
  }
}

function isRawStudentDetail(value: unknown): value is JsonRecord {
  return isRawStudentSummary(value) && Array.isArray(value.parents) && value.parents.every(item => isRecord(item) && isString(item.displayNameMasked))
    && Array.isArray(value.recentTasks) && value.recentTasks.every(item => isRecord(item) && isString(item.taskId) && isString(item.status))
}

function mapStudentDetail(raw: JsonRecord): StudentDetailView {
  const base = mapStudentSummary(raw)
  const parents = raw.parents as JsonRecord[]
  const tasks = raw.recentTasks as JsonRecord[]
  return {
    ...base,
    maskedMobile: '未提供',
    guardianName: parents[0] && isString(parents[0].displayNameMasked) ? parents[0].displayNameMasked : '暂无有效家长关系',
    guardianMaskedMobile: '未提供',
    averageScore: 0,
    recentTasks: tasks.map(item => ({ id: item.taskId as string, title: item.title as string, statusLabel: item.status as string, ...(isNumber(item.score) ? { score: item.score } : {}) })),
  }
}

export class CloudBaseM1AppRepository implements M1AppRepository {
  private readonly profileVersions = new Map<string, number>()
  private readonly readingPages = new Map<string, number>()
  private readonly readingBooks = new Map<string, ReadingBookView>()
  private readonly resourceVersions = new Map<string, number>()
  private readonly favoriteVersions = new Map<string, number>()
  private readonly progressVersions = new Map<string, number>()
  private readonly readingPageReferences = new Map<string, readonly ReadingPageReference[]>()
  private readonly readingViews = new Map<string, ReadingProgressView>()
  private readonly children = new Map<string, ChildView>()

  constructor(private readonly invoker?: CloudFunctionInvoker, private readonly authV2?: AuthV2AccountPort) {}

  async getProfile(userId: string): Promise<ServiceResult<ProfileView>> {
    const result = await this.invokeMapped('auth-session', request('getProfile', {}), isRawProfile, mapProfile)
    if (result.ok && result.data.version !== undefined) this.profileVersions.set(userId, result.data.version)
    return result
  }

  async saveProfile(userId: string, displayName: string): Promise<ServiceResult<ProfileView>> {
    const expectedVersion = this.profileVersions.get(userId)
    if (expectedVersion === undefined) return unavailable('请先刷新资料后再保存')
    const result = await this.invokeMapped('auth-session', request('updateProfile', { displayName }, { operationId: 'profile_update_' + expectedVersion, expectedVersion }), isRawProfile, mapProfile)
    if (result.ok && result.data.version !== undefined) this.profileVersions.set(userId, result.data.version)
    return result
  }

  requestPasswordCode(mobile: string): Promise<ServiceResult<{ cooldownSeconds: number }>> {
    return this.authV2 ? this.authV2.requestPasswordCode(mobile) : unavailable('CloudBase Authentication v2 尚未配置')
  }

  resetPassword(mobile: string, code: string, password: string, confirmation: string): Promise<ServiceResult<true>> {
    return this.authV2 ? this.authV2.resetPassword(mobile, code, password, confirmation) : unavailable('CloudBase Authentication v2 尚未配置')
  }

  getWordPractice(_userId: string): Promise<ServiceResult<WordPracticeView>> {
    return this.invokeMapped('content-query', request('getVocabularyPack', { resourceId: 'res_vocabulary_animals_cloud_v1' }), isRawVocabularyPack, mapVocabularyPack)
  }

  async listReadingBooks(_userId: string, category: ReadingCategory = 'picture', onlyFavorites = false): Promise<ServiceResult<ReadingBookView[]>> {
    const response = await this.invokeRaw('content-query', request('listReadingResources', {}))
    if (!response.ok) return response
    const mapped = mapReadingList(response.data)
    if (mapped === null) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
    const rawItems = (Array.isArray(response.data) ? response.data : (response.data as JsonRecord).items) as JsonRecord[]
    mapped.forEach((book, index) => { this.readingBooks.set(book.id, book); this.resourceVersions.set(book.id, rawItems[index].contentVersion as number) })
    const visible = mapped.filter(book => book.category === category)
    const progress = await Promise.all(visible.map(book => this.getReadingProgress(_userId, book.id)))
    const failed = progress.find((item): item is Extract<ServiceResult<ReadingProgressView>, { ok: false }> => !item.ok)
    if (failed) return failed
    const books = visible.map((book, index) => {
      const saved = progress[index] as Extract<ServiceResult<ReadingProgressView>, { ok: true }>
      return { ...book, progressPercent: saved.data.hasSavedProgress ? saved.data.progressPercent : 0,
        favorite: saved.data.book.favorite, pageCount: saved.data.pageCount }
    }).filter(book => !onlyFavorites || book.favorite)
    return { ok: true, data: books, meta: response.meta }
  }

  async toggleReadingFavorite(_userId: string, bookId: string): Promise<ServiceResult<ReadingBookView>> {
    let current = this.readingViews.get(bookId)
    if (!current) {
      const loaded = await this.getReadingProgress(_userId, bookId)
      if (!loaded.ok) return loaded
      current = loaded.data
    }
    const page = this.readingPageReferences.get(bookId)?.find(item => item.pageNumber === current.pageNumber)
    if (!page) return unavailable('阅读页信息尚未加载')
    const expectedVersion = this.progressVersions.get(bookId) ?? 0
    const favorite = !current.book.favorite
    const result = await this.invokeRaw('learning-progress-command', request('saveReadingProgress', {
      resourceId: bookId, chapterId: page.chapterId, pageId: page.id, pageNumber: page.pageNumber, favorite,
    }, { operationId: `reading_favorite_${bookId}_${favorite ? 'on' : 'off'}_${expectedVersion}`, expectedVersion }))
    if (!result.ok) return result
    const savedProgress = result.data
    if (!isRawReadingProgress(savedProgress)) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
    const updated = { ...current.book, favorite }
    this.favoriteVersions.set(bookId, savedProgress.version)
    this.progressVersions.set(bookId, savedProgress.version)
    this.readingBooks.set(bookId, updated)
    this.readingViews.set(bookId, { ...current, hasSavedProgress: true, book: updated })
    return { ok: true, data: updated, meta: result.meta }
  }

  async getReadingProgress(userId: string, bookId: string): Promise<ServiceResult<ReadingProgressView>> {
    const resource = await this.invokeRaw('content-query', request('getReadingResource', { resourceId: bookId }))
    if (!resource.ok) return resource
    if (!isRawReadingResource(resource.data)) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
    const pages = readingPageReferences(resource.data)
    if (pages === null) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
    this.resourceVersions.set(bookId, resource.data.contentVersion as number)
    this.readingPageReferences.set(bookId, pages)
    const progress = await this.invokeRaw('learning-progress-query', request('getReadingProgress', { resourceId: bookId }))
    if (!progress.ok) return progress
    const progressData = progress.data
    if (progressData !== null && !isRawReadingProgress(progressData)) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
    const saved = progressData === null ? null : progressData
    const pageNumber = saved?.pageNumber ?? this.readingPages.get(userId + ':' + bookId) ?? 1
    const result = mapReadingResource(resource.data, pageNumber, saved?.favorite ?? false)
    if (saved) {
      this.progressVersions.set(bookId, saved.version)
      this.favoriteVersions.set(bookId, saved.version)
    }
    const view = { ...result, hasSavedProgress: saved !== null }
    this.readingPages.set(userId + ':' + bookId, view.pageNumber)
    this.readingViews.set(bookId, view)
    this.readingBooks.set(bookId, view.book)
    return { ok: true, data: view, meta: resource.meta }
  }

  async setReadingPage(userId: string, bookId: string, pageNumber: number): Promise<ServiceResult<ReadingProgressView>> {
    let current = this.readingViews.get(bookId)
    if (!current) { const loaded = await this.getReadingProgress(userId, bookId); if (!loaded.ok) return loaded; current = loaded.data }
    const savedPage = Math.max(1, Math.min(current.pageCount, Math.floor(pageNumber)))
    const page = this.readingPageReferences.get(bookId)?.find(item => item.pageNumber === savedPage)
    if (!page) return unavailable('阅读页信息尚未加载')
    const expectedVersion = this.progressVersions.get(bookId) ?? 0
    const favorite = current.book.favorite
    const result = await this.invokeRaw('learning-progress-command', request('saveReadingProgress', {
      resourceId: bookId, chapterId: page.chapterId, pageId: page.id, pageNumber: page.pageNumber, favorite,
    }, { operationId: `reading_page_${bookId}_${savedPage}_${expectedVersion}`, expectedVersion }))
    if (!result.ok) return result
    const savedProgress = result.data
    if (!isRawReadingProgress(savedProgress)) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
    const progressPercent = Math.round(savedPage * 100 / current.pageCount)
    const updated = { ...current, hasSavedProgress: true, pageNumber: savedPage, chapterNumber: page.chapterNumber,
      pageImageUrl: page.imageUrl, thumbnailImageUrl: page.thumbnailUrl, progressPercent,
      book: { ...current.book, favorite: savedProgress.favorite, progressPercent } }
    this.progressVersions.set(bookId, savedProgress.version)
    this.readingPages.set(userId + ':' + bookId, savedPage)
    this.readingViews.set(bookId, updated)
    this.readingBooks.set(bookId, updated.book)
    return { ok: true, data: updated, meta: result.meta }
  }

  async listChildren(_parentId: string): Promise<ServiceResult<ChildView[]>> {
    const response = await this.invokeRaw('parent-query', request('listChildren', {}))
    if (!response.ok) return response
    const items = Array.isArray(response.data) && response.data.every(isRawChild)
      ? response.data
      : pageItems(response.data, isRawChild)
    if (!items) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
    const mapped = items.map((item, index): ChildView => {
      const child = {
        id: item.childId as string,
        displayName: item.displayName as string,
        className: isString(item.className) ? item.className : '未分班',
        studentNumber: isString(item.studentNumber) ? item.studentNumber : '—',
        current: index === 0,
        linkVersion: item.linkVersion as number,
      }
      this.children.set(child.id, child)
      return child
    })
    return { ok: true, data: mapped, meta: response.meta }
  }

  async bindChild(_parentId: string, operationId: string, studentNumber: string, bindingCode: string): Promise<ServiceResult<ChildView>> {
    const result = await this.invokeMapped('relationship-command', request('bindChild', { studentNumber, code: bindingCode }, { operationId }), isRawBoundChild, raw => ({ id: raw.childId as string, displayName: raw.displayName as string, className: '已绑定班级', studentNumber: '—', current: false, linkVersion: raw.version as number }))
    if (result.ok) this.children.set(result.data.id, result.data)
    return result
  }

  chooseChild(_parentId: string, childId: string): Promise<ServiceResult<ChildView>> {
    const child = this.children.get(childId)
    if (!child) return Promise.resolve(fail('NOT_FOUND', '孩子绑定关系不存在'))
    this.children.forEach(item => { item.current = item.id === childId })
    return Promise.resolve({ ok: true, data: { ...child, current: true } })
  }

  async unbindChild(_parentId: string, childId: string, expectedVersion?: number, operationId?: string): Promise<ServiceResult<true>> {
    const version = expectedVersion ?? this.children.get(childId)?.linkVersion
    if (version === undefined || !operationId) return unavailable('解绑需要关系版本和操作标识')
    const result = await this.invokeMapped('relationship-command', request('unbindChild', { childId, reason: '家长主动解除绑定' }, { operationId, expectedVersion: version }), isRawUnbound, () => true as const)
    if (result.ok) this.children.delete(childId)
    return result
  }

  async listTeacherStudents(_teacherId: string, keyword = '', status = 'all'): Promise<ServiceResult<StudentListView[]>> {
    const normalizedStatus = status === 'active' ? 'normal' : status === 'follow_up' ? 'attention' : status
    const filters: Record<string, unknown> = { status: normalizedStatus }
    if (keyword.trim()) filters.keyword = keyword.trim()
    const response = await this.invokeRaw('teacher-student-query', request('listStudents', { filters, page: { limit: 50 } }))
    if (!response.ok) return response
    const items = pageItems(response.data, isRawStudentSummary)
    return items === null ? fail('INTERNAL_ERROR', '服务返回了无法识别的数据') : { ok: true, data: items.map(mapStudentSummary), meta: response.meta }
  }

  getTeacherStudent(_teacherId: string, studentId: string): Promise<ServiceResult<StudentDetailView>> {
    return this.invokeMapped('teacher-student-query', request('getStudent', { studentId }), isRawStudentDetail, mapStudentDetail)
  }

  private async invokeMapped<TInput, TOutput>(functionName: M1FunctionName, functionRequest: M1FunctionRequest, guard: Guard<TInput>, mapper: (value: TInput) => TOutput): Promise<ServiceResult<TOutput>> {
    const response = await this.invokeRaw(functionName, functionRequest)
    if (!response.ok) return response
    if (!guard(response.data)) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
    return { ok: true, data: mapper(response.data), meta: response.meta }
  }

  private async invokeRaw(functionName: M1FunctionName, functionRequest: M1FunctionRequest): Promise<ServiceResult<unknown>> {
    if (!this.invoker) return fail('SERVICE_UNAVAILABLE', '云端数据源尚未配置')
    try {
      const response = await this.invoker.invoke(functionName, functionRequest)
      if (!isRecord(response) || typeof response.ok !== 'boolean' || !isMeta(response.meta)) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
      if (response.ok) return { ok: true, data: response.data, meta: response.meta }
      if (!isError(response.error)) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
      return { ok: false, error: response.error, meta: response.meta }
    } catch {
      return fail('NETWORK_ERROR', '网络异常，请稍后重试', true)
    }
  }
}

export function createCloudBaseM1AppRepository(options: Readonly<{ invoker?: CloudFunctionInvoker; authV2?: AuthV2AccountPort }> = {}): M1AppRepository {
  return new CloudBaseM1AppRepository(options.invoker, options.authV2)
}

function request(action: string, payload: Record<string, unknown>, options: Readonly<{ operationId?: string; expectedVersion?: number }> = {}): M1FunctionRequest {
  return { apiVersion: 'm1.v1', action, payload, ...options }
}

function unavailable<T>(message: string): Promise<ServiceResult<T>> {
  return Promise.resolve(fail('SERVICE_UNAVAILABLE', message))
}
