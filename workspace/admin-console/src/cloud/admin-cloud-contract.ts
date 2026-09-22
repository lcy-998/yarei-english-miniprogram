export const ADMIN_API_VERSION = 'm1.v1' as const;
export const ADMIN_FUNCTION_NAME = 'organization-admin' as const;
export const ADMIN_SESSION_AUDIENCE = 'admin-console' as const;

export type AdminCloudErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RESOURCE_OFFLINE'
  | 'DUPLICATE_OPERATION'
  | 'NETWORK_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface AdminCloudError {
  readonly code: AdminCloudErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

export type AdminCloudResult<T> =
  | { readonly ok: true; readonly data: T; readonly requestId?: string }
  | { readonly ok: false; readonly error: AdminCloudError; readonly requestId?: string };

/**
 * A credential for the standalone admin console. Mini-program sessions have a
 * different audience and must never be accepted by this boundary.
 */
export interface AdminConsoleSession {
  readonly audience: typeof ADMIN_SESSION_AUDIENCE;
  readonly token: string;
  readonly expiresAt: string;
}

export interface AdminSessionSource {
  current(): Promise<unknown>;
}

export interface AdminFunctionInvoker {
  invoke(functionName: typeof ADMIN_FUNCTION_NAME, request: OrganizationAdminWireRequest): Promise<unknown>;
}

export type UserRole = 'student' | 'parent' | 'teacher' | 'admin';
export type RoleScopeType = 'self' | 'classes' | 'organization';
export type RolePermission =
  | 'organization.read'
  | 'organization.manage'
  | 'class.read'
  | 'class.manage'
  | 'user.read'
  | 'user.manage'
  | 'authorization.manage'
  | 'audit.read'
  | 'student.read'
  | 'student.manage'
  | 'student.bind-code.issue'
  | 'content.read'
  | 'task.read'
  | 'task.publish'
  | 'submission.review'
  | 'child.read'
  | 'child.bind'
  | 'child.unbind';
export type TeacherClassPermission =
  | 'class.read'
  | 'student.read'
  | 'student.manage'
  | 'student.bind-code.issue'
  | 'content.read'
  | 'task.read'
  | 'task.publish'
  | 'submission.review';

export interface AdminClassView {
  readonly id: string;
  readonly name: string;
  readonly grade: string;
  readonly term: string;
  readonly status: 'active' | 'archived';
  readonly version: number;
  readonly studentCount?: number;
  readonly teacherIds?: readonly string[];
}

export interface AdminUserView {
  readonly id: string;
  readonly displayName: string;
  readonly displayNameMasked: string;
  readonly mobileMasked?: string;
  readonly studentNumber?: string;
  readonly roles: readonly UserRole[];
  readonly status: 'active' | 'disabled';
  readonly version: number;
  readonly classIds?: readonly string[];
  readonly bindingCount?: number;
}

export interface AdminRoleAssignmentView {
  readonly id: string;
  readonly userId: string;
  readonly role: UserRole;
  readonly status: 'active' | 'revoked';
  readonly permissions: readonly RolePermission[];
  readonly scopeType: RoleScopeType;
  readonly scopeIds: readonly string[];
  readonly version: number;
}

export interface AdminTeacherClassGrantView {
  readonly id: string;
  readonly organizationId: string;
  readonly teacherId: string;
  readonly classId: string;
  readonly permissions: readonly TeacherClassPermission[];
  readonly status: 'active' | 'revoked';
  readonly grantedBy: string;
  readonly grantedAt: string;
  readonly revokedAt?: string;
  readonly version: number;
}

export interface AdminPageRequest {
  readonly limit: number;
  readonly offset: number;
}

export interface AdminPageView<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly nextOffset: number | null;
}

export interface AdminDashboardOverviewView {
  readonly range: Readonly<{ from: string; to: string }>;
  readonly counts: Readonly<{
    organizationCount: number;
    classCount: number;
    activeUserCount: number;
    taskCount: number;
  }>;
  readonly completion: Readonly<{
    assignmentCount: number;
    completedCount: number;
    completionRate: number;
  }>;
  readonly anomalies: Readonly<{
    overdueCount: number;
    pendingReviewCount: number;
  }>;
}

