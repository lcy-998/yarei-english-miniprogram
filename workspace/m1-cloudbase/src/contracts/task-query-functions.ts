import type { FunctionRequest, JsonObject, JsonValue } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import type {
  CompletionFilters,
  DraftPreviewInput,
  PageRequest,
  ReviewTaskFilters,
  StudentTaskFilters,
  TeacherTaskFilters,
} from '../task-query/types';

export const TASK_QUERY_ACTIONS = ['getTeacherWorkbench', 'listTeacherTasks', 'getDraftOptions', 'previewTask', 'getCompletion'] as const;
export type TaskQueryAction = (typeof TASK_QUERY_ACTIONS)[number];
export const STUDENT_TASK_QUERY_ACTIONS = ['getHome', 'listMyTasks', 'getMyTask'] as const;
export type StudentTaskQueryAction = (typeof STUDENT_TASK_QUERY_ACTIONS)[number];
export const REVIEW_QUERY_ACTIONS = ['listReviewTasks', 'getSubmissionForReview', 'previewBatchComment'] as const;
export type ReviewQueryAction = (typeof REVIEW_QUERY_ACTIONS)[number];

type Valid<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export type TaskQueryInput =
  | Readonly<{ action: 'getTeacherWorkbench'; date: string; classId?: string }>
  | Readonly<{ action: 'listTeacherTasks'; filters: TeacherTaskFilters; page: PageRequest }>
  | Readonly<{ action: 'getDraftOptions' }>
  | Readonly<{ action: 'previewTask'; preview: Readonly<{ taskId: string; expectedVersion: number }> | Readonly<{ draft: DraftPreviewInput }> }>
  | Readonly<{ action: 'getCompletion'; taskId: string; filter: CompletionFilters; page: PageRequest }>;

export type StudentTaskQueryInput =
  | Readonly<{ action: 'getHome'; localDate: string }>
  | Readonly<{ action: 'listMyTasks'; filters: StudentTaskFilters; page: PageRequest }>
  | Readonly<{ action: 'getMyTask'; taskId: string }>;

export type ReviewQueryInput =
  | Readonly<{ action: 'listReviewTasks'; filters: ReviewTaskFilters; page: PageRequest }>
  | Readonly<{ action: 'getSubmissionForReview'; submissionId: string }>
  | Readonly<{
      action: 'previewBatchComment';
      taskId: string;
      filter: CompletionFilters;
      selection: Readonly<{ mode: 'eligible' | 'ids'; submissionIds: readonly string[] }>;
      comment: string;
    }>;

export function validateTaskQueryRequest(request: FunctionRequest<TaskQueryAction, JsonObject>): Valid<TaskQueryInput> {
  const top = queryTop(request);
  if (!top.ok) return top;
  if (request.action === 'getTeacherWorkbench') {
    const exact = parseExactObject(request.payload, ['date'], ['classId']);
    if (!exact.ok) return exact;
    const date = localDate(exact.value.date, 'date');
    if (!date.ok) return date;
    const classId = optionalId(exact.value.classId, 'classId');
    if (!classId.ok) return classId;
    return { ok: true, value: { action: request.action, date: date.value, ...(classId.value === undefined ? {} : { classId: classId.value }) } };
  }
  if (request.action === 'listTeacherTasks') {
    const exact = parseExactObject(request.payload, ['filters', 'page']);
    if (!exact.ok) return exact;
    const filters = teacherFilters(exact.value.filters);
    if (!filters.ok) return filters;
    const page = pageRequest(exact.value.page);
    if (!page.ok) return page;
    return { ok: true, value: { action: request.action, filters: filters.value, page: page.value } };
  }
  if (request.action === 'getDraftOptions') {
    const exact = parseExactObject(request.payload, []);
    return exact.ok ? { ok: true, value: { action: request.action } } : exact;
  }
  if (request.action === 'previewTask') {
    if ('taskId' in request.payload) {
      const exact = parseExactObject(request.payload, ['taskId']);
      if (!exact.ok) return exact;
      if (request.expectedVersion === undefined) return invalid('expectedVersion', '预览已保存任务必须提供当前版本。');
      const taskId = requiredId(exact.value.taskId, 'taskId');
      if (!taskId.ok) return taskId;
      return { ok: true, value: { action: request.action, preview: { taskId: taskId.value, expectedVersion: request.expectedVersion } } };
    }
    if (request.expectedVersion !== undefined) return invalid('expectedVersion', '预览未保存草稿不应提供版本号。');
    const draft = draftPreview(request.payload);
    return draft.ok ? { ok: true, value: { action: request.action, preview: { draft: draft.value } } } : draft;
  }
  const exact = parseExactObject(request.payload, ['taskId', 'filter', 'page']);
  if (!exact.ok) return exact;
  const taskId = requiredId(exact.value.taskId, 'taskId');
  if (!taskId.ok) return taskId;
  const filter = completionFilters(exact.value.filter);
  if (!filter.ok) return filter;
  const page = pageRequest(exact.value.page);
  if (!page.ok) return page;
  return { ok: true, value: { action: request.action, taskId: taskId.value, filter: filter.value, page: page.value } };
}

