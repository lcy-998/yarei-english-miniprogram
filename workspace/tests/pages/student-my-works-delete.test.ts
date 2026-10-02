import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../miniprogram/services/app-service', () => ({
  deleteWorkDraft: vi.fn(),
  getWorkPlayback: vi.fn(),
  listMyWorks: vi.fn(),
  listWorkMaterials: vi.fn(),
}))

describe('S-12 draft deletion', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it('requires confirmation, retains rows on failure, and reuses the write intent on retry', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    let modal: { success: (result: { confirm: boolean }) => void } | null = null
    vi.stubGlobal('wx', { getStorageSync: () => ({ sessionId: 'session_demo',
      user: { id: 'student_demo', role: 'student' } }),
    showModal: (options: typeof modal) => { modal = options } })
    const services = await import('../../miniprogram/services/app-service')
    const draft = { id: 'work_draft', materialId: 'material_demo', materialVersion: 'v1',
      stagingPath: 'student-works/staging/demo/work_draft.mp3', status: 'draft' as const,
      fileId: null, sizeBytes: null, durationMs: null, note: '', version: 1,
      createdAt: '2026-09-27T09:00:00+08:00', submittedAt: null }
    const submitted = { ...draft, id: 'work_submitted', status: 'submitted' as const,
      version: 2, fileId: 'cloud://demo/private/work.mp3', submittedAt: '2026-09-27T09:01:00+08:00' }
    vi.mocked(services.listMyWorks).mockResolvedValue({ ok: true, data: [draft, submitted] })
    vi.mocked(services.listWorkMaterials).mockResolvedValue({ ok: true, data: [{ id: 'material_demo',
      title: '虚构配音', contentVersion: 'v1', subtitle: '' }] })
    vi.mocked(services.deleteWorkDraft)
      .mockResolvedValueOnce({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '网络暂不可用' } })
      .mockResolvedValueOnce({ ok: true, data: { ...draft, version: 2,
        deletedAt: '2026-09-27T09:02:00+08:00', recoverableUntil: '2026-10-04T01:02:00.000Z',
        deletedByUserId: 'student_demo' } })
    await import('../../miniprogram/pages/student/my-works/my-works')
    if (!definition) throw new Error('My works page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) },
      deleteDraft: definition.methods.deleteDraft }
    await definition.methods.loadWorks!.call(context)
    expect(context.data.rows).toHaveLength(2)
    expect(context.data.visibleRows).toHaveLength(2)
    definition.methods.chooseStatus!.call(context,
      { currentTarget: { dataset: { status: 'draft' } } } as unknown as WechatMiniprogram.TouchEvent)
    expect(context.data.visibleRows).toHaveLength(1)
    const event = { currentTarget: { dataset: { id: 'work_draft' } } } as unknown as WechatMiniprogram.TouchEvent
    definition.methods.confirmDeleteDraft!.call(context, event)
    if (!modal) throw new Error('Confirmation dialog was not opened')
    modal.success({ confirm: false })
    expect(services.deleteWorkDraft).not.toHaveBeenCalled()
    definition.methods.confirmDeleteDraft!.call(context, event)
    if (!modal) throw new Error('Confirmation dialog was not reopened')
    modal.success({ confirm: true })
    await vi.waitFor(() => expect(services.deleteWorkDraft).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(context.data.deleteError).toBe('网络暂不可用'))
    expect(context.data.rows).toHaveLength(2)
    const operationId = context.data.deleteIntents.work_draft.operationId
    expect(operationId).toBeTruthy()
    await definition.methods.deleteDraft!.call(context, 'work_draft')
    expect(vi.mocked(services.deleteWorkDraft).mock.calls.map(call => call[3]))
      .toEqual([operationId, operationId])
    expect(context.data.rows.map(row => row.id)).toEqual(['work_submitted'])
    expect(context.data.visibleRows).toEqual([])
    expect(context.data.deleteError).toBe('')
  })
})
