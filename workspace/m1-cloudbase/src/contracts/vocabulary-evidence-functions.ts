import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import type { VocabularyAttemptInput } from '../vocabulary-evidence/service';

type Validation<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export const VOCABULARY_EVIDENCE_COMMAND_ACTIONS = ['submitWordAnswer'] as const;
export const VOCABULARY_EVIDENCE_QUERY_ACTIONS = ['getWordAttemptState', 'getPackAttemptSummary'] as const;
export type VocabularyEvidenceCommandAction = (typeof VOCABULARY_EVIDENCE_COMMAND_ACTIONS)[number];
export type VocabularyEvidenceQueryAction = (typeof VOCABULARY_EVIDENCE_QUERY_ACTIONS)[number];
export type VocabularyEvidenceCommandInput = Readonly<{ action: 'submitWordAnswer'; input: VocabularyAttemptInput;
  expectedVersion: number; operationId: string }>;
export type VocabularyEvidenceQueryInput = Readonly<{ action: 'getWordAttemptState';
  input: Omit<VocabularyAttemptInput, 'studentInput'> }>
  | Readonly<{ action: 'getPackAttemptSummary'; input: Readonly<{ packId: string; taskId?: string; itemId?: string }> }>;

function invalid<T>(field: string, message: string): Validation<T> {
  return { ok: false, fieldErrors: { [field]: message } };
}

function stringId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

function scopeFields(value: Readonly<Record<string, unknown>>): Validation<Readonly<{
  packId: string; wordId: string; taskId?: string; itemId?: string }>> {
  if (!stringId(value.packId) || !stringId(value.wordId)) return invalid('word', '词包或词条标识无效。');
  if ((value.taskId === undefined) !== (value.itemId === undefined)) return invalid('taskId', '任务与任务项须同时提供。');
  if (value.taskId !== undefined && (!stringId(value.taskId) || !stringId(value.itemId))) {
    return invalid('taskId', '任务或任务项标识无效。');
  }
  return { ok: true, value: { packId: value.packId, wordId: value.wordId,
    ...(value.taskId === undefined ? {} : { taskId: value.taskId as string, itemId: value.itemId as string }) } };
}

export function validateVocabularyEvidenceCommandRequest(
  request: FunctionRequest<VocabularyEvidenceCommandAction, JsonObject>,
): Validation<VocabularyEvidenceCommandInput> {
  if (request.operationId === undefined) return invalid('operationId', '作答必须提供操作标识。');
  if (request.expectedVersion === undefined) return invalid('expectedVersion', '作答必须提供当前版本。');
  const exact = parseExactObject(request.payload, ['packId', 'wordId', 'studentInput'], ['taskId', 'itemId']);
  if (!exact.ok) return exact;
  const scope = scopeFields(exact.value);
  if (!scope.ok) return scope;
  if (typeof exact.value.studentInput !== 'string' || !exact.value.studentInput.trim()
    || exact.value.studentInput.length > 100) return invalid('studentInput', '请填写有效拼写答案。');
  return { ok: true, value: { action: 'submitWordAnswer', operationId: request.operationId,
    expectedVersion: request.expectedVersion, input: { ...scope.value, studentInput: exact.value.studentInput } } };
}

export function validateVocabularyEvidenceQueryRequest(
  request: FunctionRequest<VocabularyEvidenceQueryAction, JsonObject>,
): Validation<VocabularyEvidenceQueryInput> {
  if (request.operationId !== undefined) return invalid('operationId', '查询不接受写操作标识。');
  if (request.expectedVersion !== undefined) return invalid('expectedVersion', '查询不接受写操作版本。');
  if (request.action === 'getPackAttemptSummary') {
    const exactPack = parseExactObject(request.payload, ['packId'], ['taskId', 'itemId']);
    if (!exactPack.ok) return exactPack;
    if (!stringId(exactPack.value.packId)
      || (exactPack.value.taskId === undefined) !== (exactPack.value.itemId === undefined)
      || (exactPack.value.taskId !== undefined
        && (!stringId(exactPack.value.taskId) || !stringId(exactPack.value.itemId)))) {
      return invalid('packId', '词包或任务范围无效。');
    }
    return { ok: true, value: { action: 'getPackAttemptSummary', input: {
      packId: exactPack.value.packId,
      ...(exactPack.value.taskId === undefined ? {} : { taskId: exactPack.value.taskId as string,
        itemId: exactPack.value.itemId as string }),
    } } };
  }
  const exact = parseExactObject(request.payload, ['packId', 'wordId'], ['taskId', 'itemId']);
  if (!exact.ok) return exact;
  const scope = scopeFields(exact.value);
  return scope.ok ? { ok: true, value: { action: 'getWordAttemptState', input: scope.value } } : scope;
}