export function validateStudentTaskQueryRequest(request: FunctionRequest<StudentTaskQueryAction, JsonObject>): Valid<StudentTaskQueryInput> {
  const top = queryTop(request);
  if (!top.ok) return top;
  if (request.action === 'getHome') {
    const exact = parseExactObject(request.payload, ['localDate']);
    if (!exact.ok) return exact;
    const date = localDate(exact.value.localDate, 'localDate');
    return date.ok ? { ok: true, value: { action: request.action, localDate: date.value } } : date;
  }
  if (request.action === 'getMyTask') {
    const exact = parseExactObject(request.payload, ['taskId']);
    if (!exact.ok) return exact;
    const taskId = requiredId(exact.value.taskId, 'taskId');
    return taskId.ok ? { ok: true, value: { action: request.action, taskId: taskId.value } } : taskId;
  }
  const exact = parseExactObject(request.payload, ['filters', 'page']);
  if (!exact.ok) return exact;
  const filters = studentFilters(exact.value.filters);
  if (!filters.ok) return filters;
  const page = pageRequest(exact.value.page);
  if (!page.ok) return page;
  return { ok: true, value: { action: request.action, filters: filters.value, page: page.value } };
}

export function validateReviewQueryRequest(request: FunctionRequest<ReviewQueryAction, JsonObject>): Valid<ReviewQueryInput> {
  const top = queryTop(request);
  if (!top.ok) return top;
  if (request.action === 'getSubmissionForReview') {
    const exact = parseExactObject(request.payload, ['submissionId']);
    if (!exact.ok) return exact;
    const submissionId = requiredId(exact.value.submissionId, 'submissionId');
    return submissionId.ok ? { ok: true, value: { action: request.action, submissionId: submissionId.value } } : submissionId;
  }
  if (request.action === 'listReviewTasks') {
    const exact = parseExactObject(request.payload, ['filters', 'page']);
    if (!exact.ok) return exact;
    const filters = reviewFilters(exact.value.filters);
    if (!filters.ok) return filters;
    const page = pageRequest(exact.value.page);
    if (!page.ok) return page;
    return { ok: true, value: { action: request.action, filters: filters.value, page: page.value } };
  }
  const exact = parseExactObject(request.payload, ['taskId', 'filter', 'selection', 'comment']);
  if (!exact.ok) return exact;
  const taskId = requiredId(exact.value.taskId, 'taskId');
  if (!taskId.ok) return taskId;
  const filter = completionFilters(exact.value.filter);
  if (!filter.ok) return filter;
  const selection = batchSelection(exact.value.selection);
  if (!selection.ok) return selection;
  const comment = boundedString(exact.value.comment, 'comment', 1, 300);
  if (!comment.ok) return comment;
  return { ok: true, value: { action: request.action, taskId: taskId.value, filter: filter.value, selection: selection.value, comment: comment.value } };
}

