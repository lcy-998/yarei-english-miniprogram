import { parseExactObject } from '../shared/strict-object';
import type { FunctionRequest, JsonObject } from '../shared/protocol';

export const AUTH_SESSION_ACTIONS = ['bootstrap', 'selectRole', 'getCurrentSession', 'logout'] as const;
export type AuthSessionAction = (typeof AUTH_SESSION_ACTIONS)[number];
export type MiniProgramRole = 'student' | 'parent' | 'teacher';

export type AuthPayload =
  | { readonly action: 'bootstrap' | 'getCurrentSession' | 'logout'; readonly payload: Readonly<Record<string, never>> }
  | { readonly action: 'selectRole'; readonly payload: Readonly<{ role: MiniProgramRole }> };

export type AuthRequestValidation =
  | { readonly ok: true; readonly value: AuthPayload }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export function parseAuthPayload(action: AuthSessionAction, payload: JsonObject): AuthPayload | Readonly<Record<string, string>> {
  const exact = action === 'selectRole' ? parseExactObject(payload, ['role']) : parseExactObject(payload, []);
  if (!exact.ok) return exact.fieldErrors;
  if (action !== 'selectRole') return { action, payload: {} };
  const role = exact.value.role;
  if (role !== 'student' && role !== 'parent' && role !== 'teacher') return { role: '角色必须是学生、家长或教师。' };
  return { action, payload: { role } };
}

export function isAuthPayloadError(value: AuthPayload | Readonly<Record<string, string>>): value is Readonly<Record<string, string>> {
  return !('action' in value);
}

export function validateAuthRequest(
  request: FunctionRequest<AuthSessionAction, JsonObject>,
): AuthRequestValidation {
  const parsedPayload = parseAuthPayload(request.action, request.payload);
  if (isAuthPayloadError(parsedPayload)) {
    return { ok: false, fieldErrors: parsedPayload };
  }
  if (request.expectedVersion !== undefined) {
    return { ok: false, fieldErrors: { expectedVersion: '当前操作不支持版本号。' } };
  }
  if (request.action === 'logout' && request.operationId === undefined) {
    return { ok: false, fieldErrors: { operationId: '退出登录必须提供操作标识。' } };
  }
  if (request.action !== 'logout' && request.operationId !== undefined) {
    return { ok: false, fieldErrors: { operationId: '当前操作不支持操作标识。' } };
  }
  return { ok: true, value: parsedPayload };
}
