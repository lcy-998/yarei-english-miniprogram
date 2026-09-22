import type { OrgContentIdempotencyBoundary } from '../org-content/idempotency';
import type { OrgContentRepository, OrgContentTransaction } from '../org-content/repository';
import {
  OrgContentError,
  type Actor,
  type ClassEntity,
  type ClassMembershipEntity,
  type OrganizationAuditEntity,
  type SliceClock,
  type UserEntity,
} from '../org-content/types';
import type {
  SetTeacherStudentStatusCommand,
  TeacherStudentMutationReceipt,
  TeacherStudentTransferReceipt,
  TransferTeacherStudentCommand,
  UpdateTeacherStudentProfileCommand,
} from './types';

export interface TeacherStudentCommandIdGenerator {
  next(prefix: string): string;
}

type TeacherStudentAuditAction = Extract<OrganizationAuditEntity['action'],
  | 'student.profile.updated'
  | 'student.disabled'
  | 'student.restored'
  | 'student.transferred'>;

type TeacherStudentAuditMetadata = Readonly<{
  classId?: string;
  sourceClassId?: string;
  targetClassId?: string;
  status?: UserEntity['status'];
}>;

export class TeacherStudentCommandService {
  public constructor(
    private readonly repository: OrgContentRepository,
    private readonly clock: SliceClock,
    private readonly ids: TeacherStudentCommandIdGenerator,
    private readonly idempotency: OrgContentIdempotencyBoundary,
  ) {}

  public async updateProfile(
    actor: Actor,
    command: UpdateTeacherStudentProfileCommand,
  ): Promise<TeacherStudentMutationReceipt> {
    return this.idempotency.execute({
      actor,
      functionName: 'teacher-student-command',
      action: 'updateProfile',
      operationId: command.operationId,
      expectedVersion: command.expectedUserVersion,
      payload: {
        studentId: command.studentId,
        classId: command.classId,
        displayName: command.displayName,
        expectedMembershipVersion: command.expectedMembershipVersion,
        reason: command.reason,
      },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(
        actor,
        'student.profile.updated',
        'user',
        command.studentId,
        command.reason,
        error,
        { classId: command.classId },
        transaction,
      ),
      perform: async (transaction) => this.performAudited(
        actor,
        'student.profile.updated',
        'user',
        command.studentId,
        command.reason,
        { classId: command.classId },
        transaction,
        async (currentTransaction) => {
          this.assertCommonCommand(command.reason, command.expectedUserVersion, command.expectedMembershipVersion);
          const displayName = command.displayName.trim();
          if (displayName.length < 1 || displayName.length > 50) throw new OrgContentError('VALIDATION_ERROR');
          await this.assertTeacherCanManage(currentTransaction, actor, command.classId);
          const [student, membership, classEntity] = await Promise.all([
            currentTransaction.findUser(actor.organizationId, command.studentId),
            currentTransaction.findMembership(actor.organizationId, command.studentId, command.classId),
            currentTransaction.findClass(actor.organizationId, command.classId),
          ]);
          this.assertActiveStudentInClass(student, membership, classEntity);
          if (membership === null || classEntity === null) throw new OrgContentError('NOT_FOUND');
          if (student.version !== command.expectedUserVersion
            || membership.version !== command.expectedMembershipVersion) throw new OrgContentError('CONFLICT');
          const updated: UserEntity = {
            ...student,
            displayName,
            displayNameMasked: maskDisplayName(displayName),
            version: student.version + 1,
          };
          await currentTransaction.saveUser(updated);
          await currentTransaction.appendOrganizationAudit(this.successAudit(
            actor,
            'student.profile.updated',
            'user',
            student.id,
            command.reason,
            { classId: command.classId },
          ));
          return mutationReceipt(updated, membership, classEntity);
        },
      ),
    });
  }