function queryTop(request: FunctionRequest<string, JsonObject>): Valid<true> {
  if (request.operationId !== undefined) return invalid('operationId', '查询操作不支持操作标识。');
  if (request.action !== 'previewTask' && request.expectedVersion !== undefined) return invalid('expectedVersion', '查询操作不支持版本号。');
  return { ok: true, value: true };
}

function teacherFilters(value: unknown): Valid<TeacherTaskFilters> {
  const exact = parseExactObject(value, [], ['classId', 'status', 'keyword']);
  if (!exact.ok) return prefix('filters', exact.fieldErrors);
  const classId = optionalId(exact.value.classId, 'filters.classId');
  if (!classId.ok) return classId;
  const statuses = ['draft', 'scheduled', 'active', 'expired', 'withdrawn', 'closed', 'completed'] as const;
  if (exact.value.status !== undefined && !statuses.includes(exact.value.status as typeof statuses[number])) return invalid('filters.status', '任务状态无效。');
  const keyword = optionalBoundedString(exact.value.keyword, 'filters.keyword', 50);
  if (!keyword.ok) return keyword;
  return { ok: true, value: { ...(classId.value === undefined ? {} : { classId: classId.value }), ...(exact.value.status === undefined ? {} : { status: exact.value.status as typeof statuses[number] }), ...(keyword.value === undefined ? {} : { keyword: keyword.value }) } };
}

function studentFilters(value: unknown): Valid<StudentTaskFilters> {
  const exact = parseExactObject(value, [], ['status', 'keyword']);
  if (!exact.ok) return prefix('filters', exact.fieldErrors);
  const status = assignmentStatus(exact.value.status, 'filters.status');
  if (!status.ok) return status;
  const keyword = optionalBoundedString(exact.value.keyword, 'filters.keyword', 50);
  if (!keyword.ok) return keyword;
  return { ok: true, value: { ...(status.value === undefined ? {} : { status: status.value }), ...(keyword.value === undefined ? {} : { keyword: keyword.value }) } };
}

function reviewFilters(value: unknown): Valid<ReviewTaskFilters> {
  const exact = parseExactObject(value, [], ['classId', 'status', 'keyword']);
  if (!exact.ok) return prefix('filters', exact.fieldErrors);
  const classId = optionalId(exact.value.classId, 'filters.classId');
  if (!classId.ok) return classId;
  if (exact.value.status !== undefined && exact.value.status !== 'pending' && exact.value.status !== 'reviewed') return invalid('filters.status', '点评状态无效。');
  const keyword = optionalBoundedString(exact.value.keyword, 'filters.keyword', 50);
  if (!keyword.ok) return keyword;
  return { ok: true, value: { ...(classId.value === undefined ? {} : { classId: classId.value }), ...(exact.value.status === undefined ? {} : { status: exact.value.status }), ...(keyword.value === undefined ? {} : { keyword: keyword.value }) } };
}

function completionFilters(value: unknown): Valid<CompletionFilters> {
  const exact = parseExactObject(value, [], ['classId', 'status']);
  if (!exact.ok) return prefix('filter', exact.fieldErrors);
  const classId = optionalId(exact.value.classId, 'filter.classId');
  if (!classId.ok) return classId;
  const status = assignmentStatus(exact.value.status, 'filter.status');
  if (!status.ok) return status;
  return { ok: true, value: { ...(classId.value === undefined ? {} : { classId: classId.value }), ...(status.value === undefined ? {} : { status: status.value }) } };
}

function pageRequest(value: unknown): Valid<PageRequest> {
  const exact = parseExactObject(value, ['limit'], ['cursor']);
  if (!exact.ok) return prefix('page', exact.fieldErrors);
  if (typeof exact.value.limit !== 'number' || !Number.isInteger(exact.value.limit) || exact.value.limit < 1 || exact.value.limit > 100) return invalid('page.limit', '分页大小必须是 1 到 100 的整数。');
  const cursor = optionalBoundedString(exact.value.cursor, 'page.cursor', 128);
  if (!cursor.ok) return cursor;
  return { ok: true, value: { limit: exact.value.limit, ...(cursor.value === undefined ? {} : { cursor: cursor.value }) } };
}

