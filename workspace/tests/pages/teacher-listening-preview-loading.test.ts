import { afterEach, describe, expect, it, vi } from 'vitest'

const previewTeacherAsset = vi.fn()
vi.mock('../../miniprogram/subpackages/teacher/services/teacher-media-service', () => ({ previewTeacherAsset }))
vi.mock('../../miniprogram/subpackages/teacher/session/session', () => ({ getSession: () => ({
  sessionId: 'teacher_session', activeRole: 'teacher', user: { id: 'teacher_demo', role: 'teacher' },
}) }))

type Definition = { data: Record<string, unknown>;
  methods: Record<string, (...args: never[]) => unknown>;
  lifetimes: { detached: () => void } }

async function page(emitReadyOnSource = true) {
  let definition: Definition | null = null
  vi.stubGlobal('Component', (value: Definition) => { definition = value })
  const handlers = new Map<string, () => void>()
  const play = vi.fn(), pause = vi.fn(), destroy = vi.fn()
  let src = ''
  vi.stubGlobal('wx', { createInnerAudioContext: () => ({
    currentTime: 0, play, pause, destroy, seek: vi.fn(),
    get src() { return src }, set src(value: string) {
      src = value
      if (emitReadyOnSource) handlers.get('canplay')?.()
    },
    onCanplay: (callback: () => void) => handlers.set('canplay', callback),
    onSeeked: (callback: () => void) => handlers.set('seeked', callback),
    onEnded: (callback: () => void) => handlers.set('ended', callback),
    onError: (callback: () => void) => handlers.set('error', callback),
    onTimeUpdate: (callback: () => void) => handlers.set('timeupdate', callback),
  }) })
  await import('../../miniprogram/subpackages/teacher/media-preview/media-preview')
  if (!definition) throw new Error('Teacher media preview page unavailable')
  const context = { data: { ...definition.data, resourceId: 'listening_demo' },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
  Object.assign(context, definition.methods)
  return { context: context as typeof context & Definition['methods'],
    detached: () => definition!.lifetimes.detached.call(context), handlers, play, pause, destroy }
}

describe('T-20 listening preview loading recovery', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); previewTeacherAsset.mockReset() })

  it('registers readiness before setting the source and lets the teacher start playback', async () => {
    previewTeacherAsset.mockResolvedValue({ ok: true, data: {
      id: 'listening_demo', kind: 'listening', title: '虚构听力', durationMs: 10000,
      questions: [], clips: [], subtitles: [], playback: {
        temporaryUrl: 'https://example.test/audio.mp3', expiresAt: '2099-01-01T00:00:00Z',
      },
    } })
    const { context, detached, play } = await page()
    await context.load()
    expect(context.data).toMatchObject({ loading: false, audioReady: true })
    context.toggleAudio()
    expect(play).toHaveBeenCalledOnce()
    detached()
  })

  it('allows playback without a canplay event and exits a stalled audio wait', async () => {
    vi.useFakeTimers()
    previewTeacherAsset.mockResolvedValue({ ok: true, data: {
      id: 'listening_demo', kind: 'listening', title: '虚构听力', durationMs: 10000,
      questions: [], clips: [], subtitles: [], playback: {
        temporaryUrl: 'https://example.test/audio.mp3', expiresAt: '2099-01-01T00:00:00Z',
      },
    } })
    const { context, detached, play, pause } = await page(false)
    await context.load()
    expect(context.data.audioReady).toBe(false)
    context.toggleAudio()
    expect(play).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(12000)
    expect(pause).toHaveBeenCalled()
    expect(context.data).toMatchObject({ playing: false,
      error: '音频加载超时，请刷新试听地址后重试' })
    detached()
  })
})
