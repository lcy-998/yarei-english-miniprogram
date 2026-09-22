import { ServiceError, ServiceResponseMeta, ServiceResult } from '../../domain/types'
import { ChildView, M1AppRepository, ProfileView, ReadingBookView, ReadingCategory, ReadingProgressView, StudentDetailView, StudentListView, WordPracticeView } from '../m1-app-repository'
import { AuthV2AccountPort } from './auth-v2-account-port'
import { CloudFunctionInvoker, M1FunctionName, M1FunctionRequest } from './cloud-function-invoker'

type JsonRecord = Record<string, unknown>
type Guard<T> = (value: unknown) => value is T

export const M1_CLOUDBASE_ACTION_COVERAGE = {
  'P-03.requestPasswordCode': 'AuthV2AccountPort.requestPasswordCode',
  'P-03.resetPassword': 'AuthV2AccountPort.resetPassword',
  'P-04.getProfile': 'auth-session.getProfile',
  'P-04.saveProfile': 'auth-session.updateProfile',
  'S-02.getWordPractice': 'content-query.getVocabularyPack',
  'S-03.listReadingBooks': 'content-query.listReadingResources',
  'S-03.toggleReadingFavorite': 'learning-progress-command.setReadingFavorite',
  'S-04.getReadingProgress': 'content-query.getReadingResource',
  'S-04.setReadingPage': 'learning-progress-command.saveReadingProgress',
  'G-02.listChildren': 'parent-query.listChildren',
  'G-02.bindChild': 'relationship-command.bindChild',
  'G-02.chooseChild': 'client-session-only',
  'G-02.unbindChild': 'relationship-command.unbindChild',
  'T-02.listTeacherStudents': 'task-query.listTeacherStudents',
  'T-03.getTeacherStudent': 'task-query.getTeacherStudent',
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
  if (!isRecord(value) || !isString(value.id) || !isString(value.title) || !isNumber(value.grade) || !Array.isArray(value.words) || value.words.length === 0) return false
  return value.words.every(item => isRecord(item) && isString(item.id) && isString(item.word) && isString(item.meaning) && isString(item.syllableDisplay))
}

function mapVocabularyPack(raw: JsonRecord): WordPracticeView {
  const word = (raw.words as JsonRecord[])[0]
  const meaning = word.meaning as string
  return {
    packId: raw.id as string,
    packLabel: raw.title as string,
    todayCompleted: 0,
    todayTotal: (raw.words as JsonRecord[]).length,
    masteredPercent: 0,
    wordId: word.id as string,
    word: word.word as string,
    syllables: word.syllableDisplay as string,
    meaning,
    example: isString(word.example) ? word.example : '',
    options: [meaning],
    correctOption: meaning,
    wrongCount: 0,
  }
}

function pageItems(value: unknown, itemGuard: Guard<JsonRecord>): JsonRecord[] | null {
  if (!isRecord(value) || !Array.isArray(value.items) || !value.items.every(itemGuard)) return null
  return value.items
}

const isRawResourceSummary: Guard<JsonRecord> = (value): value is JsonRecord => isRecord(value) && isString(value.id) && isString(value.title) && isNumber(value.contentVersion)

function mapReadingList(raw: unknown, category: ReadingCategory): ReadingBookView[] | null {
  const items = pageItems(raw, isRawResourceSummary)
  if (!items) return null
  return items.map(item => ({
    id: item.id as string,
    title: item.title as string,
    category,
    grade: '已授权',
    difficulty: '基础',
    theme: '英语',
    progressPercent: 0,
    favorite: false,
    pageCount: 0,
  }))
}

function isRawReadingResource(value: unknown): value is JsonRecord {
  if (!isRawResourceSummary(value) || !Array.isArray(value.chapters) || !Array.isArray(value.pages) || value.pages.length === 0) return false
  return value.pages.every(item => isRecord(item) && isString(item.id) && isRecord(item.highResolution) && isString(item.highResolution.assetKey))
}

function mapReadingResource(raw: JsonRecord, pageNumber: number): ReadingProgressView {
  const pages = raw.pages as JsonRecord[]
  const safePage = Math.max(1, Math.min(pageNumber, pages.length))
  const page = pages[safePage - 1]
  const highResolution = page.highResolution as JsonRecord
  const chapterCount = (raw.chapters as unknown[]).length
  return {
    book: { id: raw.id as string, title: raw.title as string, category: 'picture', grade: '已授权', difficulty: '基础', theme: '英语', progressPercent: Math.round(safePage * 100 / pages.length), favorite: false, pageCount: pages.length },
    chapterNumber: 1,
    chapterCount,
    pageNumber: safePage,
    pageCount: pages.length,
    progressPercent: Math.round(safePage * 100 / pages.length),
    pageImageUrl: highResolution.assetKey as string,
  }
}

