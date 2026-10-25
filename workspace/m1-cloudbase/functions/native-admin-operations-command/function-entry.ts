import type { FunctionRequest, JsonObject, ServiceResult } from '../../src/shared/protocol';
import { parseExactObject } from '../../src/shared/strict-object';
import { createMeta, success } from '../../src/shared/result';
import { NativeAdminOperationsError, type NativeAdminOperationsService } from '../../src/native-admin/operations-service';
import { createTrustedFunction, type TrustedFunctionDependencies,
  type TrustedFunctionValidation } from '../shared/trusted-function';

export const NATIVE_ADMIN_OPERATIONS_ACTIONS =
  ['saveTextbookConfig', 'setTextbookConfigStatus', 'setQuestionStatus', 'setQuestionVisibility',
    'setQuestionBatchStatus', 'stopManaged'] as const;
type Action = (typeof NATIVE_ADMIN_OPERATIONS_ACTIONS)[number];
type Validated =
  | Readonly<{ action: 'saveTextbookConfig'; resourceId: string; classIds: string[];
    reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'setTextbookConfigStatus'; resourceId: string; status: 'published' | 'disabled';
    reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'setQuestionStatus'; questionId: string;
    status: 'published' | 'offline'; reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'setQuestionVisibility'; questionId: string; organizationWide: boolean;
    classIds: string[]; reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'setQuestionBatchStatus'; status: 'published' | 'offline';
    questions: Array<{ questionId: string; expectedVersion: number }>;
    reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'stopManaged'; kind: 'classroom' | 'activity'; id: string;
    reason: string; expectedVersion: number; operationId: string }>;

export function validateNativeAdminOperationsRequest(request: FunctionRequest<Action, JsonObject>):
  TrustedFunctionValidation<Validated> {
  const version = request.expectedVersion;
  const operationId = request.operationId;
  if (!Number.isSafeInteger(version) || Number(version) < 0
    || typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)) {
    return invalid('expectedVersion');
  }
  const keys = request.action === 'saveTextbookConfig' ? ['resourceId', 'classIds', 'reason']
    : request.action === 'setTextbookConfigStatus' ? ['resourceId', 'status', 'reason']
    : request.action === 'setQuestionStatus' ? ['questionId', 'status', 'reason']
      : request.action === 'setQuestionVisibility' ? ['questionId', 'organizationWide', 'classIds', 'reason']
      : request.action === 'setQuestionBatchStatus' ? ['status', 'questions', 'reason']
      : ['kind', 'id', 'reason'];
  const exact = parseExactObject(request.payload, keys);
  if (!exact.ok) return exact;
  const row = exact.value;
  if (typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 200) return invalid('reason');
  if (request.action === 'saveTextbookConfig') {
    if (!validId(row.resourceId) || !Array.isArray(row.classIds) || !row.classIds.length
      || row.classIds.length > 500 || row.classIds.some(id => !validId(id))
      || new Set(row.classIds).size !== row.classIds.length) return invalid('payload');
    return { ok: true, value: { action: 'saveTextbookConfig', resourceId: row.resourceId,
      classIds: row.classIds as string[], reason: row.reason,
      expectedVersion: Number(version), operationId } };
  }
  if (Number(version) < 1) return invalid('expectedVersion');
  if (request.action === 'setTextbookConfigStatus') {
    if (!validId(row.resourceId) || (row.status !== 'published' && row.status !== 'disabled')) return invalid('payload');
    return { ok: true, value: { action: 'setTextbookConfigStatus', resourceId: row.resourceId,
      status: row.status, reason: row.reason, expectedVersion: Number(version), operationId } };
  }
  if (request.action === 'setQuestionStatus') {
    if (!validId(row.questionId) || (row.status !== 'published' && row.status !== 'offline')) {
      return invalid('payload');
    }
    return { ok: true, value: { action: 'setQuestionStatus', questionId: row.questionId,
      status: row.status, reason: row.reason, expectedVersion: Number(version), operationId } };
  }
  if (request.action === 'setQuestionVisibility') {
    if (!validId(row.questionId) || typeof row.organizationWide !== 'boolean'
      || !Array.isArray(row.classIds) || row.classIds.length > 500
      || row.classIds.some(id => !validId(id)) || new Set(row.classIds).size !== row.classIds.length
      || row.organizationWide && row.classIds.length !== 0
      || !row.organizationWide && row.classIds.length === 0) return invalid('payload');
    return { ok: true, value: { action: 'setQuestionVisibility', questionId: row.questionId,
      organizationWide: row.organizationWide, classIds: row.classIds as string[], reason: row.reason,
      expectedVersion: Number(version), operationId } };
  }
  if (request.action === 'setQuestionBatchStatus') {
    if (Number(version) < 1 || (row.status !== 'published' && row.status !== 'offline')
      || !Array.isArray(row.questions) || row.questions.length < 1 || row.questions.length > 50) return invalid('payload');
    const questions: Array<{ questionId: string; expectedVersion: number }> = [];
    for (const raw of row.questions) {
      const item = parseExactObject(raw, ['questionId', 'expectedVersion']);
      if (!item.ok || !validId(item.value.questionId)
        || !Number.isSafeInteger(item.value.expectedVersion) || Number(item.value.expectedVersion) < 1) {
        return invalid('payload');
      }
      questions.push({ questionId: item.value.questionId, expectedVersion: Number(item.value.expectedVersion) });
    }
    if (new Set(questions.map(item => item.questionId)).size !== questions.length) return invalid('payload');
    return { ok: true, value: { action: 'setQuestionBatchStatus', status: row.status,
      questions, reason: row.reason, expectedVersion: Number(version), operationId } };
  }
  if (!validId(row.id) || (row.kind !== 'classroom' && row.kind !== 'activity')) return invalid('payload');
  return { ok: true, value: { action: 'stopManaged', kind: row.kind, id: row.id,
    reason: row.reason, expectedVersion: Number(version), operationId } };
}

