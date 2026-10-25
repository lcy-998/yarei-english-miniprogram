export const LEARNING_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const
export type LearningSpeed = typeof LEARNING_SPEEDS[number]

export function normalizeLearningSpeed(value: unknown): LearningSpeed {
  return LEARNING_SPEEDS.find(speed => speed === value) ?? 1
}

export function nextLearningSpeed(value: unknown): LearningSpeed {
  const current = normalizeLearningSpeed(value)
  return LEARNING_SPEEDS[(LEARNING_SPEEDS.indexOf(current) + 1) % LEARNING_SPEEDS.length]!
}

/** VideoContext supports 0.8× but not the product's 0.75× audio setting. */
export function nativeVideoSpeed(value: unknown): Readonly<{ speed: LearningSpeed; fallback: boolean }> {
  const requested = normalizeLearningSpeed(value)
  return requested === 0.75 ? { speed: 1, fallback: true } : { speed: requested, fallback: false }
}

export function confirmedSeekTarget(requestedSeconds: number, durationSeconds: number,
  confirmedSeconds: number, locked: boolean): number {
  if (!Number.isFinite(requestedSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  const requested = Math.max(0, Math.min(durationSeconds, requestedSeconds))
  if (!locked) return requested
  if (!Number.isFinite(confirmedSeconds) || confirmedSeconds < 0) return 0
  return Math.min(requested, confirmedSeconds, durationSeconds)
}

function speedKey(userId: string): string { return `learning_audio_speed_${userId}` }

export function readLearningSpeed(userId: string): LearningSpeed {
  if (!userId || typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return 1
  return normalizeLearningSpeed(wx.getStorageSync(speedKey(userId)) as unknown)
}

export function saveLearningSpeed(userId: string, speed: LearningSpeed): void {
  if (userId && typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
    wx.setStorageSync(speedKey(userId), speed)
  }
}
