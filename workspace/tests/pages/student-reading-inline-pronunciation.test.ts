import { afterEach, describe, expect, it, vi } from 'vitest'

const beginPronunciationRecording = vi.fn()
vi.mock('../../miniprogram/services/student-pronunciation-service', () => ({
  beginPronunciationRecording, sealPronunciationRecording: vi.fn(), beginPronunciationScore: vi.fn(),
  getPronunciationScore: vi.fn(), getReadingPronunciationSegments: vi.fn(),
  listPronunciationAttempts: vi.fn(),
}))

vi.mock('../../miniprogram/session/session', () => ({
  getSession: () => ({ sessionId: 'session_demo', activeRole: 'student', user: { id: 'student_demo', role: 'student' } }),
}))

describe('S-04 inline follow-reading', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); beginPronunciationRecording.mockReset() })

  async function panel(source: Record<string, string>) {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown>;
      lifetimes: { attached: (...args: never[]) => void } } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const toast = vi.fn()
    vi.stubGlobal('wx', { getStorageSync: vi.fn(() => null), showToast: toast,
      getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }) })
    await import('../../miniprogram/components/pronunciation-panel/pronunciation-panel')
    if (!definition) throw new Error('Inline pronunciation panel was not registered')
    const events: Array<{ name: string; detail: unknown }> = []
    const context = {
      data: { ...definition.data, ...source },
      setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() },
      triggerEvent(name: string, detail: unknown) { events.push({ name, detail }) },
    }
    Object.assign(context, definition.methods, { loadAttempts: vi.fn(), loadDemonstration: vi.fn() })
    return { context, events, toast, attached: () => definition.lifetimes.attached.call(context) }
  }

  it('keeps a reading sentence on the opened book and lets the pager continue', async () => {
    const { context, events, attached } = await panel({ resourceId: 'book_demo', segmentId: 'segment_demo',
      referenceText: 'She is stretching.' })
    attached()
    expect(context.data.source).toEqual({ kind: 'reading', resourceId: 'book_demo', segmentId: 'segment_demo' })
    expect(context.data.referencePreview).toBe('She is stretching.')
    context.requestPageChange(1)
    expect(events).toEqual([{ name: 'pagechange', detail: { delta: 1 } }])
  })

  it('binds a classroom sentence to its task item and blocks turning during recording', async () => {
    const { context, events, toast } = await panel({ resourceId: 'book_demo', segmentId: 'segment_demo',
      taskId: 'task_demo', itemId: 'item_demo' })
    context.initializeInlineSource()
    expect(context.data.source).toEqual({ kind: 'task', taskId: 'task_demo', itemId: 'item_demo',
      segmentId: 'segment_demo' })
    context.data.recordingState = 'recording'
    context.requestPageChange(-1)
    expect(toast).toHaveBeenCalledOnce()
    expect(events).toEqual([])
  })

  it('routes recorder completion to the sentence that started recording when several panels are visible', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown>;
      lifetimes: { attached: (...args: never[]) => void } } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    let onStop: ((result: { duration: number; fileSize: number; tempFilePath: string }) => void) | undefined
    const manager = { onStop: (handler: typeof onStop) => { onStop = handler }, onError: vi.fn(),
      start: vi.fn(), stop: vi.fn() }
    vi.stubGlobal('wx', { getStorageSync: () => null, setStorageSync: vi.fn(),
      getRecorderManager: () => manager, authorize: vi.fn().mockResolvedValue(undefined) })
    beginPronunciationRecording.mockImplementation(async (_userId, source) => ({ ok: true, data: {
      recordingId: `recording_${source.segmentId}`, stagingPath: 'pronunciation/staging/demo.mp3',
      source, referencePreview: 'A sentence.', expectedVersion: 1,
      durationLimits: { minMs: 1000, maxMs: 300000, maxBytes: 20971520 },
    } }))
    await import('../../miniprogram/components/pronunciation-panel/pronunciation-panel')
    if (!definition) throw new Error('Inline pronunciation panel was not registered')
    const makePanel = (segmentId: string) => {
      const context = { data: { ...definition!.data, resourceId: 'book_demo', segmentId },
        setData(change: Record<string, unknown>, done?: () => void) { Object.assign(this.data, change); done?.() },
        triggerEvent: vi.fn() }
      Object.assign(context, definition!.methods, { loadAttempts: vi.fn(), loadDemonstration: vi.fn() })
      definition!.lifetimes.attached.call(context)
      return context
    }
    const first = makePanel('segment_one'), second = makePanel('segment_two')
    await first.startRecording()
    expect(first.triggerEvent).toHaveBeenCalledWith('recordingstart')
    await second.playDemonstration()
    expect(second.data.demonstrationPlaying).toBe(false)
    onStop?.({ duration: 2200, fileSize: 1000, tempFilePath: 'wxfile://first.mp3' })
    expect(first.triggerEvent).toHaveBeenCalledWith('recordingend')
    expect(first.data).toMatchObject({ recordingState: 'local', localPath: 'wxfile://first.mp3' })
    expect(second.data.recordingState).toBe('idle')
  })
})
