import { adminHasScope, actorHasPermission, teacherHasClassPermission } from './authorization';
import type { OrgContentIdempotencyBoundary } from './idempotency';
import type { OrgContentRepository, OrgContentTransaction } from './repository';
import type { TaskQueryRepository } from '../task-query/repository';
import type { OperationLogRecord } from '../runtime/records';
import {
  OrgContentError,
  ROLE_PERMISSIONS,
  TEACHER_CLASS_PERMISSIONS,
  type Actor,
  type AdminDashboardOverviewView,
  type AdminPageView,
  type ClassEntity,
  type ClassSafeView,
  type OrganizationAuditEntity,
  type OrganizationSafeView,
  type OperationLogSafeView,
  type RoleAssignmentEntity,
  type RoleAssignmentSafeView,
  type RolePermission,
  type RoleScopeType,
  type SliceClock,
  type TeacherClassGrantEntity,
  type TeacherClassPermission,
  type UserEntity,
  type UserRole,
  type UserSafeView,
} from './types';

export interface OrganizationIdGenerator { next(prefix: string): string; }

export interface UserListFilter {
  readonly classId?: string;
  readonly role?: UserRole;
  readonly status?: UserEntity['status'];
  readonly keyword?: string;
}

export interface CreateClassCommand {
  readonly name: string;
  readonly grade: string;
  readonly term: string;
  readonly reason: string;
  readonly expectedVersion: 1;
  readonly operationId: string;
}

export interface UpdateClassCommand extends Omit<CreateClassCommand, 'expectedVersion'> {
  readonly classId: string;
  readonly expectedVersion: number;
}

export interface CreateUserCommand {
  readonly displayName: string;
  readonly mobile: string;
  readonly role: UserRole;
  readonly classId?: string;
  readonly reason: string;
  readonly expectedVersion: 1;
  readonly operationId: string;
}

export interface UpdateUserCommand {
  readonly userId: string;
  readonly displayName: string;
  readonly reason: string;
  readonly expectedVersion: number;
  readonly operationId: string;
}

export interface AssignRoleCommand {
  readonly userId: string;
  readonly role: UserRole;
  readonly permissions: readonly RolePermission[];
  readonly scopeType: RoleScopeType;
  readonly scopeIds: readonly string[];
  readonly reason: string;
  readonly expectedVersion: number;
  readonly operationId: string;
}

export interface AdminPageRequest { readonly limit: number; readonly offset: number; }
export interface RoleAssignmentListFilter {
  readonly userId?: string;
  readonly role?: UserRole;
  readonly status?: RoleAssignmentEntity['status'];
  readonly scopeType?: RoleScopeType;
}
export interface AuditLogListFilter {
  readonly actorUserId?: string;
  readonly action?: string;
  readonly result?: OperationLogRecord['result'];
  readonly targetType?: string;
  readonly from?: string;
  readonly to?: string;
}

type OrganizationAuditMetadata = Readonly<{
  teacherId?: string;
  classId?: string;
  userId?: string;
  role?: UserRole;
}>;

function organizationView(entity: Readonly<{ id: string; name: string; status: 'active' | 'disabled'; timeZone: string; version: number }>): OrganizationSafeView {
  return { id: entity.id, name: entity.name, status: entity.status, timeZone: entity.timeZone, version: entity.version };
}

function classView(entity: ClassEntity, studentCount?: number, teacherIds?: readonly string[]): ClassSafeView {
  return {
    id: entity.id,
    name: entity.name,
    grade: entity.grade,
    term: entity.term,
    status: entity.status,
    version: entity.version,
    ...(studentCount === undefined ? {} : { studentCount }),
    ...(teacherIds === undefined ? {} : { teacherIds: [...teacherIds] }),
  };
}

export function userSafeView(entity: Readonly<{
  id: string;
  displayName: string;
  displayNameMasked: string;
  mobileMasked?: string;
  studentNumber?: string;
  roles: UserSafeView['roles'];
  status: 'active' | 'disabled';
  version: number;
}>, classIds?: readonly string[], bindingCount?: number): UserSafeView {
  return {
    id: entity.id,
    displayName: entity.displayName,
    displayNameMasked: entity.displayNameMasked,
    ...(entity.mobileMasked === undefined ? {} : { mobileMasked: entity.mobileMasked }),
    ...(entity.studentNumber === undefined ? {} : { studentNumber: entity.studentNumber }),
    roles: [...entity.roles],
    status: entity.status,
    version: entity.version,
    ...(classIds === undefined ? {} : { classIds: [...classIds] }),
    ...(bindingCount === undefined ? {} : { bindingCount }),
  };
}

function roleAssignmentView(entity: RoleAssignmentEntity): RoleAssignmentSafeView {
  return {
    id: entity.id,
    userId: entity.userId,
    role: entity.role,
    status: entity.status,
    permissions: [...entity.permissions],
    scopeType: entity.scopeType,
    scopeIds: [...entity.scopeIds],
    version: entity.version,
  };
}

