/**
 * M2 task-item rules. Playback, media and answer evidence supplied here must
 * already have been verified by the server against the published snapshot.
 * Client-submitted counts or playback positions are never trusted evidence.
 */

export type ContentRule =
  | Readonly<{ kind: 'listening'; segmentIds: readonly string[]; questionIds: readonly string[] }>
  | Readonly<{ kind: 'reading'; pageIds: readonly string[]; questionIds: readonly string[] }>
  | Readonly<{ kind: 'recording' }>
  | Readonly<{ kind: 'video'; durationMs: number; questionIds: readonly string[] }>
  | Readonly<{ kind: 'vocabulary'; wordIds: readonly string[] }>
  | Readonly<{ kind: 'exercise'; questionIds: readonly string[]; objectiveQuestionIds: readonly string[] }>
  | Readonly<{ kind: 'dubbing' }>;

type QuestionEvidence = Readonly<{
  answeredQuestionIds: readonly string[];
  correctQuestionIds: readonly string[];
}>;

type UploadedRecording = Readonly<{
  mediaId: string;
  durationMs: number;
  sizeBytes: number;
  serverReadable: boolean;
}>;

export type ContentEvidence =
  | (Readonly<{ kind: 'listening'; verifiedPlayedSegmentIds: readonly string[] }> & QuestionEvidence)
  | (Readonly<{ kind: 'reading'; completedPageIds: readonly string[] }> & QuestionEvidence)
  | Readonly<{ kind: 'recording'; recording: UploadedRecording | null }>
  | (Readonly<{ kind: 'video'; verifiedRanges: readonly Readonly<{ startMs: number; endMs: number }>[] }> & QuestionEvidence)
  | Readonly<{ kind: 'vocabulary'; attemptedWordIds: readonly string[]; firstCorrectWordIds: readonly string[] }>
  | QuestionEvidence & Readonly<{ kind: 'exercise' }>
  | Readonly<{ kind: 'dubbing'; finalWorkId: string | null; recording: UploadedRecording | null }>;

export type ContentEvaluation = Readonly<{
  complete: boolean;
  automaticScore: number | null;
  teacherScoreRequired: boolean;
}>;

export type TaskItemEvaluation = Readonly<{
  itemId: string;
  evaluation: ContentEvaluation;
  teacherScore?: number;
}>;

export type TaskScoreResult = Readonly<{
  validWeights: boolean;
  complete: boolean;
  score: number | null;
  needsTeacherScore: boolean;
}>;

const INCOMPLETE: ContentEvaluation = { complete: false, automaticScore: null, teacherScoreRequired: false };
const STUDENT_RECORDING_MAX_MS = 5 * 60 * 1000;
const STUDENT_RECORDING_MAX_BYTES = 20 * 1024 * 1024;

/** Task publication stays closed for media workflows that need M3 safeguards. */
export function isTaskContentPublishableInM2(kind: ContentRule['kind']): boolean {
  return kind === 'reading' || kind === 'vocabulary' || kind === 'exercise' || kind === 'recording';
}

export function validateContentRule(rule: ContentRule): boolean {
  switch (rule.kind) {
    case 'listening': return uniqueIds(rule.segmentIds) && uniqueIds(rule.questionIds);
    case 'reading': return uniqueIds(rule.pageIds) && uniqueIdsOrEmpty(rule.questionIds);
    case 'recording':
    case 'dubbing': return true;
    case 'video': return Number.isSafeInteger(rule.durationMs) && rule.durationMs > 0 && uniqueIdsOrEmpty(rule.questionIds);
    case 'vocabulary': return uniqueIds(rule.wordIds);
    case 'exercise': return uniqueIds(rule.questionIds)
      && uniqueIdsOrEmpty(rule.objectiveQuestionIds)
      && isSubset(rule.objectiveQuestionIds, rule.questionIds);
  }
}

export function evaluateVerifiedContent(rule: ContentRule, evidence: ContentEvidence): ContentEvaluation {
  if (!validateContentRule(rule) || rule.kind !== evidence.kind) return INCOMPLETE;
  switch (rule.kind) {
    case 'listening': {
      if (evidence.kind !== 'listening' || !isExactSet(evidence.verifiedPlayedSegmentIds, rule.segmentIds)
        || !validQuestionEvidence(evidence, rule.questionIds)
        || !isExactSet(evidence.answeredQuestionIds, rule.questionIds)) return INCOMPLETE;
      return automatic(percent(evidence.correctQuestionIds.length, rule.questionIds.length));
    }
    case 'reading': {
      if (evidence.kind !== 'reading' || !isExactSet(evidence.completedPageIds, rule.pageIds)
        || !validQuestionEvidence(evidence, rule.questionIds)
        || !isExactSet(evidence.answeredQuestionIds, rule.questionIds)) return INCOMPLETE;
      return automatic(rule.questionIds.length ? percent(evidence.correctQuestionIds.length, rule.questionIds.length) : 100);
    }
    case 'recording':
      return evidence.kind === 'recording' && validRecording(evidence.recording) ? manual() : INCOMPLETE;
    case 'video': {
      if (evidence.kind !== 'video' || coveredDuration(evidence.verifiedRanges, rule.durationMs) < rule.durationMs * 0.9
        || !validQuestionEvidence(evidence, rule.questionIds)
        || !isExactSet(evidence.answeredQuestionIds, rule.questionIds)) return INCOMPLETE;
      return rule.questionIds.length ? automatic(percent(evidence.correctQuestionIds.length, rule.questionIds.length)) : unscored();
    }
    case 'vocabulary': {
      if (evidence.kind !== 'vocabulary' || !isExactSet(evidence.attemptedWordIds, rule.wordIds)
        || !uniqueIdsOrEmpty(evidence.firstCorrectWordIds)
        || !isSubset(evidence.firstCorrectWordIds, rule.wordIds)) return INCOMPLETE;
      return automatic(percent(evidence.firstCorrectWordIds.length, rule.wordIds.length));
    }
    case 'exercise': {
      if (evidence.kind !== 'exercise' || !validQuestionEvidence(evidence, rule.objectiveQuestionIds)
        || !isExactSet(evidence.answeredQuestionIds, rule.questionIds)) return INCOMPLETE;
      return rule.objectiveQuestionIds.length === rule.questionIds.length
        ? automatic(percent(evidence.correctQuestionIds.length, rule.questionIds.length))
        : manual();
    }
    case 'dubbing':
      return evidence.kind === 'dubbing' && Boolean(evidence.finalWorkId?.trim()) && validRecording(evidence.recording)
        ? manual() : INCOMPLETE;
  }
}

