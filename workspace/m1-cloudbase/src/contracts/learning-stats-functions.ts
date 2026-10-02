import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import type { StatsFilters } from '../learning-stats/types';

export const LEARNING_STATS_ACTIONS = ['teacherReport', 'parentReport', 'exportTeacherCsv'] as const;
export type LearningStatsAction = (typeof LEARNING_STATS_ACTIONS)[number];
export type LearningStatsInput = Readonly<{ action: 'teacherReport'; filters: StatsFilters }>
  | Readonly<{ action: 'exportTeacherCsv'; filters: StatsFilters }>
  | Readonly<{ action: 'parentReport'; childId: string; filters: StatsFilters }>;
type Validation<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export function validateLearningStatsRequest(
  request: FunctionRequest<LearningStatsAction, JsonObject>,
): Validation<LearningStatsInput> {
  if (request.operationId !== undefined || request.expectedVersion !== undefined) {
    return { ok: false, fieldErrors: { operationId: '统计查询不接受写操作字段。' } };
  }
  const exact = request.action === 'parentReport'
    ? parseExactObject(request.payload, ['childId', 'filters'])
    : parseExactObject(request.payload, ['filters']);
  if (!exact.ok) return exact;
  const childId = exact.value.childId;
  if (request.action === 'parentReport' && (typeof childId !== 'string' || !childId.trim() || childId.length > 128)) {
    return { ok: false, fieldErrors: { childId: '孩子标识无效。' } };
  }
  const parsed = parseExactObject(exact.value.filters, ['startsOn', 'endsOn'], ['classId', 'studentId']);
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.fieldErrors };
  const value = parsed.value;
  if (typeof value.startsOn !== 'string' || typeof value.endsOn !== 'string'
    || (value.classId !== undefined && (typeof value.classId !== 'string' || value.classId.length > 128))
    || (value.studentId !== undefined && (typeof value.studentId !== 'string' || value.studentId.length > 128))) {
    return { ok: false, fieldErrors: { filters: '统计条件无效。' } };
  }
  const filters: StatsFilters = { startsOn: value.startsOn, endsOn: value.endsOn,
    ...(typeof value.classId === 'string' && value.classId ? { classId: value.classId } : {}),
    ...(typeof value.studentId === 'string' && value.studentId ? { studentId: value.studentId } : {}) };
  return request.action === 'parentReport'
    ? { ok: true, value: { action: 'parentReport', childId: childId as string, filters } }
    : { ok: true, value: { action: request.action, filters } };
}