export class OrganizationService {
  public constructor(
    private readonly repository: OrgContentRepository,
    private readonly clock: SliceClock,
    private readonly ids: OrganizationIdGenerator,
    private readonly idempotency: OrgContentIdempotencyBoundary,
    private readonly taskRepository?: TaskQueryRepository,
  ) {}

  public async listOrganizations(actor: Actor): Promise<readonly OrganizationSafeView[]> {
    if (!actorHasPermission(actor, 'organization.read') || !adminHasScope(actor, actor.organizationId)) throw new OrgContentError('FORBIDDEN');
    return (await this.repository.listOrganizations([actor.organizationId])).map(organizationView);
  }

  public async getDashboardOverview(
    actor: Actor,
    range: Readonly<{ from?: string; to?: string }>,
  ): Promise<AdminDashboardOverviewView> {
    this.assertAdminRead(actor, 'organization.read');
    if (this.taskRepository === undefined) throw new OrgContentError('SERVICE_UNAVAILABLE');
    const to = range.to ?? this.clock.nowIso();
    const from = range.from ?? new Date(Date.parse(to) - 7 * 24 * 60 * 60 * 1_000).toISOString();
    const [classes, users, tasks, assignments] = await Promise.all([
      this.repository.listClasses(actor.organizationId),
      this.repository.listUsers(actor.organizationId),
      this.taskRepository.listTasks(actor.organizationId),
      this.taskRepository.listAssignments(actor.organizationId),
    ]);
    const allowedClassIds = new Set(classes
      .filter((item) => adminHasScope(actor, actor.organizationId, item.id))
      .map((item) => item.id));
    const organizationWide = adminHasScope(actor, actor.organizationId);
    const scopedAssignments = assignments.filter((item) => allowedClassIds.has(item.classId));
    const scopedUserIds = new Set(scopedAssignments.map((item) => item.studentId));
    if (!organizationWide) {
      for (const classId of allowedClassIds) {
        const [classUsers, teacherGrants] = await Promise.all([
          this.repository.listUsersForClass(actor.organizationId, classId),
          this.repository.listActiveTeacherGrantsForClass(actor.organizationId, classId),
        ]);
        for (const user of classUsers) scopedUserIds.add(user.id);
        for (const grant of teacherGrants) scopedUserIds.add(grant.teacherId);
      }
    }
    const visibleTasks = tasks.filter((task) => task.status !== 'draft' && task.status !== 'withdrawn'
      && Date.parse(task.startsAt) <= Date.parse(to) && Date.parse(task.dueAt) >= Date.parse(from)
      && (organizationWide || task.targetClassIds.some((classId) => allowedClassIds.has(classId))
        || scopedAssignments.some((assignment) => assignment.taskId === task.id)));
    const visibleTaskIds = new Set(visibleTasks.map((item) => item.id));
    const visibleAssignments = scopedAssignments.filter((item) => visibleTaskIds.has(item.taskId));
    const completedCount = visibleAssignments.filter((item) => item.status === 'completed').length;
    return {
      range: { from, to },
      counts: {
        organizationCount: 1,
        classCount: allowedClassIds.size,
        activeUserCount: users.filter((user) => user.status === 'active'
          && (organizationWide || scopedUserIds.has(user.id))).length,
        taskCount: visibleTasks.length,
      },
      completion: {
        assignmentCount: visibleAssignments.length,
        completedCount,
        completionRate: visibleAssignments.length === 0 ? 0 : Math.round(completedCount * 10_000 / visibleAssignments.length) / 100,
      },
      anomalies: {
        overdueCount: visibleAssignments.filter((item) => item.status === 'overdue').length,
        pendingReviewCount: visibleAssignments.filter((item) => item.status === 'awaiting_review').length,
      },
    };
  }

  public async listRoleAssignments(
    actor: Actor,
    filter: RoleAssignmentListFilter,
    page: AdminPageRequest,
  ): Promise<AdminPageView<RoleAssignmentSafeView>> {
    this.assertAdminRead(actor, 'authorization.manage');
    const assignments = (await this.repository.listRoleAssignments(actor.organizationId, filter.userId))
      .filter((item) => filter.role === undefined || item.role === filter.role)
      .filter((item) => filter.status === undefined || item.status === filter.status)
      .filter((item) => filter.scopeType === undefined || item.scopeType === filter.scopeType);
    const allowed: RoleAssignmentEntity[] = [];
    for (const assignment of assignments) {
      if (await this.canReadRoleAssignment(actor, assignment)) allowed.push(assignment);
    }
    const sorted = allowed.sort((left, right) => left.id.localeCompare(right.id));
    return boundedPage(sorted, page, roleAssignmentView);
  }

