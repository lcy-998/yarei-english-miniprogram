import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import type { NotificationFilter } from '../notification/service';

type Validation<T> = { readonly ok: true; readonly value: T } | {
  readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export const NOTIFICATION_QUERY_ACTIONS = ['list'] as const;
export const NOTIFICATION_COMMAND_ACTIONS = ['markRead', 'markAllRead'] as const;
export type NotificationQueryAction = (typeof NOTIFICATION_QUERY_ACTIONS)[number];
export type NotificationCommandAction = (typeof NOTIFICATION_COMMAND_ACTIONS)[number];
export type NotificationQueryInput = Readonly<{ filter: NotificationFilter; offset: number; limit: number; days: 7 | 30 | 90 }>;
export type NotificationCommandInput = Readonly<{ action: 'markRead'; noticeId: string }>
  | Readonly<{ action: 'markAllRead' }>;

function invalid<T>(field: string): Validation<T> {
  return { ok: false, fieldErrors: { [field]: '通知参数无效。' } };
}

export function validateNotificationQueryRequest(request: FunctionRequest<NotificationQueryAction, JsonObject>): Validation<NotificationQueryInput> {
  if (request.operationId !== undefined || request.expectedVersion !== undefined) return invalid('request');
  const exact = parseExactObject(request.payload, ['filter', 'offset', 'limit', 'days']);
  if (!exact.ok) return exact;
  const { filter, offset, limit, days } = exact.value;
  if (!['all', 'task', 'feedback', 'checkin'].includes(String(filter))
    || !Number.isSafeInteger(offset) || Number(offset) < 0
    || !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 50
    || ![7, 30, 90].includes(Number(days))) return invalid('payload');
  return { ok: true, value: { filter: filter as NotificationFilter, offset: Number(offset), limit: Number(limit),
    days: Number(days) as 7 | 30 | 90 } };
}

export function validateNotificationCommandRequest(request: FunctionRequest<NotificationCommandAction, JsonObject>): Validation<NotificationCommandInput> {
  if (request.operationId === undefined || request.operationId.trim().length < 8
    || request.expectedVersion !== undefined) return invalid('operationId');
  if (request.action === 'markAllRead') {
    const exact = parseExactObject(request.payload, []);
    return exact.ok ? { ok: true, value: { action: 'markAllRead' } } : exact;
  }
  const exact = parseExactObject(request.payload, ['noticeId']);
  if (!exact.ok) return exact;
  return typeof exact.value.noticeId === 'string' && /^notice_[0-9a-f]{16}$/.test(exact.value.noticeId)
    ? { ok: true, value: { action: 'markRead', noticeId: exact.value.noticeId } }
    : invalid('noticeId');
}
