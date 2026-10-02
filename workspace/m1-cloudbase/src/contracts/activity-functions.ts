import type { ActivityDraftInput } from '../activity/types';
import type { DailyCondition } from '../task-core/activity-rules';
import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { isRecord } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';

type Validation<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export const ACTIVITY_COMMAND_ACTIONS = ['saveDraft', 'publish', 'setOverride', 'addFutureRestDay'] as const;
export const ACTIVITY_QUERY_ACTIONS = ['listForTeacher', 'listForStudent', 'getForStudent', 'getMyDay', 'getOverrideForTeacher', 'getLeaderboard'] as const;
export type ActivityCommandAction = (typeof ACTIVITY_COMMAND_ACTIONS)[number];
export type ActivityQueryAction = (typeof ACTIVITY_QUERY_ACTIONS)[number];

export type ActivityCommandInput =
  | Readonly<{ action: 'saveDraft'; draft: ActivityDraftInput; operationId: string; expectedVersion: number }>
  | Readonly<{ action: 'publish'; activityId: string; operationId: string; expectedVersion: number }>
  | Readonly<{ action: 'addFutureRestDay'; activityId: string; date: string; reason: string;
      operationId: string; expectedVersion: number }>
  | Readonly<{ action: 'setOverride'; activityId: string; studentId: string; date: string;
      active: boolean; reason: string; operationId: string; expectedVersion: number }>;
export type ActivityQueryInput =
  | Readonly<{ action: 'listForTeacher' }>
  | Readonly<{ action: 'listForStudent' }>
  | Readonly<{ action: 'getForStudent'; activityId: string }>
  | Readonly<{ action: 'getMyDay'; activityId: string; date: string }>
  | Readonly<{ action: 'getOverrideForTeacher'; activityId: string; studentId: string; date: string }>
  | Readonly<{ action: 'getLeaderboard'; activityId: string }>;

function invalid<T>(field: string, message: string): Validation<T> {
  return { ok: false, fieldErrors: { [field]: message } };
}

function nonemptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.length <= maxLength;
}

function localDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function parseConditions(value: unknown): Validation<readonly DailyCondition[]> {
  if (!Array.isArray(value) || !value.length) return invalid('conditions', '每日条件至少选择一项。');
  const conditions: DailyCondition[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw) || !nonemptyString(raw.resourceId, 128)) return invalid(`conditions.${index}`, '每日条件无效。');
    const required = raw.kind === 'reading' || raw.kind === 'work' ? ['kind', 'resourceId']
      : raw.kind === 'vocabulary' ? ['kind', 'resourceId', 'requiredWordCount']
        : raw.kind === 'exercise' ? ['kind', 'resourceId', 'minimumScore'] : null;
    if (!required) return invalid(`conditions.${index}.kind`, '该条件尚未开放。');
    const exact = parseExactObject(raw, required);
    if (!exact.ok) return invalid(`conditions.${index}`, '每日条件包含不支持的字段。');
    if (raw.kind === 'reading') conditions.push({ kind: 'reading', resourceId: raw.resourceId });
    else if (raw.kind === 'work') conditions.push({ kind: 'work', resourceId: raw.resourceId });
    else if (raw.kind === 'vocabulary') {
      if (!Number.isSafeInteger(raw.requiredWordCount) || Number(raw.requiredWordCount) < 1) {
        return invalid(`conditions.${index}.requiredWordCount`, '单词数量无效。');
      }
      conditions.push({ kind: 'vocabulary', resourceId: raw.resourceId, requiredWordCount: Number(raw.requiredWordCount) });
    } else {
      if (typeof raw.minimumScore !== 'number' || !Number.isFinite(raw.minimumScore)
        || raw.minimumScore < 0 || raw.minimumScore > 100) {
        return invalid(`conditions.${index}.minimumScore`, '练习分数无效。');
      }
      conditions.push({ kind: 'exercise', resourceId: raw.resourceId, minimumScore: raw.minimumScore });
    }
  }
  return { ok: true, value: conditions };
}

