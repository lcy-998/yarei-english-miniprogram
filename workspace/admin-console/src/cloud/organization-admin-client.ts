import type {
  AdminAuditErrorCode,
  AdminAuditLogFilter,
  AdminAuditLogView,
  AdminClassView,
  AdminCloudResult,
  AdminDashboardFilter,
  AdminDashboardOverviewView,
  AdminPageRequest,
  AdminPageView,
  AdminRoleAssignmentView,
  AdminRoleAssignmentFilter,
  AdminTeacherClassGrantView,
  AdminUserView,
  OrganizationAdminCall,
  RolePermission,
  RoleScopeType,
  TeacherClassPermission,
  UserRole,
} from './admin-cloud-contract';
import type { AdminCloudTransport } from './admin-cloud-transport';

export interface OrganizationAdminClient {
  listClasses(): Promise<AdminCloudResult<readonly AdminClassView[]>>;
  getDashboardOverview(filter?: AdminDashboardFilter): Promise<AdminCloudResult<AdminDashboardOverviewView>>;
  listRoleAssignments(input: Readonly<{ filter?: AdminRoleAssignmentFilter; page: AdminPageRequest }>): Promise<AdminCloudResult<AdminPageView<AdminRoleAssignmentView>>>;
  listAuditLogs(input: Readonly<{ filter?: AdminAuditLogFilter; page: AdminPageRequest }>): Promise<AdminCloudResult<AdminPageView<AdminAuditLogView>>>;
  listUsers(filter?: Readonly<{ classId?: string; role?: UserRole; status?: 'active' | 'disabled'; keyword?: string }>): Promise<AdminCloudResult<readonly AdminUserView[]>>;
  createClass(input: ClassWriteInput & Readonly<{ expectedVersion: 1; operationId: string }>): Promise<AdminCloudResult<AdminClassView>>;
  updateClass(input: ClassWriteInput & Readonly<{ classId: string; expectedVersion: number; operationId: string }>): Promise<AdminCloudResult<AdminClassView>>;
  disableClass(input: Readonly<{ classId: string; reason: string; expectedVersion: number; operationId: string }>): Promise<AdminCloudResult<AdminClassView>>;
  createUser(input: Readonly<{ displayName: string; mobile: string; role: UserRole; classId?: string; reason: string; expectedVersion: 1; operationId: string }>): Promise<AdminCloudResult<AdminUserView>>;
  updateUser(input: Readonly<{ userId: string; displayName: string; reason: string; expectedVersion: number; operationId: string }>): Promise<AdminCloudResult<AdminUserView>>;
  disableUser(input: Readonly<{ userId: string; reason: string; expectedVersion: number; operationId: string }>): Promise<AdminCloudResult<AdminUserView>>;
  assignRole(input: RoleWriteInput & Readonly<{ expectedVersion: number; operationId: string }>): Promise<AdminCloudResult<AdminRoleAssignmentView>>;
  revokeRole(input: Readonly<{ userId: string; role: UserRole; reason: string; expectedVersion: number; operationId: string }>): Promise<AdminCloudResult<AdminRoleAssignmentView>>;
  grantTeacherClass(input: TeacherGrantInput & Readonly<{ expectedVersion: number; operationId: string }>): Promise<AdminCloudResult<AdminTeacherClassGrantView>>;
  revokeTeacherClass(input: Readonly<{ teacherId: string; classId: string; reason: string; expectedVersion: number; operationId: string }>): Promise<AdminCloudResult<AdminTeacherClassGrantView>>;
}

interface ClassWriteInput { readonly name: string; readonly grade: string; readonly term: string; readonly reason: string }
interface RoleWriteInput { readonly userId: string; readonly role: UserRole; readonly permissions: readonly RolePermission[]; readonly scopeType: RoleScopeType; readonly scopeIds: readonly string[]; readonly reason: string }
interface TeacherGrantInput { readonly teacherId: string; readonly classId: string; readonly permissions: readonly TeacherClassPermission[]; readonly reason: string }

