import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import {
  ORGANIZATION_ADMIN_ACTIONS,
  validateOrganizationAdminRequest,
} from '../../src/contracts/org-content-functions';
import {
  OrgContentError,
  type AdminDashboardOverviewView,
  type AdminPageView,
  type ClassSafeView,
  type OperationLogSafeView,
  type RoleAssignmentSafeView,
  type RolePermission,
  type RoleScopeType,
  type TeacherClassGrantEntity,
  type TeacherClassPermission,
  type UserRole,
  type UserSafeView,
} from '../../src/org-content/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, failure, success } from '../../src/shared/result';
import { createOrgContentFailureMapper } from '../shared/org-content-failure';
import { QuestionAdminError, type QuestionAdminDetail, type QuestionAdminPage } from '../../src/question-admin/types';
import type { QuestionAdminService } from '../../src/question-admin/service';
import { StudentWorkAdminError, type DeletedWorkDraftPage, type RestoredWorkDraftView,
  type StudentWorkAdminService } from '../../src/student-work/admin-service';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export type OrganizationAdminOutput =
  | readonly ClassSafeView[]
  | readonly UserSafeView[]
  | ClassSafeView
  | UserSafeView
  | RoleAssignmentSafeView
  | TeacherClassGrantEntity
  | AdminDashboardOverviewView
  | AdminPageView<RoleAssignmentSafeView>
  | AdminPageView<OperationLogSafeView>
  | QuestionAdminDetail
  | readonly QuestionAdminDetail[]
  | QuestionAdminPage
  | DeletedWorkDraftPage
  | RestoredWorkDraftView;

export interface OrganizationAdminHandler {
  getDashboardOverview(actor: TrustedActorContext, range: Readonly<{ from?: string; to?: string }>): Promise<AdminDashboardOverviewView>;
  listRoleAssignments(actor: TrustedActorContext, filter: Readonly<{ userId?: string; role?: UserRole; status?: 'active' | 'revoked'; scopeType?: RoleScopeType }>, page: Readonly<{ limit: number; offset: number }>): Promise<AdminPageView<RoleAssignmentSafeView>>;
  listAuditLogs(actor: TrustedActorContext, filter: Readonly<{ actorUserId?: string; action?: string; result?: 'succeeded' | 'denied' | 'failed'; targetType?: string; from?: string; to?: string }>, page: Readonly<{ limit: number; offset: number }>): Promise<AdminPageView<OperationLogSafeView>>;
  listClasses(actor: TrustedActorContext): Promise<readonly ClassSafeView[]>;
  createClass(actor: TrustedActorContext, command: Readonly<{ name: string; grade: string; term: string; reason: string; expectedVersion: 1; operationId: string }>): Promise<ClassSafeView>;
  updateClass(actor: TrustedActorContext, command: Readonly<{ classId: string; name: string; grade: string; term: string; reason: string; expectedVersion: number; operationId: string }>): Promise<ClassSafeView>;
  disableClass(actor: TrustedActorContext, classId: string, expectedVersion: number, reason: string, operationId: string): Promise<ClassSafeView>;
  listUsers(actor: TrustedActorContext, filter: Readonly<{ classId?: string; role?: UserRole; status?: 'active' | 'disabled'; keyword?: string }>): Promise<readonly UserSafeView[]>;
  createUser(actor: TrustedActorContext, command: Readonly<{ displayName: string; mobile: string; role: UserRole; classId?: string; reason: string; expectedVersion: 1; operationId: string }>): Promise<UserSafeView>;
  updateUser(actor: TrustedActorContext, command: Readonly<{ userId: string; displayName: string; reason: string; expectedVersion: number; operationId: string }>): Promise<UserSafeView>;
  disableUser(actor: TrustedActorContext, userId: string, expectedVersion: number, reason: string, operationId: string): Promise<UserSafeView>;
  assignRole(actor: TrustedActorContext, command: Readonly<{ userId: string; role: UserRole; permissions: readonly RolePermission[]; scopeType: RoleScopeType; scopeIds: readonly string[]; reason: string; expectedVersion: number; operationId: string }>): Promise<RoleAssignmentSafeView>;
  revokeRole(actor: TrustedActorContext, userId: string, role: UserRole, expectedVersion: number, reason: string, operationId: string): Promise<RoleAssignmentSafeView>;
  grantTeacherClass(
    actor: TrustedActorContext,
    teacherId: string,
    classId: string,
    permissions: readonly TeacherClassPermission[],
    expectedVersion: number,
    reason: string,
    operationId: string,
  ): Promise<TeacherClassGrantEntity>;
  revokeTeacherClass(
    actor: TrustedActorContext,
    teacherId: string,
    classId: string,
    expectedVersion: number,
    reason: string,
    operationId: string,
  ): Promise<TeacherClassGrantEntity>;
}

export interface OrganizationAdminFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: OrganizationAdminHandler;
  readonly questions: QuestionAdminService;
  readonly studentWorks: StudentWorkAdminService;
}