  public async listAuditLogs(
    actor: Actor,
    filter: AuditLogListFilter,
    page: AdminPageRequest,
  ): Promise<AdminPageView<OperationLogSafeView>> {
    this.assertAdminRead(actor, 'audit.read');
    const records = await this.repository.listOperationLogs(actor.organizationId, {
      ...(filter.actorUserId === undefined ? {} : { actorUserId: filter.actorUserId }),
      ...(filter.action === undefined ? {} : { action: filter.action }),
      ...(filter.result === undefined ? {} : { result: filter.result }),
      ...(filter.targetType === undefined ? {} : { targetType: filter.targetType }),
    });
    const filtered = records
      .filter((item) => filter.from === undefined || Date.parse(item.occurredAt) >= Date.parse(filter.from))
      .filter((item) => filter.to === undefined || Date.parse(item.occurredAt) <= Date.parse(filter.to))
      .filter((item) => this.canReadAuditRecord(actor, item))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id));
    return boundedPage(filtered, page, operationLogView);
  }

  public async listClasses(actor: Actor): Promise<readonly ClassSafeView[]> {
    const classes = await this.repository.listClasses(actor.organizationId);
    if (actor.actorRole === 'admin') {
      if (!actorHasPermission(actor, 'class.read')) throw new OrgContentError('FORBIDDEN');
      const allowed = classes.filter((item) => adminHasScope(actor, item.organizationId, item.id));
      return Promise.all(allowed.map(async (item) => {
        const [memberships, grants] = await Promise.all([
          this.repository.listActiveMembershipsForClass(actor.organizationId, item.id),
          this.repository.listActiveTeacherGrantsForClass(actor.organizationId, item.id),
        ]);
        return classView(item, memberships.length, grants.map((grant) => grant.teacherId));
      }));
    }
    if (actor.actorRole !== 'teacher' || !actorHasPermission(actor, 'class.read')) throw new OrgContentError('FORBIDDEN');
    const allowed: ClassSafeView[] = [];
    for (const item of classes) {
      if (await teacherHasClassPermission(this.repository, actor, item.id, 'class.read')) allowed.push(classView(item));
    }
    return allowed;
  }

  public async createClass(actor: Actor, command: CreateClassCommand): Promise<ClassSafeView> {
    return this.idempotency.execute({
      actor, functionName: 'organization-admin', action: 'createClass', operationId: command.operationId,
      expectedVersion: command.expectedVersion,
      payload: { name: command.name, grade: command.grade, term: command.term, reason: command.reason },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'class.created', 'class', 'new', command.reason, error, {}, transaction),
      perform: async (transaction) => this.performAudited(actor, 'class.created', 'class', 'new', command.reason, async () => {
        this.assertAdminPermission(actor, 'class.manage', actor.organizationId);
        return this.runTransaction(transaction, async (currentTransaction) => {
          if (await currentTransaction.findClassByName(actor.organizationId, command.name) !== null) throw new OrgContentError('CONFLICT');
          const entity: ClassEntity = { id: this.ids.next('cls'), organizationId: actor.organizationId, name: command.name, grade: command.grade, term: command.term, status: 'active', version: 1 };
          await currentTransaction.saveClass(entity);
          await currentTransaction.appendOrganizationAudit(this.successAudit(actor, 'class.created', 'class', entity.id, command.reason, { classId: entity.id }));
          return classView(entity, 0, []);
        });
      }, transaction),
    });
  }

  public async updateClass(actor: Actor, command: UpdateClassCommand): Promise<ClassSafeView> {
    return this.idempotency.execute({
      actor, functionName: 'organization-admin', action: 'updateClass', operationId: command.operationId,
      expectedVersion: command.expectedVersion,
      payload: { classId: command.classId, name: command.name, grade: command.grade, term: command.term, reason: command.reason },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'class.updated', 'class', command.classId, command.reason, error, {}, transaction),
      perform: async (transaction) => this.performAudited(actor, 'class.updated', 'class', command.classId, command.reason, async () => {
        this.assertAdminPermission(actor, 'class.manage', command.classId);
        return this.runTransaction(transaction, async (currentTransaction) => {
          const current = await currentTransaction.findClass(actor.organizationId, command.classId);
          if (current === null) throw new OrgContentError('NOT_FOUND');
          if (current.version !== command.expectedVersion) throw new OrgContentError('CONFLICT');
          const duplicate = await currentTransaction.findClassByName(actor.organizationId, command.name);
          if (duplicate !== null && duplicate.id !== current.id) throw new OrgContentError('CONFLICT');
          const updated: ClassEntity = { ...current, name: command.name, grade: command.grade, term: command.term, version: current.version + 1 };
          await currentTransaction.saveClass(updated);
          await currentTransaction.appendOrganizationAudit(this.successAudit(actor, 'class.updated', 'class', updated.id, command.reason, { classId: updated.id }));
          return classView(updated);
        });
      }, transaction),
    });
  }

  public async disableClass(actor: Actor, classId: string, expectedVersion: number, reason: string, operationId: string): Promise<ClassSafeView> {
    return this.idempotency.execute({
      actor, functionName: 'organization-admin', action: 'disableClass', operationId, expectedVersion,
      payload: { classId, reason },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'class.disabled', 'class', classId, reason, error, {}, transaction),
      perform: async (transaction) => this.performAudited(actor, 'class.disabled', 'class', classId, reason, async () => {
        this.assertAdminPermission(actor, 'class.manage', classId);
        return this.runTransaction(transaction, async (currentTransaction) => {
          const current = await currentTransaction.findClass(actor.organizationId, classId);
          if (current === null) throw new OrgContentError('NOT_FOUND');
          if (current.version !== expectedVersion || current.status !== 'active') throw new OrgContentError('CONFLICT');
          if (await currentTransaction.countActiveMembershipsForClass(actor.organizationId, classId) > 0) throw new OrgContentError('CONFLICT');
          const disabled: ClassEntity = { ...current, status: 'archived', version: current.version + 1 };
          await currentTransaction.saveClass(disabled);
          await currentTransaction.appendOrganizationAudit(this.successAudit(actor, 'class.disabled', 'class', classId, reason, { classId }));
          return classView(disabled, 0);
        });
      }, transaction),
    });
  }

  public async getMyUser(actor: Actor): Promise<UserSafeView> {
    const user = await this.repository.findUser(actor.organizationId, actor.actorUserId);
    if (user === null || user.status !== 'active') throw new OrgContentError('NOT_FOUND');
    return userSafeView(user);
  }

  public async listUsers(actor: Actor, filter: UserListFilter): Promise<readonly UserSafeView[]> {
    if (actor.actorRole !== 'admin' || !actorHasPermission(actor, 'user.read')) throw new OrgContentError('FORBIDDEN');
    if (filter.classId !== undefined) {
      if (!adminHasScope(actor, actor.organizationId, filter.classId)) throw new OrgContentError('FORBIDDEN');
      if (await this.repository.findClass(actor.organizationId, filter.classId) === null) throw new OrgContentError('NOT_FOUND');
    } else if (!adminHasScope(actor, actor.organizationId)) throw new OrgContentError('FORBIDDEN');
    const users = filter.classId === undefined ? await this.repository.listUsers(actor.organizationId) : await this.repository.listUsersForClass(actor.organizationId, filter.classId);
    const keyword = filter.keyword?.toLocaleLowerCase();
    return users
      .filter((user) => filter.role === undefined || user.roles.includes(filter.role))
      .filter((user) => filter.status === undefined || user.status === filter.status)
      .filter((user) => keyword === undefined || user.displayName.toLocaleLowerCase().includes(keyword) || user.studentNumber?.toLocaleLowerCase().includes(keyword) === true)
      .map((user) => userSafeView(user));
  }

  public async listUsersForClass(actor: Actor, classId: string): Promise<readonly UserSafeView[]> {
    if (actor.actorRole === 'admin') return this.listUsers(actor, { classId });
    const classEntity = await this.repository.findClass(actor.organizationId, classId);
    if (classEntity === null || classEntity.status !== 'active') throw new OrgContentError('NOT_FOUND');
    if (!await teacherHasClassPermission(this.repository, actor, classId, 'student.read')) throw new OrgContentError('FORBIDDEN');
    return (await this.repository.listUsersForClass(actor.organizationId, classId)).map((user) => userSafeView(user));
  }

  public async createUser(actor: Actor, command: CreateUserCommand): Promise<UserSafeView> {
    return this.idempotency.execute({
      actor, functionName: 'organization-admin', action: 'createUser', operationId: command.operationId,
      expectedVersion: command.expectedVersion,
      payload: { displayName: command.displayName, mobile: command.mobile, role: command.role, classId: command.classId ?? null, reason: command.reason },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'user.created', 'user', 'new', command.reason, error, {}, transaction),
      perform: async (transaction) => this.performAudited(actor, 'user.created', 'user', 'new', command.reason, async () => {
        this.assertAdminPermission(actor, 'user.manage', command.classId ?? actor.organizationId);
        if (command.role === 'admin' && !actorHasPermission(actor, 'authorization.manage')) throw new OrgContentError('FORBIDDEN');
        return this.runTransaction(transaction, async (currentTransaction) => {
          let targetClass: ClassEntity | null = null;
          if (command.classId !== undefined) {
            targetClass = await currentTransaction.findClass(actor.organizationId, command.classId);
            if (targetClass === null || targetClass.status !== 'active') throw new OrgContentError('NOT_FOUND');
          }
          const now = this.clock.nowIso();
          const userId = this.ids.next('usr');
          const user: UserEntity = {
            id: userId, organizationId: actor.organizationId, displayName: command.displayName,
            displayNameMasked: maskDisplayName(command.displayName), mobileMasked: maskMobile(command.mobile),
            ...(command.role === 'student' ? { studentNumber: `STU-DEMO-${userId.replace(/\D/g, '').padStart(4, '0')}` } : {}),
            roles: [command.role], status: 'active', authorizationVersion: 1, version: 1,
          };
          await currentTransaction.saveUser(user);
          const defaults = defaultRoleAccess(command.role, userId, command.classId, actor.organizationId);
          await currentTransaction.saveRoleAssignment({
            id: this.ids.next('role'), organizationId: actor.organizationId, userId, role: command.role, status: 'active',
            permissions: defaults.permissions, scopeType: defaults.scopeType, scopeIds: defaults.scopeIds,
            grantedBy: actor.actorUserId, grantedAt: now, version: 1,
          });
          if (targetClass !== null) {
            await currentTransaction.saveMembership({ id: this.ids.next('mem'), organizationId: actor.organizationId, classId: targetClass.id, studentId: userId, status: 'active', version: 1 });
            await currentTransaction.saveClass({ ...targetClass, version: targetClass.version + 1 });
          }
          await currentTransaction.appendOrganizationAudit(this.successAudit(actor, 'user.created', 'user', userId, command.reason, { userId }));
          return userSafeView(user, command.classId === undefined ? [] : [command.classId], 0);
        });
      }, transaction),
    });
  }

  public async disableUser(actor: Actor, userId: string, expectedVersion: number, reason: string, operationId: string): Promise<UserSafeView> {
    return this.idempotency.execute({
      actor, functionName: 'organization-admin', action: 'disableUser', operationId, expectedVersion,
      payload: { userId, reason },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'user.disabled', 'user', userId, reason, error, {}, transaction),
      perform: async (transaction) => this.performAudited(actor, 'user.disabled', 'user', userId, reason, async () => {
        if (userId === actor.actorUserId || actor.actorRole !== 'admin' || !actorHasPermission(actor, 'user.manage')) throw new OrgContentError('FORBIDDEN');
        return this.runTransaction(transaction, async (currentTransaction) => {
          const current = await currentTransaction.findUser(actor.organizationId, userId);
          if (current === null) throw new OrgContentError('NOT_FOUND');
          if (current.version !== expectedVersion || current.status !== 'active') throw new OrgContentError('CONFLICT');
          const memberships = await currentTransaction.listActiveMembershipsForStudent(actor.organizationId, userId);
          if (!adminHasScope(actor, actor.organizationId) && !memberships.some((membership) => actor.scopeIds.includes(membership.classId))) throw new OrgContentError('FORBIDDEN');
          for (const membership of memberships) {
            await currentTransaction.saveMembership({ ...membership, status: 'inactive', version: membership.version + 1 });
            const classEntity = await currentTransaction.findClass(actor.organizationId, membership.classId);
            if (classEntity !== null) await currentTransaction.saveClass({ ...classEntity, version: classEntity.version + 1 });
          }
          const disabled: UserEntity = { ...current, status: 'disabled', version: current.version + 1 };
          await currentTransaction.saveUser(disabled);
          await currentTransaction.appendOrganizationAudit(this.successAudit(actor, 'user.disabled', 'user', userId, reason, { userId }));
          return userSafeView(disabled, []);
        });
      }, transaction),
    });
  }

  public async updateUser(actor: Actor, command: UpdateUserCommand): Promise<UserSafeView> {
    return this.idempotency.execute({
      actor, functionName: 'organization-admin', action: 'user.updated', operationId: command.operationId,
      expectedVersion: command.expectedVersion, payload: { userId: command.userId, displayName: command.displayName, reason: command.reason },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'user.updated', 'user', command.userId, command.reason, error, { userId: command.userId }, transaction),
      perform: async (transaction) => this.performAudited(actor, 'user.updated', 'user', command.userId, command.reason, async () => {
        if (actor.actorRole !== 'admin' || !actorHasPermission(actor, 'user.manage')) throw new OrgContentError('FORBIDDEN');
        return this.runTransaction(transaction, async (currentTransaction) => {
          const current = await currentTransaction.findUser(actor.organizationId, command.userId);
          if (current === null) throw new OrgContentError('NOT_FOUND');
          if (current.version !== command.expectedVersion || current.status !== 'active') throw new OrgContentError('CONFLICT');
          if (!adminHasScope(actor, actor.organizationId)) {
            const memberships = await currentTransaction.listActiveMembershipsForStudent(actor.organizationId, command.userId);
            if (!memberships.some((membership) => actor.scopeIds.includes(membership.classId))) throw new OrgContentError('FORBIDDEN');
          }
          const updated: UserEntity = { ...current, displayName: command.displayName, displayNameMasked: maskDisplayName(command.displayName), version: current.version + 1, authorizationVersion: current.authorizationVersion + 1 };
          await currentTransaction.saveUser(updated);
          await currentTransaction.appendOrganizationAudit(this.successAudit(actor, 'user.updated', 'user', command.userId, command.reason, { userId: command.userId }));
          const memberships = await currentTransaction.listActiveMembershipsForStudent(actor.organizationId, command.userId);
          return userSafeView(updated, memberships.map((membership) => membership.classId));
        });
      }, transaction),
    });
  }

  public async assignRole(actor: Actor, command: AssignRoleCommand): Promise<RoleAssignmentSafeView> {
    return this.idempotency.execute({
      actor, functionName: 'organization-admin', action: 'assignRole', operationId: command.operationId,
      expectedVersion: command.expectedVersion,
      payload: { userId: command.userId, role: command.role, permissions: [...command.permissions], scopeType: command.scopeType, scopeIds: [...command.scopeIds], reason: command.reason },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'role.assigned', 'role_assignment', command.userId, command.reason, error, { userId: command.userId, role: command.role }, transaction),
      perform: async (transaction) => this.performAudited(actor, 'role.assigned', 'role_assignment', command.userId, command.reason, async () => {
        this.assertRoleManagementAccess(actor, command.userId, command.permissions, command.scopeType, command.scopeIds);
        return this.runTransaction(transaction, async (currentTransaction) => {
          const [user, existing] = await Promise.all([currentTransaction.findUser(actor.organizationId, command.userId), currentTransaction.findRoleAssignment(actor.organizationId, command.userId, command.role)]);
          if (user === null || user.status !== 'active') throw new OrgContentError('NOT_FOUND');
          if ((existing?.version ?? 1) !== command.expectedVersion) throw new OrgContentError('CONFLICT');
          const assignment: RoleAssignmentEntity = {
            id: existing?.id ?? this.ids.next('role'), organizationId: actor.organizationId, userId: command.userId,
            role: command.role, status: 'active', permissions: [...new Set(command.permissions)], scopeType: command.scopeType,
            scopeIds: [...new Set(command.scopeIds)], grantedBy: actor.actorUserId, grantedAt: this.clock.nowIso(), version: (existing?.version ?? 0) + 1,
          };
          await currentTransaction.saveRoleAssignment(assignment);
          await currentTransaction.saveUser({
            ...user,
            roles: user.roles.includes(command.role) ? user.roles : [...user.roles, command.role],
            authorizationVersion: user.authorizationVersion + 1,
            version: user.version + 1,
          });
          await currentTransaction.appendOrganizationAudit(this.successAudit(actor, 'role.assigned', 'role_assignment', assignment.id, command.reason, { userId: command.userId, role: command.role }));
          return roleAssignmentView(assignment);
        });
      }, transaction),
    });
  }

  public async revokeRole(actor: Actor, userId: string, role: UserRole, expectedVersion: number, reason: string, operationId: string): Promise<RoleAssignmentSafeView> {
    return this.idempotency.execute({
      actor, functionName: 'organization-admin', action: 'revokeRole', operationId, expectedVersion,
      payload: { userId, role, reason },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'role.revoked', 'role_assignment', userId, reason, error, { userId, role }, transaction),
      perform: async (transaction) => this.performAudited(actor, 'role.revoked', 'role_assignment', userId, reason, async () => {
        this.assertRoleManagementAccess(actor, userId, [], 'self', [userId]);
        return this.runTransaction(transaction, async (currentTransaction) => {
          const [user, current] = await Promise.all([currentTransaction.findUser(actor.organizationId, userId), currentTransaction.findRoleAssignment(actor.organizationId, userId, role)]);
          if (user === null || current === null || current.status !== 'active') throw new OrgContentError('NOT_FOUND');
          if (current.version !== expectedVersion) throw new OrgContentError('CONFLICT');
          const revoked: RoleAssignmentEntity = { ...current, status: 'revoked', revokedAt: this.clock.nowIso(), revokedBy: actor.actorUserId, revokeReason: reason, version: current.version + 1 };
          await currentTransaction.saveRoleAssignment(revoked);
          await currentTransaction.saveUser({
            ...user,
            roles: user.roles.filter((item) => item !== role),
            authorizationVersion: user.authorizationVersion + 1,
            version: user.version + 1,
          });
          await currentTransaction.appendOrganizationAudit(this.successAudit(actor, 'role.revoked', 'role_assignment', revoked.id, reason, { userId, role }));
          return roleAssignmentView(revoked);
        });
      }, transaction),
    });
  }

  public async grantTeacherClass(actor: Actor, teacherId: string, classId: string, permissions: readonly TeacherClassPermission[], expectedVersion: number, reason: string, operationId: string): Promise<TeacherClassGrantEntity> {
    return this.idempotency.execute({
      actor, functionName: 'organization-admin', action: 'grantTeacherClass', operationId, expectedVersion,
      payload: { teacherId, classId, permissions: [...permissions], reason },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'teacher_class.granted', 'teacher_class_grant', `${teacherId}:${classId}`, reason, error, { teacherId, classId }, transaction),
      perform: async (transaction) => this.performAudited(actor, 'teacher_class.granted', 'teacher_class_grant', `${teacherId}:${classId}`, reason, async () => {
        this.assertAdminPermission(actor, 'authorization.manage', classId);
        if (permissions.length === 0 || permissions.some((permission) => !TEACHER_CLASS_PERMISSIONS.includes(permission))) throw new OrgContentError('VALIDATION_ERROR');
        return this.runTransaction(transaction, async (currentTransaction) => {
          const [teacher, classEntity, existing] = await Promise.all([currentTransaction.findUser(actor.organizationId, teacherId), currentTransaction.findClass(actor.organizationId, classId), currentTransaction.findTeacherGrant(actor.organizationId, teacherId, classId)]);
          if (teacher === null || teacher.status !== 'active' || !teacher.roles.includes('teacher') || classEntity === null || classEntity.status !== 'active') throw new OrgContentError('NOT_FOUND');
          if ((existing?.version ?? 1) !== expectedVersion) throw new OrgContentError('CONFLICT');
          const grant: TeacherClassGrantEntity = {
            id: existing?.id ?? this.ids.next('tcg'), organizationId: actor.organizationId, teacherId, classId,
            permissions: [...new Set(permissions)], status: 'active', grantedBy: actor.actorUserId,
            grantedAt: this.clock.nowIso(), version: (existing?.version ?? 0) + 1,
          };
          await currentTransaction.saveTeacherGrant(grant);
          await currentTransaction.saveUser({
            ...teacher,
            authorizationVersion: teacher.authorizationVersion + 1,
            version: teacher.version + 1,
          });
          await currentTransaction.appendOrganizationAudit(this.successAudit(actor, 'teacher_class.granted', 'teacher_class_grant', grant.id, reason, { teacherId, classId }));
          return grant;
        });
      }, transaction),
    });
  }

  public async revokeTeacherClass(actor: Actor, teacherId: string, classId: string, expectedVersion: number, reason: string, operationId: string): Promise<TeacherClassGrantEntity> {
    return this.idempotency.execute({
      actor, functionName: 'organization-admin', action: 'revokeTeacherClass', operationId, expectedVersion,
      payload: { teacherId, classId, reason },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(actor, 'teacher_class.revoked', 'teacher_class_grant', `${teacherId}:${classId}`, reason, error, { teacherId, classId }, transaction),
      perform: async (transaction) => this.performAudited(actor, 'teacher_class.revoked', 'teacher_class_grant', `${teacherId}:${classId}`, reason, async () => {
        this.assertAdminPermission(actor, 'authorization.manage', classId);
        return this.runTransaction(transaction, async (currentTransaction) => {
          const [current, teacher] = await Promise.all([
            currentTransaction.findActiveTeacherGrant(actor.organizationId, teacherId, classId),
            currentTransaction.findUser(actor.organizationId, teacherId),
          ]);
          if (current === null || teacher === null || teacher.status !== 'active') throw new OrgContentError('NOT_FOUND');
          if (current.version !== expectedVersion) throw new OrgContentError('CONFLICT');
          const revoked: TeacherClassGrantEntity = { ...current, status: 'revoked', revokedAt: this.clock.nowIso(), version: current.version + 1 };
          await currentTransaction.saveTeacherGrant(revoked);
          await currentTransaction.saveUser({
            ...teacher,
            authorizationVersion: teacher.authorizationVersion + 1,
            version: teacher.version + 1,
          });
          await currentTransaction.appendOrganizationAudit(this.successAudit(actor, 'teacher_class.revoked', 'teacher_class_grant', revoked.id, reason, { teacherId, classId }));
          return revoked;
        });
      }, transaction),
    });
  }

  private assertAdminPermission(actor: Actor, permission: string, scopeId: string): void {
    if (actor.actorRole !== 'admin' || !actorHasPermission(actor, permission) || !adminHasScope(actor, actor.organizationId, scopeId)) throw new OrgContentError('FORBIDDEN');
  }

  private assertAdminRead(actor: Actor, permission: string): void {
    if (actor.actorRole !== 'admin' || !actorHasPermission(actor, permission)
      || actor.scopeIds.length === 0) throw new OrgContentError('FORBIDDEN');
  }

  private async canReadRoleAssignment(actor: Actor, assignment: RoleAssignmentEntity): Promise<boolean> {
    if (adminHasScope(actor, actor.organizationId)) return true;
    if (assignment.scopeType === 'organization') return false;
    if (assignment.scopeType === 'classes') {
      return assignment.scopeIds.length > 0 && assignment.scopeIds.every((scopeId) => actor.scopeIds.includes(scopeId));
    }
    const memberships = await this.repository.listActiveMembershipsForStudent(actor.organizationId, assignment.userId);
    return memberships.some((item) => actor.scopeIds.includes(item.classId));
  }

  private canReadAuditRecord(actor: Actor, record: OperationLogRecord): boolean {
    if (adminHasScope(actor, actor.organizationId)) return true;
    const metadataClassId = typeof record.metadata.classId === 'string' ? record.metadata.classId : null;
    const targetClassId = record.targetType === 'class' && record.targetId !== null ? record.targetId : null;
    const classId = metadataClassId ?? targetClassId;
    return classId !== null && actor.scopeIds.includes(classId);
  }

  private assertRoleManagementAccess(actor: Actor, targetUserId: string, permissions: readonly RolePermission[], scopeType: RoleScopeType, scopeIds: readonly string[]): void {
    if (targetUserId === actor.actorUserId || actor.actorRole !== 'admin' || !actorHasPermission(actor, 'authorization.manage')) throw new OrgContentError('FORBIDDEN');
    if (permissions.some((permission) => !ROLE_PERMISSIONS.includes(permission)) || scopeIds.length === 0) throw new OrgContentError('VALIDATION_ERROR');
    const hasOrganizationScope = adminHasScope(actor, actor.organizationId);
    if (!hasOrganizationScope && scopeIds.some((scopeId) => !actor.scopeIds.includes(scopeId))) throw new OrgContentError('FORBIDDEN');
    if (scopeType === 'organization' && (!hasOrganizationScope || !scopeIds.includes(actor.organizationId))) throw new OrgContentError('FORBIDDEN');
    if (scopeType === 'self' && (scopeIds.length !== 1 || scopeIds[0] !== targetUserId)) throw new OrgContentError('VALIDATION_ERROR');
  }

  private async performAudited<T>(actor: Actor, action: OrganizationAuditEntity['action'], targetType: NonNullable<OrganizationAuditEntity['targetType']>, targetId: string, reason: string, perform: () => Promise<T>, transaction?: OrgContentTransaction): Promise<T> {
    try { return await perform(); }
    catch (error: unknown) {
      if (error instanceof OrgContentError) {
        await this.writeDeniedAudit(actor, action, targetType, targetId, reason, error, {}, transaction);
      }
      throw error;
    }
  }

  private successAudit(actor: Actor, action: OrganizationAuditEntity['action'], targetType: OrganizationAuditEntity['targetType'], targetId: string, reason: string, extra: OrganizationAuditMetadata = {}): OrganizationAuditEntity {
    return {
      id: this.ids.next('org_audit'),
      organizationId: actor.organizationId,
      requestId: actor.requestId,
      actorUserId: actor.actorUserId,
      actorRole: actor.actorRole,
      action,
      targetType,
      targetId,
      result: 'succeeded',
      errorCode: null,
      metadata: { ...extra, reasonProvided: reason.trim().length > 0, reasonLength: reason.length },
      occurredAt: this.clock.nowIso(),
    };
  }

  private async writeDeniedAudit(actor: Actor, action: OrganizationAuditEntity['action'], targetType: OrganizationAuditEntity['targetType'], targetId: string, requestedReason: string, error: unknown, extra: OrganizationAuditMetadata = {}, transaction?: OrgContentTransaction): Promise<void> {
    const failureCode = error instanceof OrgContentError ? error.code : 'INTERNAL_ERROR';
    await this.runTransaction(transaction, async (currentTransaction) => currentTransaction.appendOrganizationAudit({
      id: this.ids.next('org_audit'),
      organizationId: actor.organizationId,
      requestId: actor.requestId,
      actorUserId: actor.actorUserId,
      actorRole: actor.actorRole,
      action,
      targetType,
      targetId,
      result: error instanceof OrgContentError ? 'denied' : 'failed',
      errorCode: failureCode,
      metadata: {
        ...extra,
        reasonProvided: requestedReason.trim().length > 0,
        reasonLength: requestedReason.length,
      },
      occurredAt: this.clock.nowIso(),
    }));
  }

  private runTransaction<T>(
    transaction: OrgContentTransaction | undefined,
    work: (current: OrgContentTransaction) => Promise<T>,
  ): Promise<T> {
    return transaction === undefined ? this.repository.transaction(work) : work(transaction);
  }
}

