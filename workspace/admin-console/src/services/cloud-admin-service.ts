import type { OrganizationAdminClient } from '../cloud/organization-admin-client';
import type { CloudBaseAdminRuntime } from '../cloud/cloudbase-admin-runtime';
import type { AdminRoleAssignmentView, AdminUserView, RolePermission, RoleScopeType, UserRole } from '../cloud/admin-cloud-contract';
import type { AdminSnapshot, ClassRoom, PermissionKey, RoleDefinition, ServiceResult, UserAccount, UserKind } from '../domain/models';
import { AdminService, type CreateClassInput, type CreateUserInput, type UpdateRoleInput } from './admin-service';
import { MemoryAdminRepository } from './admin-repository';
import { ADMIN_SEED } from './seed';

type AdminServiceContract = Pick<AdminService, 'snapshot' | 'createClass' | 'updateClass' | 'assignTeachers' | 'disableClass' | 'createUser' | 'updateUser' | 'disableUser' | 'resetPassword' | 'updateBindingCount' | 'updateRole'>;

const CLOUD_TO_PERMISSION: Readonly<Record<RolePermission, PermissionKey>> = {
  'organization.read': 'organization.view', 'organization.manage': 'organization.edit',
  'class.read': 'organization.view', 'class.manage': 'organization.edit',
  'user.read': 'user.view', 'user.manage': 'user.edit', 'authorization.manage': 'permission.manage',
  'audit.read': 'audit.view', 'student.read': 'user.view', 'student.manage': 'user.edit',
  'student.bind-code.issue': 'user.bind', 'content.read': 'dashboard.view', 'task.read': 'dashboard.view',
  'task.publish': 'dashboard.view', 'submission.review': 'dashboard.view', 'child.read': 'user.view',
  'child.bind': 'user.bind', 'child.unbind': 'user.bind',
};

const ROLE_LABELS: Readonly<Record<UserRole, string>> = { student: '学生', parent: '家长', teacher: '教师', admin: '管理员' };
const KIND_LABELS: Readonly<Record<UserKind, string>> = { student: '学生', parent: '家长', teacher: '教师', staff: '员工' };

export class CloudAdminService extends AdminService implements AdminServiceContract {
  private operation = 0;
  constructor(private readonly runtime: CloudBaseAdminRuntime) {
    super(new MemoryAdminRepository(ADMIN_SEED), { actorId: 'cloud-admin', actorName: '云端管理员', schoolIds: [], permissions: [] });
  }

  async snapshot(): Promise<ServiceResult<AdminSnapshot>> {
    const [dashboard, classes, users, roles, audits] = await Promise.all([
      this.runtime.organization.getDashboardOverview(),
      this.runtime.organization.listClasses(),
      this.runtime.organization.listUsers(),
      this.runtime.organization.listRoleAssignments({ page: { limit: 50, offset: 0 } }),
      this.runtime.organization.listAuditLogs({ page: { limit: 50, offset: 0 } }),
    ]);
    const failure = [dashboard, classes, users, roles, audits].find((item) => !item.ok);
    if (failure && !failure.ok) return fail(failure.error.code, failure.error.message);
    if (!dashboard.ok || !classes.ok || !users.ok || !roles.ok || !audits.ok) return fail('INTERNAL_ERROR', '后台数据返回不完整，请稍后重试');
    const schoolId = roles.data.items[0]?.scopeIds[0] ?? 'organization-current';
    const schoolName = '当前授权组织';
    const classRows = classes.data.map((item) => this.toClass(item, schoolId));
    const userRows = users.data.map((item) => this.toUser(item, schoolId));
    const roleRows = this.toRoles(roles.data.items, schoolId);
    return ok({
      schools: [{ id: schoolId, name: schoolName, status: 'active', version: 1 }],
      classes: classRows,
      users: userRows,
      roles: roleRows,
      audits: audits.data.items.map((item) => ({ id: item.id, actorId: item.actorUserId ?? 'cloud-admin', action: item.action, target: item.targetId ?? item.targetType, createdAt: item.occurredAt, result: item.result === 'succeeded' ? 'success' : 'failure' })),
    });
  }

