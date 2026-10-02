export function formatRecordingDuration(durationMs: number): string {
  const seconds = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs / 1000)) : 0
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
