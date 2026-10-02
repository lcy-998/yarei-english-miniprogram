export const ORIGINAL_AUDIO_RETENTION_MS = 180 * 86_400_000;

/** Playback expires on time even if asynchronous physical cleanup runs later. */
export function originalAudioExpired(submittedAt: string | null, at: string): boolean {
  if (submittedAt === null) return false;
  const submitted = Date.parse(submittedAt);
  const now = Date.parse(at);
  return Number.isFinite(submitted) && Number.isFinite(now)
    && now >= submitted + ORIGINAL_AUDIO_RETENTION_MS;
}
