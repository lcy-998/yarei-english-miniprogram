import type { JsonObject, JsonValue } from '../shared/protocol';

/** M3-SYL guard shared by future content publication and current task snapshot validation. */
export function requiresSyllableOnlyDisplay(payload: JsonObject): boolean {
  const gradeValues: JsonValue[] = [];
  if (payload.grade !== undefined) gradeValues.push(payload.grade);
  if (Array.isArray(payload.grades)) gradeValues.push(...payload.grades);
  return gradeValues.some(grade => {
    if (typeof grade === 'number') return grade === 3 || grade === 4;
    if (typeof grade !== 'string') return false;
    return /(?:^|\D)[34](?:\D|$)/.test(grade) || /三|四/.test(grade);
  });
}

export function validVocabularySyllableContent(payload: JsonObject): boolean {
  if (!requiresSyllableOnlyDisplay(payload)) return true;
  if (!Array.isArray(payload.words) || payload.words.length === 0) return false;
  return payload.words.every(word => {
    if (typeof word !== 'object' || word === null || Array.isArray(word)) return false;
    const syllables = word.syllables;
    return Array.isArray(syllables) && syllables.length > 0
      && syllables.every(part => typeof part === 'string' && part.trim().length > 0);
  });
}