const ADMIN_RESULT_WINDOW = 1_000;
const AUDIT_METADATA_KEYS = [
  'classId', 'role', 'scopeType', 'permissionCount', 'affectedCount',
  'authorizationVersion', 'reasonProvided',
] as const;

function boundedPage<T, V>(
  values: readonly T[],
  page: AdminPageRequest,
  project: (value: T) => V,
): AdminPageView<V> {
  if (values.length > ADMIN_RESULT_WINDOW) throw new OrgContentError('SERVICE_UNAVAILABLE');
  const items = values.slice(page.offset, page.offset + page.limit).map(project);
  const nextOffset = page.offset + items.length < values.length ? page.offset + items.length : null;
  return { items, total: values.length, nextOffset };
}

function operationLogView(entity: OperationLogRecord): OperationLogSafeView {
  const metadata: Record<string, import('../shared/protocol').JsonValue> = {};
  for (const key of AUDIT_METADATA_KEYS) {
    const value = entity.metadata[key];
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      metadata[key] = value;
    }
  }
  return {
    id: entity.id,
    requestId: entity.requestId,
    actorUserId: entity.actorUserId,
    actorRole: entity.actorRole,
    action: entity.action,
    targetType: entity.targetType,
    targetId: entity.targetId,
    result: entity.result,
    errorCode: entity.errorCode,
    metadata,
    occurredAt: entity.occurredAt,
  };
}

function maskMobile(mobile: string): string { return `${mobile.slice(0, 3)}****${mobile.slice(-4)}`; }
function maskDisplayName(name: string): string { return name.length <= 1 ? name : `${name[0]}${'*'.repeat(Math.min(2, name.length - 1))}`; }

function defaultRoleAccess(role: UserRole, userId: string, classId: string | undefined, organizationId: string): Readonly<{ permissions: readonly RolePermission[]; scopeType: RoleScopeType; scopeIds: readonly string[] }> {
  switch (role) {
    case 'student': return { permissions: ['content.read', 'task.read'], scopeType: 'self', scopeIds: [userId] };
    case 'parent': return { permissions: ['child.read', 'child.bind', 'child.unbind'], scopeType: 'self', scopeIds: [userId] };
    case 'teacher': return { permissions: ['class.read'], scopeType: classId === undefined ? 'organization' : 'classes', scopeIds: [classId ?? organizationId] };
    case 'admin': return { permissions: ['organization.read'], scopeType: 'organization', scopeIds: [organizationId] };
  }
}