export function validateActivityCommandRequest(request: FunctionRequest<ActivityCommandAction, JsonObject>): Validation<ActivityCommandInput> {
  if (request.operationId === undefined) return invalid('operationId', '写操作必须提供操作标识。');
  if (request.expectedVersion === undefined) return invalid('expectedVersion', '写操作必须提供当前版本。');
  if (request.action === 'publish') {
    const exact = parseExactObject(request.payload, ['activityId']);
    if (!exact.ok) return exact;
    if (!nonemptyString(exact.value.activityId, 128)) return invalid('activityId', '活动标识无效。');
    return { ok: true, value: { action: 'publish', activityId: exact.value.activityId,
      operationId: request.operationId, expectedVersion: request.expectedVersion } };
  }
  if (request.action === 'addFutureRestDay') {
    const exact = parseExactObject(request.payload, ['activityId', 'date', 'reason']);
    if (!exact.ok) return exact;
    if (!nonemptyString(exact.value.activityId, 128) || !localDate(exact.value.date)
      || !nonemptyString(exact.value.reason, 300)) return invalid('restDay', '休息日日期或变更原因无效。');
    return { ok: true, value: { action: 'addFutureRestDay', activityId: exact.value.activityId,
      date: exact.value.date, reason: exact.value.reason,
      operationId: request.operationId, expectedVersion: request.expectedVersion } };
  }
  if (request.action === 'setOverride') {
    const exact = parseExactObject(request.payload, ['activityId', 'studentId', 'date', 'active', 'reason']);
    if (!exact.ok) return exact;
    if (!nonemptyString(exact.value.activityId, 128) || !nonemptyString(exact.value.studentId, 128)
      || !localDate(exact.value.date) || typeof exact.value.active !== 'boolean'
      || !nonemptyString(exact.value.reason, 300)) return invalid('override', '补记或撤销参数无效。');
    return { ok: true, value: { action: 'setOverride', activityId: exact.value.activityId,
      studentId: exact.value.studentId, date: exact.value.date, active: exact.value.active,
      reason: exact.value.reason, operationId: request.operationId, expectedVersion: request.expectedVersion } };
  }
  const exact = parseExactObject(request.payload, ['title', 'classId', 'startsOn', 'endsOn', 'restDates', 'conditions'],
    ['activityId', 'description']);
  if (!exact.ok) return exact;
  if (!nonemptyString(exact.value.title, 50) || !nonemptyString(exact.value.classId, 128)
    || !localDate(exact.value.startsOn) || !localDate(exact.value.endsOn)) return invalid('draft', '活动名称、班级或日期无效。');
  if (exact.value.activityId !== undefined && !nonemptyString(exact.value.activityId, 128)) {
    return invalid('activityId', '活动标识无效。');
  }
  if (exact.value.description !== undefined && (typeof exact.value.description !== 'string'
    || exact.value.description.length > 300)) return invalid('description', '活动说明无效。');
  if (!Array.isArray(exact.value.restDates) || !exact.value.restDates.every(localDate)) {
    return invalid('restDates', '休息日期无效。');
  }
  const conditions = parseConditions(exact.value.conditions);
  if (!conditions.ok) return conditions;
  return { ok: true, value: { action: 'saveDraft', operationId: request.operationId,
    expectedVersion: request.expectedVersion,
    draft: { ...(exact.value.activityId === undefined ? {} : { activityId: exact.value.activityId as string }),
      title: exact.value.title, classId: exact.value.classId, startsOn: exact.value.startsOn,
      endsOn: exact.value.endsOn, restDates: exact.value.restDates as string[], conditions: conditions.value,
      ...(exact.value.description === undefined ? {} : { description: exact.value.description as string }) } } };
}

export function validateActivityQueryRequest(request: FunctionRequest<ActivityQueryAction, JsonObject>): Validation<ActivityQueryInput> {
  if (request.operationId !== undefined) return invalid('operationId', '查询不接受写操作参数。');
  if (request.expectedVersion !== undefined) return invalid('expectedVersion', '查询不接受写操作参数。');
  if (request.action === 'listForTeacher' || request.action === 'listForStudent') {
    const exact = parseExactObject(request.payload, []);
    return exact.ok ? { ok: true, value: { action: request.action } } : exact;
  }
  const exact = parseExactObject(request.payload, request.action === 'getMyDay' ? ['activityId', 'date']
    : request.action === 'getOverrideForTeacher' ? ['activityId', 'studentId', 'date'] : ['activityId']);
  if (!exact.ok) return exact;
  if (!nonemptyString(exact.value.activityId, 128)) return invalid('activityId', '活动标识无效。');
  if (request.action === 'getMyDay') {
    if (!localDate(exact.value.date)) return invalid('date', '业务日期无效。');
    return { ok: true, value: { action: 'getMyDay', activityId: exact.value.activityId, date: exact.value.date } };
  }
  if (request.action === 'getOverrideForTeacher') {
    if (!nonemptyString(exact.value.studentId, 128) || !localDate(exact.value.date)) {
      return invalid('override', '补记记录查询参数无效。');
    }
    return { ok: true, value: { action: 'getOverrideForTeacher', activityId: exact.value.activityId,
      studentId: exact.value.studentId, date: exact.value.date } };
  }
  return { ok: true, value: { action: request.action, activityId: exact.value.activityId } };
}
