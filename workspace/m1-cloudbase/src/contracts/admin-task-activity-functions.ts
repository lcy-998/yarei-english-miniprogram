import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import type { ManagedFilters, ManagedKind } from '../admin-task-activity/types';

export const ADMIN_TASK_ACTIVITY_QUERY_ACTIONS = ['list', 'detail', 'exportCsv'] as const;
export const ADMIN_TASK_ACTIVITY_COMMAND_ACTIONS = ['stop'] as const;
export type AdminTaskActivityQueryAction = (typeof ADMIN_TASK_ACTIVITY_QUERY_ACTIONS)[number];
export type AdminTaskActivityCommandAction = (typeof ADMIN_TASK_ACTIVITY_COMMAND_ACTIONS)[number];
export type AdminTaskActivityQueryInput = { readonly action: 'list'; readonly filters: ManagedFilters;
  readonly page: Readonly<{ limit: number; offset: number }> }
  | { readonly action: 'exportCsv'; readonly filters: ManagedFilters }
  | { readonly action: 'detail'; readonly kind: ManagedKind; readonly id: string };
export type AdminTaskActivityCommandInput = { readonly action: 'stop'; readonly kind: ManagedKind;
  readonly id: string; readonly reason: string; readonly expectedVersion: number; readonly operationId: string };
type Validation<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };
const bad = <T>(field: string): Validation<T> => ({ ok: false, fieldErrors: { [field]: '字段格式无效。' } });
function isKind(value: unknown): value is ManagedKind {
  return value === 'classroom' || value === 'activity' || value === 'template';
}
function isId(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 128; }
function parseFilters(value: unknown): Validation<ManagedFilters> {
  const parsed = parseExactObject(value, ['startsOn', 'endsOn'], ['kind', 'status', 'keyword']);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  if (typeof record.startsOn !== 'string' || typeof record.endsOn !== 'string'
    || (record.kind !== undefined && !isKind(record.kind))
    || (record.status !== undefined && (typeof record.status !== 'string' || record.status.length > 30))
    || (record.keyword !== undefined && (typeof record.keyword !== 'string' || record.keyword.length > 100))) return bad('filters');
  return { ok: true, value: { startsOn: record.startsOn, endsOn: record.endsOn,
    ...(isKind(record.kind) ? { kind: record.kind } : {}),
    ...(typeof record.status === 'string' && record.status ? { status: record.status } : {}),
    ...(typeof record.keyword === 'string' && record.keyword ? { keyword: record.keyword } : {}) } };
}
export function validateAdminTaskActivityQueryRequest(
  request: FunctionRequest<AdminTaskActivityQueryAction, JsonObject>,
): Validation<AdminTaskActivityQueryInput> {
  if (request.operationId !== undefined || request.expectedVersion !== undefined) return bad('operationId');
  if (request.action === 'detail') {
    const parsed = parseExactObject(request.payload, ['kind', 'id']);
    return parsed.ok && isKind(parsed.value.kind) && isId(parsed.value.id)
      ? { ok: true, value: { action: 'detail', kind: parsed.value.kind, id: parsed.value.id } }
      : bad('id');
  }
  const parsed = request.action === 'list'
    ? parseExactObject(request.payload, ['filters', 'page'])
    : parseExactObject(request.payload, ['filters']);
  if (!parsed.ok) return parsed;
  const filters = parseFilters(parsed.value.filters);
  if (!filters.ok) return filters;
  if (request.action === 'exportCsv') return { ok: true, value: { action: 'exportCsv', filters: filters.value } };
  const page = parseExactObject(parsed.value.page, ['limit', 'offset']);
  if (!page.ok || !Number.isSafeInteger(page.value.limit) || !Number.isSafeInteger(page.value.offset)) return bad('page');
  return { ok: true, value: { action: 'list', filters: filters.value,
    page: { limit: Number(page.value.limit), offset: Number(page.value.offset) } } };
}
export function validateAdminTaskActivityCommandRequest(
  request: FunctionRequest<AdminTaskActivityCommandAction, JsonObject>,
): Validation<AdminTaskActivityCommandInput> {
  if (!isId(request.operationId) || !Number.isSafeInteger(request.expectedVersion)
    || Number(request.expectedVersion) < 1) return bad('expectedVersion');
  const parsed = parseExactObject(request.payload, ['kind', 'id', 'reason']);
  if (!parsed.ok) return parsed;
  if (!isKind(parsed.value.kind) || !isId(parsed.value.id) || typeof parsed.value.reason !== 'string'
    || !parsed.value.reason.trim() || parsed.value.reason.length > 200) return bad('reason');
  return { ok: true, value: { action: 'stop', kind: parsed.value.kind, id: parsed.value.id,
    reason: parsed.value.reason, expectedVersion: Number(request.expectedVersion), operationId: request.operationId } };
}
