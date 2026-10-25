export interface DubbingSubtitleCue { startMs: number; endMs: number; text: string; translationText?: string }

/** Only a reviewed, ordered timeline can drive the current sentence. */
export function validDubbingSubtitleCues(
  candidates: readonly DubbingSubtitleCue[] | undefined,
): DubbingSubtitleCue[] {
  if (!Array.isArray(candidates) || !candidates.length) return []
  const cues: DubbingSubtitleCue[] = []
  let previousEnd = 0
  for (const candidate of candidates) {
    if (!Number.isSafeInteger(candidate.startMs) || !Number.isSafeInteger(candidate.endMs)
      || candidate.startMs < previousEnd || candidate.endMs <= candidate.startMs
      || typeof candidate.text !== 'string' || !candidate.text.trim()
      || candidate.translationText !== undefined && (typeof candidate.translationText !== 'string'
        || candidate.translationText.trim().length > 500)) return []
    cues.push({ startMs: candidate.startMs, endMs: candidate.endMs, text: candidate.text.trim(),
      ...(candidate.translationText?.trim() ? { translationText: candidate.translationText.trim() } : {}) })
    previousEnd = candidate.endMs
  }
  return cues
}

export function dubbingCueState(cues: readonly DubbingSubtitleCue[], positionMs: number): {
  index: number; text: string; translationText: string; previousIndex: number; nextIndex: number
} {
  const position = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0
  const index = cues.findIndex(cue => cue.startMs <= position && position < cue.endMs)
  const previousIndex = index >= 0 ? index - 1
    : cues.reduce((last, cue, cueIndex) => cue.endMs <= position ? cueIndex : last, -1)
  const nextIndex = index >= 0 ? index + 1 < cues.length ? index + 1 : -1
    : cues.findIndex(cue => cue.startMs > position)
  return { index, text: index >= 0 ? cues[index].text : '',
    translationText: index >= 0 ? cues[index].translationText ?? '' : '', previousIndex, nextIndex }
}