  public async setStatus(
    actor: Actor,
    command: SetTeacherStudentStatusCommand,
  ): Promise<TeacherStudentMutationReceipt> {
    const action: TeacherStudentAuditAction = command.status === 'disabled'
      ? 'student.disabled'
      : 'student.restored';
    return this.idempotency.execute({
      actor,
      functionName: 'teacher-student-command',
      action: 'setStatus',
      operationId: command.operationId,
      expectedVersion: command.expectedUserVersion,
      payload: {
        studentId: command.studentId,
        classId: command.classId,
        status: command.status,
        expectedMembershipVersion: command.expectedMembershipVersion,
        expectedClassVersion: command.expectedClassVersion,
        reason: command.reason,
      },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(
        actor,
        action,
        'user',
        command.studentId,
        command.reason,
        error,
        { classId: command.classId, status: command.status },
        transaction,
      ),
      perform: async (transaction) => this.performAudited(
        actor,
        action,
        'user',
        command.studentId,
        command.reason,
        { classId: command.classId, status: command.status },
        transaction,
        async (currentTransaction) => {
          this.assertCommonCommand(
            command.reason,
            command.expectedUserVersion,
            command.expectedMembershipVersion,
            command.expectedClassVersion,
          );
          await this.assertTeacherCanManage(currentTransaction, actor, command.classId);
          const [student, membership, classEntity] = await Promise.all([
            currentTransaction.findUser(actor.organizationId, command.studentId),
            currentTransaction.findMembership(actor.organizationId, command.studentId, command.classId),
            currentTransaction.findClass(actor.organizationId, command.classId),
          ]);
          this.assertStudentRecord(student, membership, classEntity);
          if (membership === null || classEntity === null) throw new OrgContentError('NOT_FOUND');
          if (student.version !== command.expectedUserVersion
            || membership.version !== command.expectedMembershipVersion
            || classEntity.version !== command.expectedClassVersion) throw new OrgContentError('CONFLICT');
          const disabling = command.status === 'disabled';
          if (disabling
            ? student.status !== 'active' || membership.status !== 'active'
            : student.status !== 'disabled' || membership.status !== 'inactive') throw new OrgContentError('CONFLICT');
          const now = this.clock.nowIso();
          const updatedMembership: ClassMembershipEntity = disabling
            ? { ...membership, status: 'inactive', leftAt: now, version: membership.version + 1 }
            : { ...membership, status: 'active', joinedAt: now, leftAt: undefined, version: membership.version + 1 };
          const updatedClass: ClassEntity = { ...classEntity, version: classEntity.version + 1 };
          const updatedStudent: UserEntity = {
            ...student,
            status: command.status,
            authorizationVersion: student.authorizationVersion + 1,
            version: student.version + 1,
          };
          await currentTransaction.saveMembership(updatedMembership);
          await currentTransaction.saveClass(updatedClass);
          await currentTransaction.saveUser(updatedStudent);
          await currentTransaction.appendOrganizationAudit(this.successAudit(
            actor,
            action,
            'user',
            student.id,
            command.reason,
            { classId: command.classId, status: command.status },
          ));
          return mutationReceipt(updatedStudent, updatedMembership, updatedClass);
        },
      ),
    });
  }

