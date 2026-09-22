import { parseExactObject } from '../shared/strict-object';
import type { FunctionRequest, JsonObject } from '../shared/protocol';

export const ADMIN_SESSION_ACTIONS = ['bootstrap', 'refresh', 'getCurrentSession', 'logout'] as const;
export type AdminSessionAction = (typeof ADMIN_SESSION_ACTIONS)[number];

export type AdminSessionInput = Readonly<{
  action: AdminSessionAction;
  operationId?: string;
}>;

export type AdminSessionValidation =
  | { readonly ok: true; readonly value: AdminSessionInput }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export function validateAdminSessionRequest(
  request: FunctionRequest<AdminSessionAction, JsonObject>,
): AdminSessionValidation {
  const exact = parseExactObject(request.payload, []);
  if (!exact.ok) return exact;
  if (request.expectedVersion !== undefined) {
    return { ok: false, fieldErrors: { expectedVersion: '后台会话操作不支持版本号。' } };
  }
  if (request.action === 'logout') {
    if (request.operationId === undefined) {
      return { ok: false, fieldErrors: { operationId: '退出登录必须提供操作标识。' } };
    }
    return { ok: true, value: { action: request.action, operationId: request.operationId } };
  }
  if (request.operationId !== undefined) {
    return { ok: false, fieldErrors: { operationId: '当前后台会话操作不支持操作标识。' } };
  }
  return { ok: true, value: { action: request.action } };
}
