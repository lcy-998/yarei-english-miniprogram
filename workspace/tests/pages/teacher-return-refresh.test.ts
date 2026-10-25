import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), listTeacherTextbookClasses: vi.fn(), getTeacherTextbookCenterSettings: vi.fn(),
  listSynchronizedTextbooks: vi.fn(), getSynchronizedTextbook: vi.fn(),
}))

vi.mock('../../miniprogram/subpackages/teacher/session/session', () => ({
  getSession: mocks.getSession,
}))
vi.mock('../../miniprogram/subpackages/teacher/services/app-service', () => ({
  listTeacherTextbookClasses: mocks.listTeacherTextbookClasses,
  getTeacherTextbookCenterSettings: mocks.getTeacherTextbookCenterSettings,
  listSynchronizedTextbooks: mocks.listSynchronizedTextbooks,
  getSynchronizedTextbook: mocks.getSynchronizedTextbook,
}))

interface PageDefinition {
  data: Record<string, unknown>
  pageLifetimes: { show: (this: PageContext) => void }
  methods: Record<string, (this: PageContext, ...args: never[]) => unknown>
}
interface PageContext {
  data: Record<string, unknown>
  setData: (value: Record<string, unknown>, callback?: () => void) => void
  [key: string]: unknown
}

async function page(path: string): Promise<{ definition: PageDefinition; context: PageContext }> {
  let definition: PageDefinition | null = null
  vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
  await import(path)
  if (!definition) throw new Error(`Page not registered: ${path}`)
  const registered: PageDefinition = definition
  const context: PageContext = {
    data: structuredClone(registered.data),
    setData(value, callback) { Object.assign(this.data, value); callback?.() },
  }
  for (const [name, method] of Object.entries(registered.methods)) {
    context[name] = (...args: never[]) => method.call(context, ...args)
  }
  return { definition: registered, context }
}

describe('teacher overview return refresh', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('updates class configuration on return and keeps the active status filter', async () => {
    mocks.getSession.mockReturnValue({ user: { id: 'teacher_1', role: 'teacher' } })
    mocks.getTeacherTextbookCenterSettings.mockResolvedValue({ ok: true, data: { dashboardFields: [
      'grade', 'studentCount', 'configuredBookCount', 'progress', 'updatedAt',
    ] } })
    const unconfigured = { id: 'class_1', name: '四年级一班', grade: '4', term: '2026-autumn', studentCount: 20, config: null }
    const configured = { ...unconfigured, config: { publishedTextbooks: [{ textbookId: 'book_1' }], updatedAt: '2026-10-25' } }
    mocks.listTeacherTextbookClasses.mockResolvedValueOnce({ ok: true, data: [unconfigured] })
      .mockResolvedValueOnce({ ok: true, data: [configured] })
    const { definition, context } = await page('../../miniprogram/subpackages/teacher/class-textbooks/class-textbooks')
    definition.pageLifetimes.show.call(context)
    await vi.waitFor(() => expect(context.data.unconfiguredCount).toBe(1))
    ;(context.chooseConfigured as (event: unknown) => void)({ detail: { value: '1' } })
    expect(context.data.rows).toEqual([])

    definition.pageLifetimes.show.call(context)
    await vi.waitFor(() => expect(context.data.unconfiguredCount).toBe(0))
    expect((context.data.rows as Array<{ id: string }>).map(row => row.id)).toEqual(['class_1'])
    expect(context.data.configured).toBe('yes')
  })

  it('updates the textbook center summary after returning from class configuration', async () => {
    mocks.getSession.mockReturnValue({ user: { id: 'teacher_1', role: 'teacher' } })
    mocks.getTeacherTextbookCenterSettings.mockResolvedValue({ ok: true, data: {
      classTextbooksEnabled: true, synchronizedTextbooksEnabled: true, visibleClassIds: ['class_1'],
    } })
    mocks.listTeacherTextbookClasses.mockResolvedValueOnce({ ok: true, data: [{ id: 'class_1', config: null }] })
      .mockResolvedValueOnce({ ok: true, data: [{ id: 'class_1', config: {
        publishedTextbooks: [{ textbookId: 'book_1' }], textbooks: [{ textbookId: 'book_1' }],
      } }] })
    mocks.listSynchronizedTextbooks.mockResolvedValue({ ok: true, data: { items: [], nextOffset: null } })
    mocks.getSynchronizedTextbook.mockResolvedValue({ ok: true, data: { id: 'book_1', title: '课本' } })
    const { definition, context } = await page('../../miniprogram/subpackages/teacher/materials-home/materials-home')
    definition.pageLifetimes.show.call(context)
    await vi.waitFor(() => expect(context.data.loading).toBe(false))
    expect(context.data.configuredCount).toBe(0)

    definition.pageLifetimes.show.call(context)
    await vi.waitFor(() => expect(context.data.configuredCount).toBe(1))
    expect(context.data.recentBooks).toEqual([{ id: 'book_1', title: '课本' }])
  })
})
