import { describe, expect, it } from 'vitest'
import { confirmedSeekTarget, nativeVideoSpeed, nextLearningSpeed, normalizeLearningSpeed } from '../miniprogram/pages/student/student-media-preferences'

describe('student learning media controls', () => {
  it('cycles only the approved playback speeds', () => {
    expect([1, 1.25, 1.5, 2, 0.75].map(nextLearningSpeed)).toEqual([1.25, 1.5, 2, 0.75, 1])
    expect(normalizeLearningSpeed(3)).toBe(1)
    expect(normalizeLearningSpeed('1.5')).toBe(1)
  })

  it('never claims unsupported 0.75× native video playback', () => {
    expect(nativeVideoSpeed(nextLearningSpeed(2))).toEqual({ speed: 1, fallback: true })
    expect(nativeVideoSpeed(1.25)).toEqual({ speed: 1.25, fallback: false })
    expect(nativeVideoSpeed(0.75)).toEqual({ speed: 1, fallback: true })
  })

  it('never seeks a locked task beyond server confirmed playback', () => {
    expect(confirmedSeekTarget(90, 120, 45, true)).toBe(45)
    expect(confirmedSeekTarget(20, 120, 45, true)).toBe(20)
    expect(confirmedSeekTarget(90, 120, 45, false)).toBe(90)
    expect(confirmedSeekTarget(90, 120, -1, true)).toBe(0)
    expect(confirmedSeekTarget(200, 120, 100, true)).toBe(100)
  })
})
