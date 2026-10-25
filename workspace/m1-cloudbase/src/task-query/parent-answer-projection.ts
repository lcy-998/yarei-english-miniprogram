import { originalAudioExpired } from '../media-retention/policy';
import type { JsonObject, JsonValue } from '../shared/protocol';
import type { FrozenTaskItem, SubmissionAnswer, TaskRecord } from '../task-core/types';

function object(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function count(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function response(value: JsonValue | undefined): JsonValue | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return [...value];
  return null;
}
function legacy(value: JsonValue): JsonValue {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed !== null && typeof parsed === 'object') return { kind: 'unavailable' };
    } catch { /* Legacy free text remains visible to the bound parent. */ }
    return value;
  }
  return typeof value === 'number' ? value : null;
}
function strings(value: JsonValue | undefined): string[] | null {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? [...value] as string[] : null;
}
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length
    && left.every(value => right.includes(value));
}
function mediaQuestions(item: FrozenTaskItem, value: JsonObject): JsonValue[] | null {
  const snapshot = item.mediaSnapshot;
  if (!snapshot || !Array.isArray(value.questionResponses)
    || value.questionResponses.length !== snapshot.questionIds.length) return null;
  const correct = strings(value.correctQuestionIds);
  if (!correct || new Set(correct).size !== correct.length
    || correct.some(id => !snapshot.questionIds.includes(id))) return null;
  const answers = new Map<string, JsonObject>();
  for (const raw of value.questionResponses) {
    if (!object(raw) || typeof raw.questionId !== 'string' || answers.has(raw.questionId)
      || response(raw.response) === null) return null;
    answers.set(raw.questionId, raw);
  }
  if (!sameIds([...answers.keys()], snapshot.questionIds)) return null;
  return snapshot.questionIds.map(questionId => {
    const question = snapshot.questions.find(item => item.questionId === questionId);
    const submitted = answers.get(questionId)!;
    return { questionId, stem: question?.stem ?? '题目未记录',
      response: response(submitted.response),
      isCorrect: question?.questionType === 'subjective' ? null : correct.includes(questionId) };
  });
}
function coveredMs(value: JsonValue | undefined, durationMs: number): number | null {
  if (!Array.isArray(value)) return null;
  const ranges: Array<{ start: number; end: number }> = [];
  for (const raw of value) {
    if (!object(raw) || typeof raw.startMs !== 'number' || typeof raw.endMs !== 'number'
      || !Number.isSafeInteger(raw.startMs) || !Number.isSafeInteger(raw.endMs)
      || raw.startMs < 0 || raw.endMs <= raw.startMs || raw.endMs > durationMs) return null;
    ranges.push({ start: raw.startMs, end: raw.endMs });
  }
  ranges.sort((a, b) => a.start - b.start);
  if (!ranges.length || ranges[0]!.start !== 0) return null;
  let covered = 0; let through = 0;
  for (const range of ranges) {
    if (range.start > through) return null;
    if (range.end > through) covered += range.end - through;
    through = Math.max(through, range.end);
  }
  return covered;
}
function mediaEvidence(item: FrozenTaskItem, value: JsonObject): JsonValue {
  const snapshot = item.mediaSnapshot;
  if (!snapshot || !snapshot.continuousPlaybackEnforced
    || snapshot.reviewVersion !== snapshot.mediaVersion
    || !snapshot.mediaAssetKey.startsWith('cloud://')
    || snapshot.kind !== item.resourceSnapshot.type || value.kind !== snapshot.kind
    || value.mediaId !== snapshot.mediaId || value.mediaVersion !== snapshot.mediaVersion
    || typeof value.mediaSessionId !== 'string' || !value.mediaSessionId.trim()) return { kind: 'unavailable' };
  if (snapshot.kind === 'dubbing') {
    const recording = object(value.recording) ? value.recording : null;
    return typeof value.finalWorkId === 'string' && value.finalWorkId.trim() && recording
      && count(recording.durationMs) !== null && recording.serverReadable === true
      ? { kind: 'dubbing', submitted: true, durationMs: count(recording.durationMs) }
      : { kind: 'unavailable' };
  }
  const questions = mediaQuestions(item, value);
  if (questions === null) return { kind: 'unavailable' };
  if (snapshot.kind === 'listening') {
    const played = strings(value.verifiedPlayedSegmentIds);
    if (!played || !sameIds(played, snapshot.clips.map(clip => clip.segmentId))) return { kind: 'unavailable' };
    return { kind: 'listening', playedSegmentCount: played.length,
      requiredSegmentCount: snapshot.clips.length, answeredQuestionCount: questions.length, questions };
  }
  const playedMs = coveredMs(value.verifiedRanges, snapshot.durationMs);
  if (playedMs === null || playedMs < Math.ceil(snapshot.durationMs * 0.9)) return { kind: 'unavailable' };
  return { kind: 'video', verifiedPlayedMs: playedMs, durationMs: snapshot.durationMs,
    answeredQuestionCount: questions.length, questions };
}

/** Parent results contain task evidence, never storage IDs, private paths or raw server proofs. */
export function parentSafeAnswers(task: TaskRecord, answers: readonly SubmissionAnswer[],
  submittedAt: string | null, now: string): SubmissionAnswer[] {
  const itemById = new Map(task.items.map(item => [item.id, item]));
  return answers.map((answer): SubmissionAnswer => {
    const item = itemById.get(answer.itemId);
    if (!item) return { itemId: answer.itemId,
      value: task.items.length === 0 ? legacy(answer.value) : null };
    if (!object(answer.value)) return { itemId: answer.itemId, value: null };
    const value = answer.value;
    if (item.resourceSnapshot.type === 'reading' && value.kind === 'reading') {
      return { itemId: answer.itemId, value: { kind: 'reading', completedPageCount: count(value.completedPageCount) } };
    }
    if (item.resourceSnapshot.type === 'vocabulary' && value.kind === 'vocabulary') {
      return { itemId: answer.itemId, value: { kind: 'vocabulary',
        completedWordCount: count(value.completedWordCount), correctWordCount: count(value.correctWordCount) } };
    }
    if (item.resourceSnapshot.type === 'exercise' && value.kind === 'exercise') {
      const questionResponses = Array.isArray(value.questionResponses) ? value.questionResponses.flatMap(raw => {
        if (!object(raw) || typeof raw.questionId !== 'string') return [];
        return [{ questionId: raw.questionId, response: response(raw.response),
          isCorrect: typeof raw.isCorrect === 'boolean' ? raw.isCorrect : null }];
      }) : [];
      return { itemId: answer.itemId, value: { kind: 'exercise',
        answeredQuestionCount: count(value.answeredQuestionCount), questionResponses } };
    }
    if (item.resourceSnapshot.type === 'recording' && value.kind === 'recording') {
      return { itemId: answer.itemId, value: { kind: 'recording', durationMs: count(value.durationMs),
        mediaExpired: originalAudioExpired(submittedAt, now) } };
    }
    if (item.resourceSnapshot.type === 'listening' || item.resourceSnapshot.type === 'video'
      || item.resourceSnapshot.type === 'dubbing') {
      return { itemId: answer.itemId, value: mediaEvidence(item, value) };
    }
    return { itemId: answer.itemId, value: { kind: 'unavailable' } };
  });
}