const isRawChild: Guard<JsonRecord> = (value): value is JsonRecord => isRecord(value) && isString(value.id) && isString(value.displayName) && isNumber(value.linkVersion) && (value.class === null || (isRecord(value.class) && isString(value.class.name)))
const isRawBoundChild: Guard<JsonRecord> = (value): value is JsonRecord => isRecord(value) && isString(value.childId) && isString(value.displayName) && isNumber(value.version) && value.status === 'active'
const isRawUnbound: Guard<JsonRecord> = (value): value is JsonRecord => isRecord(value) && isString(value.childId) && isNumber(value.version) && value.status === 'revoked'

function isRawStudentSummary(value: unknown): value is JsonRecord {
  return isRecord(value) && isString(value.id) && isString(value.displayName) && (value.studentNumber === null || isString(value.studentNumber))
    && (value.status === 'active' || value.status === 'disabled') && (value.class === null || (isRecord(value.class) && isString(value.class.name)))
    && isRecord(value.taskSummary) && isNumber(value.taskSummary.completedCount) && isNumber(value.taskSummary.totalCount)
}

function mapStudentSummary(raw: JsonRecord): StudentListView {
  const taskSummary = raw.taskSummary as JsonRecord
  const completedCount = taskSummary.completedCount as number
  const totalCount = taskSummary.totalCount as number
  const status = raw.status === 'disabled' ? 'disabled' : 'active'
  return {
    id: raw.id as string,
    displayName: raw.displayName as string,
    studentNumber: isString(raw.studentNumber) ? raw.studentNumber : '—',
    className: isRecord(raw.class) && isString(raw.class.name) ? raw.class.name : '未分班',
    status,
    statusLabel: status === 'active' ? '正常' : '已停用',
    completedCount,
    totalCount,
    completionPercent: totalCount === 0 ? 0 : Math.round(completedCount * 100 / totalCount),
  }
}

function isRawStudentDetail(value: unknown): value is JsonRecord {
  return isRawStudentSummary(value) && Array.isArray(value.parents) && value.parents.every(item => isRecord(item) && isString(item.displayName))
    && Array.isArray(value.tasks) && value.tasks.every(item => isRecord(item) && isString(item.taskId) && isString(item.status))
}

function mapStudentDetail(raw: JsonRecord): StudentDetailView {
  const base = mapStudentSummary(raw)
  const parents = raw.parents as JsonRecord[]
  const tasks = raw.tasks as JsonRecord[]
  return {
    ...base,
    maskedMobile: '未提供',
    guardianName: parents[0] && isString(parents[0].displayName) ? parents[0].displayName : '暂无有效家长关系',
    guardianMaskedMobile: '未提供',
    averageScore: 0,
    recentTasks: tasks.map(item => ({ id: item.taskId as string, title: '任务 ' + (item.taskId as string), statusLabel: item.status as string })),
  }
}