export function createOrganizationAdminFunction(dependencies: OrganizationAdminFunctionDependencies) {
  return createTrustedFunction(
    'organization-admin',
    ORGANIZATION_ADMIN_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => error instanceof StudentWorkAdminError ? error.code
      : error instanceof QuestionAdminError ? error.code
      : createOrgContentFailureMapper(dependencies.mapFailure)(phase, error) },
    validateOrganizationAdminRequest,
    async (input, actor): Promise<ServiceResult<OrganizationAdminOutput>> => {
      if (actor.actorRole !== 'admin') throw new OrgContentError('FORBIDDEN');
      switch (input.action) {
        case 'listDeletedWorkDrafts':
          return success(await dependencies.studentWorks.listDeletedDrafts(actor, input.studentId, input.page),
            createMeta(dependencies.clock, dependencies.requestIds));
        case 'restoreWorkDraft': {
          try {
            return success(await dependencies.studentWorks.restoreDraft(actor, input),
              createMeta(dependencies.clock, dependencies.requestIds));
          } catch (error: unknown) {
            if (error instanceof StudentWorkAdminError && error.fieldMessage) {
              return failure(error.code, createMeta(dependencies.clock, dependencies.requestIds),
                { workId: error.fieldMessage });
            }
            throw error;
          }
        }
        case 'listAdminQuestions':
          return success(await dependencies.questions.list(actor, input.filters, input.page), createMeta(dependencies.clock, dependencies.requestIds));
        case 'getAdminQuestion':
          return success(await dependencies.questions.get(actor, input.id), createMeta(dependencies.clock, dependencies.requestIds));
        case 'setQuestionVisibility':
          return success(await dependencies.questions.setVisibility(actor, input.id, input.visibility,
            input.expectedVersion, input.reason, input.operationId), createMeta(dependencies.clock, dependencies.requestIds));
        case 'batchSetQuestionVisibility':
          return success(await dependencies.questions.batchSetVisibility(actor, input.items, input.visibility,
            input.reason, input.operationId), createMeta(dependencies.clock, dependencies.requestIds));
        case 'batchSetQuestionStatus':
          return success(await dependencies.questions.batchSetStatus(actor, input.items, input.status,
            input.reason, input.operationId), createMeta(dependencies.clock, dependencies.requestIds));
        case 'getDashboardOverview':
          return success(
            await dependencies.handler.getDashboardOverview(actor, {
              ...(input.from === undefined ? {} : { from: input.from }),
              ...(input.to === undefined ? {} : { to: input.to }),
            }),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'listRoleAssignments':
          return success(
            await dependencies.handler.listRoleAssignments(actor, input.filter, input.page),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'listAuditLogs':
          return success(
            await dependencies.handler.listAuditLogs(actor, input.filter, input.page),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'listClasses':
          return success(
            await dependencies.handler.listClasses(actor),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'createClass':
          return success(await dependencies.handler.createClass(actor, input), createMeta(dependencies.clock, dependencies.requestIds));
        case 'updateClass':
          return success(await dependencies.handler.updateClass(actor, input), createMeta(dependencies.clock, dependencies.requestIds));
        case 'disableClass':
          return success(
            await dependencies.handler.disableClass(actor, input.classId, input.expectedVersion, input.reason, input.operationId),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'listUsers':
          return success(
            await dependencies.handler.listUsers(actor, {
              ...(input.classId === undefined ? {} : { classId: input.classId }),
              ...(input.role === undefined ? {} : { role: input.role }),
              ...(input.status === undefined ? {} : { status: input.status }),
              ...(input.keyword === undefined ? {} : { keyword: input.keyword }),
            }),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'createUser':
          return success(await dependencies.handler.createUser(actor, input), createMeta(dependencies.clock, dependencies.requestIds));
        case 'updateUser':
          return success(await dependencies.handler.updateUser(actor, input), createMeta(dependencies.clock, dependencies.requestIds));
        case 'disableUser':
          return success(
            await dependencies.handler.disableUser(actor, input.userId, input.expectedVersion, input.reason, input.operationId),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'assignRole':
          return success(await dependencies.handler.assignRole(actor, input), createMeta(dependencies.clock, dependencies.requestIds));
        case 'revokeRole':
          return success(
            await dependencies.handler.revokeRole(actor, input.userId, input.role, input.expectedVersion, input.reason, input.operationId),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'grantTeacherClass':
          return success(
            await dependencies.handler.grantTeacherClass(
              actor,
              input.teacherId,
              input.classId,
              input.permissions,
              input.expectedVersion,
              input.reason,
              input.operationId,
            ),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'revokeTeacherClass':
          return success(
            await dependencies.handler.revokeTeacherClass(
              actor,
              input.teacherId,
              input.classId,
              input.expectedVersion,
              input.reason,
              input.operationId,
            ),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
      }
    },
  );
}