export interface NativeAdminOperationsDependencies extends TrustedFunctionDependencies {
  readonly operations: Pick<NativeAdminOperationsService,
    'saveTextbookConfig' | 'setTextbookConfigStatus' | 'setQuestionStatus'
    | 'setQuestionVisibility' | 'setQuestionBatchStatus' | 'stopManaged'>;
}

export function createNativeAdminOperationsFunction(dependencies: NativeAdminOperationsDependencies) {
  return createTrustedFunction<Action, Validated, JsonObject>(
    'native-admin-operations-command', NATIVE_ADMIN_OPERATIONS_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => error instanceof NativeAdminOperationsError
      ? error.code : dependencies.mapFailure?.(phase, error) ?? 'SERVICE_UNAVAILABLE' },
    validateNativeAdminOperationsRequest,
    async (input, actor): Promise<ServiceResult<JsonObject>> => {
      if (input.action === 'saveTextbookConfig' || input.action === 'setTextbookConfigStatus'
        || input.action === 'setQuestionVisibility' || input.action === 'stopManaged') {
        return { ok: false, error: { code: 'FORBIDDEN', message: '当前原生管理范围不包含该操作',
          retryable: false }, meta: createMeta(dependencies.clock, dependencies.requestIds) };
      }
      const result = input.action === 'setQuestionStatus'
        ? await dependencies.operations.setQuestionStatus(actor, input,
          input.expectedVersion, input.operationId)
        : await dependencies.operations.setQuestionBatchStatus(actor, input, input.operationId);
      return success<JsonObject>({ ...result }, createMeta(dependencies.clock, dependencies.requestIds));
    });
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function invalid(field: string): TrustedFunctionValidation<Validated> {
  return { ok: false, fieldErrors: { [field]: '字段无效或版本已变化。' } };
}
