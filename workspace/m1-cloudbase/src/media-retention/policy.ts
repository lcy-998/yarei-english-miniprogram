const DAY_MS = 86_400_000;
export const ORIGINAL_AUDIO_RETENTION_MS = 60 * DAY_MS;
export const DUBBING_AUDIO_RETENTION_MS = 180 * DAY_MS;
export const AUTONOMOUS_READING_AUDIO_RETENTION_MS = 30 * DAY_MS;
export const TEACHER_VOICE_COMMENT_RETENTION_MS = 30 * DAY_MS;

export function audioExpired(anchorAt: string | null, at: string, retentionMs: number): boolean {
  if (anchorAt === null) return false;
  const anchor = Date.parse(anchorAt);
  const now = Date.parse(at);
  return Number.isFinite(anchor) && Number.isFinite(now)
    && now >= anchor + retentionMs;
}

/** Playback expires on time even if asynchronous physical cleanup runs later. */
export function originalAudioExpired(submittedAt: string | null, at: string): boolean {
  return audioExpired(submittedAt, at, ORIGINAL_AUDIO_RETENTION_MS);
}

export function dubbingAudioExpired(submittedAt: string | null, at: string): boolean {
  return audioExpired(submittedAt, at, DUBBING_AUDIO_RETENTION_MS);
}

export function autonomousReadingAudioExpired(sealedAt: string | null, at: string): boolean {
  return audioExpired(sealedAt, at, AUTONOMOUS_READING_AUDIO_RETENTION_MS);
}

export function pronunciationAudioExpired(kind: 'task' | 'reading', submittedAt: string | null,
  sealedAt: string | null, at: string): boolean {
  return kind === 'reading' ? autonomousReadingAudioExpired(sealedAt, at)
    : originalAudioExpired(submittedAt, at);
}

export function teacherVoiceCommentExpired(publishedAt: string | null, at: string): boolean {
  return audioExpired(publishedAt, at, TEACHER_VOICE_COMMENT_RETENTION_MS);
}