export type AdminAuditErrorCode = AdminCloudErrorCode | 'TASK_NOT_SUBMITTABLE' | 'REDO_LIMIT_REACHED';
export type AdminAuditMetadataValue = string | number | boolean | null;
export type AdminAuditMetadata = Readonly<Partial<Record<
  'classId' | 'role' | 'scopeType' | 'permissionCount' | 'affectedCount' | 'authorizationVersion' | 'reasonProvided',
  AdminAuditMetadataValue
>>>;

export interface AdminAuditLogView {
  readonly id: string;
  readonly requestId: string;
  readonly actorUserId: string | null;
  readonly actorRole: UserRole | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly result: 'succeeded' | 'denied' | 'failed';
  readonly errorCode: AdminAuditErrorCode | null;
  readonly metadata: AdminAuditMetadata;
  readonly occurredAt: string;
}

export interface AdminDashboardFilter { readonly from?: string; readonly to?: string }
export interface AdminRoleAssignmentFilter { readonly userId?: string; readonly role?: UserRole; readonly status?: 'active' | 'revoked'; readonly scopeType?: RoleScopeType }
export interface AdminAuditLogFilter { readonly actorUserId?: string; readonly action?: string; readonly result?: 'succeeded' | 'denied' | 'failed'; readonly targetType?: string; readonly from?: string; readonly to?: string }

export type OrganizationAdminCall =
  | { readonly action: 'listClasses'; readonly payload: Readonly<Record<string, never>> }
  | { readonly action: 'getDashboardOverview'; readonly payload: AdminDashboardFilter }
  | { readonly action: 'listRoleAssignments'; readonly payload: Readonly<{ filter: AdminRoleAssignmentFilter; page: AdminPageRequest }> }
  | { readonly action: 'listAuditLogs'; readonly payload: Readonly<{ filter: AdminAuditLogFilter; page: AdminPageRequest }> }
  | { readonly action: 'listUsers'; readonly payload: Readonly<{ classId?: string; role?: UserRole; status?: 'active' | 'disabled'; keyword?: string }> }
  | AdminWriteCall<'createClass', Readonly<{ name: string; grade: string; term: string; reason: string }>>
  | AdminWriteCall<'updateClass', Readonly<{ classId: string; name: string; grade: string; term: string; reason: string }>>
  | AdminWriteCall<'disableClass', Readonly<{ classId: string; reason: string }>>
  | AdminWriteCall<'createUser', Readonly<{ displayName: string; mobile: string; role: UserRole; classId?: string; reason: string }>>
  | AdminWriteCall<'updateUser', Readonly<{ userId: string; displayName: string; reason: string }>>
  | AdminWriteCall<'disableUser', Readonly<{ userId: string; reason: string }>>
  | AdminWriteCall<'assignRole', Readonly<{ userId: string; role: UserRole; permissions: readonly RolePermission[]; scopeType: RoleScopeType; scopeIds: readonly string[]; reason: string }>>
  | AdminWriteCall<'revokeRole', Readonly<{ userId: string; role: UserRole; reason: string }>>
  | AdminWriteCall<'grantTeacherClass', Readonly<{ teacherId: string; classId: string; permissions: readonly TeacherClassPermission[]; reason: string }>>
  | AdminWriteCall<'revokeTeacherClass', Readonly<{ teacherId: string; classId: string; reason: string }>>;

interface AdminWriteCall<TAction extends string, TPayload> {
  readonly action: TAction;
  readonly payload: TPayload;
  readonly expectedVersion: number;
  readonly operationId: string;
}

export interface OrganizationAdminWireRequest {
  readonly apiVersion: typeof ADMIN_API_VERSION;
  readonly action: OrganizationAdminCall['action'];
  readonly payload: OrganizationAdminCall['payload'];
  readonly businessSessionToken: string;
  readonly expectedVersion?: number;
  readonly operationId?: string;
}

export class UnconfiguredAdminSessionSource implements AdminSessionSource {
  async current(): Promise<null> {
    return null;
  }
}
