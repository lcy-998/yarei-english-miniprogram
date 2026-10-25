import { afterEach, describe, expect, it, vi } from 'vitest'
import { dubbingCueState, validDubbingSubtitleCues } from '../../miniprogram/subpackages/student-media/shared/dubbing-subtitle'

describe('S-07 autonomous dubbing current text', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows only the sentence covering the actual playback position', () => {
    const cues = validDubbingSubtitleCues([
      { startMs: 1000, endMs: 2200, text: ' Hello! ' },
      { startMs: 2600, endMs: 4000, text: 'Come in.' },
    ])
    expect(dubbingCueState(cues, 0)).toMatchObject({ index: -1, text: '', nextIndex: 0 })
    expect(dubbingCueState(cues, 1000)).toMatchObject({ index: 0, text: 'Hello!', nextIndex: 1 })
    expect(dubbingCueState(cues, 2300)).toMatchObject({ index: -1, text: '', previousIndex: 0, nextIndex: 1 })
    expect(dubbingCueState(cues, 4000)).toMatchObject({ index: -1, text: '' })
    expect(validDubbingSubtitleCues([{ startMs: 1000, endMs: 2200, text: 'First.' },
      { startMs: 2100, endMs: 3000, text: 'Overlap.' }])).toEqual([])
  })

  it('moves the video to a timed sentence and updates text from video time events', async () => {
    vi.resetModules()
    let definition: { methods: Record<string, (this: unknown, event?: unknown) => void> } | undefined
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const seek = vi.fn()
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }),
      createVideoContext: () => ({ seek }) })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    const context = { data: { practiceSubtitleCues: [
      { startMs: 1000, endMs: 2200, text: 'Hello!' },
      { startMs: 2600, endMs: 4000, text: 'Come in.' }], demonstrationUrl: 'https://example.test/demo.mp4',
      practiceSubtitleIndex: 0, practiceSubtitleText: 'Hello!',
      practicePreviousCueIndex: -1, practiceNextCueIndex: 1 },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    definition!.methods.showNextPracticeText.call(context)
    expect(seek).toHaveBeenCalledWith(2.6)
    expect(context.data.practiceSubtitleText).toBe('')
    definition!.methods.onPracticeVideoTimeUpdate.call(context, { detail: { currentTime: 2.7 } })
    expect(context.data).toMatchObject({ practiceSubtitleIndex: 1, practiceSubtitleText: 'Come in.' })
    definition!.methods.showPreviousPracticeText.call(context)
    expect(seek).toHaveBeenCalledWith(1)
    definition!.methods.onPracticeVideoTimeUpdate.call(context, { detail: { currentTime: 1.2 } })
    expect(context.data).toMatchObject({ practiceSubtitleIndex: 0, practiceSubtitleText: 'Hello!' })
  })
})
