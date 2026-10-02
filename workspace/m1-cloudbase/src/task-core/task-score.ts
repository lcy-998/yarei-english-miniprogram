import type { JsonObject, JsonValue } from '../shared/protocol';
import { calculateTaskScore, type ContentEvaluation, type TaskItemEvaluation } from './content-rules';
import { evaluateExerciseSubmission, readExerciseQuestionSnapshot } from './exercise-evidence';
import type { SubmissionRecord, TaskRecord } from './types';

export interface ManualTaskItemScore { readonly itemId: string; readonly score: number }

export interface TaskScoringItem {
  readonly itemId: string;
  readonly weightPercent: number;
  readonly automaticScore: number | null;
  readonly teacherScoreRequired: boolean;
  readonly complete: boolean;
}

function evaluationsFor(task: TaskRecord, submission: SubmissionRecord): TaskItemEvaluation[] {
  const byItem = new Map(submission.answers.map(answer => [answer.itemId, answer.value]));
  return task.items.map(item => ({ itemId: item.id, evaluation: evaluateItem(item, byItem.get(item.id)) }));
}

function scoreWeights(task: TaskRecord): Readonly<Record<string, number>> | undefined {
  const explicit = task.items.map(item => item.scoringRule.weightPercent);
  return explicit.every(weight => typeof weight === 'number')
    ? Object.fromEntries(task.items.map((item, index) => [item.id, explicit[index] as number])) : undefined;
}

/** Read-only scoring inputs from the published snapshot and this exact submission version. */
export function taskScoringItems(task: TaskRecord, submission: SubmissionRecord): TaskScoringItem[] {
  const evaluations = evaluationsFor(task, submission);
  const scored = evaluations.filter(item => item.evaluation.automaticScore !== null || item.evaluation.teacherScoreRequired);
  const weights = scoreWeights(task);
  return scored.map(item => ({ itemId: item.itemId,
    weightPercent: weights?.[item.itemId] ?? 100 / scored.length,
    automaticScore: item.evaluation.automaticScore,
    teacherScoreRequired: item.evaluation.teacherScoreRequired,
    complete: item.evaluation.complete }));
}

/** Returns null for a damaged or incomplete submission. Legacy unstructured items remain manually reviewed. */
export function manualTaskItemIds(task: TaskRecord, submission: SubmissionRecord): readonly string[] | null {
  if (submission.taskId !== task.id || submission.status === 'draft') return null;
  const evaluations = evaluationsFor(task, submission);
  return evaluations.every(item => item.evaluation.complete)
    ? evaluations.filter(item => item.evaluation.teacherScoreRequired).map(item => item.itemId) : null;
}

/** The teacher scores only manual items; automatic items and published weights determine the final total. */
export function scoreTaskWithManualItems(task: TaskRecord, submission: SubmissionRecord,
  manualScores: readonly ManualTaskItemScore[]): number | null {
  const manualIds = manualTaskItemIds(task, submission);
  if (manualIds === null || manualScores.length !== manualIds.length
    || new Set(manualScores.map(item => item.itemId)).size !== manualScores.length
    || manualScores.some(item => !manualIds.includes(item.itemId)
      || !Number.isFinite(item.score) || item.score < 0 || item.score > 100)) return null;
  const scores = new Map(manualScores.map(item => [item.itemId, item.score]));
  const evaluations = evaluationsFor(task, submission).map(item => ({ ...item,
    ...(scores.has(item.itemId) ? { teacherScore: scores.get(item.itemId) } : {}) }));
  const result = calculateTaskScore(evaluations, scoreWeights(task));
  return result.validWeights && result.complete && !result.needsTeacherScore ? result.score : null;
}

/** Recomputes an automatic total from the immutable published task snapshot. */
export function automaticTaskScore(task: TaskRecord, submission: SubmissionRecord): number | null {
  if (submission.taskId !== task.id || submission.status === 'draft') return null;
  if (!task.items.some((item) => item.resourceSnapshot.type === 'exercise'
    && item.resourceSnapshot.payload.questionIds !== undefined)) return null;
  const result = calculateTaskScore(evaluationsFor(task, submission), scoreWeights(task));
  return result.validWeights && result.complete && !result.needsTeacherScore ? result.score : null;
}

function evaluateItem(item: TaskRecord['items'][number], value: JsonValue | undefined): ContentEvaluation {
  if (!isObject(value)) return incomplete();
  const rule = item.completionRule;
  if (item.resourceSnapshot.type === 'reading') {
    return value.kind === 'reading' && count(value.completedPageCount) !== null
      && count(rule.requiredPageCount) !== null && (value.completedPageCount as number) >= (rule.requiredPageCount as number)
      ? automatic(100) : incomplete();
  }
  if (item.resourceSnapshot.type === 'vocabulary') {
    const completed = count(value.completedWordCount);
    const correct = count(value.correctWordCount);
    const required = count(rule.requiredWordCount);
    return value.kind === 'vocabulary' && completed !== null && correct !== null && required !== null
      && completed >= required && correct <= completed && completed > 0
      ? automatic(Math.round(correct * 100 / completed)) : incomplete();
  }
  if (item.resourceSnapshot.type === 'recording') {
    return rule.kind === 'recording_upload' && value.kind === 'recording'
      && typeof value.recordingId === 'string' && value.recordingId.trim().length > 0
      ? manual() : incomplete();
  }
  const snapshot = readExerciseQuestionSnapshot(item.resourceSnapshot.payload);
  if (item.resourceSnapshot.payload.questionIds !== undefined && snapshot === null) return incomplete();
  if (snapshot !== null) {
    if (value.kind !== 'exercise' || !Array.isArray(value.questionResponses)) return incomplete();
    const raw = value.questionResponses.map((entry) => {
      if (!isObject(entry)) return entry;
      return { questionId: entry.questionId, response: entry.response };
    });
    const evaluated = evaluateExerciseSubmission(snapshot, { kind: 'exercise', answeredQuestionCount: 1, questionResponses: raw });
    if (!evaluated.complete) return incomplete();
    return evaluated.automaticScore === null ? manual() : automatic(evaluated.automaticScore);
  }
  return value.kind === 'exercise' && count(value.answeredQuestionCount) !== null
    && count(rule.requiredQuestionCount) !== null && (value.answeredQuestionCount as number) >= (rule.requiredQuestionCount as number)
    ? manual() : incomplete();
}

function incomplete(): ContentEvaluation { return { complete: false, automaticScore: null, teacherScoreRequired: false }; }
function automatic(score: number): ContentEvaluation { return { complete: true, automaticScore: score, teacherScoreRequired: false }; }
function manual(): ContentEvaluation { return { complete: true, automaticScore: null, teacherScoreRequired: true }; }
function count(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value);
}