export function createOrganizationAdminClient(transport: AdminCloudTransport): OrganizationAdminClient {
  return {
    listClasses: () => invokeAndParse(transport, { action: 'listClasses', payload: {} }, parseClassList),
    getDashboardOverview: (filter = {}) => invokeAndParse(transport, { action: 'getDashboardOverview', payload: filter }, parseDashboardOverview),
    listRoleAssignments: (input) => invokeAndParse(
      transport,
      { action: 'listRoleAssignments', payload: { filter: input.filter ?? {}, page: input.page } },
      (value) => parsePage(value, parseRoleAssignment, input.page),
    ),
    listAuditLogs: (input) => invokeAndParse(
      transport,
      { action: 'listAuditLogs', payload: { filter: input.filter ?? {}, page: input.page } },
      (value) => parsePage(value, parseAuditLog, input.page),
    ),
    listUsers: (filter = {}) => invokeAndParse(transport, { action: 'listUsers', payload: filter }, parseUserList),
    createClass: (input) => invokeAndParse(transport, writeCall('createClass', input, ['name', 'grade', 'term', 'reason']), parseClass),
    updateClass: (input) => invokeAndParse(transport, writeCall('updateClass', input, ['classId', 'name', 'grade', 'term', 'reason']), parseClass),
    disableClass: (input) => invokeAndParse(transport, writeCall('disableClass', input, ['classId', 'reason']), parseClass),
    createUser: (input) => invokeAndParse(transport, writeCall('createUser', input, ['displayName', 'mobile', 'role', 'classId', 'reason']), parseUser),
    updateUser: (input) => invokeAndParse(transport, writeCall('updateUser', input, ['userId', 'displayName', 'reason']), parseUser),
    disableUser: (input) => invokeAndParse(transport, writeCall('disableUser', input, ['userId', 'reason']), parseUser),
    assignRole: (input) => invokeAndParse(transport, writeCall('assignRole', input, ['userId', 'role', 'permissions', 'scopeType', 'scopeIds', 'reason']), parseRoleAssignment),
    revokeRole: (input) => invokeAndParse(transport, writeCall('revokeRole', input, ['userId', 'role', 'reason']), parseRoleAssignment),
    grantTeacherClass: (input) => invokeAndParse(transport, writeCall('grantTeacherClass', input, ['teacherId', 'classId', 'permissions', 'reason']), parseTeacherGrant),
    revokeTeacherClass: (input) => invokeAndParse(transport, writeCall('revokeTeacherClass', input, ['teacherId', 'classId', 'reason']), parseTeacherGrant),
  };
}