export class CloudBaseM1AppRepository implements M1AppRepository {
  private readonly profileVersions = new Map<string, number>()
  private readonly readingPages = new Map<string, number>()
  private readonly readingBooks = new Map<string, ReadingBookView>()
  private readonly resourceVersions = new Map<string, number>()
  private readonly favoriteVersions = new Map<string, number>()
  private readonly progressVersions = new Map<string, number>()
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
    return this.invokeMapped('content-query', request('getVocabularyPack', { resourceId: 'res_vocab_animals' }), isRawVocabularyPack, mapVocabularyPack)
  }

  async listReadingBooks(_userId: string, category: ReadingCategory = 'picture', onlyFavorites = false): Promise<ServiceResult<ReadingBookView[]>> {
    if (onlyFavorites) return unavailable('阅读收藏尚无经评审的 m1.v1 action')
    const response = await this.invokeRaw('content-query', request('listReadingResources', { filters: {}, page: { limit: 100 } }))
    if (!response.ok) return response
    const mapped = mapReadingList(response.data, category)
    if (mapped === null) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
    const rawItems = (response.data as JsonRecord).items as JsonRecord[]
    mapped.forEach((book, index) => { this.readingBooks.set(book.id, book); this.resourceVersions.set(book.id, rawItems[index].contentVersion as number) })
    return { ok: true, data: mapped, meta: response.meta }
  }

  async toggleReadingFavorite(_userId: string, bookId: string): Promise<ServiceResult<ReadingBookView>> {
    const book = this.readingBooks.get(bookId) ?? this.readingViews.get(bookId)?.book
    const resourceVersion = this.resourceVersions.get(bookId)
    if (!book || resourceVersion === undefined) return unavailable('请先刷新阅读列表后再收藏')
    const expectedVersion = this.favoriteVersions.get(bookId)
    const favorite = !book.favorite
    const result = await this.invokeRaw('learning-progress-command', request('setReadingFavorite', { resourceId: bookId, resourceVersion, favorite }, { operationId: `favorite_${bookId}_${favorite ? 'on' : 'off'}_${expectedVersion ?? 0}`, ...(expectedVersion === undefined ? {} : { expectedVersion }) }))
    if (!result.ok) return result
    if (!isRecord(result.data) || !isNumber(result.data.version)) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
    const updated = { ...book, favorite }
    this.favoriteVersions.set(bookId, result.data.version)
    this.readingBooks.set(bookId, updated)
    return { ok: true, data: updated, meta: result.meta }
  }

  async getReadingProgress(userId: string, bookId: string): Promise<ServiceResult<ReadingProgressView>> {
    const pageNumber = this.readingPages.get(userId + ':' + bookId) ?? 1
    const result = await this.invokeMapped('content-query', request('getReadingResource', { resourceId: bookId }), isRawReadingResource, raw => { this.resourceVersions.set(bookId, raw.contentVersion as number); return mapReadingResource(raw, pageNumber) })
    if (result.ok) { this.readingViews.set(bookId, result.data); this.readingBooks.set(bookId, result.data.book) }
    return result
  }

  async setReadingPage(userId: string, bookId: string, pageNumber: number): Promise<ServiceResult<ReadingProgressView>> {
    let current = this.readingViews.get(bookId)
    if (!current) { const loaded = await this.getReadingProgress(userId, bookId); if (!loaded.ok) return loaded; current = loaded.data }
    const resourceVersion = this.resourceVersions.get(bookId)
    if (resourceVersion === undefined) return unavailable('阅读资源版本尚未加载')
    const savedPage = Math.max(1, Math.min(current.pageCount, Math.floor(pageNumber)))
    const progressPercent = Math.round(savedPage * 100 / current.pageCount)
    const expectedVersion = this.progressVersions.get(bookId)
    const result = await this.invokeRaw('learning-progress-command', request('saveReadingProgress', { resourceId: bookId, resourceVersion, context: 'self', pageNumber: savedPage, progressPercent }, { operationId: `reading_${bookId}_${savedPage}_${expectedVersion ?? 0}`, ...(expectedVersion === undefined ? {} : { expectedVersion }) }))
    if (!result.ok) return result
    if (!isRecord(result.data) || !isNumber(result.data.version)) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
    const updated = { ...current, pageNumber: savedPage, progressPercent, book: { ...current.book, progressPercent } }
    this.progressVersions.set(bookId, result.data.version)
    this.readingPages.set(userId + ':' + bookId, savedPage)
    this.readingViews.set(bookId, updated)
    this.readingBooks.set(bookId, updated.book)
    return { ok: true, data: updated, meta: result.meta }
  }

  async listChildren(_parentId: string): Promise<ServiceResult<ChildView[]>> {
    const response = await this.invokeRaw('parent-query', request('listChildren', { page: { limit: 100 } }))
    if (!response.ok) return response
    const items = pageItems(response.data, isRawChild)
    if (!items) return fail('INTERNAL_ERROR', '服务返回了无法识别的数据')
    const mapped = items.map((item, index): ChildView => {
      const child = { id: item.id as string, displayName: item.displayName as string, className: isRecord(item.class) && isString(item.class.name) ? item.class.name : '未分班', studentNumber: '—', current: index === 0, linkVersion: item.linkVersion as number }
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
    const filters: Record<string, unknown> = {}
    if (keyword.trim()) filters.query = keyword.trim()
    if (status !== 'all') filters.status = status
    const response = await this.invokeRaw('task-query', request('listTeacherStudents', { filters, page: { limit: 100 } }))
    if (!response.ok) return response
    const items = pageItems(response.data, isRawStudentSummary)
    return items === null ? fail('INTERNAL_ERROR', '服务返回了无法识别的数据') : { ok: true, data: items.map(mapStudentSummary), meta: response.meta }
  }

  getTeacherStudent(_teacherId: string, studentId: string): Promise<ServiceResult<StudentDetailView>> {
    return this.invokeMapped('task-query', request('getTeacherStudent', { studentId }), isRawStudentDetail, mapStudentDetail)
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