/** Unscored completed items are omitted from the 100-point task weighting. */
export function calculateTaskScore(
  items: readonly TaskItemEvaluation[],
  weights?: Readonly<Record<string, number>>,
): TaskScoreResult {
  const scored = items.filter((item) => item.evaluation.automaticScore !== null || item.evaluation.teacherScoreRequired);
  const validIds = items.length > 0 && items.every((item) => item.itemId.trim().length > 0)
    && new Set(items.map((item) => item.itemId)).size === items.length;
  const validWeights = validIds && (weights === undefined || (
    Object.keys(weights).length === scored.length
    && scored.every((item) => Number.isFinite(weights[item.itemId]) && weights[item.itemId]! > 0)
    && Object.keys(weights).every((id) => scored.some((item) => item.itemId === id))
    && Math.abs(Object.values(weights).reduce((sum, weight) => sum + weight, 0) - 100) < 0.000001
  ));
  if (!validWeights) return { validWeights: false, complete: false, score: null, needsTeacherScore: false };
  if (items.some((item) => !item.evaluation.complete)) {
    return { validWeights: true, complete: false, score: null, needsTeacherScore: false };
  }
  const needsTeacherScore = scored.some((item) => item.evaluation.teacherScoreRequired
    && (item.teacherScore === undefined || !Number.isFinite(item.teacherScore) || item.teacherScore < 0 || item.teacherScore > 100));
  if (needsTeacherScore) return { validWeights: true, complete: true, score: null, needsTeacherScore: true };
  if (!scored.length) return { validWeights: true, complete: true, score: null, needsTeacherScore: false };
  const score = scored.reduce((sum, item) => {
    const value = item.evaluation.teacherScoreRequired ? item.teacherScore! : item.evaluation.automaticScore!;
    return sum + value * (weights === undefined ? 1 / scored.length : weights[item.itemId]! / 100);
  }, 0);
  return { validWeights: true, complete: true, score: Math.round(score), needsTeacherScore: false };
}

function automatic(score: number): ContentEvaluation {
  return { complete: true, automaticScore: score, teacherScoreRequired: false };
}

function manual(): ContentEvaluation {
  return { complete: true, automaticScore: null, teacherScoreRequired: true };
}

function unscored(): ContentEvaluation {
  return { complete: true, automaticScore: null, teacherScoreRequired: false };
}

function percent(correct: number, total: number): number {
  return Math.round((correct / total) * 100);
}

function uniqueIds(ids: readonly string[]): boolean {
  return ids.length > 0 && uniqueIdsOrEmpty(ids);
}

function uniqueIdsOrEmpty(ids: readonly string[]): boolean {
  return ids.every((id) => typeof id === 'string' && id.trim().length > 0) && new Set(ids).size === ids.length;
}

function isSubset(candidate: readonly string[], allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return candidate.every((id) => allowedSet.has(id));
}

function isExactSet(candidate: readonly string[], required: readonly string[]): boolean {
  return uniqueIdsOrEmpty(candidate) && candidate.length === required.length && isSubset(candidate, required);
}

function validQuestionEvidence(evidence: QuestionEvidence, scoredIds: readonly string[]): boolean {
  return uniqueIdsOrEmpty(evidence.answeredQuestionIds)
    && uniqueIdsOrEmpty(evidence.correctQuestionIds)
    && isSubset(evidence.correctQuestionIds, evidence.answeredQuestionIds)
    && isSubset(evidence.correctQuestionIds, scoredIds);
}

function validRecording(recording: UploadedRecording | null): boolean {
  return recording !== null && typeof recording.mediaId === 'string' && recording.mediaId.trim().length > 0 && recording.serverReadable
    && Number.isSafeInteger(recording.durationMs) && recording.durationMs >= 1000
    && recording.durationMs <= STUDENT_RECORDING_MAX_MS
    && Number.isSafeInteger(recording.sizeBytes) && recording.sizeBytes > 0
    && recording.sizeBytes <= STUDENT_RECORDING_MAX_BYTES;
}

function coveredDuration(ranges: readonly Readonly<{ startMs: number; endMs: number }>[], durationMs: number): number {
  if (!ranges.length || ranges.some(({ startMs, endMs }) => !Number.isSafeInteger(startMs)
    || !Number.isSafeInteger(endMs) || startMs < 0 || endMs > durationMs || startMs >= endMs)) return 0;
  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs);
  let covered = 0;
  let end = 0;
  for (const range of sorted) {
    covered += Math.max(0, range.endMs - Math.max(end, range.startMs));
    end = Math.max(end, range.endMs);
  }
  return covered;
}