function writeCall<T extends OrganizationAdminCall['action']>(action: T, input: object, payloadKeys: readonly string[]): OrganizationAdminCall {
  const record = input as Record<string, unknown>;
  const payload = Object.fromEntries(payloadKeys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
  return { action, payload, expectedVersion: record.expectedVersion, operationId: record.operationId } as OrganizationAdminCall;
}

async function invokeAndParse<T>(transport: AdminCloudTransport, call: OrganizationAdminCall, parse: (value: unknown) => T | null): Promise<AdminCloudResult<T>> {
  const result = await transport.invoke(call);
  if (!result.ok) return result;
  const parsed = parse(result.data);
  if (parsed === null) return { ok: false, error: { code: 'INTERNAL_ERROR', message: '后台服务处理失败，请稍后重试。', retryable: true }, ...(result.requestId === undefined ? {} : { requestId: result.requestId }) };
  return { ok: true, data: parsed, ...(result.requestId === undefined ? {} : { requestId: result.requestId }) };
}

function parseClassList(value: unknown): readonly AdminClassView[] | null { return parseList(value, parseClass); }
function parseUserList(value: unknown): readonly AdminUserView[] | null { return parseList(value, parseUser); }

function parseClass(value: unknown): AdminClassView | null {
  if (!exactRecord(value, ['id', 'name', 'grade', 'term', 'status', 'version'], ['studentCount', 'teacherIds'])) return null;
  const { id, name, grade, term, status, version, studentCount } = value;
  if (!isString(id) || !isString(name) || !isString(grade) || !isString(term) || (status !== 'active' && status !== 'archived') || !isVersion(version)) return null;
  if (studentCount !== undefined && (typeof studentCount !== 'number' || !Number.isSafeInteger(studentCount) || studentCount < 0)) return null;
  const teacherIds = optionalStringArray(value.teacherIds);
  if (teacherIds === null) return null;
  return { id, name, grade, term, status, version, ...(studentCount === undefined ? {} : { studentCount }), ...(teacherIds === undefined ? {} : { teacherIds }) };
}

function parseUser(value: unknown): AdminUserView | null {
  if (!exactRecord(value, ['id', 'displayName', 'displayNameMasked', 'roles', 'status', 'version'], ['mobileMasked', 'studentNumber', 'classIds', 'bindingCount'])) return null;
  const { id, displayName, displayNameMasked, status, version, mobileMasked, studentNumber, bindingCount } = value;
  if (!isString(id) || !isString(displayName) || !isString(displayNameMasked) || (status !== 'active' && status !== 'disabled') || !isVersion(version)) return null;
  if (mobileMasked !== undefined && (typeof mobileMasked !== 'string' || !/^\d{3}\*{4}\d{4}$/.test(mobileMasked))) return null;
  if (studentNumber !== undefined && !isString(studentNumber)) return null;
  const roles = stringEnumArray(value.roles, ['student', 'parent', 'teacher', 'admin'] as const);
  const classIds = optionalStringArray(value.classIds);
  if (roles === null || classIds === null || (bindingCount !== undefined && (typeof bindingCount !== 'number' || !Number.isSafeInteger(bindingCount) || bindingCount < 0))) return null;
  return { id, displayName, displayNameMasked, roles, status, version, ...(mobileMasked === undefined ? {} : { mobileMasked }), ...(studentNumber === undefined ? {} : { studentNumber }), ...(classIds === undefined ? {} : { classIds }), ...(bindingCount === undefined ? {} : { bindingCount }) };
}

function parseRoleAssignment(value: unknown): AdminRoleAssignmentView | null {
  if (!exactRecord(value, ['id', 'userId', 'role', 'status', 'permissions', 'scopeType', 'scopeIds', 'version'])) return null;
  const roles = ['student', 'parent', 'teacher', 'admin'] as const;
  const scopes = ['self', 'classes', 'organization'] as const;
  const permissions = stringEnumArray(value.permissions, ROLE_PERMISSIONS);
  const scopeIds = optionalStringArray(value.scopeIds);
  const { id, userId, role, scopeType, status, version } = value;
  if (!isString(id) || !isString(userId) || !roles.includes(role as UserRole) || !scopes.includes(scopeType as RoleScopeType) || (status !== 'active' && status !== 'revoked') || permissions === null || scopeIds === null || scopeIds === undefined || !isVersion(version)) return null;
  return { id, userId, role: role as UserRole, status, permissions, scopeType: scopeType as RoleScopeType, scopeIds, version };
}

function parseDashboardOverview(value: unknown): AdminDashboardOverviewView | null {
  if (!exactRecord(value, ['range', 'counts', 'completion', 'anomalies'])) return null;
  if (!exactRecord(value.range, ['from', 'to']) || !isValidRange(value.range.from, value.range.to)) return null;
  if (!exactRecord(value.counts, ['organizationCount', 'classCount', 'activeUserCount', 'taskCount'])) return null;
  if (!exactRecord(value.completion, ['assignmentCount', 'completedCount', 'completionRate'])) return null;
  if (!exactRecord(value.anomalies, ['overdueCount', 'pendingReviewCount'])) return null;
  const { organizationCount, classCount, activeUserCount, taskCount } = value.counts;
  const { assignmentCount, completedCount, completionRate } = value.completion;
  const { overdueCount, pendingReviewCount } = value.anomalies;
  if (![organizationCount, classCount, activeUserCount, taskCount, assignmentCount, completedCount, overdueCount, pendingReviewCount].every(isCount)
    || typeof completionRate !== 'number' || !Number.isFinite(completionRate) || completionRate < 0 || completionRate > 100
    || (completedCount as number) > (assignmentCount as number)) return null;
  return {
    range: { from: value.range.from as string, to: value.range.to as string },
    counts: { organizationCount: organizationCount as number, classCount: classCount as number, activeUserCount: activeUserCount as number, taskCount: taskCount as number },
    completion: { assignmentCount: assignmentCount as number, completedCount: completedCount as number, completionRate },
    anomalies: { overdueCount: overdueCount as number, pendingReviewCount: pendingReviewCount as number },
  };
}

function parseAuditLog(value: unknown): AdminAuditLogView | null {
  if (!exactRecord(value, ['id', 'requestId', 'actorUserId', 'actorRole', 'action', 'targetType', 'targetId', 'result', 'errorCode', 'metadata', 'occurredAt'])) return null;
  const actorRoles = ['student', 'parent', 'teacher', 'admin'] as const;
  const results = ['succeeded', 'denied', 'failed'] as const;
  const errorCodes: readonly AdminAuditErrorCode[] = [
    'VALIDATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RESOURCE_OFFLINE',
    'TASK_NOT_SUBMITTABLE', 'REDO_LIMIT_REACHED', 'DUPLICATE_OPERATION', 'NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR',
  ];
  if (!isBoundedString(value.id, 128) || !isBoundedString(value.requestId, 128)
    || value.actorUserId !== null && !isBoundedString(value.actorUserId, 128)
    || value.actorRole !== null && !actorRoles.includes(value.actorRole as typeof actorRoles[number])
    || !isBoundedString(value.action, 80) || !isBoundedString(value.targetType, 80)
    || value.targetId !== null && !isBoundedString(value.targetId, 128)
    || !results.includes(value.result as typeof results[number])
    || value.errorCode !== null && !errorCodes.includes(value.errorCode as AdminAuditErrorCode)
    || typeof value.occurredAt !== 'string' || !isIsoDateTime(value.occurredAt)) return null;
  const metadata = parseAuditMetadata(value.metadata);
  if (metadata === null) return null;
  return {
    id: value.id,
    requestId: value.requestId,
    actorUserId: value.actorUserId as string | null,
    actorRole: value.actorRole as AdminAuditLogView['actorRole'],
    action: value.action,
    targetType: value.targetType,
    targetId: value.targetId as string | null,
    result: value.result as AdminAuditLogView['result'],
    errorCode: value.errorCode as AdminAuditLogView['errorCode'],
    metadata,
    occurredAt: value.occurredAt,
  };
}

function parseAuditMetadata(value: unknown): AdminAuditLogView['metadata'] | null {
  const allowed = ['classId', 'role', 'scopeType', 'permissionCount', 'affectedCount', 'authorizationVersion', 'reasonProvided'] as const;
  if (!exactRecord(value, [], allowed)) return null;
  if (Object.values(value).some((item) => item !== null
    && typeof item !== 'string'
    && typeof item !== 'boolean'
    && (typeof item !== 'number' || !Number.isFinite(item)))) return null;
  return { ...value } as AdminAuditLogView['metadata'];
}

function parsePage<T>(value: unknown, parseItem: (item: unknown) => T | null, request: AdminPageRequest): AdminPageView<T> | null {
  if (!exactRecord(value, ['items', 'total', 'nextOffset']) || !Array.isArray(value.items)
    || value.items.length > request.limit || !isCount(value.total) || value.total > 1_000) return null;
  const items: T[] = [];
  for (const item of value.items) {
    const parsed = parseItem(item);
    if (parsed === null) return null;
    items.push(parsed);
  }
  if (items.length > Math.max(0, value.total - request.offset)) return null;
  const consumed = request.offset + items.length;
  if (value.nextOffset === null) {
    if (consumed < value.total) return null;
  } else if (!Number.isSafeInteger(value.nextOffset) || typeof value.nextOffset !== 'number'
    || value.nextOffset !== consumed || value.nextOffset <= request.offset || value.nextOffset >= value.total || value.nextOffset > 1_000) return null;
  return { items, total: value.total, nextOffset: value.nextOffset as number | null };
}

function parseTeacherGrant(value: unknown): AdminTeacherClassGrantView | null {
  if (!exactRecord(value, ['id', 'organizationId', 'teacherId', 'classId', 'permissions', 'status', 'grantedBy', 'grantedAt', 'version'], ['revokedAt'])) return null;
  const permissions = stringEnumArray(value.permissions, TEACHER_PERMISSIONS);
  const { id, organizationId, teacherId, classId, status, grantedBy, grantedAt, revokedAt, version } = value;
  if (!isString(id) || !isString(organizationId) || !isString(teacherId) || !isString(classId) || !isString(grantedBy) || !isString(grantedAt) || permissions === null || (status !== 'active' && status !== 'revoked') || !isVersion(version) || (revokedAt !== undefined && !isString(revokedAt))) return null;
  return { id, organizationId, teacherId, classId, permissions, status, grantedBy, grantedAt, version, ...(revokedAt === undefined ? {} : { revokedAt }) };
}

const ROLE_PERMISSIONS: readonly RolePermission[] = ['organization.read', 'organization.manage', 'class.read', 'class.manage', 'user.read', 'user.manage', 'authorization.manage', 'audit.read', 'student.read', 'student.manage', 'student.bind-code.issue', 'content.read', 'task.read', 'task.publish', 'submission.review', 'child.read', 'child.bind', 'child.unbind'];
const TEACHER_PERMISSIONS: readonly TeacherClassPermission[] = ['class.read', 'student.read', 'student.manage', 'student.bind-code.issue', 'content.read', 'task.read', 'task.publish', 'submission.review'];

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): readonly T[] | null {
  if (!Array.isArray(value)) return null;
  const result: T[] = [];
  for (const item of value) { const parsed = parse(item); if (parsed === null) return null; result.push(parsed); }
  return result;
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => key in value) && keys.every((key) => required.includes(key) || optional.includes(key));
}
function optionalStringArray(value: unknown): readonly string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => !isString(item))) return null;
  return value;
}
function stringEnumArray<T extends string>(value: unknown, allowed: readonly T[]): readonly T[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !allowed.includes(item as T))) return null;
  return value as readonly T[];
}
function isString(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 300; }
function isVersion(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 1; }
function isCount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function isBoundedString(value: unknown, maximumLength: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= maximumLength; }
function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}
function isValidRange(from: unknown, to: unknown): boolean {
  return typeof from === 'string' && typeof to === 'string' && isIsoDateTime(from) && isIsoDateTime(to)
    && Date.parse(to) >= Date.parse(from) && Date.parse(to) - Date.parse(from) <= 31 * 24 * 60 * 60 * 1_000;
}
