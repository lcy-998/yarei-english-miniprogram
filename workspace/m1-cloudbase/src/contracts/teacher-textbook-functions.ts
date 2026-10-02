import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import type { TextbookListFilters, TextbookSaveInput } from '../textbook/service';

type Validation<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };
export const TEACHER_TEXTBOOK_QUERY_ACTIONS = ['getCenterSettings', 'listClasses', 'getClass', 'listTextbooks', 'getTextbook'] as const;
export const TEACHER_TEXTBOOK_COMMAND_ACTIONS = ['saveClassTextbooks', 'publishClassTextbooks'] as const;
export type TeacherTextbookQueryAction = (typeof TEACHER_TEXTBOOK_QUERY_ACTIONS)[number];
export type TeacherTextbookCommandAction = (typeof TEACHER_TEXTBOOK_COMMAND_ACTIONS)[number];
export type TeacherTextbookQueryInput = Readonly<{ action: 'getCenterSettings' | 'listClasses' }>
  | Readonly<{ action: 'getClass'; classId: string }>
  | Readonly<{ action: 'listTextbooks'; filters: TextbookListFilters; page: { limit: number; offset: number }; targetClassId?: string }>
  | Readonly<{ action: 'getTextbook'; textbookId: string; targetClassId?: string }>;
export type TeacherTextbookCommandInput = Readonly<{ action: TeacherTextbookCommandAction;
  input: TextbookSaveInput; expectedVersion: number; operationId: string }>;
function invalid<T>(field: string): Validation<T> { return { ok: false, fieldErrors: { [field]: '字段格式无效。' } }; }
function id(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 128; }
function optionalString(value: unknown, maximumLength = 100): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length <= maximumLength);
}

export function validateTeacherTextbookQueryRequest(request: FunctionRequest<TeacherTextbookQueryAction, JsonObject>):
  Validation<TeacherTextbookQueryInput> {
  if (request.operationId !== undefined || request.expectedVersion !== undefined) return invalid('operationId');
  if (request.action === 'listClasses' || request.action === 'getCenterSettings') {
    const exact = parseExactObject(request.payload, []);
    return exact.ok ? { ok: true, value: { action: request.action } } : exact;
  }
  if (request.action === 'getClass') {
    const exact = parseExactObject(request.payload, ['classId']);
    return exact.ok && id(exact.value.classId) ? { ok: true, value: { action: 'getClass', classId: exact.value.classId } }
      : invalid('classId');
  }
  if (request.action === 'getTextbook') {
    const exact = parseExactObject(request.payload, ['textbookId'], ['targetClassId']);
    return exact.ok && id(exact.value.textbookId) && (exact.value.targetClassId === undefined || id(exact.value.targetClassId))
      ? { ok: true, value: { action: 'getTextbook', textbookId: exact.value.textbookId,
        ...(exact.value.targetClassId === undefined ? {} : { targetClassId: exact.value.targetClassId }) } }
      : invalid('textbookId');
  }
  const exact = parseExactObject(request.payload, ['filters', 'page'], ['targetClassId']);
  if (!exact.ok) return exact;
  const filters = parseExactObject(exact.value.filters, [], ['grade', 'term', 'edition', 'unit', 'lesson', 'keyword']);
  const page = parseExactObject(exact.value.page, ['limit', 'offset']);
  if (!filters.ok || !page.ok || !optionalString(filters.value.grade) || !optionalString(filters.value.term)
    || !optionalString(filters.value.edition) || !optionalString(filters.value.unit)
    || !optionalString(filters.value.lesson) || !optionalString(filters.value.keyword)
    || (exact.value.targetClassId !== undefined && !id(exact.value.targetClassId))
    || !Number.isSafeInteger(page.value.limit) || Number(page.value.limit) < 1 || Number(page.value.limit) > 50
    || !Number.isSafeInteger(page.value.offset) || Number(page.value.offset) < 0 || Number(page.value.offset) > 10000) {
    return invalid('filters');
  }
  return { ok: true, value: { action: 'listTextbooks', filters: filters.value as TextbookListFilters,
    page: { limit: Number(page.value.limit), offset: Number(page.value.offset) },
    ...(exact.value.targetClassId === undefined ? {} : { targetClassId: exact.value.targetClassId }) } };
}

export function validateTeacherTextbookCommandRequest(request: FunctionRequest<TeacherTextbookCommandAction, JsonObject>):
  Validation<TeacherTextbookCommandInput> {
  if (!request.operationId || !Number.isSafeInteger(request.expectedVersion) || Number(request.expectedVersion) < 0) {
    return invalid('expectedVersion');
  }
  const exact = parseExactObject(request.payload, ['classId', 'textbooks', 'note']);
  if (!exact.ok) return exact;
  if (!id(exact.value.classId) || !Array.isArray(exact.value.textbooks)
    || exact.value.textbooks.length > 20 || typeof exact.value.note !== 'string' || exact.value.note.length > 100) {
    return invalid('textbooks');
  }
  const textbooks: TextbookSaveInput['textbooks'][number][] = [];
  for (const item of exact.value.textbooks) {
    const parsed = parseExactObject(item, ['textbookId', 'chapterIds', 'lessonIds', 'contentVersion']);
    if (!parsed.ok || !id(parsed.value.textbookId) || typeof parsed.value.contentVersion !== 'string'
      || !Array.isArray(parsed.value.chapterIds) || !parsed.value.chapterIds.every(id)
      || !Array.isArray(parsed.value.lessonIds) || !parsed.value.lessonIds.every(id)) return invalid('textbooks');
    textbooks.push({ textbookId: parsed.value.textbookId, chapterIds: parsed.value.chapterIds,
      lessonIds: parsed.value.lessonIds, contentVersion: parsed.value.contentVersion });
  }
  return { ok: true, value: { action: request.action,
    input: { classId: exact.value.classId, textbooks, note: exact.value.note },
    expectedVersion: Number(request.expectedVersion), operationId: request.operationId } };
}