  async createClass(input: CreateClassInput): Promise<ServiceResult<ClassRoom>> {
    const result = await this.runtime.organization.createClass({ ...input, reason: '管理后台创建班级', expectedVersion: 1, operationId: this.id() });
    return result.ok ? ok(this.toClass(result.data, input.schoolId)) : fail(result.error.code, result.error.message);
  }
  async updateClass(classId: string, patch: Pick<CreateClassInput, 'name' | 'grade' | 'term'>, expectedVersion: number): Promise<ServiceResult<ClassRoom>> {
    const result = await this.runtime.organization.updateClass({ classId, ...patch, reason: '管理后台编辑班级', expectedVersion, operationId: this.id() });
    return result.ok ? ok(this.toClass(result.data, 'organization-current')) : fail(result.error.code, result.error.message);
  }
  async assignTeachers(classId: string, teacherIds: string[], expectedVersion: number): Promise<ServiceResult<ClassRoom>> {
    const current = await this.runtime.organization.listClasses();
    if (!current.ok) return fail(current.error.code, current.error.message);
    const row = current.data.find((item) => item.id === classId);
    if (!row) return fail('NOT_FOUND', '班级不存在或不在授权范围');
    const existing = new Set(row.teacherIds ?? []);
    const desired = new Set(teacherIds);
    for (const teacherId of [...desired].filter((id) => !existing.has(id))) {
      const result = await this.runtime.organization.grantTeacherClass({ teacherId, classId, permissions: ['class.read', 'student.read', 'content.read', 'task.read'], reason: '管理后台分配教师', expectedVersion, operationId: this.id() });
      if (!result.ok) return fail(result.error.code, result.error.message);
    }
    for (const teacherId of [...existing].filter((id) => !desired.has(id))) {
      const result = await this.runtime.organization.revokeTeacherClass({ teacherId, classId, reason: '管理后台解除教师分配', expectedVersion, operationId: this.id() });
      if (!result.ok) return fail(result.error.code, result.error.message);
    }
    return ok(this.toClass({ ...row, teacherIds }, 'organization-current'));
  }
  async disableClass(classId: string, expectedVersion: number): Promise<ServiceResult<ClassRoom>> {
    const result = await this.runtime.organization.disableClass({ classId, reason: '管理后台停用班级', expectedVersion, operationId: this.id() });
    return result.ok ? ok(this.toClass(result.data, 'organization-current')) : fail(result.error.code, result.error.message);
  }
  async createUser(input: CreateUserInput): Promise<ServiceResult<UserAccount>> {
    const role = input.kind === 'staff' ? 'admin' : input.kind;
    const result = await this.runtime.organization.createUser({ displayName: input.name || `${KIND_LABELS[input.kind]}新用户`, mobile: input.mobile, role, ...(input.classId ? { classId: input.classId } : {}), reason: '管理后台创建用户', expectedVersion: 1, operationId: this.id() });
    return result.ok ? ok(this.toUser(result.data, input.schoolId)) : fail(result.error.code, result.error.message);
  }
  async updateUser(userId: string, name: string, _roleLabel: string, expectedVersion: number): Promise<ServiceResult<UserAccount>> {
    const result = await this.runtime.organization.updateUser({ userId, displayName: name, reason: '管理后台编辑用户', expectedVersion, operationId: this.id() });
    return result.ok ? ok(this.toUser(result.data, 'organization-current')) : fail(result.error.code, result.error.message);
  }
  async disableUser(userId: string, expectedVersion: number): Promise<ServiceResult<UserAccount>> {
    const result = await this.runtime.organization.disableUser({ userId, reason: '管理后台停用用户', expectedVersion, operationId: this.id() });
    return result.ok ? ok(this.toUser(result.data, 'organization-current')) : fail(result.error.code, result.error.message);
  }
  async resetPassword(): Promise<ServiceResult<{ resetTicket: string }>> { return fail('SERVICE_UNAVAILABLE', '密码重置需走后台账号安全流程。'); }
  async updateBindingCount(): Promise<ServiceResult<UserAccount>> { return fail('SERVICE_UNAVAILABLE', '绑定关系请使用亲子关系管理流程。'); }
  async updateRole(input: UpdateRoleInput): Promise<ServiceResult<RoleDefinition>> {
    const role = input.roleId.replace(/^role-/, '') as UserRole;
    const list = await this.runtime.organization.listRoleAssignments({ filter: { role, status: 'active' }, page: { limit: 1, offset: 0 } });
    if (!list.ok || list.data.items.length === 0) return fail(list.ok ? 'NOT_FOUND' : list.error.code, list.ok ? '角色不存在' : list.error.message);
    const assignment = list.data.items[0]!;
    const permissions = input.permissions.map((permission) => Object.entries(CLOUD_TO_PERMISSION).find(([, value]) => value === permission)?.[0] as RolePermission | undefined).filter((value): value is RolePermission => value !== undefined);
    const result = await this.runtime.organization.assignRole({ userId: assignment.userId, role, permissions, scopeType: input.dataScope === 'all-schools' ? 'organization' : 'classes', scopeIds: input.schoolIds, reason: '管理后台发布权限', expectedVersion: input.expectedVersion, operationId: this.id() });
    return result.ok ? ok(this.toRole(result.data, input.schoolIds)) : fail(result.error.code, result.error.message);
  }

