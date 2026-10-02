import type { JsonObject } from '../shared/protocol';
import type { VocabularyAttemptRecord } from './types';

export function vocabularyWordIds(payload: JsonObject): readonly string[] | null {
  if (typeof payload.grade !== 'string' || !payload.grade.trim()
    || typeof payload.unit !== 'string' || !payload.unit.trim()
    || !Array.isArray(payload.words) || payload.words.length === 0) return null;
  const ids: string[] = [];
  for (const entry of payload.words) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.id !== 'string' || !entry.id.trim()
      || typeof entry.word !== 'string' || !entry.word.trim()
      || typeof entry.meaning !== 'string' || !entry.meaning.trim()
      || !Array.isArray(entry.syllables) || entry.syllables.length === 0
      || !entry.syllables.every((part: unknown) => typeof part === 'string' && part.trim())) return null;
    ids.push(entry.id);
  }
  return new Set(ids).size === ids.length ? ids : null;
}

export interface VocabularyFirstAttemptSummary {
  readonly completedCount: number;
  readonly correctCount: number;
}

export function summarizeVocabularyFirstAttempts(wordIds: readonly string[],
  attempts: readonly VocabularyAttemptRecord[]): VocabularyFirstAttemptSummary | null {
  const allowed = new Set(wordIds);
  if (allowed.size !== wordIds.length || allowed.size === 0) return null;
  const byWord = new Map<string, VocabularyAttemptRecord[]>();
  const attemptIds = new Set<string>();
  for (const attempt of attempts) {
    if (!allowed.has(attempt.wordId) || attemptIds.has(attempt.id)) return null;
    attemptIds.add(attempt.id);
    byWord.set(attempt.wordId, [...(byWord.get(attempt.wordId) ?? []), attempt]);
  }
  let correctCount = 0;
  for (const entries of byWord.values()) {
    entries.sort((left, right) => left.attemptNumber - right.attemptNumber);
    for (const [index, entry] of entries.entries()) {
      if (entry.attemptNumber !== index + 1 || entry.firstAttempt !== (index === 0)
        || typeof entry.isCorrect !== 'boolean' || !entry.studentInput.trim()) return null;
    }
    if (entries[0]?.isCorrect) correctCount += 1;
  }
  return { completedCount: byWord.size, correctCount };
}