function draftPreview(value: unknown): Valid<DraftPreviewInput> {
  const exact = parseExactObject(value, ['title', 'items', 'targetClassIds', 'startsAt', 'dueAt'], ['description']);
  if (!exact.ok) return exact;
  const title = boundedString(exact.value.title, 'title', 1, 50);
  if (!title.ok) return title;
  const description = optionalBoundedString(exact.value.description, 'description', 300);
  if (!description.ok) return description;
  const classIds = idArray(exact.value.targetClassIds, 'targetClassIds', false);
  if (!classIds.ok) return classIds;
  const startsAt = offsetIso(exact.value.startsAt, 'startsAt');
  if (!startsAt.ok) return startsAt;
  const dueAt = offsetIso(exact.value.dueAt, 'dueAt');
  if (!dueAt.ok) return dueAt;
  if (Date.parse(startsAt.value) >= Date.parse(dueAt.value)) return invalid('dueAt', '截止时间必须晚于开始时间。');
  if (!Array.isArray(exact.value.items) || exact.value.items.length === 0) return invalid('items', '任务内容至少包含一项。');
  const items: DraftPreviewInput['items'][number][] = [];
  for (const [index, item] of exact.value.items.entries()) {
    const parsed = parseExactObject(item, ['id', 'resourceId', 'title', 'type', 'completionRule', 'scoringRule', 'order']);
    if (!parsed.ok) return prefix(`items[${index}]`, parsed.fieldErrors);
    const id = requiredId(parsed.value.id, `items[${index}].id`);
    if (!id.ok) return id;
    const resourceId = requiredId(parsed.value.resourceId, `items[${index}].resourceId`);
    if (!resourceId.ok) return resourceId;
    const itemTitle = boundedString(parsed.value.title, `items[${index}].title`, 1, 100);
    if (!itemTitle.ok) return itemTitle;
    if (parsed.value.type !== 'reading' && parsed.value.type !== 'vocabulary' && parsed.value.type !== 'exercise') return invalid(`items[${index}].type`, '内容类型无效。');
    const completionRule = jsonObject(parsed.value.completionRule, `items[${index}].completionRule`);
    if (!completionRule.ok) return completionRule;
    const scoringRule = jsonObject(parsed.value.scoringRule, `items[${index}].scoringRule`);
    if (!scoringRule.ok) return scoringRule;
    if (typeof parsed.value.order !== 'number' || !Number.isInteger(parsed.value.order) || parsed.value.order < 1) return invalid(`items[${index}].order`, '排序值必须是正整数。');
    items.push({ id: id.value, resourceId: resourceId.value, title: itemTitle.value, type: parsed.value.type, completionRule: completionRule.value, scoringRule: scoringRule.value, order: parsed.value.order });
  }
  return { ok: true, value: { title: title.value, ...(description.value === undefined ? {} : { description: description.value }), targetClassIds: classIds.value, startsAt: startsAt.value, dueAt: dueAt.value, items } };
}

function batchSelection(value: unknown): Valid<Readonly<{ mode: 'eligible' | 'ids'; submissionIds: readonly string[] }>> {
  const exact = parseExactObject(value, ['mode'], ['submissionIds']);
  if (!exact.ok) return prefix('selection', exact.fieldErrors);
  if (exact.value.mode !== 'eligible' && exact.value.mode !== 'ids') return invalid('selection.mode', '选择模式无效。');
  const ids = exact.value.submissionIds === undefined
    ? { ok: true as const, value: [] as readonly string[] }
    : idArray(exact.value.submissionIds, 'selection.submissionIds', true);
  if (!ids.ok) return ids;
  if (exact.value.mode === 'ids' && ids.value.length === 0) return invalid('selection.submissionIds', '按标识选择时至少选择一条提交。');
  if (exact.value.mode === 'eligible' && ids.value.length > 0) return invalid('selection.submissionIds', '选择全部符合条件项时不应提供提交标识。');
  return { ok: true, value: { mode: exact.value.mode, submissionIds: ids.value } };
}

