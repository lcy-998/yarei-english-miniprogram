import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';

export type ContractValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export const LEARNING_PROGRESS_QUERY_ACTIONS = ['getReadingProgress', 'getVocabularyProgress'] as const;
export type LearningProgressQueryAction = (typeof LEARNING_PROGRESS_QUERY_ACTIONS)[number];
export type LearningProgressQueryInput =
  | Readonly<{ action: 'getReadingProgress'; resourceId: string }>
  | Readonly<{ action: 'getVocabularyProgress'; packId: string }>;

export const LEARNING_PROGRESS_COMMAND_ACTIONS = ['saveReadingProgress', 'saveVocabularyProgress'] as const;
export type LearningProgressCommandAction = (typeof LEARNING_PROGRESS_COMMAND_ACTIONS)[number];
export type LearningProgressCommandInput =
  | Readonly<{
      action: 'saveReadingProgress'; resourceId: string; chapterId: string; pageId: string;
      pageNumber: number; favorite: boolean; expectedVersion: number; operationId: string;
    }>
  | Readonly<{
      action: 'saveVocabularyProgress'; packId: string; completedCount: number; correctCount: number;
      wrongWordIds: readonly string[]; expectedVersion: number; operationId: string;
    }>;

export function validateLearningProgressQueryRequest(
  request: FunctionRequest<LearningProgressQueryAction, JsonObject>,
): ContractValidation<LearningProgressQueryInput> {
  if (request.operationId !== undefined) return invalid('operationId', '查询操作不支持操作标识。');
  if (request.expectedVersion !== undefined) return invalid('expectedVersion', '查询操作不支持版本号。');
  if (request.action === 'getReadingProgress') {
    const exact = parseExactObject(request.payload, ['resourceId']);
    if (!exact.ok) return exact;
    const resourceId = requiredId(exact.value.resourceId, 'resourceId');
    return resourceId.ok ? { ok: true, value: { action: request.action, resourceId: resourceId.value } } : resourceId;
  }
  const exact = parseExactObject(request.payload, ['packId']);
  if (!exact.ok) return exact;
  const packId = requiredId(exact.value.packId, 'packId');
  return packId.ok ? { ok: true, value: { action: request.action, packId: packId.value } } : packId;
}

export function validateLearningProgressCommandRequest(
  request: FunctionRequest<LearningProgressCommandAction, JsonObject>,
): ContractValidation<LearningProgressCommandInput> {
  if (request.operationId === undefined) return invalid('operationId', '写操作必须提供操作标识。');
  const expectedVersion = request.expectedVersion ?? 0;
  if (request.action === 'saveReadingProgress') {
    const exact = parseExactObject(request.payload, ['resourceId', 'chapterId', 'pageId', 'pageNumber', 'favorite']);
    if (!exact.ok) return exact;
    const resourceId = requiredId(exact.value.resourceId, 'resourceId');
    const chapterId = requiredId(exact.value.chapterId, 'chapterId');
    const pageId = requiredId(exact.value.pageId, 'pageId');
    if (!resourceId.ok) return resourceId;
    if (!chapterId.ok) return chapterId;
    if (!pageId.ok) return pageId;
    if (!isPositiveInteger(exact.value.pageNumber)) return invalid('pageNumber', '页码必须是正整数。');
    if (typeof exact.value.favorite !== 'boolean') return invalid('favorite', '收藏状态格式无效。');
    return { ok: true, value: {
      action: request.action, resourceId: resourceId.value, chapterId: chapterId.value,
      pageId: pageId.value, pageNumber: exact.value.pageNumber, favorite: exact.value.favorite,
      expectedVersion, operationId: request.operationId,
    } };
  }

  const exact = parseExactObject(request.payload, ['packId', 'completedCount', 'correctCount', 'wrongWordIds']);
  if (!exact.ok) return exact;
  const packId = requiredId(exact.value.packId, 'packId');
  if (!packId.ok) return packId;
  if (!isNonNegativeInteger(exact.value.completedCount)) return invalid('completedCount', '完成量必须是非负整数。');
  if (!isNonNegativeInteger(exact.value.correctCount)) return invalid('correctCount', '正确量必须是非负整数。');
  if (exact.value.correctCount > exact.value.completedCount) return invalid('correctCount', '正确量不能超过完成量。');
  const wrongWordIds = idArray(exact.value.wrongWordIds, 'wrongWordIds');
  if (!wrongWordIds.ok) return wrongWordIds;
  return { ok: true, value: {
    action: request.action, packId: packId.value, completedCount: exact.value.completedCount,
    correctCount: exact.value.correctCount, wrongWordIds: wrongWordIds.value,
    expectedVersion, operationId: request.operationId,
  } };
}

function idArray(value: unknown, field: string): ContractValidation<readonly string[]> {
  if (!Array.isArray(value) || value.length > 500) return invalid(field, '标识列表格式无效。');
  const ids: string[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = requiredId(item, `${field}[${index}]`);
    if (!parsed.ok) return parsed;
    ids.push(parsed.value);
  }
  return { ok: true, value: [...new Set(ids)] };
}

function requiredId(value: unknown, field: string): ContractValidation<string> {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) return invalid(field, '标识格式无效。');
  return { ok: true, value };
}

function isPositiveInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function invalid<T>(field: string, message: string): ContractValidation<T> { return { ok: false, fieldErrors: { [field]: message } }; }

