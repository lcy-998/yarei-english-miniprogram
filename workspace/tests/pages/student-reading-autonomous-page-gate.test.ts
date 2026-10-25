import { afterEach, describe, expect, it, vi } from 'vitest'

describe('S-04 autonomous reading page gate', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  async function page(mode = 'reading') {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | undefined
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { showToast: vi.fn(), showActionSheet: vi.fn() })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading page not registered')
    const changePage = vi.fn()
    const context = { data: { ...definition.data, taskMode: mode === 'task', checkinMode: mode === 'checkin',
      reading: { book: { category: 'picture' }, pages: [1, 2, 3].map(pageNumber => ({ pageNumber })) },
      displayPageNumber: 1, imageLoading: false, pageSegments: [{ id: 'sentence_demo' }],
      followReadingBlocked: true, followReadingChecking: true, pronunciationError: '跟读内容暂不可用',
      nextPointreadPageNumber: 3 },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) },
      selectAllComponents: () => [] }
    Object.assign(context, definition.methods, { changePage })
    return { context, changePage }
  }

  it('allows next-page and pointread jumps without recording, even if pronunciation loading failed', async () => {
    const { context, changePage } = await page()
    context.requestPageChange(1)
    expect(changePage).toHaveBeenCalledWith(1)
    context.jumpToPointreadPage()
    expect(changePage).toHaveBeenCalledWith(2)
    context.updateFollowReadingGate(context.data.pageSegments, 1, {}, true)
    expect(context.data.followReadingBlocked).toBe(false)
    expect(context.isFollowReadingIncomplete()).toBe(false)
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  it.each(['task', 'checkin'])('retains unfinished follow-reading restrictions in %s mode', async mode => {
    const { context, changePage } = await page(mode)
    context.updateFollowReadingGate(context.data.pageSegments, 1, {})
    context.requestPageChange(1)
    expect(changePage).not.toHaveBeenCalled()
    expect(context.isFollowReadingIncomplete()).toBe(true)
    context.data.pronunciationError = ''
    context.updateFollowReadingGate(context.data.pageSegments, 1, { 1: ['sentence_demo'] })
    context.requestPageChange(1)
    expect(changePage).toHaveBeenCalledWith(1)
  })

  it('still protects an active or unsaved autonomous recording', async () => {
    const { context, changePage } = await page()
    Object.assign(context, { selectAllComponents: () => [{ hasActiveRecording: () => true }] })
    context.requestPageChange(1)
    expect(changePage).not.toHaveBeenCalled()
    Object.assign(context, { selectAllComponents: () => [{ hasUnsubmittedRecording: () => true }] })
    context.jumpToPointreadPage()
    expect(changePage).not.toHaveBeenCalled()
    expect(wx.showActionSheet).toHaveBeenCalledOnce()
  })
})
