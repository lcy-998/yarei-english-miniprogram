import { describe, expect, it } from 'vitest'
import { fitFullscreenImage, fitFullscreenImageToStage, fullscreenSwipeDelta, fullscreenViewport } from '../../miniprogram/subpackages/student/reading-detail/reading-fullscreen'

describe('S-04 fullscreen reading layout and gestures', () => {
  it('follows portrait and landscape native viewports without forcing a rotation', () => {
    expect(fullscreenViewport(390, 844)).toMatchObject({ width: 390, height: 844 })
    expect(fullscreenViewport(844, 390)).toMatchObject({ width: 844, height: 390 })
    expect(fullscreenViewport(390, 844).style).not.toContain('rotate')
    expect(fullscreenViewport(844, 390).style).not.toContain('rotate')
  })

  it('fills the actual stage height for portrait pages without obsolete control reserves', () => {
    const size = fitFullscreenImageToStage(828, 326, 750, 1000)
    expect(size.height).toBe(326)
    expect(size.width).toBe(244)
    const spread = fitFullscreenImageToStage(828, 326, 2000, 750)
    expect(spread.width).toBe(828)
    expect(spread.height).toBeLessThanOrEqual(326)
  })
  it('fits a portrait book page within portrait and landscape viewports', () => {
    const portrait = fitFullscreenImage(390, 844, 750, 1000, true)
    const landscape = fitFullscreenImage(844, 390, 750, 1000, true)
    expect(portrait.width).toBeLessThanOrEqual(358)
    expect(portrait.height).toBeLessThanOrEqual(714)
    expect(landscape.width).toBeLessThanOrEqual(812)
    expect(landscape.height).toBe(310)
    expect(portrait.width / portrait.height).toBeCloseTo(0.75, 2)
    expect(landscape.width / landscape.height).toBeCloseTo(0.75, 2)
  })

  it('maps horizontal swipes to previous or next pages and ignores taps and vertical swipes', () => {
    expect(fullscreenSwipeDelta(260, 300, 170, 304, 390)).toBe(1)
    expect(fullscreenSwipeDelta(140, 300, 240, 302, 390)).toBe(-1)
    expect(fullscreenSwipeDelta(200, 300, 225, 304, 390)).toBe(0)
    expect(fullscreenSwipeDelta(200, 300, 300, 380, 390)).toBe(0)
  })
})
