import { describe, expect, it, vi } from 'vitest';
import { main as managementMain } from '../../functions/native-admin-management-command';
import { createNativeAdminManagementFunction, validateNativeAdminManagementRequest } from '../../functions/native-admin-management-command/function-entry';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import type { NativeAccountInput } from '../../src/native-admin/account-service';
import { main as grantMain } from '../../functions/native-admin-command';
import { validateNativeAdminCommandRequest } from '../../functions/native-admin-command/function-entry';

describe('native management command validation and deployment gate', () => {
  it('rejects legacy administrator reset before an injected account handler while allowing phone-account creation', async () => {
    const actor: TrustedActorContext = { requestId: 'req_manager', sessionId: 'ses_manager',
      actorUserId: 'teacher_manager', actorRole: 'teacher', organizationId: 'org_demo',
      platformSubjectDigest: 'digest_manager', permissions: [], scopeIds: [], authzVersion: 2 };
    const createUser = vi.fn(async (_actor: TrustedActorContext, input: NativeAccountInput,
      _expectedVersion: number, _operationId: string) => ({ id: 'user_created_demo',
      displayName: input.displayName, role: input.role, status: 'active' as const,
      version: 1, setupStatus: 'self_service_required' as const }));
    const requestPasswordReset = vi.fn(async (): Promise<never> => {
      throw new Error('legacy reset provider must never be called');
    });
    const unexpectedManagement = vi.fn(async (): Promise<never> => {
      throw new Error('unrelated management command must not run');
    });
    const main = createNativeAdminManagementFunction({
      runtime: { functionName: 'native-admin-management-command',
        getPlatformSubject: async () => ({ subject: 'platform_demo', loginType: 'USERNAME', isAuthenticated: true }),
        getBusinessSessionId: async () => 'ses_manager' },
      actorResolver: { resolve: async () => actor },
      clock: { nowIso: () => '2026-10-07T12:00:00+08:00' },
      requestIds: { next: () => 'req_account_result' },
      accounts: { createUser, requestPasswordReset },
      management: { createClass: unexpectedManagement, updateClass: unexpectedManagement,
        archiveClass: unexpectedManagement, assignTeacher: unexpectedManagement,
        revokeTeacher: unexpectedManagement, updateUser: unexpectedManagement,
        disableUser: unexpectedManagement, unbindParentLink: unexpectedManagement },
    });
    expect(await main({ apiVersion: 'm1.v1', action: 'requestPasswordReset',
      payload: { userId: 'user_created_demo', reason: '旧客户端重置尝试' },
      expectedVersion: 1, operationId: 'operation_legacy_reset' }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN', retryable: false } });
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();

    const payload: NativeAccountInput = { displayName: '虚构新学员', mobile: '13800000001',
      role: 'student', classId: 'class_demo', reason: '创建虚构教学账号' };
    expect(await main({ apiVersion: 'm1.v1', action: 'createUser', payload,
      expectedVersion: 0, operationId: 'operation_phone_account' }))
      .toMatchObject({ ok: true, data: { id: 'user_created_demo', setupStatus: 'self_service_required' } });
    expect(createUser).toHaveBeenCalledExactlyOnceWith(actor, expect.objectContaining(payload),
      0, 'operation_phone_account');
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(unexpectedManagement).not.toHaveBeenCalled();
  });

  it('validates CAS, operation ID and exact class or user fields', () => {
    const request = { apiVersion: 'm1.v1' as const, action: 'updateClass' as const,
      payload: { classId: 'class_demo', name: '虚构班级', grade: 3, term: '秋季', reason: '核对名称' },
      expectedVersion: 1, operationId: 'operation_update_class' };
    expect(validateNativeAdminManagementRequest(request)).toMatchObject({
      ok: true, value: { action: 'updateClass', expectedVersion: 1 } });
    expect(validateNativeAdminManagementRequest({ ...request, payload: { ...request.payload,
      actorRole: 'admin' } }).ok).toBe(false);
    expect(validateNativeAdminManagementRequest({ ...request, expectedVersion: 0 }).ok).toBe(false);
    expect(validateNativeAdminManagementRequest({ ...request, payload: { ...request.payload,
      grade: 13 } }).ok).toBe(false);
    expect(validateNativeAdminManagementRequest({ ...request, action: 'archiveClass',
      payload: { classId: 'class_demo', destinationClassId: 'class_next',
        destinationExpectedVersion: 1, reason: '合并班级' } }).ok).toBe(true);
    expect(validateNativeAdminManagementRequest({ ...request, action: 'disableUser',
      payload: { userId: 'user_demo', reason: '毕业停用' } }).ok).toBe(true);
    expect(validateNativeAdminManagementRequest({ ...request, action: 'unbindParentLink',
      payload: { linkId: 'link_demo', reason: '监护关系变更' } }).ok).toBe(true);
  });

  it('keeps new management writes unavailable before a reviewed runtime is installed', async () => {
    expect(await managementMain({ apiVersion: 'm1.v1', action: 'createClass',
      payload: { name: '虚构新班', grade: 3, term: '秋季', reason: '新建测试班级' },
      expectedVersion: 0, operationId: 'operation_create_class' }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });

  it('validates grant changes without accepting forged actor claims', async () => {
    const request = { apiVersion: 'm1.v1' as const, action: 'setGrant' as const,
      payload: { teacherId: 'teacher_target', status: 'revoked', permissions: [],
        scope: { organizationWide: false, classIds: [] }, expectedUserVersion: 2,
        reason: '收回管理授权' }, expectedVersion: 1, operationId: 'operation_revoke_grant' };
    expect(validateNativeAdminCommandRequest(request)).toMatchObject({ ok: true });
    expect(validateNativeAdminCommandRequest({ ...request, payload: { ...request.payload,
      actorUserId: 'someone_else' } }).ok).toBe(false);
    expect(await grantMain(request)).toMatchObject({ ok: false,
      error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});
