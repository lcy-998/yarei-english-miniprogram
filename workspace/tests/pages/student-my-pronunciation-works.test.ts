import { afterEach, describe, expect, it, vi } from 'vitest'

const listMyPronunciationWorks = vi.fn(), getMyPronunciationPlayback = vi.fn()
let currentSession = { sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }
vi.mock('../../miniprogram/subpackages/student/services/student-pronunciation-service', () => ({
  listMyPronunciationWorks, getMyPronunciationPlayback,
}))
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({
  deleteWorkDraft: vi.fn(), getWorkPlayback: vi.fn(), listMyWorks: vi.fn(), listWorkMaterials: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => currentSession,
}))

describe('S-12 own pronunciation works', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); listMyPronunciationWorks.mockReset();
    getMyPronunciationPlayback.mockReset(); currentSession = { sessionId: 'session_demo',
      user: { id: 'student_demo', role: 'student' } } })

  it('loads only the current student projection and signs playback on click', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const play = vi.fn()
    vi.stubGlobal('wx', { createInnerAudioContext: () => ({ src: '', play, stop: vi.fn(),
      destroy: vi.fn(), onEnded: vi.fn(), onError: vi.fn() }) })
    listMyPronunciationWorks.mockResolvedValue({ ok: true, data: { nextCursor: null, items: [{
      scoreId: 'score_1', recordingId: 'recording_1',
      source: { kind: 'reading', resourceId: 'book_1', segmentId: 'segment_1' },
      displayTitle: 'A Day at the Zoo', referencePreview: 'The lion sleeps.',
      status: 'scored', experimental: true,
      score: { total: 86, pronunciation: 88, fluency: 82, completeness: 90 },
      qualityReason: null, modelVersion: 'test', algorithmVersion: 'test',
      scoredAt: '2026-10-03T10:00:00+08:00', mediaExpired: null, playbackAvailable: true,
    }] } })
    getMyPronunciationPlayback.mockResolvedValue({ ok: true, data: { scoreId: 'score_1',
      mediaExpired: null, playback: { temporaryUrl: 'https://example.invalid/signed',
        expiresAt: '2099-01-01T00:00:00Z' } } })
    await import('../../miniprogram/subpackages/student/my-works/my-works')
    if (!definition) throw new Error('My works page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadPronunciationWorks()
    expect(listMyPronunciationWorks).toHaveBeenCalledWith('student_demo', null, 20)
    expect(context.data.pronunciationRows).toMatchObject([{ id: 'score_1', canPlay: true }])
    await context.playPronunciation({ currentTarget: { dataset: { id: 'score_1' } } })
    expect(getMyPronunciationPlayback).toHaveBeenCalledWith('student_demo', 'recording_1')
    expect(play).toHaveBeenCalledOnce()
  })

  it('drops a delayed list response after the student account changes', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {})
    let resolveList: ((value: unknown) => void) | null = null
    listMyPronunciationWorks.mockReturnValue(new Promise(resolve => { resolveList = resolve }))
    await import('../../miniprogram/subpackages/student/my-works/my-works')
    if (!definition) throw new Error('My works page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    const loading = context.loadPronunciationWorks()
    currentSession = { sessionId: 'other_session', user: { id: 'other_student', role: 'student' } }
    resolveList?.({ ok: true, data: { nextCursor: null, items: [{ scoreId: 'private_score' }] } })
    await loading
    expect(context.data.pronunciationRows).toEqual([])
  })
})