const ASSIGNMENT_STATUSES = ['not_started', 'in_progress', 'awaiting_review', 'completed', 'redo_required', 'overdue'] as const;
function assignmentStatus(value: unknown, field: string): Valid<typeof ASSIGNMENT_STATUSES[number] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return typeof value === 'string' && ASSIGNMENT_STATUSES.includes(value as typeof ASSIGNMENT_STATUSES[number])
    ? { ok: true, value: value as typeof ASSIGNMENT_STATUSES[number] }
    : invalid(field, '学生任务状态无效。');
}

function localDate(value: unknown, field: string): Valid<string> {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
    ? { ok: true, value }
    : invalid(field, '日期格式必须为 YYYY-MM-DD。');
}

function offsetIso(value: unknown, field: string): Valid<string> {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
    ? { ok: true, value }
    : invalid(field, '时间必须是带时区的 ISO 8601 字符串。');
}

function requiredId(value: unknown, field: string): Valid<string> {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128 ? { ok: true, value } : invalid(field, '标识格式无效。');
}

function optionalId(value: unknown, field: string): Valid<string | undefined> {
  return value === undefined ? { ok: true, value: undefined } : requiredId(value, field);
}

function idArray(value: unknown, field: string, allowEmpty: boolean): Valid<readonly string[]> {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 100) return invalid(field, '标识列表格式无效。');
  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    const id = requiredId(item, `${field}[${index}]`);
    if (!id.ok) return id;
    if (result.includes(id.value)) return invalid(`${field}[${index}]`, '标识不能重复。');
    result.push(id.value);
  }
  return { ok: true, value: result };
}

function boundedString(value: unknown, field: string, min: number, max: number): Valid<string> {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max ? { ok: true, value } : invalid(field, `字段长度必须为 ${min} 到 ${max} 个字符。`);
}

function optionalBoundedString(value: unknown, field: string, max: number): Valid<string | undefined> {
  return value === undefined ? { ok: true, value: undefined } : boundedString(value, field, 0, max);
}

function jsonObject(value: unknown, field: string): Valid<JsonObject> {
  const parsed = jsonValue(value, field, new Set<object>());
  if (!parsed.ok) return parsed;
  return parsed.value !== null && typeof parsed.value === 'object' && !Array.isArray(parsed.value)
    ? { ok: true, value: parsed.value as JsonObject }
    : invalid(field, '字段必须是 JSON 对象。');
}

function jsonValue(value: unknown, field: string, ancestors: Set<object>): Valid<JsonValue> {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'number') return Number.isFinite(value) ? { ok: true, value } : invalid(field, '数字必须是有限值。');
  if (typeof value !== 'object') return invalid(field, '字段必须是有效 JSON 值。');
  if (ancestors.has(value)) return invalid(field, 'JSON 值不能循环引用。');
  ancestors.add(value);
  if (Array.isArray(value)) {
    const output: JsonValue[] = [];
    for (const [index, item] of value.entries()) {
      const parsed = jsonValue(item, `${field}[${index}]`, ancestors);
      if (!parsed.ok) return parsed;
      output.push(parsed.value);
    }
    ancestors.delete(value);
    return { ok: true, value: output };
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return invalid(field, '字段必须是普通 JSON 对象。');
  const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, item] of Object.entries(value)) {
    const parsed = jsonValue(item, `${field}.${key}`, ancestors);
    if (!parsed.ok) return parsed;
    output[key] = parsed.value;
  }
  ancestors.delete(value);
  return { ok: true, value: output };
}

function prefix<T>(base: string, errors: Readonly<Record<string, string>>): Valid<T> {
  return { ok: false, fieldErrors: Object.fromEntries(Object.entries(errors).map(([field, message]) => [field === 'payload' ? base : `${base}.${field}`, message])) };
}

function invalid<T>(field: string, message: string): Valid<T> {
  return { ok: false, fieldErrors: { [field]: message } };
}
