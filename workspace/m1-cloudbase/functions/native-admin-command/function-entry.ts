import type { FunctionRequest, JsonObject, ServiceResult } from '../../src/shared/protocol';
import { parseExactObject } from '../../src/shared/strict-object';
import { createMeta, success } from '../../src/shared/result';
import { NATIVE_ADMIN_PERMISSIONS, type NativeAdminPermission } from '../../src/native-admin/authorization';
import { NativeAdminGrantError, type NativeAdminGrantService } from '../../src/native-admin/grant-service';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export const NATIVE_ADMIN_COMMAND_ACTIONS = ['setGrant'] as const;
type NativeAdminCommandAction = (typeof NATIVE_ADMIN_COMMAND_ACTIONS)[number];

export function validateNativeAdminCommandRequest(request: FunctionRequest<NativeAdminCommandAction, JsonObject>) {
  if (!Number.isSafeInteger(request.expectedVersion) || Number(request.expectedVersion) < 0
    || typeof request.operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(request.operationId)) {
    return { ok: false as const, fieldErrors: { expectedVersion: '需要当前授权版本与操作号。' } };
  }
  const exact = parseExactObject(request.payload,
    ['teacherId', 'status', 'permissions', 'scope', 'expectedUserVersion', 'reason']);
  if (!exact.ok) return exact;
  const row = exact.value;
  const scope = parseExactObject(row.scope, ['organizationWide', 'classIds']);
  if (!scope.ok) return scope;
  if (typeof row.teacherId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.teacherId)
    || (row.status !== 'active' && row.status !== 'revoked')
    || !Array.isArray(row.permissions) || row.permissions.some(permission =>
      typeof permission !== 'string' || !NATIVE_ADMIN_PERMISSIONS.includes(permission as NativeAdminPermission))
    || typeof scope.value.organizationWide !== 'boolean'
    || !Array.isArray(scope.value.classIds) || scope.value.classIds.some(id =>
      typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    || !Number.isSafeInteger(row.expectedUserVersion) || Number(row.expectedUserVersion) < 1
    || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 200) {
    return { ok: false as const, fieldErrors: { payload: '授权变更字段无效。' } };
  }
  return { ok: true as const, value: { teacherId: row.teacherId,
    status: row.status as 'active' | 'revoked',
    permissions: row.permissions as NativeAdminPermission[],
    scope: { organizationWide: scope.value.organizationWide,
      classIds: scope.value.classIds as string[] },
    expectedUserVersion: Number(row.expectedUserVersion), reason: row.reason,
    expectedGrantVersion: Number(request.expectedVersion), operationId: request.operationId } };
}

export interface NativeAdminCommandDependencies extends TrustedFunctionDependencies {
  readonly grants: Pick<NativeAdminGrantService, 'setGrant'>;
}

export function createNativeAdminCommandFunction(dependencies: NativeAdminCommandDependencies) {
  return createTrustedFunction('native-admin-command', NATIVE_ADMIN_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => error instanceof NativeAdminGrantError
      ? error.code : dependencies.mapFailure?.(phase, error) ?? 'SERVICE_UNAVAILABLE' },
    validateNativeAdminCommandRequest,
    async (input, actor): Promise<ServiceResult<JsonObject>> => {
      const grant = await dependencies.grants.setGrant(actor, input.teacherId,
        { status: input.status, permissions: input.permissions, scope: input.scope },
        input.expectedGrantVersion, input.expectedUserVersion,
        input.reason, input.operationId);
      return success<JsonObject>({ organizationId: grant.organizationId, teacherId: grant.teacherId,
        status: grant.status, permissions: [...grant.permissions],
        scope: { organizationWide: grant.scope.organizationWide, classIds: [...grant.scope.classIds] },
        version: grant.version }, createMeta(dependencies.clock, dependencies.requestIds));
    });
}
