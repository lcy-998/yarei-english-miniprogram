import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import type { BoundaryValidation } from './task-core-functions';

export const TEACHER_SUGGESTION_COMMAND_ACTIONS = ['generateSuggestion', 'getSuggestion', 'getAutomaticSuggestion'] as const;
export type TeacherSuggestionCommandAction = (typeof TEACHER_SUGGESTION_COMMAND_ACTIONS)[number];
export type TeacherSuggestionCommandInput = Readonly<{ action: 'generateSuggestion'; submissionId: string;
  operationId: string }> | Readonly<{ action: 'getSuggestion'; submissionId: string;
    generationOperationId: string }> | Readonly<{ action: 'getAutomaticSuggestion'; submissionId: string }>;

export function validateTeacherSuggestionCommandRequest(
  request: FunctionRequest<TeacherSuggestionCommandAction, JsonObject>,
): BoundaryValidation<TeacherSuggestionCommandInput> {
  if (request.action === 'getAutomaticSuggestion') {
    if (request.expectedVersion !== undefined || request.operationId !== undefined) {
      return { ok: false, fieldErrors: { operationId: '查询不能携带写入操作标识。' } };
    }
    const exact = parseExactObject(request.payload, ['submissionId']);
    if (!exact.ok || typeof exact.value.submissionId !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/.test(exact.value.submissionId)) {
      return { ok: false, fieldErrors: { submissionId: '提交记录无效。' } };
    }
    return { ok: true, value: { action: 'getAutomaticSuggestion', submissionId: exact.value.submissionId } };
  }
  if (request.action === 'getSuggestion') {
    if (request.expectedVersion !== undefined || request.operationId !== undefined) {
      return { ok: false, fieldErrors: { operationId: '查询不能携带写入操作标识。' } };
    }
    const exact = parseExactObject(request.payload, ['submissionId', 'generationOperationId']);
    if (!exact.ok || typeof exact.value.submissionId !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/.test(exact.value.submissionId)
      || typeof exact.value.generationOperationId !== 'string'
      || !/^[A-Za-z0-9_-]{8,128}$/.test(exact.value.generationOperationId)) {
      return { ok: false, fieldErrors: { submissionId: '建议查询参数无效。' } };
    }
    return { ok: true, value: { action: 'getSuggestion', submissionId: exact.value.submissionId,
      generationOperationId: exact.value.generationOperationId } };
  }
  if (request.action !== 'generateSuggestion' || request.expectedVersion !== undefined
    || typeof request.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(request.operationId)) {
    return { ok: false, fieldErrors: { operationId: 'AI 点评请求标识无效。' } };
  }
  const exact = parseExactObject(request.payload, ['submissionId']);
  if (!exact.ok || typeof exact.value.submissionId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(exact.value.submissionId)) {
    return { ok: false, fieldErrors: { submissionId: '提交记录无效。' } };
  }
  return { ok: true, value: { action: 'generateSuggestion',
    submissionId: exact.value.submissionId, operationId: request.operationId } };
}
