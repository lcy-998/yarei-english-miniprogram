import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearTeacherCatalogResultIds, setTeacherCatalogResultIds,
  takeTeacherCatalogInitialIds } from '../../miniprogram/subpackages/teacher/session/session'
import * as teacherAppService from '../../miniprogram/subpackages/teacher/services/app-service'

interface PageContext {
  data: Record<string, unknown>
  setData(patch: Record<string, unknown>, callback?: () => void): void
  loadCatalog?(): void
}
interface PageDefinition {
  methods: Record<string, (this: PageContext, ...args: unknown[]) => unknown>
  pageLifetimes?: { show: (this: PageContext) => void }
}
let publishDefinition: PageDefinition | undefined

async function publishPage(): Promise<PageDefinition> {
  if (publishDefinition) return publishDefinition
  vi.stubGlobal('Component', (value: PageDefinition) => { publishDefinition = value })
  await import('../../miniprogram/subpackages/teacher/publish-task/publish-task')
  if (!publishDefinition) throw new Error('T-06 page unavailable')
  return publishDefinition
}

describe('T-06 添加或调整任务内容', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearTeacherCatalogResultIds()
    takeTeacherCatalogInitialIds()
  })

  it('未选发布对象时一次点击直接进入 T-18，不弹班级选择也不预选对象', async () => {
    const definition = await publishPage()
    const navigateTo = vi.fn()
    const showActionSheet = vi.fn()
    vi.stubGlobal('wx', { navigateTo, showActionSheet })
    const context: PageContext = { data: { loading: false, optionsLoading: false,
      targetMode: 'classes', targetClasses: [
        { id: 'class_a', name: '三年级 1 班', selected: false },
        { id: 'class_b', name: '三年级 2 班', selected: false },
      ], targetStudents: [], draftOptions: { resources: [], structuredDraft: { items: [], target: { type: 'classes', classIds: [] } } } },
    setData(patch) { Object.assign(this.data, patch) } }
    definition.methods.openContentCatalog.call(context)
    expect(showActionSheet).not.toHaveBeenCalled()
    expect(navigateTo).toHaveBeenCalledWith({ url: '/subpackages/teacher/content-selector/content-selector' })
    expect(context.data.draftOptions).toMatchObject({ structuredDraft: { target: { classIds: [] } } })
  })

  it('登录状态失效时结束加载并提示重新进入', async () => {
    const definition = await publishPage()
    vi.stubGlobal('wx', { getStorageSync: () => null })
    const context: PageContext = { data: { optionsLoading: true, error: '' },
      setData(patch) { Object.assign(this.data, patch) } }
    await definition.methods.loadDraftOptions.call(context)
    expect(context.data).toMatchObject({ optionsLoading: false,
      error: '登录状态已失效，请重新进入后重试' })
  })

  it('资源服务异常时结束加载并保留可重试状态', async () => {
    const definition = await publishPage()
    vi.stubGlobal('wx', { getStorageSync: () => ({ user: { id: 'teacher_demo', role: 'teacher' } }) })
    vi.spyOn(teacherAppService, 'getCatalogDraftOptions').mockRejectedValueOnce(new Error('network'))
    const context: PageContext = { data: { optionsLoading: false, error: '' },
      setData(patch) { Object.assign(this.data, patch) } }
    await definition.methods.loadDraftOptions.call(context)
    expect(context.data).toMatchObject({ optionsLoading: false,
      error: '资源或授权对象加载失败，请重试' })
  })

  it('已选发布班级时仍按该班级范围进入 T-18', async () => {
    const definition = await publishPage()
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { navigateTo })
    const context: PageContext = { data: { loading: false, optionsLoading: false,
      targetMode: 'classes', targetClasses: [{ id: 'class_a', selected: true }], targetStudents: [],
      draftOptions: { resources: [], structuredDraft: { items: [] } } },
    setData(patch) { Object.assign(this.data, patch) } }
    definition.methods.openContentCatalog.call(context)
    expect(navigateTo).toHaveBeenCalledWith({
      url: '/subpackages/teacher/content-selector/content-selector?targetClassIds=class_a',
    })
  })

  it('无发布对象时选中的内容能回填，发布对象仍为空', async () => {
    const definition = await publishPage()
    vi.stubGlobal('wx', { getStorageSync: () => ({ user: { id: 'teacher_demo', role: 'teacher' } }) })
    setTeacherCatalogResultIds(['book_zoo'])
    const context: PageContext = { data: { loading: false, optionsLoading: false, editingStatus: '',
      targetMode: 'classes', targetKeyword: '', targetClasses: [{ id: 'class_a', selected: false }], targetStudents: [],
      authorizedClasses: [{ id: 'class_a', name: '三年级 1 班', grade: '三年级', term: '上学期' }],
      authorizedStudents: [],
      draftOptions: { selectedClassName: '三年级 1 班', resources: [
        { id: 'book_zoo', title: '虚构阅读', type: 'reading', requiredCount: 2, allowedClassIds: ['class_a'] }],
      structuredDraft: { items: [], target: { type: 'classes', classIds: [] },
        startsAt: '2026-10-02T00:00:00.000Z', dueAt: '2026-10-03T00:00:00.000Z',
        latePolicy: { allowLate: true, lateDays: 7 } } } },
    setData(patch) { Object.assign(this.data, patch) } }
    await definition.methods.applySelectedCatalogResources.call(context)
    expect(context.data.draftOptions).toMatchObject({ structuredDraft: {
      target: { classIds: [] }, items: [{ resourceId: 'book_zoo' }],
    } })
    expect(context.data.error).toBe('')
  })

  it('旧草稿包含其他班级专属课本时在发布前指出冲突内容', async () => {
    const definition = await publishPage()
    vi.stubGlobal('wx', { getStorageSync: () => ({ user: { id: 'teacher_demo', role: 'teacher' } }) })
    const context: PageContext = { data: {
      loading: false, optionsLoading: false, targetMode: 'classes', requestedStudentId: '',
      targetClasses: [{ id: 'class_grade3', name: '三年级 2 班', selected: true }],
      targetStudents: [{ studentId: 'student_demo', displayName: '虚构学生',
        classInfo: { id: 'class_grade3' }, selected: false }], editingStatus: 'draft',
      draftOptions: { resources: [{ id: 'book_grade4', title: '四年级上册', type: 'reading',
        requiredCount: 1, allowedClassIds: ['class_grade4'] }],
      structuredDraft: { items: [{ id: 'item_book', resourceId: 'book_grade4', type: 'reading',
        requiredCount: 1, maxScore: 100 }] } },
    }, setData(patch) { Object.assign(this.data, patch) } }
    expect(definition.methods.buildCommand.call(context, 'publish')).toBeNull()
    expect(context.data.error).toBe('「四年级上册」不适用于所选班级，请移除该内容或调整布置对象')
  })

  it('移除不适用的旧课本后恢复可选择的班级', async () => {
    const definition = await publishPage()
    const classInfo = { id: 'class_grade3', name: '三年级 2 班', grade: '三年级', term: '上学期' }
    const context: PageContext = { data: {
      targetMode: 'classes', targetKeyword: '', editingStatus: 'draft',
      authorizedClasses: [classInfo], authorizedStudents: [{ studentId: 'student_demo',
        displayName: '虚构学生', classInfo, selected: false }],
      targetClasses: [], targetStudents: [],
      draftOptions: { resources: [
        { id: 'book_grade3', title: '三年级上册', type: 'reading', requiredCount: 1,
          allowedClassIds: ['class_grade3'] },
        { id: 'book_grade4', title: '四年级上册', type: 'reading', requiredCount: 1,
          allowedClassIds: ['class_grade4'] },
      ], structuredDraft: { items: [
        { id: 'item_grade3', resourceId: 'book_grade3', type: 'reading', requiredCount: 1, maxScore: 100 },
        { id: 'item_grade4', resourceId: 'book_grade4', type: 'reading', requiredCount: 1, maxScore: 100 },
      ], target: { type: 'classes', classIds: [] } } },
    }, setData(patch) { Object.assign(this.data, patch) } }
    definition.methods.toggleResource.call(context, { currentTarget: { dataset: { id: 'book_grade4' } } })
    expect(context.data.targetClasses).toMatchObject([{ id: 'class_grade3', selected: false }])
    expect(context.data.draftOptions).toMatchObject({ structuredDraft: {
      items: [{ resourceId: 'book_grade3' }], target: { classIds: [] },
    } })
  })

  it('T-18 在显示阶段只读取一次路由；无目标参数表示查找全部授权资源', async () => {
    let definition: PageDefinition | undefined
    vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
    await import('../../miniprogram/subpackages/teacher/content-selector/content-selector')
    if (!definition?.pageLifetimes) throw new Error('T-18 page unavailable')
    vi.stubGlobal('wx', { getStorageSync: () => null })
    vi.stubGlobal('getCurrentPages', () => [{ options: {} }])
    let loads = 0
    const context: PageContext = { data: { initialized: false, targetClassIds: [], loading: true },
      setData(patch, callback) { Object.assign(this.data, patch); callback?.() },
      loadCatalog() { loads += 1 } }
    definition.pageLifetimes.show.call(context)
    expect(context.data).toMatchObject({ initialized: true, targetClassIds: [] })
    expect(loads).toBe(1)
  })
})
