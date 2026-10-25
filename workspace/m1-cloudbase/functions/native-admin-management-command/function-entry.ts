import type { FunctionRequest, JsonObject, ServiceResult } from '../../src/shared/protocol';
import { parseExactObject } from '../../src/shared/strict-object';
import { createMeta, success } from '../../src/shared/result';
import { TEACHER_CLASS_PERMISSIONS, type TeacherClassPermission } from '../../src/org-content/types';
import { NativeAdminManagementError, type NativeAdminManagementService } from '../../src/native-admin/management-service';
import { NativeAccountError, type NativeAdminAccountService, type NativeAccountInput } from '../../src/native-admin/account-service';
import { NativeWorkRestoreError, type NativeAdminWorkRestoreService } from '../../src/native-admin/work-restore-service';
import { createTrustedFunction, type TrustedFunctionDependencies,
  type TrustedFunctionValidation } from '../shared/trusted-function';

export const NATIVE_ADMIN_MANAGEMENT_ACTIONS =
  ['createUser', 'requestPasswordReset', 'createClass', 'updateClass', 'archiveClass', 'assignTeacher', 'revokeTeacher', 'updateUser', 'disableUser', 'unbindParentLink', 'restoreWorkDraft', 'updateOrganization', 'bindParentLink'] as const;
type Action = (typeof NATIVE_ADMIN_MANAGEMENT_ACTIONS)[number];
type Validated =
  | Readonly<NativeAccountInput & { action: 'createUser'; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'requestPasswordReset'; userId: string; reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'updateOrganization'; name: string; reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'bindParentLink'; parentId: string; studentId: string; reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'createClass'; name: string; grade: number; term: string;
    reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'updateClass'; classId: string; name: string; grade: number; term: string;
    reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'archiveClass'; classId: string; destinationClassId: string | null;
    destinationExpectedVersion: number | null; reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'assignTeacher'; classId: string; teacherId: string;
    permissions: readonly TeacherClassPermission[]; reason: string;
    expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'revokeTeacher'; classId: string; teacherId: string; reason: string;
    expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'updateUser'; userId: string; displayName: string;
    reason: string; expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'disableUser'; userId: string; reason: string;
    expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'unbindParentLink'; linkId: string; reason: string;
    expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'restoreWorkDraft'; studentId: string; workId: string;
    reason: string; expectedVersion: number; operationId: string }>;