  private id(): string { this.operation += 1; return `admin-ui-${Date.now().toString(36)}-${this.operation.toString(36).padStart(8, '0')}`; }
  private toClass(item: { id: string; name: string; grade: string; term: string; status: 'active' | 'archived'; version: number; studentCount?: number; teacherIds?: readonly string[] }, schoolId: string): ClassRoom { return { id: item.id, schoolId, name: item.name, grade: item.grade, term: item.term, teacherIds: [...(item.teacherIds ?? [])], studentCount: item.studentCount ?? 0, status: item.status === 'active' ? 'active' : 'disabled', version: item.version }; }
  private toUser(item: AdminUserView, schoolId: string): UserAccount { const role = item.roles[0] ?? 'student'; const kind: UserKind = role === 'admin' ? 'staff' : role; return { id: item.id, schoolId, name: item.displayName, mobileMasked: item.mobileMasked ?? item.displayNameMasked, kind, roleLabel: ROLE_LABELS[role], classId: item.classIds?.[0], bindingCount: item.bindingCount ?? 0, status: item.status, version: item.version }; }
  private toRole(item: AdminRoleAssignmentView, schoolIds: readonly string[]): RoleDefinition { return { id: `role-${item.role}`, name: ROLE_LABELS[item.role], system: item.role === 'admin', memberCount: 1, permissions: item.permissions.map((permission) => CLOUD_TO_PERMISSION[permission]), dataScope: item.scopeType === 'organization' ? 'all-schools' : 'selected-schools', schoolIds: [...schoolIds], version: item.version }; }
  private toRoles(items: readonly AdminRoleAssignmentView[], schoolId: string): RoleDefinition[] { const byRole = new Map<UserRole, AdminRoleAssignmentView>(); for (const item of items) if (!byRole.has(item.role)) byRole.set(item.role, item); return [...byRole.values()].map((item) => this.toRole(item, item.scopeIds.length ? item.scopeIds : [schoolId])); }
}

function ok<T>(data: T): ServiceResult<T> { return { ok: true, data }; }
function fail<T>(code: string, message: string): ServiceResult<T> { return { ok: false, code, message }; }
