import type { JsonObject, JsonValue } from '../shared/protocol';

export type ExerciseQuestionType = 'single_choice' | 'multiple_choice' | 'fill' | 'subjective';

export interface ExerciseQuestionSnapshot {
  readonly questionId: string;
  readonly questionType: ExerciseQuestionType;
  readonly stem: string;
  readonly options: readonly string[];
  readonly correctAnswer: JsonValue;
  readonly explanation: string;
}

export interface ExerciseSubmissionEvaluation {
  readonly complete: boolean;
  readonly canonicalValue: JsonObject | null;
  readonly automaticScore: number | null;
}

export function readExerciseQuestionSnapshot(payload: JsonObject): ExerciseQuestionSnapshot | null {
  const questionIds = payload.questionIds;
  const type = payload.questionType;
  const options = payload.options;
  if (!Array.isArray(questionIds) || questionIds.length !== 1 || typeof questionIds[0] !== 'string'
    || !questionIds[0].trim() || !['single_choice', 'multiple_choice', 'fill', 'subjective'].includes(String(type))
    || typeof payload.stem !== 'string' || !payload.stem.trim()
    || !Array.isArray(options) || !options.every((option) => typeof option === 'string')
    || payload.correctAnswer === undefined || typeof payload.explanation !== 'string') return null;
  if (type === 'single_choice' && (typeof payload.correctAnswer !== 'string' || !options.includes(payload.correctAnswer))) return null;
  if (type === 'multiple_choice' && (!Array.isArray(payload.correctAnswer) || !payload.correctAnswer.length
    || payload.correctAnswer.some((item) => typeof item !== 'string' || !options.includes(item)))) return null;
  return {
    questionId: questionIds[0], questionType: type as ExerciseQuestionType,
    stem: payload.stem, options: options as string[],
    correctAnswer: payload.correctAnswer, explanation: payload.explanation,
  };
}

export function evaluateExerciseSubmission(snapshot: ExerciseQuestionSnapshot, value: JsonValue): ExerciseSubmissionEvaluation {
  if (!isObject(value) || !['kind,questionResponses', 'answeredQuestionCount,kind,questionResponses'].includes(Object.keys(value).sort().join(','))
    || (value.answeredQuestionCount !== undefined && value.answeredQuestionCount !== 1)
    || value.kind !== 'exercise' || !Array.isArray(value.questionResponses)
    || value.questionResponses.length !== 1) return incomplete();
  const raw = value.questionResponses[0];
  if (!isObject(raw) || Object.keys(raw).sort().join(',') !== 'questionId,response'
    || raw.questionId !== snapshot.questionId || !validResponse(snapshot, raw.response)) return incomplete();
  const response = raw.response;
  const isCorrect = snapshot.questionType === 'subjective' ? null : answersEqual(snapshot.questionType, response, snapshot.correctAnswer);
  const canonicalValue: JsonObject = {
    kind: 'exercise', answeredQuestionCount: 1,
    questionResponses: [{ questionId: snapshot.questionId, response,
      ...(isCorrect === null ? {} : { isCorrect }) }],
    ...(isCorrect === null ? {} : { correctQuestionCount: isCorrect ? 1 : 0 }),
  };
  return { complete: true, canonicalValue, automaticScore: isCorrect === null ? null : isCorrect ? 100 : 0 };
}

function incomplete(): ExerciseSubmissionEvaluation {
  return { complete: false, canonicalValue: null, automaticScore: null };
}

function validResponse(snapshot: ExerciseQuestionSnapshot, value: JsonValue | undefined): value is JsonValue {
  if (snapshot.questionType === 'multiple_choice') return Array.isArray(value) && value.length > 0
    && value.every((item) => typeof item === 'string' && snapshot.options.includes(item))
    && new Set(value).size === value.length;
  if (typeof value !== 'string' || !value.trim()) return false;
  return snapshot.questionType !== 'single_choice' || snapshot.options.includes(value);
}

function answersEqual(type: ExerciseQuestionType, response: JsonValue, correctAnswer: JsonValue): boolean {
  if (type === 'multiple_choice') {
    if (!Array.isArray(response) || !Array.isArray(correctAnswer)
      || correctAnswer.some((item) => typeof item !== 'string')) return false;
    return response.length === correctAnswer.length
      && response.every((item) => correctAnswer.includes(item));
  }
  return typeof response === 'string' && typeof correctAnswer === 'string'
    && response.trim().toLocaleLowerCase() === correctAnswer.trim().toLocaleLowerCase();
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