export function validateNativeAdminManagementRequest(request: FunctionRequest<Action, JsonObject>):
  TrustedFunctionValidation<Validated> {
  const expectedVersion = request.expectedVersion;
  const operationId = request.operationId;
  if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0
    || typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)) {
    return invalid('expectedVersion');
  }
  if (request.action === 'createUser') {
    const exact = parseExactObject(request.payload, ['displayName', 'mobile', 'role', 'classId', 'reason']);
    if (!exact.ok) return exact;
    const row = exact.value;
    if (expectedVersion !== 0 || typeof row.displayName !== 'string' || row.displayName.trim().length > 50
      || typeof row.mobile !== 'string' || !/^1\d{10}$/.test(row.mobile)
      || !['student', 'parent', 'teacher', 'admin'].includes(String(row.role))
      || typeof row.classId !== 'string' || row.classId !== '' && !validId(row.classId)
      || row.role === 'student' && !row.classId || row.role !== 'student' && row.classId !== ''
      || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 200) return invalid('payload');
    return { ok: true, value: { action: 'createUser', displayName: row.displayName, mobile: row.mobile,
      role: row.role as NativeAccountInput['role'], classId: row.classId, reason: row.reason, expectedVersion: 0, operationId } };
  }
  if (request.action === 'requestPasswordReset') {
    const exact = parseExactObject(request.payload, ['userId', 'reason']);
    if (!exact.ok) return exact;
    if (!validId(exact.value.userId) || Number(expectedVersion) < 1 || typeof exact.value.reason !== 'string'
      || !exact.value.reason.trim() || exact.value.reason.length > 200) return invalid('payload');
    return { ok: true, value: { action: 'requestPasswordReset', userId: exact.value.userId,
      reason: exact.value.reason, expectedVersion: Number(expectedVersion), operationId } };
  }
  const required = request.action === 'updateOrganization' ? ['name', 'reason']
    : request.action === 'bindParentLink' ? ['parentId', 'studentId', 'reason']
    : request.action === 'createClass' ? ['name', 'grade', 'term', 'reason']
    : request.action === 'updateClass' ? ['classId', 'name', 'grade', 'term', 'reason']
      : request.action === 'archiveClass' ? ['classId', 'destinationClassId', 'destinationExpectedVersion', 'reason']
      : request.action === 'assignTeacher' ? ['classId', 'teacherId', 'permissions', 'reason']
        : request.action === 'revokeTeacher' ? ['classId', 'teacherId', 'reason']
        : request.action === 'restoreWorkDraft' ? ['studentId', 'workId', 'reason']
        : request.action === 'disableUser' ? ['userId', 'reason']
        : request.action === 'unbindParentLink' ? ['linkId', 'reason']
          : ['userId', 'displayName', 'reason'];
  const exact = parseExactObject(request.payload, required);
  if (!exact.ok) return exact;
  const row = exact.value;
  if (typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 200) return invalid('reason');
  if (request.action === 'updateOrganization') {
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.trim().length > 50
      || Number(expectedVersion) < 1) return invalid('name');
    return { ok: true, value: { action: 'updateOrganization', name: row.name, reason: row.reason,
      expectedVersion: Number(expectedVersion), operationId } };
  }
  if (request.action === 'bindParentLink') {
    if (!validId(row.parentId) || !validId(row.studentId) || expectedVersion !== 0) return invalid('payload');
    return { ok: true, value: { action: 'bindParentLink', parentId: row.parentId, studentId: row.studentId,
      reason: row.reason, expectedVersion: 0, operationId } };
  }
  if (request.action === 'createClass' || request.action === 'updateClass') {
    if (Number(expectedVersion) < (request.action === 'createClass' ? 0 : 1)
      || request.action === 'createClass' && expectedVersion !== 0
      || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 50
      || !Number.isSafeInteger(row.grade) || Number(row.grade) < 1 || Number(row.grade) > 12
      || typeof row.term !== 'string' || !row.term.trim() || row.term.length > 60) return invalid('payload');
    if (request.action === 'createClass') return { ok: true, value: { action: 'createClass',
      name: row.name, grade: Number(row.grade), term: row.term, reason: row.reason,
      expectedVersion: 0, operationId } };
    if (!validId(row.classId)) return invalid('classId');
    return { ok: true, value: { action: 'updateClass', classId: row.classId as string,
      name: row.name, grade: Number(row.grade), term: row.term, reason: row.reason,
      expectedVersion: Number(expectedVersion), operationId } };
  }
  if (request.action === 'archiveClass') {
    const destinationId = row.destinationClassId;
    const destinationVersion = row.destinationExpectedVersion;
    if (!validId(row.classId) || destinationId !== null && !validId(destinationId)
      || destinationVersion !== null && (!Number.isSafeInteger(destinationVersion) || Number(destinationVersion) < 1)
      || destinationId === null && destinationVersion !== null
      || destinationId !== null && destinationVersion === null || Number(expectedVersion) < 1) return invalid('payload');
    return { ok: true, value: { action: 'archiveClass', classId: row.classId,
      destinationClassId: destinationId as string | null,
      destinationExpectedVersion: destinationVersion as number | null, reason: row.reason,
      expectedVersion: Number(expectedVersion), operationId } };
  }
  if (request.action === 'assignTeacher') {
    if (!validId(row.classId) || !validId(row.teacherId)
      || !Array.isArray(row.permissions) || !row.permissions.length
      || row.permissions.some(permission => typeof permission !== 'string'
        || !TEACHER_CLASS_PERMISSIONS.includes(permission as TeacherClassPermission))
      || new Set(row.permissions).size !== row.permissions.length) return invalid('payload');
    return { ok: true, value: { action: 'assignTeacher', classId: row.classId as string,
      teacherId: row.teacherId as string, permissions: row.permissions as TeacherClassPermission[],
      reason: row.reason, expectedVersion: Number(expectedVersion), operationId } };
  }
  if (request.action === 'revokeTeacher') {
    if (!validId(row.classId) || !validId(row.teacherId) || Number(expectedVersion) < 1) return invalid('payload');
    return { ok: true, value: { action: 'revokeTeacher', classId: row.classId,
      teacherId: row.teacherId, reason: row.reason, expectedVersion: Number(expectedVersion), operationId } };
  }
  if (request.action === 'restoreWorkDraft') {
    if (!validId(row.studentId) || !validId(row.workId) || Number(expectedVersion) < 1) {
      return invalid('payload');
    }
    return { ok: true, value: { action: 'restoreWorkDraft', studentId: row.studentId as string,
      workId: row.workId as string, reason: row.reason,
      expectedVersion: Number(expectedVersion), operationId } };
  }
  if (request.action === 'disableUser') {
    if (!validId(row.userId) || Number(expectedVersion) < 1) return invalid('payload');
    return { ok: true, value: { action: 'disableUser', userId: row.userId,
      reason: row.reason, expectedVersion: Number(expectedVersion), operationId } };
  }
  if (request.action === 'unbindParentLink') {
    if (!validId(row.linkId) || Number(expectedVersion) < 1) return invalid('payload');
    return { ok: true, value: { action: 'unbindParentLink', linkId: row.linkId,
      reason: row.reason, expectedVersion: Number(expectedVersion), operationId } };
  }
  if (!validId(row.userId) || typeof row.displayName !== 'string'
    || !row.displayName.trim() || row.displayName.length > 50 || Number(expectedVersion) < 1) {
    return invalid('payload');
  }
  return { ok: true, value: { action: 'updateUser', userId: row.userId as string,
    displayName: row.displayName, reason: row.reason,
    expectedVersion: Number(expectedVersion), operationId } };
}