  public async transfer(
    actor: Actor,
    command: TransferTeacherStudentCommand,
  ): Promise<TeacherStudentTransferReceipt> {
    return this.idempotency.execute({
      actor,
      functionName: 'teacher-student-command',
      action: 'transfer',
      operationId: command.operationId,
      expectedVersion: command.expectedUserVersion,
      payload: {
        studentId: command.studentId,
        sourceClassId: command.sourceClassId,
        targetClassId: command.targetClassId,
        expectedMembershipVersion: command.expectedMembershipVersion,
        expectedTargetMembershipVersion: command.expectedTargetMembershipVersion,
        expectedSourceClassVersion: command.expectedSourceClassVersion,
        expectedTargetClassVersion: command.expectedTargetClassVersion,
        reason: command.reason,
      },
      onBoundaryError: async (error, transaction) => this.writeDeniedAudit(
        actor,
        'student.transferred',
        'class_membership',
        command.studentId,
        command.reason,
        error,
        { sourceClassId: command.sourceClassId, targetClassId: command.targetClassId },
        transaction,
      ),
      perform: async (transaction) => this.performAudited(
        actor,
        'student.transferred',
        'class_membership',
        command.studentId,
        command.reason,
        { sourceClassId: command.sourceClassId, targetClassId: command.targetClassId },
        transaction,
        async (currentTransaction) => {
          this.assertCommonCommand(
            command.reason,
            command.expectedUserVersion,
            command.expectedMembershipVersion,
            command.expectedSourceClassVersion,
            command.expectedTargetClassVersion,
          );
          if (!Number.isSafeInteger(command.expectedTargetMembershipVersion)
            || command.expectedTargetMembershipVersion < 0
            || command.sourceClassId === command.targetClassId) throw new OrgContentError('VALIDATION_ERROR');
          await this.assertTeacherCanManage(currentTransaction, actor, command.sourceClassId);
          await this.assertTeacherCanManage(currentTransaction, actor, command.targetClassId);
          const [student, sourceMembership, targetMembership, sourceClass, targetClass] = await Promise.all([
            currentTransaction.findUser(actor.organizationId, command.studentId),
            currentTransaction.findMembership(actor.organizationId, command.studentId, command.sourceClassId),
            currentTransaction.findMembership(actor.organizationId, command.studentId, command.targetClassId),
            currentTransaction.findClass(actor.organizationId, command.sourceClassId),
            currentTransaction.findClass(actor.organizationId, command.targetClassId),
          ]);
          this.assertActiveStudentInClass(student, sourceMembership, sourceClass);
          if (sourceMembership === null || sourceClass === null) throw new OrgContentError('NOT_FOUND');
          if (targetClass === null || targetClass.status !== 'active') throw new OrgContentError('NOT_FOUND');
          if (student.version !== command.expectedUserVersion
            || sourceMembership.version !== command.expectedMembershipVersion
            || sourceClass.version !== command.expectedSourceClassVersion
            || targetClass.version !== command.expectedTargetClassVersion
            || (targetMembership?.version ?? 0) !== command.expectedTargetMembershipVersion) {
            throw new OrgContentError('CONFLICT');
          }
          if (targetMembership?.status === 'active') throw new OrgContentError('CONFLICT');
          const now = this.clock.nowIso();
          const transferredMembership: ClassMembershipEntity = {
            ...sourceMembership,
            status: 'transferred',
            leftAt: now,
            version: sourceMembership.version + 1,
          };
          const activeMembership: ClassMembershipEntity = targetMembership === null
            ? {
                id: this.ids.next('mem'),
                organizationId: actor.organizationId,
                classId: targetClass.id,
                studentId: student.id,
                status: 'active',
                joinedAt: now,
                version: 1,
              }
            : {
                ...targetMembership,
                status: 'active',
                joinedAt: now,
                leftAt: undefined,
                version: targetMembership.version + 1,
              };
          const updatedSourceClass: ClassEntity = { ...sourceClass, version: sourceClass.version + 1 };
          const updatedTargetClass: ClassEntity = { ...targetClass, version: targetClass.version + 1 };
          const updatedStudent: UserEntity = {
            ...student,
            authorizationVersion: student.authorizationVersion + 1,
            version: student.version + 1,
          };
          await currentTransaction.saveMembership(transferredMembership);
          await currentTransaction.saveMembership(activeMembership);
          await currentTransaction.saveClass(updatedSourceClass);
          await currentTransaction.saveClass(updatedTargetClass);
          await currentTransaction.saveUser(updatedStudent);
          await currentTransaction.appendOrganizationAudit(this.successAudit(
            actor,
            'student.transferred',
            'class_membership',
            student.id,
            command.reason,
            { sourceClassId: sourceClass.id, targetClassId: targetClass.id },
          ));
          return {
            ...mutationReceipt(updatedStudent, activeMembership, updatedTargetClass),
            sourceClassId: updatedSourceClass.id,
            sourceClassVersion: updatedSourceClass.version,
          };
        },
      ),
    });
  }

  private async assertTeacherCanManage(
    transaction: OrgContentTransaction,
    actor: Actor,
    classId: string,
  ): Promise<void> {
    if (actor.actorRole !== 'teacher'
      || !actor.permissions.includes('student.manage')
      || !actor.scopeIds.includes(classId)) throw new OrgContentError('FORBIDDEN');
    const grant = await transaction.findActiveTeacherGrant(actor.organizationId, actor.actorUserId, classId);
    if (grant === null || !grant.permissions.includes('student.manage')) throw new OrgContentError('FORBIDDEN');
  }

