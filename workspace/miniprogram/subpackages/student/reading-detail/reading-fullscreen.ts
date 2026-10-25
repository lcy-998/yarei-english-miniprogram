export interface FullscreenImageSize {
  width: number
  height: number
}

/** The native viewport follows the device; never rotate the content independently. */
export function fullscreenViewport(width: number, height: number) {
  return { width, height, style: `width:${width}px;height:${height}px;` }
}

export function fitFullscreenImage(viewportWidth: number, viewportHeight: number,
  sourceWidth: number, sourceHeight: number, hasCaptions: boolean): FullscreenImageSize {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 390
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 844
  const availableWidth = Math.max(1, width - 32)
  // Initial layout only; replace with the measured stage after WXML has rendered.
  const reservedHeight = hasCaptions ? (width > height ? 80 : 130) : 16
  const availableHeight = Math.max(1, height - reservedHeight)
  return fitFullscreenImageToStage(availableWidth, availableHeight, sourceWidth, sourceHeight)
}

export function fitFullscreenImageToStage(availableWidth: number, availableHeight: number,
  sourceWidth: number, sourceHeight: number): FullscreenImageSize {
  const sourceRatio = Number.isFinite(sourceWidth) && sourceWidth > 0
    && Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceWidth / sourceHeight : 0.75
  const scale = Math.min(availableWidth / (sourceRatio * 1000), availableHeight / 1000)
  return { width: Math.max(1, Math.floor(sourceRatio * 1000 * scale)),
    height: Math.max(1, Math.floor(1000 * scale)) }
}

export function fullscreenSwipeDelta(startX: number, startY: number, endX: number,
  endY: number, viewportWidth: number): -1 | 0 | 1 {
  const deltaX = endX - startX
  const deltaY = endY - startY
  const threshold = Math.max(48, Math.min(88, viewportWidth * 0.12))
  if (Math.abs(deltaX) < threshold || Math.abs(deltaY) > Math.max(42, Math.abs(deltaX) * 0.65)) return 0
  return deltaX < 0 ? 1 : -1
}
