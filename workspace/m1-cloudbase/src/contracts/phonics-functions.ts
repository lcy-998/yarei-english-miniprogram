import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';

type Validation<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };
export const PHONICS_QUERY_ACTIONS = ['listCourses', 'getCourse', 'getState', 'getAudio'] as const;
export const PHONICS_COMMAND_ACTIONS = ['submitAnswer'] as const;
export type PhonicsQueryAction = (typeof PHONICS_QUERY_ACTIONS)[number];
export type PhonicsCommandAction = (typeof PHONICS_COMMAND_ACTIONS)[number];
export type PhonicsQueryInput = Readonly<{ action: 'listCourses' }>
  | Readonly<{ action: 'getCourse'; courseId: string }>
  | Readonly<{ action: 'getState'; courseId: string }>
  | Readonly<{ action: 'getAudio'; courseId: string; phonemeId: string }>;
export type PhonicsCommandInput = Readonly<{ action: 'submitAnswer'; courseId: string;
  questionId: string; selectedOptionId: string; round: number; expectedVersion: number; operationId: string }>;
function invalid<T>(field: string, message: string): Validation<T> {
  return { ok: false, fieldErrors: { [field]: message } };
}
function id(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 128; }

export function validatePhonicsQueryRequest(
  request: FunctionRequest<PhonicsQueryAction, JsonObject>,
): Validation<PhonicsQueryInput> {
  if (request.operationId !== undefined || request.expectedVersion !== undefined) {
    return invalid('operationId', '查询不接受写操作字段。');
  }
  if (request.action === 'listCourses') {
    const empty = parseExactObject(request.payload, []);
    return empty.ok ? { ok: true, value: { action: 'listCourses' } } : empty;
  }
  const exact = request.action === 'getAudio'
    ? parseExactObject(request.payload, ['courseId', 'phonemeId'])
    : parseExactObject(request.payload, ['courseId']);
  if (!exact.ok) return exact;
  if (!id(exact.value.courseId)) return invalid('courseId', '课程标识无效。');
  if (request.action === 'getAudio') {
    return id(exact.value.phonemeId)
      ? { ok: true, value: { action: 'getAudio', courseId: exact.value.courseId,
        phonemeId: exact.value.phonemeId } } : invalid('phonemeId', '音素标识无效。');
  }
  return { ok: true, value: { action: request.action, courseId: exact.value.courseId } };
}

export function validatePhonicsCommandRequest(
  request: FunctionRequest<PhonicsCommandAction, JsonObject>,
): Validation<PhonicsCommandInput> {
  if (request.operationId === undefined || request.expectedVersion === undefined
    || !Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 0) {
    return invalid('expectedVersion', '作答需要操作标识与当前版本。');
  }
  const exact = parseExactObject(request.payload, ['courseId', 'questionId', 'selectedOptionId', 'round']);
  if (!exact.ok) return exact;
  if (!id(exact.value.courseId) || !id(exact.value.questionId) || !id(exact.value.selectedOptionId)
    || !Number.isSafeInteger(exact.value.round) || Number(exact.value.round) < 1) {
    return invalid('questionId', '课程或答案标识无效。');
  }
  return { ok: true, value: { action: 'submitAnswer', courseId: exact.value.courseId,
    questionId: exact.value.questionId, selectedOptionId: exact.value.selectedOptionId,
    round: Number(exact.value.round),
    expectedVersion: request.expectedVersion, operationId: request.operationId } };
}