  private assertActiveStudentInClass(
    student: UserEntity | null,
    membership: ClassMembershipEntity | null,
    classEntity: ClassEntity | null,
  ): asserts student is UserEntity & { status: 'active' } {
    if (student === null || !student.roles.includes('student') || membership === null
      || classEntity === null || classEntity.status !== 'active') throw new OrgContentError('NOT_FOUND');
    if (student.status !== 'active' || membership.status !== 'active') throw new OrgContentError('CONFLICT');
  }

  private assertStudentRecord(
    student: UserEntity | null,
    membership: ClassMembershipEntity | null,
    classEntity: ClassEntity | null,
  ): asserts student is UserEntity {
    if (student === null || !student.roles.includes('student') || membership === null
      || classEntity === null || classEntity.status !== 'active') throw new OrgContentError('NOT_FOUND');
  }

  private assertCommonCommand(reason: string, ...versions: readonly number[]): void {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 1 || normalizedReason.length > 200
      || versions.some((version) => !Number.isSafeInteger(version) || version < 1)) {
      throw new OrgContentError('VALIDATION_ERROR');
    }
  }

  private async performAudited<T>(
    actor: Actor,
    action: TeacherStudentAuditAction,
    targetType: OrganizationAuditEntity['targetType'],
    targetId: string,
    reason: string,
    metadata: TeacherStudentAuditMetadata,
    transaction: OrgContentTransaction | undefined,
    perform: (currentTransaction: OrgContentTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.runTransaction(transaction, perform);
    } catch (error: unknown) {
      if (error instanceof OrgContentError) {
        await this.writeDeniedAudit(actor, action, targetType, targetId, reason, error, metadata, transaction);
      }
      throw error;
    }
  }

  private successAudit(
    actor: Actor,
    action: TeacherStudentAuditAction,
    targetType: OrganizationAuditEntity['targetType'],
    targetId: string,
    reason: string,
    metadata: TeacherStudentAuditMetadata,
  ): OrganizationAuditEntity {
    return {
      id: this.ids.next('student_audit'),
      organizationId: actor.organizationId,
      requestId: actor.requestId,
      actorUserId: actor.actorUserId,
      actorRole: actor.actorRole,
      action,
      targetType,
      targetId,
      result: 'succeeded',
      errorCode: null,
      metadata: {
        ...metadata,
        reasonProvided: reason.trim().length > 0,
        reasonLength: reason.length,
      },
      occurredAt: this.clock.nowIso(),
    };
  }

  private async writeDeniedAudit(
    actor: Actor,
    action: TeacherStudentAuditAction,
    targetType: OrganizationAuditEntity['targetType'],
    targetId: string,
    reason: string,
    error: unknown,
    metadata: TeacherStudentAuditMetadata,
    transaction?: OrgContentTransaction,
  ): Promise<void> {
    await this.runTransaction(transaction, async (currentTransaction) => currentTransaction.appendOrganizationAudit({
      id: this.ids.next('student_audit'),
      organizationId: actor.organizationId,
      requestId: actor.requestId,
      actorUserId: actor.actorUserId,
      actorRole: actor.actorRole,
      action,
      targetType,
      targetId,
      result: error instanceof OrgContentError ? 'denied' : 'failed',
      errorCode: error instanceof OrgContentError ? error.code : 'INTERNAL_ERROR',
      metadata: {
        ...metadata,
        reasonProvided: reason.trim().length > 0,
        reasonLength: reason.length,
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

function mutationReceipt(
  student: UserEntity,
  membership: ClassMembershipEntity,
  classEntity: ClassEntity,
): TeacherStudentMutationReceipt {
  return {
    studentId: student.id,
    displayName: student.displayName,
    accountStatus: student.status,
    classId: classEntity.id,
    userVersion: student.version,
    membershipVersion: membership.version,
    classVersion: classEntity.version,
  };
}

function maskDisplayName(name: string): string {
  return name.length <= 1 ? name : `${name[0]}${'*'.repeat(Math.min(2, name.length - 1))}`;
}
