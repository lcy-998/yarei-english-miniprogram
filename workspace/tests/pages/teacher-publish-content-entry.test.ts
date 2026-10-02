import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearTeacherCatalogResultIds, setTeacherCatalogResultIds,
  takeTeacherCatalogInitialIds } from '../../miniprogram/session/session'

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
  await import('../../miniprogram/pages/teacher/publish-task/publish-task')
  if (!publishDefinition) throw new Error('T-06 page unavailable')
  return publishDefinition
}

describe('T-06 添加或调整任务内容', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/teacher/content-selector/content-selector' })
    expect(context.data.draftOptions).toMatchObject({ structuredDraft: { target: { classIds: [] } } })
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
      url: '/pages/teacher/content-selector/content-selector?targetClassIds=class_a',
    })
  })

  it('无发布对象时选中的内容能回填，发布对象仍为空', async () => {
    const definition = await publishPage()
    vi.stubGlobal('wx', { getStorageSync: () => ({ user: { id: 'teacher_demo', role: 'teacher' } }) })
    setTeacherCatalogResultIds(['book_zoo'])
    const context: PageContext = { data: { loading: false, optionsLoading: false, editingStatus: '',
      targetMode: 'classes', targetClasses: [{ id: 'class_a', selected: false }], targetStudents: [],
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

  it('T-18 在显示阶段只读取一次路由；无目标参数表示查找全部授权资源', async () => {
    let definition: PageDefinition | undefined
    vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
    await import('../../miniprogram/pages/teacher/content-selector/content-selector')
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