export interface NativeAdminManagementDependencies extends TrustedFunctionDependencies {
  readonly accounts?: Pick<NativeAdminAccountService, 'createUser' | 'requestPasswordReset'>;
  readonly management: Pick<NativeAdminManagementService,
    'createClass' | 'updateClass' | 'archiveClass' | 'assignTeacher' | 'revokeTeacher'
    | 'updateUser' | 'disableUser' | 'unbindParentLink'>;
  readonly organizationManagement?: Pick<NativeAdminManagementService, 'updateOrganization' | 'bindParentLink'>;
  readonly workRestore?: Pick<NativeAdminWorkRestoreService, 'restore'>;
}

export function createNativeAdminManagementFunction(dependencies: NativeAdminManagementDependencies) {
  return createTrustedFunction<Action, Validated, JsonObject>(
    'native-admin-management-command', NATIVE_ADMIN_MANAGEMENT_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => error instanceof NativeAdminManagementError
      || error instanceof NativeAccountError
      || error instanceof NativeWorkRestoreError
      ? error.code : dependencies.mapFailure?.(phase, error) ?? 'SERVICE_UNAVAILABLE' },
    validateNativeAdminManagementRequest,
    async (input, actor): Promise<ServiceResult<JsonObject>> => {
      if (input.action === 'requestPasswordReset') {
        return { ok: false, error: { code: 'FORBIDDEN', retryable: false,
          message: '请由账号本人在登录页验证手机号并设置密码。' },
        meta: createMeta(dependencies.clock, dependencies.requestIds) };
      }
      if (input.action === 'createUser') {
        if (!dependencies.accounts) return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', retryable: true,
          message: '账号安全服务尚未接通，请保留输入后重试。' }, meta: createMeta(dependencies.clock, dependencies.requestIds) };
        const result = await dependencies.accounts.createUser(actor, input, input.expectedVersion, input.operationId);
        return success<JsonObject>({ ...result }, createMeta(dependencies.clock, dependencies.requestIds));
      }
      if (input.action === 'updateOrganization' || input.action === 'bindParentLink') {
        if (!dependencies.organizationManagement) return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
          message: '管理服务暂时不可用', retryable: true }, meta: createMeta(dependencies.clock, dependencies.requestIds) };
        const result = input.action === 'updateOrganization'
          ? await dependencies.organizationManagement.updateOrganization(actor, input, input.expectedVersion, input.operationId)
          : await dependencies.organizationManagement.bindParentLink(actor, input, input.expectedVersion, input.operationId);
        return success<JsonObject>({ ...result }, createMeta(dependencies.clock, dependencies.requestIds));
      }
      if (input.action === 'restoreWorkDraft') {
        return { ok: false, error: { code: 'FORBIDDEN',
          message: '已删草稿不可恢复', retryable: false },
        meta: createMeta(dependencies.clock, dependencies.requestIds) };
      }
      const result = input.action === 'createClass'
        ? await dependencies.management.createClass(actor, input, input.expectedVersion, input.operationId)
        : input.action === 'updateClass'
          ? await dependencies.management.updateClass(actor, input, input.expectedVersion, input.operationId)
          : input.action === 'archiveClass'
            ? await dependencies.management.archiveClass(actor, input, input.expectedVersion,
              input.destinationExpectedVersion, input.operationId)
          : input.action === 'assignTeacher'
            ? await dependencies.management.assignTeacher(actor, input, input.expectedVersion, input.operationId)
            : input.action === 'revokeTeacher'
              ? await dependencies.management.revokeTeacher(actor, input, input.expectedVersion, input.operationId)
              : input.action === 'disableUser'
                ? await dependencies.management.disableUser(actor, input, input.expectedVersion, input.operationId)
                : input.action === 'unbindParentLink'
                  ? await dependencies.management.unbindParentLink(actor, input, input.expectedVersion, input.operationId)
                  : await dependencies.management.updateUser(actor, input, input.expectedVersion, input.operationId);
      return success<JsonObject>({ ...result }, createMeta(dependencies.clock, dependencies.requestIds));
    });
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function invalid(field: string): TrustedFunctionValidation<Validated> {
  return { ok: false, fieldErrors: { [field]: '字段无效或与当前版本不匹配。' } };
}

