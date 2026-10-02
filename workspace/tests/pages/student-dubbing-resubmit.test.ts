import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../miniprogram/services/app-service', () => ({
  beginWorkDraft: vi.fn(),
  getMaterialPlayback: vi.fn(),
  getWorkMaterial: vi.fn(),
  listMyWorks: vi.fn(),
  listWorkMaterialFacets: vi.fn(),
  listWorkMaterials: vi.fn(),
  searchWorkMaterials: vi.fn(),
  submitWork: vi.fn(),
}))

describe('S-07 autonomous dubbing retry', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it('starts a fresh work after a submitted take is explicitly replaced', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (this: unknown) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const uploadFile = vi.fn().mockResolvedValue({ fileID: 'cloud://demo/staging/work.mp3' })
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), stop: vi.fn() }),
      getStorageSync: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
      cloud: { uploadFile }, showToast: vi.fn(),
      showModal: ({ success }: { success: (result: { confirm: boolean }) => void }) => success({ confirm: true }),
    })
    const services = await import('../../miniprogram/services/app-service')
    vi.mocked(services.beginWorkDraft).mockResolvedValueOnce({ ok: true, data: {
      id: 'work_first', materialId: 'material_demo', materialVersion: 'v1',
      stagingPath: 'student-works/staging/demo/work_first.mp3', status: 'draft',
      fileId: null, sizeBytes: null, durationMs: null, note: '', version: 1,
      createdAt: '2026-09-27T09:00:00+08:00', submittedAt: null,
    } }).mockResolvedValueOnce({ ok: true, data: {
      id: 'work_second', materialId: 'material_demo', materialVersion: 'v1',
      stagingPath: 'student-works/staging/demo/work_second.mp3', status: 'draft',
      fileId: null, sizeBytes: null, durationMs: null, note: '', version: 1,
      createdAt: '2026-09-27T09:02:00+08:00', submittedAt: null,
    } })
    vi.mocked(services.submitWork).mockImplementation(async (_userId, input) => ({ ok: true, data: {
      id: input.workId, materialId: 'material_demo', materialVersion: 'v1',
      stagingPath: `student-works/staging/demo/${input.workId}.mp3`, status: 'submitted',
      fileId: 'cloud://demo/private/work.mp3', sizeBytes: 1000, durationMs: 2000,
      note: '', version: 2, createdAt: '2026-09-27T09:00:00+08:00',
      submittedAt: '2026-09-27T09:01:00+08:00',
    } }))
    await import('../../miniprogram/pages/student/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const methods = definition.methods
    const context = { data: { ...definition.data, selectedMaterialId: 'material_demo',
      selectedMaterial: { id: 'material_demo', title: '虚构配音素材', contentVersion: 'v1', subtitle: '' },
      recordingState: 'local', localPath: 'wxfile://first.mp3', durationMs: 2000,
      fileSize: 1000, note: '' },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    await methods.submitRecording!.call(context)
    expect(context.data.draft).toMatchObject({ id: 'work_first', status: 'submitted' })
    methods.redoRecording!.call(context)
    expect(context.data.draft).toBeNull()
    Object.assign(context.data, { recordingState: 'local', localPath: 'wxfile://second.mp3',
      durationMs: 2000, fileSize: 1000 })
    await methods.submitRecording!.call(context)
    expect(services.beginWorkDraft).toHaveBeenCalledTimes(2)
    expect(vi.mocked(services.submitWork).mock.calls.map(call => call[1].workId))
      .toEqual(['work_first', 'work_second'])
  })

  it('restores a failed take in this session and blocks it when its material was withdrawn', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (this: unknown) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), stop: vi.fn() }),
      getStorageSync: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
      redirectTo: vi.fn(),
    })
    const services = await import('../../miniprogram/services/app-service')
    vi.mocked(services.searchWorkMaterials).mockResolvedValue({ ok: true,
      data: { items: [], total: 0, nextOffset: null } })
    vi.mocked(services.listWorkMaterialFacets).mockResolvedValue({ ok: true, data: [] })
    vi.mocked(services.getWorkMaterial).mockResolvedValue({ ok: false,
      error: { code: 'NOT_FOUND', message: '素材已不可用', retryable: false } })
    await import('../../miniprogram/pages/student/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const methods = definition.methods
    const context = { data: { ...definition.data, selectedMaterialId: 'material_demo',
      selectedMaterial: { id: 'material_demo', title: '虚构配音素材', contentVersion: 'v1', subtitle: '' },
      localPath: 'wxfile://retained.mp3', durationMs: 2000, fileSize: 1000,
      recordingState: 'local', note: '虚构录音' },
    setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() } }
    methods.rememberLocalDraft!.call(context)
    const reopened = { data: { ...definition.data },
      setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() },
      loadDemonstration: vi.fn() }
    await methods.loadMaterials!.call(reopened)
    expect(reopened.data).toMatchObject({ localPath: 'wxfile://retained.mp3', note: '虚构录音',
      recordingState: 'local', selectedMaterial: null })
    expect(reopened.data.submitError).toContain('原配音素材已不可用')
    await methods.submitRecording!.call(reopened)
    expect(services.beginWorkDraft).not.toHaveBeenCalled()
    expect(services.submitWork).not.toHaveBeenCalled()
  })

  it('keeps an uncertain submit for retry and accepts a later server-confirmed success', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (this: unknown) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), stop: vi.fn() }),
      getStorageSync: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
      cloud: { uploadFile: vi.fn().mockResolvedValue({ fileID: 'cloud://demo/staging/work.mp3' }) },
      showToast: vi.fn(),
    })
    const services = await import('../../miniprogram/services/app-service')
    const draft = { id: 'work_uncertain', materialId: 'material_demo', materialVersion: 'v1',
      stagingPath: 'student-works/staging/demo/work_uncertain.mp3', status: 'draft' as const,
      fileId: null, sizeBytes: null, durationMs: null, note: '', version: 1,
      createdAt: '2026-09-27T09:00:00+08:00', submittedAt: null }
    const committed = { ...draft, status: 'submitted' as const,
      fileId: 'cloud://demo/private/work.mp3', sizeBytes: 1000, durationMs: 2000,
      version: 2, submittedAt: '2026-09-27T09:01:00+08:00' }
    vi.mocked(services.beginWorkDraft).mockResolvedValue({ ok: true, data: draft })
    vi.mocked(services.submitWork).mockResolvedValue({ ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '网络暂不可用' } })
    vi.mocked(services.listMyWorks)
      .mockResolvedValueOnce({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '网络暂不可用' } })
      .mockResolvedValueOnce({ ok: true, data: [committed] })
    await import('../../miniprogram/pages/student/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data, selectedMaterialId: 'material_demo',
      selectedMaterial: { id: 'material_demo', title: '虚构配音素材', contentVersion: 'v1', subtitle: '' },
      localPath: 'wxfile://recording.mp3', durationMs: 2000, fileSize: 1000,
      recordingState: 'local', note: '' },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) },
    rememberLocalDraft: definition.methods.rememberLocalDraft }
    await definition.methods.submitRecording!.call(context)
    const firstIntent = context.data.submitIntent.operationId
    expect(context.data).toMatchObject({ recordingState: 'local', localPath: 'wxfile://recording.mp3' })
    expect(firstIntent).toBeTruthy()
    await definition.methods.submitRecording!.call(context)
    expect(services.beginWorkDraft).toHaveBeenCalledTimes(1)
    expect(vi.mocked(services.submitWork).mock.calls.map(call => call[3])).toEqual([firstIntent, firstIntent])
    expect(context.data).toMatchObject({ recordingState: 'submitted', submittedWork: { id: 'work_uncertain' },
      draft: { status: 'submitted' } })
  })

  it('keeps the recording but discards a draft deleted from the works page', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (this: unknown) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), stop: vi.fn() }),
      getStorageSync: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
      cloud: { uploadFile: vi.fn().mockResolvedValue({ fileID: 'cloud://demo/staging/work.mp3' }) },
      showToast: vi.fn(),
    })
    const services = await import('../../miniprogram/services/app-service')
    const draft = { id: 'work_deleted', materialId: 'material_demo', materialVersion: 'v1',
      stagingPath: 'student-works/staging/demo/work_deleted.mp3', status: 'draft' as const,
      fileId: null, sizeBytes: null, durationMs: null, note: '', version: 1,
      createdAt: '2026-09-27T09:00:00+08:00', submittedAt: null }
    vi.mocked(services.submitWork).mockResolvedValue({ ok: false,
      error: { code: 'NOT_FOUND', message: '草稿不存在' } })
    vi.mocked(services.listMyWorks).mockResolvedValue({ ok: true, data: [] })
    await import('../../miniprogram/pages/student/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data, selectedMaterialId: 'material_demo',
      selectedMaterial: { id: 'material_demo', title: '虚构配音素材', contentVersion: 'v1', subtitle: '' },
      localPath: 'wxfile://recording.mp3', durationMs: 2000, fileSize: 1000,
      recordingState: 'local', draft, note: '' },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) },
    rememberLocalDraft: definition.methods.rememberLocalDraft }
    await definition.methods.submitRecording!.call(context)
    expect(context.data).toMatchObject({ localPath: 'wxfile://recording.mp3',
      recordingState: 'local', draft: null })
    expect(context.data.submitError).toContain('原草稿已删除')
    expect(services.beginWorkDraft).not.toHaveBeenCalled()
  })

  it('opens the same authorized material from a submitted work', async () => {
    const definitions: Array<{ data: Record<string, unknown>; methods: Record<string, (this: unknown) => unknown> }> = []
    vi.stubGlobal('Component', (value: typeof definitions[number]) => { definitions.push(value) })
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), stop: vi.fn() }),
      getStorageSync: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
      navigateTo,
    })
    const services = await import('../../miniprogram/services/app-service')
    vi.mocked(services.searchWorkMaterials).mockResolvedValue({ ok: true, data: { items: [
      { id: 'material_first', title: '虚构素材一', contentVersion: 'v1', subtitle: '' },
    ], total: 2, nextOffset: 1 } })
    vi.mocked(services.listWorkMaterialFacets).mockResolvedValue({ ok: true, data: [] })
    vi.mocked(services.getWorkMaterial).mockResolvedValue({ ok: true,
      data: { id: 'material_second', title: '虚构素材二', contentVersion: 'v1', subtitle: '' } })
    await import('../../miniprogram/pages/student/my-works/my-works')
    await import('../../miniprogram/pages/student/dubbing/dubbing')
    const worksPage = definitions[0]
    const dubbingPage = definitions[1]
    if (!worksPage || !dubbingPage) throw new Error('Student work pages were not registered')
    const worksContext = { data: { rows: [{ id: 'work_previous', work: { materialId: 'material_second' } }] },
      openDubbing: worksPage.methods.openDubbing }
    worksPage.methods.redoWork!.call(worksContext,
      { currentTarget: { dataset: { id: 'work_previous' } } } as unknown as WechatMiniprogram.TouchEvent)
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/student/dubbing/dubbing' })
    const dubbingContext = { data: { ...dubbingPage.data },
      setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() },
      loadDemonstration: vi.fn() }
    await dubbingPage.methods.loadMaterials!.call(dubbingContext)
    expect(dubbingContext.data.selectedMaterialId).toBe('material_second')
    expect(dubbingContext.data.selectedMaterial).toMatchObject({ id: 'material_second' })
    expect(services.getWorkMaterial).toHaveBeenCalledWith('student_demo', 'material_second')
  })

  it('searches material pages while keeping the selected recording material', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), stop: vi.fn() }),
      getStorageSync: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
    })
    const services = await import('../../miniprogram/services/app-service')
    vi.mocked(services.searchWorkMaterials).mockReset()
      .mockResolvedValueOnce({ ok: true, data: { items: [{ id: 'material_zoo', title: 'Zoo 配音',
        contentVersion: 'v1', subtitle: '' }], total: 2, nextOffset: 1 } })
      .mockResolvedValueOnce({ ok: true, data: { items: [{ id: 'material_zoo_2', title: 'Zoo 故事',
        contentVersion: 'v1', subtitle: '' }], total: 2, nextOffset: null } })
    await import('../../miniprogram/pages/student/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data, materialKeyword: 'Zoo', hasAuthorizedMaterials: true,
      selectedMaterialId: 'material_previous', selectedMaterial: { id: 'material_previous',
        title: '之前的素材', contentVersion: 'v1', subtitle: '' } },
    setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() },
    refreshMaterialCatalog: vi.fn() }
    await definition.methods.refreshMaterialCatalog!.call(context, 0)
    await definition.methods.refreshMaterialCatalog!.call(context, 1)
    expect(services.searchWorkMaterials).toHaveBeenNthCalledWith(1, 'student_demo', 'Zoo', 20, 0, {})
    expect(services.searchWorkMaterials).toHaveBeenNthCalledWith(2, 'student_demo', 'Zoo', 20, 1, {})
    expect(context.data.materials).toHaveLength(2)
    expect(context.data.selectedMaterialId).toBe('material_previous')
    expect(context.data.materialNextOffset).toBeNull()
    Object.assign(context.data, { materialFacets: [
      { grade: '三年级', textbook: '演示教材 A', unit: 'Unit 1' },
      { grade: '四年级', textbook: '演示教材 B', unit: 'Unit 2' },
    ], gradeFilter: '全部年级', textbookFilter: '演示教材 B', unitFilter: 'Unit 2' })
    definition.methods.chooseMaterialFilter!.call(context,
      { currentTarget: { dataset: { key: 'grade', value: '三年级' } } })
    expect(context.data).toMatchObject({ gradeFilter: '三年级', textbookFilter: '全部教材',
      unitFilter: '全部单元', materialFilterOptions: { textbooks: ['演示教材 A'], units: ['Unit 1'] } })
    expect(context.refreshMaterialCatalog).toHaveBeenCalledOnce()
  })

  it('restores the recently selected authorized material beyond the first page', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string,
      (this: unknown, ...args: unknown[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const setStorageSync = vi.fn()
    vi.stubGlobal('wx', {
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(), stop: vi.fn() }),
      getStorageSync: (key: string) => key.startsWith('dubbing_recent_material_') ? 'material_second'
        : { sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } },
      setStorageSync,
    })
    const services = await import('../../miniprogram/services/app-service')
    vi.mocked(services.searchWorkMaterials).mockResolvedValue({ ok: true, data: { items: [
      { id: 'material_first', title: '素材一', contentVersion: 'v1', subtitle: '' },
    ], total: 2, nextOffset: 1 } })
    vi.mocked(services.listWorkMaterialFacets).mockResolvedValue({ ok: true, data: [] })
    vi.mocked(services.getWorkMaterial).mockResolvedValue({ ok: true,
      data: { id: 'material_second', title: '素材二', contentVersion: 'v1', subtitle: '' } })
    await import('../../miniprogram/pages/student/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() },
      loadDemonstration: vi.fn() }
    await definition.methods.loadMaterials!.call(context)
    expect(context.data.selectedMaterialId).toBe('material_second')
    expect(services.getWorkMaterial).toHaveBeenCalledWith('student_demo', 'material_second')
    definition.methods.selectMaterial!.call(context,
      { currentTarget: { dataset: { id: 'material_first' } } })
    expect(setStorageSync).toHaveBeenCalledWith('dubbing_recent_material_student_demo', 'material_first')
  })

  it('does not restore another session’s local recording', async () => {
    const { saveDubbingLocalDraft, readDubbingLocalDraft } = await import('../../miniprogram/shared/dubbing-local-draft')
    saveDubbingLocalDraft({ ownerUserId: 'student_demo', ownerSessionId: 'session_old',
      materialId: 'material_demo', materialVersion: 'v1', localPath: 'wxfile://private.mp3',
      durationMs: 2000, fileSize: 1000, note: '', draft: null,
      beginIntent: { operationId: '', fingerprint: '' }, submitIntent: { operationId: '', fingerprint: '' } })
    expect(readDubbingLocalDraft('student_demo', 'session_new')).toBeNull()
    expect(readDubbingLocalDraft('student_demo', 'session_old')).toBeNull()
  })
})
