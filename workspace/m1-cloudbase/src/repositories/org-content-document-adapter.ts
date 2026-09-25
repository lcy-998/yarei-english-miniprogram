import { ACTOR_ROLES, type TrustedActorContext } from '../auth/trusted-actor';
import type { OrgContentIdempotencyBoundary } from '../org-content/idempotency';
import type { OrgContentRepository, OrgContentTransaction } from '../org-content/repository';
import {
  OrgContentError,
  ROLE_PERMISSIONS,
  ROLE_SCOPE_TYPES,
  TEACHER_CLASS_PERMISSIONS,
  USER_ROLES,
  type BindingCodeEntity,
  type ClassEntity,
  type ClassMembershipEntity,
  type LearningResourceEntity,
  type OrganizationAuditEntity,
  type OrganizationEntity,
  type ParentStudentLinkEntity,
  type ReadingChapterEntity,
  type ReadingPageEntity,
  type RelationshipAuditEntity,
  type ResourceVisibility,
  type RoleAssignmentEntity,
  type TeacherClassGrantEntity,
  type UserEntity,
  type VocabularyWordEntity,
} from '../org-content/types';
import type { FunctionName, JsonObject, JsonValue } from '../shared/protocol';
import type { OperationLogRecord } from '../runtime/records';
import { createOperationFingerprint } from '../shared/request-summary';
import {
  type DocumentDatabasePort,
  type DocumentDatabaseTransactionPort,
  type VersionedDocument,
} from './document-database-port';

export const ORG_CONTENT_COLLECTIONS = {
  organizations: 'organizations',
  classes: 'classes',
  users: 'users',
  memberships: 'class_memberships',
  roles: 'role_assignments',
  teacherGrants: 'teacher_class_grants',
  parentLinks: 'parent_student_links',
  bindingCodes: 'binding_codes',
  organizationAudits: 'operation_logs',
  relationshipAudits: 'operation_logs',
  idempotency: 'idempotency_records',
  guards: 'org_content_guards',
  resources: 'learning_resources',
} as const;

export function createOrgContentDocumentRepository(database: DocumentDatabasePort): OrgContentRepository {
  return new OrgContentDocumentRepository(database);
}

export function createOrgContentDocumentPersistence(database: DocumentDatabasePort): Readonly<{
  repository: OrgContentRepository;
  idempotency: OrgContentIdempotencyBoundary;
}> {
  const repository = new OrgContentDocumentRepository(database);
  return { repository, idempotency: new DocumentOrgContentIdempotency(repository) };
}

export class OrgContentDocumentRepository implements OrgContentRepository {
  private transactionTail: Promise<void> = Promise.resolve();

  public constructor(private readonly database: DocumentDatabasePort) {}

  public async listOrganizations(organizationIds: readonly string[]): Promise<readonly OrganizationEntity[]> {
    const uniqueIds = [...new Set(organizationIds)];
    const documents = await Promise.all(uniqueIds.map(async (id) => this.database.get(
      ORG_CONTENT_COLLECTIONS.organizations,
      id,
    )));
    return documents.map((document) => decodeOrganization(document, document?._id ?? ''))
      .filter((item): item is OrganizationEntity => item !== null);
  }

  public async findOrganization(organizationId: string): Promise<OrganizationEntity | null> {
    return decodeOrganization(
      await this.database.get(ORG_CONTENT_COLLECTIONS.organizations, organizationId),
      organizationId,
    );
  }

  public async listClasses(organizationId: string): Promise<readonly ClassEntity[]> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.classes, {
      organizationId,
      deletedAt: null,
    });
    return documents.map((document) => decodeClass(document, organizationId))
      .filter((item): item is ClassEntity => item !== null);
  }

  public async findClass(organizationId: string, classId: string): Promise<ClassEntity | null> {
    return decodeClass(await this.database.get(ORG_CONTENT_COLLECTIONS.classes, classId), organizationId);
  }

  public async findUser(organizationId: string, userId: string): Promise<UserEntity | null> {
    const document = await this.database.get(ORG_CONTENT_COLLECTIONS.users, userId);
    return this.decodeUserWithRoles(document, organizationId);
  }

  public async listUsers(organizationId: string): Promise<readonly UserEntity[]> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.users, {
      organizationId,
      deletedAt: null,
    });
    return compact(await Promise.all(documents.map(async (document) => this.decodeUserWithRoles(
      document,
      organizationId,
    ))));
  }

  public async listUsersForClass(organizationId: string, classId: string): Promise<readonly UserEntity[]> {
    const memberships = await this.listActiveMembershipsForClass(organizationId, classId);
    const users = await Promise.all([...new Set(memberships.map((membership) => membership.studentId))]
      .map(async (studentId) => this.findUser(organizationId, studentId)));
    return compact(users);
  }

  public async listActiveMembershipsForClass(
    organizationId: string,
    classId: string,
  ): Promise<readonly ClassMembershipEntity[]> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.memberships, {
      organizationId,
      classId,
      status: 'active',
      deletedAt: null,
    });
    return documents.map((document) => decodeMembership(document, organizationId))
      .filter((item): item is ClassMembershipEntity => item !== null);
  }

  public async listMembershipsForClass(
    organizationId: string,
    classId: string,
  ): Promise<readonly ClassMembershipEntity[]> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.memberships, {
      organizationId,
      classId,
      deletedAt: null,
    });
    return documents.map((document) => decodeMembershipAnyStatus(document, organizationId))
      .filter((item): item is ClassMembershipEntity => item !== null);
  }

  public async findActiveMembershipForStudent(
    organizationId: string,
    studentId: string,
  ): Promise<ClassMembershipEntity | null> {
    const memberships = await this.listActiveMembershipsForStudent(organizationId, studentId);
    return memberships.length === 1 ? memberships[0] ?? null : null;
  }

  public async listActiveMembershipsForStudent(
    organizationId: string,
    studentId: string,
  ): Promise<readonly ClassMembershipEntity[]> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.memberships, {
      organizationId,
      studentId,
      status: 'active',
      deletedAt: null,
    });
    return documents.map((document) => decodeMembership(document, organizationId))
      .filter((item): item is ClassMembershipEntity => item !== null);
  }

  public async findMembership(
    organizationId: string,
    studentId: string,
    classId: string,
  ): Promise<ClassMembershipEntity | null> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.memberships, {
      organizationId,
      studentId,
      classId,
      deletedAt: null,
    });
    const memberships = documents.map((document) => decodeMembershipAnyStatus(document, organizationId))
      .filter((item): item is ClassMembershipEntity => item !== null);
    return selectCurrentMembership(memberships);
  }

  public async findActiveTeacherGrant(
    organizationId: string,
    teacherId: string,
    classId: string,
  ): Promise<TeacherClassGrantEntity | null> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.teacherGrants, {
      organizationId,
      teacherId,
      classId,
      status: 'active',
      deletedAt: null,
    });
    const grants = documents.map((document) => decodeTeacherGrant(document, organizationId))
      .filter((item): item is TeacherClassGrantEntity => item !== null);
    return grants.length === 1 ? grants[0] ?? null : null;
  }

  public async listActiveTeacherGrants(
    organizationId: string,
    teacherId: string,
  ): Promise<readonly TeacherClassGrantEntity[]> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.teacherGrants, {
      organizationId,
      teacherId,
      status: 'active',
      deletedAt: null,
    });
    return documents.map((document) => decodeTeacherGrant(document, organizationId))
      .filter((item): item is TeacherClassGrantEntity => item !== null);
  }

  public async listActiveTeacherGrantsForClass(
    organizationId: string,
    classId: string,
  ): Promise<readonly TeacherClassGrantEntity[]> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.teacherGrants, {
      organizationId,
      classId,
      status: 'active',
      deletedAt: null,
    });
    return documents.map((document) => decodeTeacherGrant(document, organizationId))
      .filter((item): item is TeacherClassGrantEntity => item !== null);
  }

  public async listRoleAssignments(
    organizationId: string,
    userId?: string,
  ): Promise<readonly RoleAssignmentEntity[]> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.roles, {
      organizationId,
      ...(userId === undefined ? {} : { userId }),
      deletedAt: null,
    });
    return documents.map((document) => decodeRoleAssignment(document, organizationId))
      .filter((item): item is RoleAssignmentEntity => item !== null);
  }

  public async listOperationLogs(
    organizationId: string,
    filter: Readonly<{
      actorUserId?: string;
      action?: string;
      result?: OperationLogRecord['result'];
      targetType?: string;
    }>,
  ): Promise<readonly OperationLogRecord[]> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.organizationAudits, {
      organizationId,
      ...(filter.actorUserId === undefined ? {} : { actorUserId: filter.actorUserId }),
      ...(filter.action === undefined ? {} : { action: filter.action }),
      ...(filter.result === undefined ? {} : { result: filter.result }),
      ...(filter.targetType === undefined ? {} : { targetType: filter.targetType }),
      deletedAt: null,
    });
    return documents.map((document) => decodeOperationLog(document, organizationId))
      .filter((item): item is OperationLogRecord => item !== null);
  }

  public async findActiveParentLink(
    organizationId: string,
    parentId: string,
    studentId: string,
  ): Promise<ParentStudentLinkEntity | null> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.parentLinks, {
      organizationId,
      parentId,
      studentId,
      status: 'active',
      deletedAt: null,
    });
    const links = documents.map((document) => decodeParentLink(document, organizationId))
      .filter((item): item is ParentStudentLinkEntity => item !== null);
    return links.length === 1 ? links[0] ?? null : null;
  }

  public async listActiveParentLinks(
    organizationId: string,
    parentId: string,
  ): Promise<readonly ParentStudentLinkEntity[]> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.parentLinks, {
      organizationId,
      parentId,
      status: 'active',
      deletedAt: null,
    });
    return documents.map((document) => decodeParentLink(document, organizationId))
      .filter((item): item is ParentStudentLinkEntity => item !== null);
  }

  public async listActiveParentLinksForStudent(
    organizationId: string,
    studentId: string,
  ): Promise<readonly ParentStudentLinkEntity[]> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.parentLinks, {
      organizationId,
      studentId,
      status: 'active',
      deletedAt: null,
    });
    return documents.map((document) => decodeParentLink(document, organizationId))
      .filter((item): item is ParentStudentLinkEntity => item !== null);
  }

  public async listLearningResources(
    organizationId: string,
    type: LearningResourceEntity['type'],
  ): Promise<readonly LearningResourceEntity[]> {
    const documents = await this.database.find(ORG_CONTENT_COLLECTIONS.resources, {
      organizationId,
      type,
      status: 'published',
      deletedAt: null,
    });
    return documents.map((document) => decodeLearningResource(document, organizationId))
      .filter((item): item is LearningResourceEntity => item !== null && item.type === type);
  }

  public async findLearningResource(
    organizationId: string,
    resourceId: string,
  ): Promise<LearningResourceEntity | null> {
    const resource = decodeLearningResource(
      await this.database.get(ORG_CONTENT_COLLECTIONS.resources, resourceId),
      organizationId,
    );
    return resource?.status === 'published' ? resource : null;
  }

  public async transaction<T>(work: (transaction: OrgContentTransaction) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await this.database.runTransaction(async (nativeTransaction) => {
        const transaction = new OrgContentDocumentTransaction(nativeTransaction);
        return work(transaction);
      });
    } finally {
      release();
    }
  }

  public async findOperation(recordId: string, organizationId: string): Promise<OrgContentOperationRecord | null> {
    const document = await this.database.get(ORG_CONTENT_COLLECTIONS.idempotency, recordId);
    if (document === null || document.organizationId !== organizationId || document.deletedAt !== null || document.operationType !== 'org_content') return null;
    return {
      id: recordId,
      organizationId,
      actorUserId: String(document.actorUserId),
      functionName: document.functionName as FunctionName,
      action: String(document.action),
      operationId: String(document.operationId),
      requestHash: String(document.requestHash),
      status: document.status as 'processing' | 'succeeded' | 'failed',
      resultKind: document.resultKind as 'value' | 'void',
      result: document.result ?? null,
      errorCode: (document.errorCode ?? null) as OrgContentError['code'] | null,
    };
  }

  public async executeIdempotent<T>(input: Readonly<{
    actor: TrustedActorContext;
    functionName: FunctionName;
    action: string;
    operationId: string;
    payload: JsonValue;
    expectedVersion?: number;
    perform: (transaction?: OrgContentTransaction) => Promise<T>;
    onBoundaryError?: (error: unknown, transaction?: OrgContentTransaction) => Promise<void>;
    serializeResult?: (value: T) => JsonValue;
    restoreResult?: (value: JsonValue) => T;
  }>): Promise<T> {
    if (input.operationId.trim().length === 0) {
      const error = new OrgContentError('VALIDATION_ERROR');
      await this.transaction(async (transaction) => input.onBoundaryError?.(error, transaction));
      throw error;
    }
    const fingerprint = createOperationFingerprint({
      organizationId: input.actor.organizationId,
      actorUserId: input.actor.actorUserId,
      functionName: input.functionName,
      action: input.action,
      operationId: input.operationId,
      payload: input.payload,
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
    });
    let outcome: Readonly<{ ok: true; value: T } | { ok: false; code: OrgContentError['code'] }>;
    try {
      const preexisting = this.findOperation === undefined ? null : await this.findOperation(fingerprint.recordId, input.actor.organizationId);
      if (preexisting !== null) {
        if (preexisting.requestHash !== fingerprint.requestHash || preexisting.status === 'processing') {
          const error = new OrgContentError('CONFLICT');
          await input.onBoundaryError?.(error);
          throw error;
        }
        if (preexisting.status === 'failed') throw new OrgContentError(preexisting.errorCode ?? 'CONFLICT');
        const stored = cloneOutcome<JsonValue>(preexisting.result, preexisting.resultKind);
        return input.restoreResult === undefined ? stored as T : input.restoreResult(stored);
      }
      outcome = await this.transaction(async (transaction) => {
        const concrete = transaction as OrgContentDocumentTransaction;
        if (this.findOperation === undefined) {
          const existing = await concrete.findOperation(fingerprint.recordId, input.actor.organizationId);
          if (existing !== null) {
            if (existing.requestHash !== fingerprint.requestHash || existing.status === 'processing') return { ok: false as const, code: 'CONFLICT' as const };
            if (existing.status === 'failed') return { ok: false as const, code: existing.errorCode ?? 'CONFLICT' as const };
            const stored = cloneOutcome<JsonValue>(existing.result, existing.resultKind);
            return { ok: true as const, value: input.restoreResult === undefined ? stored as T : input.restoreResult(stored) };
          }
        }
        const processing: OrgContentOperationRecord = {
          id: fingerprint.recordId,
          organizationId: input.actor.organizationId,
          actorUserId: input.actor.actorUserId,
          functionName: input.functionName,
          action: input.action,
          operationId: input.operationId,
          requestHash: fingerprint.requestHash,
          status: 'processing',
          resultKind: 'void',
          result: null,
          errorCode: null,
        };
        if (!(await concrete.createOperation(processing))) {
          return { ok: false as const, code: 'CONFLICT' as const };
        }
        try {
          const value = await input.perform(transaction);
          await concrete.finishOperation(processing, input.serializeResult === undefined ? value : input.serializeResult(value));
          return { ok: true as const, value };
        } catch (error: unknown) {
          if (!(error instanceof OrgContentError)) throw error;
          await concrete.failOperation(processing, error.code);
          return { ok: false as const, code: error.code };
        }
      });
    } catch (error: unknown) {
      if (!(error instanceof OrgContentError) && input.onBoundaryError !== undefined) {
        try {
          await this.transaction(async (transaction) => input.onBoundaryError?.(error, transaction));
        } catch {
          // A failed audit must not replace the original infrastructure error.
        }
      }
      throw error;
    }
    if (!outcome.ok) throw new OrgContentError(outcome.code);
    return outcome.value;
  }

  private async decodeUserWithRoles(
    document: VersionedDocument | null,
    organizationId: string,
  ): Promise<UserEntity | null> {
    const base = decodeUser(document, organizationId);
    if (base === null) return null;
    const roles = (await this.listRoleAssignments(organizationId, base.id))
      .filter((assignment) => assignment.status === 'active')
      .map((assignment) => assignment.role);
    return { ...base, roles: [...new Set(roles)] };
  }
}

class DocumentOrgContentIdempotency implements OrgContentIdempotencyBoundary {
  public constructor(private readonly repository: OrgContentDocumentRepository) {}

  public execute<T>(input: Readonly<{
    actor: TrustedActorContext;
    functionName: FunctionName;
    action: string;
    operationId: string;
    payload: JsonValue;
    expectedVersion?: number;
    perform: (transaction?: OrgContentTransaction) => Promise<T>;
    onBoundaryError?: (error: unknown, transaction?: OrgContentTransaction) => Promise<void>;
    serializeResult?: (value: T) => JsonValue;
    restoreResult?: (value: JsonValue) => T;
  }>): Promise<T> {
    return this.repository.executeIdempotent(input);
  }
}

interface OrgContentOperationRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly functionName: FunctionName;
  readonly action: string;
  readonly operationId: string;
  readonly requestHash: string;
  readonly status: 'processing' | 'succeeded' | 'failed';
  readonly resultKind: 'value' | 'void';
  readonly result: JsonValue;
  readonly errorCode: OrgContentError['code'] | null;
}

class OrgContentDocumentTransaction implements OrgContentTransaction {
  public constructor(private readonly transaction: DocumentDatabaseTransactionPort) {}

  public async findUser(organizationId: string, userId: string): Promise<UserEntity | null> {
    return this.decodeUserWithRoles(
      await this.transaction.get(ORG_CONTENT_COLLECTIONS.users, userId),
      organizationId,
    );
  }

  public async findUserByStudentNumber(
    organizationId: string,
    studentNumber: string,
  ): Promise<UserEntity | null> {
    const documents = await this.transaction.find(ORG_CONTENT_COLLECTIONS.users, {
      organizationId,
      studentNumber,
      deletedAt: null,
    });
    const users = compact(await Promise.all(documents.map(async (document) => this.decodeUserWithRoles(
      document,
      organizationId,
    )))).filter((user) => user.roles.includes('student'));
    return users.length === 1 ? users[0] ?? null : null;
  }

  public async findClass(organizationId: string, classId: string): Promise<ClassEntity | null> {
    return decodeClass(await this.transaction.get(ORG_CONTENT_COLLECTIONS.classes, classId), organizationId);
  }

  public async findClassByName(organizationId: string, name: string): Promise<ClassEntity | null> {
    const documents = await this.transaction.find(ORG_CONTENT_COLLECTIONS.classes, {
      organizationId,
      name,
      deletedAt: null,
    });
    const classes = documents.map((document) => decodeClass(document, organizationId))
      .filter((item): item is ClassEntity => item !== null);
    return classes.length === 1 ? classes[0] ?? null : null;
  }

  public async saveClass(entity: ClassEntity): Promise<void> {
    const currentDocument = await this.transaction.get(ORG_CONTENT_COLLECTIONS.classes, entity.id);
    const current = decodeClass(currentDocument, entity.organizationId);
    if (currentDocument !== null && current === null) throw new OrgContentError('CONFLICT');
    const nextNameKey = normalizeGuardValue(entity.name);
    const currentNameKey = current === null ? null : normalizeGuardValue(current.name);
    if (currentNameKey !== nextNameKey) {
      await this.acquireOwnerGuard('class_name', entity.organizationId, nextNameKey, entity.id, async () => (
        (await this.transaction.find(ORG_CONTENT_COLLECTIONS.classes, {
          organizationId: entity.organizationId, deletedAt: null,
        })).filter((document) => typeof document.name === 'string'
          && normalizeGuardValue(document.name) === nextNameKey)
      ));
    }
    await this.save(ORG_CONTENT_COLLECTIONS.classes, entity.id, entity.organizationId, entity.version, {
      name: entity.name,
      grade: entity.grade,
      term: entity.term,
      status: entity.status,
    });
    if (currentNameKey !== null && currentNameKey !== nextNameKey) {
      await this.releaseOwnerGuard('class_name', entity.organizationId, currentNameKey, entity.id);
    }
  }

  public async countActiveMembershipsForClass(organizationId: string, classId: string): Promise<number> {
    return (await this.transaction.find(ORG_CONTENT_COLLECTIONS.memberships, {
      organizationId, classId, status: 'active', deletedAt: null,
    })).length;
  }

  public async listActiveMembershipsForStudent(
    organizationId: string,
    studentId: string,
  ): Promise<readonly ClassMembershipEntity[]> {
    const documents = await this.transaction.find(ORG_CONTENT_COLLECTIONS.memberships, {
      organizationId, studentId, status: 'active', deletedAt: null,
    });
    return documents.map((document) => decodeMembership(document, organizationId))
      .filter((item): item is ClassMembershipEntity => item !== null);
  }

  public async findMembership(
    organizationId: string,
    studentId: string,
    classId: string,
  ): Promise<ClassMembershipEntity | null> {
    const documents = await this.transaction.find(ORG_CONTENT_COLLECTIONS.memberships, {
      organizationId, studentId, classId, deletedAt: null,
    });
    const memberships = documents.map((document) => decodeMembershipAnyStatus(document, organizationId))
      .filter((item): item is ClassMembershipEntity => item !== null);
    return selectCurrentMembership(memberships);
  }

  public async findActiveMembershipForStudent(
    organizationId: string,
    studentId: string,
  ): Promise<ClassMembershipEntity | null> {
    const memberships = await this.listActiveMembershipsForStudent(organizationId, studentId);
    return memberships.length === 1 ? memberships[0] ?? null : null;
  }

  public async saveMembership(entity: ClassMembershipEntity): Promise<void> {
    const currentDocument = await this.transaction.get(ORG_CONTENT_COLLECTIONS.memberships, entity.id);
    const current = currentDocument === null ? null : decodeMembershipAnyStatus(currentDocument, entity.organizationId);
    if (currentDocument !== null && current === null) throw new OrgContentError('CONFLICT');
    if (current === null) {
      const membershipKey = `${normalizeGuardValue(entity.studentId)}:${normalizeGuardValue(entity.classId)}`;
      await this.acquireOwnerGuard('student_class_membership', entity.organizationId, membershipKey, entity.id, async () => (
        this.transaction.find(ORG_CONTENT_COLLECTIONS.memberships, {
          organizationId: entity.organizationId,
          studentId: entity.studentId,
          classId: entity.classId,
          deletedAt: null,
        })
      ));
    }
    if (entity.status === 'active' && current?.status !== 'active') {
      await this.acquireOwnerGuard('student_active_membership', entity.organizationId, normalizeGuardValue(entity.studentId), entity.id, async () => (
        this.transaction.find(ORG_CONTENT_COLLECTIONS.memberships, {
          organizationId: entity.organizationId,
          studentId: entity.studentId,
          status: 'active',
          deletedAt: null,
        })
      ));
    }
    await this.save(ORG_CONTENT_COLLECTIONS.memberships, entity.id, entity.organizationId, entity.version, {
      classId: entity.classId,
      studentId: entity.studentId,
      status: entity.status,
      ...(entity.joinedAt === undefined ? {} : { joinedAt: entity.joinedAt }),
      ...(entity.leftAt === undefined ? {} : { leftAt: entity.leftAt }),
    });
    if (current?.status === 'active' && entity.status !== 'active') {
      await this.releaseOwnerGuard(
        'student_active_membership',
        entity.organizationId,
        normalizeGuardValue(entity.studentId),
        entity.id,
      );
    }
  }

  public async saveUser(entity: UserEntity): Promise<void> {
    const currentDocument = await this.transaction.get(ORG_CONTENT_COLLECTIONS.users, entity.id);
    const current = decodeUser(currentDocument, entity.organizationId);
    if (currentDocument !== null && current === null) throw new OrgContentError('CONFLICT');
    const nextNumberKey = entity.studentNumber === undefined ? null : normalizeGuardValue(entity.studentNumber);
    const currentNumberKey = current?.studentNumber === undefined ? null : normalizeGuardValue(current.studentNumber);
    if (nextNumberKey !== null && currentNumberKey !== nextNumberKey) {
      await this.acquireOwnerGuard('student_number', entity.organizationId, nextNumberKey, entity.id, async () => (
        (await this.transaction.find(ORG_CONTENT_COLLECTIONS.users, {
          organizationId: entity.organizationId, deletedAt: null,
        })).filter((document) => typeof document.studentNumber === 'string'
          && normalizeGuardValue(document.studentNumber) === nextNumberKey)
      ));
    }
    await this.save(ORG_CONTENT_COLLECTIONS.users, entity.id, entity.organizationId, entity.version, {
      authorizationVersion: entity.authorizationVersion,
      displayName: entity.displayName,
      displayNameMasked: entity.displayNameMasked,
      ...(entity.mobileMasked === undefined ? {} : { mobileMasked: entity.mobileMasked }),
      ...(entity.studentNumber === undefined ? {} : { studentNumber: entity.studentNumber }),
      status: entity.status,
    });
    if (currentNumberKey !== null && currentNumberKey !== nextNumberKey) {
      await this.releaseOwnerGuard('student_number', entity.organizationId, currentNumberKey, entity.id);
    }
  }

  public async findRoleAssignment(
    organizationId: string,
    userId: string,
    role: RoleAssignmentEntity['role'],
  ): Promise<RoleAssignmentEntity | null> {
    const documents = await this.transaction.find(ORG_CONTENT_COLLECTIONS.roles, {
      organizationId, userId, role, deletedAt: null,
    });
    const assignments = documents.map((document) => decodeRoleAssignment(document, organizationId))
      .filter((item): item is RoleAssignmentEntity => item !== null);
    return assignments.length === 1 ? assignments[0] ?? null : null;
  }

  public async saveRoleAssignment(entity: RoleAssignmentEntity): Promise<void> {
    await this.save(ORG_CONTENT_COLLECTIONS.roles, entity.id, entity.organizationId, entity.version, {
      userId: entity.userId,
      role: entity.role,
      status: entity.status,
      permissions: [...entity.permissions],
      scopeType: entity.scopeType,
      scopeIds: [...entity.scopeIds],
      grantedBy: entity.grantedBy,
      grantedAt: entity.grantedAt,
      ...(entity.revokedAt === undefined ? {} : { revokedAt: entity.revokedAt }),
      ...(entity.revokedBy === undefined ? {} : { revokedBy: entity.revokedBy }),
      ...(entity.revokeReason === undefined ? {} : { revokeReason: entity.revokeReason }),
    });
  }

  public async findActiveTeacherGrant(
    organizationId: string,
    teacherId: string,
    classId: string,
  ): Promise<TeacherClassGrantEntity | null> {
    const grant = await this.findTeacherGrant(organizationId, teacherId, classId);
    return grant?.status === 'active' ? grant : null;
  }

  public async findTeacherGrant(
    organizationId: string,
    teacherId: string,
    classId: string,
  ): Promise<TeacherClassGrantEntity | null> {
    const documents = await this.transaction.find(ORG_CONTENT_COLLECTIONS.teacherGrants, {
      organizationId, teacherId, classId, deletedAt: null,
    });
    const grants = documents.map((document) => decodeTeacherGrantAnyStatus(document, organizationId))
      .filter((item): item is TeacherClassGrantEntity => item !== null);
    return grants.length === 1 ? grants[0] ?? null : null;
  }

  public async saveTeacherGrant(entity: TeacherClassGrantEntity): Promise<void> {
    await this.save(ORG_CONTENT_COLLECTIONS.teacherGrants, entity.id, entity.organizationId, entity.version, {
      teacherId: entity.teacherId,
      classId: entity.classId,
      permissions: [...entity.permissions],
      status: entity.status,
      grantedBy: entity.grantedBy,
      grantedAt: entity.grantedAt,
      ...(entity.revokedAt === undefined ? {} : { revokedAt: entity.revokedAt }),
    });
  }

  public async appendOrganizationAudit(entry: OrganizationAuditEntity): Promise<void> {
    await this.appendOperationLog(entry);
  }

  public async findActiveBindingCodeForStudent(
    organizationId: string,
    studentId: string,
  ): Promise<BindingCodeEntity | null> {
    const documents = await this.transaction.find(ORG_CONTENT_COLLECTIONS.bindingCodes, {
      organizationId, studentId, status: 'active', deletedAt: null,
    });
    const codes = documents.map((document) => decodeBindingCode(document, organizationId))
      .filter((item): item is BindingCodeEntity => item !== null);
    return codes.length === 1 ? codes[0] ?? null : null;
  }

  public async saveBindingCode(entity: BindingCodeEntity): Promise<void> {
    const currentDocument = await this.transaction.get(ORG_CONTENT_COLLECTIONS.bindingCodes, entity.id);
    const current = currentDocument === null ? null : decodeBindingCode(currentDocument, entity.organizationId);
    if (currentDocument !== null && current === null) throw new OrgContentError('CONFLICT');
    const wasActive = current?.status === 'active';
    const willBeActive = entity.status === 'active';
    if (!wasActive && willBeActive) {
      await this.acquireOwnerGuard('active_binding_code', entity.organizationId, entity.studentId, entity.id, async () => (
        this.transaction.find(ORG_CONTENT_COLLECTIONS.bindingCodes, {
          organizationId: entity.organizationId, studentId: entity.studentId, status: 'active', deletedAt: null,
        })
      ));
    }
    await this.save(ORG_CONTENT_COLLECTIONS.bindingCodes, entity.id, entity.organizationId, entity.version, {
      studentId: entity.studentId,
      codeDigest: entity.codeDigest,
      status: entity.status,
      attemptCount: entity.attemptCount,
      expiresAt: entity.expiresAt,
      ...(entity.usedAt === undefined ? {} : { usedAt: entity.usedAt }),
      ...(entity.usedByParentId === undefined ? {} : { usedByParentId: entity.usedByParentId }),
      createdBy: entity.createdBy,
      createdAt: entity.createdAt,
    });
    if (wasActive && !willBeActive) {
      await this.releaseOwnerGuard('active_binding_code', entity.organizationId, entity.studentId, entity.id);
    }
  }

  public async countActiveChildren(organizationId: string, parentId: string): Promise<number> {
    return (await this.transaction.find(ORG_CONTENT_COLLECTIONS.parentLinks, {
      organizationId, parentId, status: 'active', deletedAt: null,
    })).length;
  }

  public async countActiveParents(organizationId: string, studentId: string): Promise<number> {
    return (await this.transaction.find(ORG_CONTENT_COLLECTIONS.parentLinks, {
      organizationId, studentId, status: 'active', deletedAt: null,
    })).length;
  }

  public async findActiveParentLink(
    organizationId: string,
    parentId: string,
    studentId: string,
  ): Promise<ParentStudentLinkEntity | null> {
    const documents = await this.transaction.find(ORG_CONTENT_COLLECTIONS.parentLinks, {
      organizationId, parentId, studentId, status: 'active', deletedAt: null,
    });
    const links = documents.map((document) => decodeParentLink(document, organizationId))
      .filter((item): item is ParentStudentLinkEntity => item !== null);
    return links.length === 1 ? links[0] ?? null : null;
  }

  public async saveParentLink(entity: ParentStudentLinkEntity): Promise<void> {
    const currentDocument = await this.transaction.get(ORG_CONTENT_COLLECTIONS.parentLinks, entity.id);
    const current = currentDocument === null ? null : decodeParentLinkAnyStatus(currentDocument, entity.organizationId);
    if (currentDocument !== null && current === null) throw new OrgContentError('CONFLICT');
    const wasActive = current?.status === 'active';
    const willBeActive = entity.status === 'active';
    if (!wasActive && willBeActive) {
      await this.acquireParentPairGuard(entity.organizationId, entity.parentId, entity.studentId, entity.id);
      await this.adjustCountGuard('parent_child_count', entity.organizationId, entity.parentId, 1, 5, async () => (
        this.transaction.find(ORG_CONTENT_COLLECTIONS.parentLinks, {
          organizationId: entity.organizationId, parentId: entity.parentId, status: 'active', deletedAt: null,
        })
      ));
      await this.adjustCountGuard('student_parent_count', entity.organizationId, entity.studentId, 1, 3, async () => (
        this.transaction.find(ORG_CONTENT_COLLECTIONS.parentLinks, {
          organizationId: entity.organizationId, studentId: entity.studentId, status: 'active', deletedAt: null,
        })
      ));
    }
    if (wasActive && !willBeActive) {
      await this.releaseParentPairGuard(entity.organizationId, entity.parentId, entity.studentId, entity.id);
      await this.adjustCountGuard('parent_child_count', entity.organizationId, entity.parentId, -1, 5, async () => (
        this.transaction.find(ORG_CONTENT_COLLECTIONS.parentLinks, {
          organizationId: entity.organizationId, parentId: entity.parentId, status: 'active', deletedAt: null,
        })
      ));
      await this.adjustCountGuard('student_parent_count', entity.organizationId, entity.studentId, -1, 3, async () => (
        this.transaction.find(ORG_CONTENT_COLLECTIONS.parentLinks, {
          organizationId: entity.organizationId, studentId: entity.studentId, status: 'active', deletedAt: null,
        })
      ));
    }
    await this.save(ORG_CONTENT_COLLECTIONS.parentLinks, entity.id, entity.organizationId, entity.version, {
      parentId: entity.parentId,
      studentId: entity.studentId,
      status: entity.status,
      confirmedBy: entity.confirmedBy,
      confirmedAt: entity.confirmedAt,
      confirmationSource: entity.confirmationSource,
      ...(entity.revokedAt === undefined ? {} : { revokedAt: entity.revokedAt }),
      ...(entity.revokedBy === undefined ? {} : { revokedBy: entity.revokedBy }),
      ...(entity.revokeReason === undefined ? {} : { revokeReason: entity.revokeReason }),
    });
  }

  public async appendRelationshipAudit(entry: RelationshipAuditEntity): Promise<void> {
    await this.appendOperationLog(entry);
  }

  public async findOperation(recordId: string, organizationId: string): Promise<OrgContentOperationRecord | null> {
    const document = await this.transaction.get(ORG_CONTENT_COLLECTIONS.idempotency, recordId);
    return this.decodeOperationDocument(recordId, document, organizationId);
  }
  private decodeOperationDocument(recordId: string, document: VersionedDocument | null, organizationId: string): OrgContentOperationRecord | null {
    if (!isScopedVisible(document, organizationId) || document.operationType !== 'org_content') return null;
    const actorUserId = readString(document, 'actorUserId');
    const functionName = readEnum(
      document.functionName,
      ['organization-admin', 'relationship-command', 'teacher-student-command'] as const,
    );
    const action = readString(document, 'action');
    const operationId = readString(document, 'operationId');
    const requestHash = readString(document, 'requestHash');
    const status = readEnum(document.status, ['processing', 'succeeded', 'failed'] as const);
    const resultKind = readEnum(document.resultKind, ['value', 'void'] as const);
    const errorCode = document.errorCode === null
      ? null
      : readEnum(document.errorCode, ['VALIDATION_ERROR', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RESOURCE_OFFLINE'] as const);
    if (actorUserId === null || functionName === null || action === null || operationId === null
      || requestHash === null || status === null || resultKind === null || errorCode === null && document.errorCode !== null) return null;
    return {
      id: recordId,
      organizationId,
      actorUserId,
      functionName,
      action,
      operationId,
      requestHash,
      status,
      resultKind,
      result: document.result ?? null,
      errorCode,
    };
  }

  public async createOperation(record: OrgContentOperationRecord): Promise<boolean> {
    return this.transaction.create(
      ORG_CONTENT_COLLECTIONS.idempotency,
      operationDocument(record, 1),
    );
  }

  public async finishOperation<T>(record: OrgContentOperationRecord, value: T): Promise<void> {
    const encoded = encodeOutcome(value);
    await this.replaceOperation({
      ...record,
      status: 'succeeded',
      resultKind: encoded.kind,
      result: encoded.value,
      errorCode: null,
    });
  }

  public async failOperation(record: OrgContentOperationRecord, code: OrgContentError['code']): Promise<void> {
    await this.replaceOperation({ ...record, status: 'failed', resultKind: 'void', result: null, errorCode: code });
  }

  private async decodeUserWithRoles(
    document: VersionedDocument | null,
    organizationId: string,
  ): Promise<UserEntity | null> {
    const base = decodeUser(document, organizationId);
    if (base === null) return null;
    const documents = await this.transaction.find(ORG_CONTENT_COLLECTIONS.roles, {
      organizationId, userId: base.id, status: 'active', deletedAt: null,
    });
    const roles = documents.map((candidate) => decodeRoleAssignment(candidate, organizationId))
      .filter((item): item is RoleAssignmentEntity => item !== null)
      .map((assignment) => assignment.role);
    return { ...base, roles: [...new Set(roles)] };
  }

  private async acquireOwnerGuard(
    guardType: 'class_name' | 'student_number' | 'active_binding_code' | 'student_class_membership' | 'student_active_membership',
    organizationId: string,
    key: string,
    ownerId: string,
    findExisting: () => Promise<readonly VersionedDocument[]>,
  ): Promise<void> {
    const id = guardDocumentId(guardType, organizationId, key);
    const current = await this.readGuard(id, organizationId, guardType);
    if (current !== null && current.active === true) {
      if (current.ownerId !== ownerId) throw new OrgContentError('CONFLICT');
      return;
    }
    const existing = await findExisting();
    if (existing.some((document) => document._id !== ownerId)) throw new OrgContentError('CONFLICT');
    await this.writeGuard(id, organizationId, current?.document ?? null, {
      guardType,
      guardKey: key,
      active: true,
      ownerId,
    });
  }

  private async releaseOwnerGuard(
    guardType: 'class_name' | 'student_number' | 'active_binding_code' | 'student_class_membership' | 'student_active_membership',
    organizationId: string,
    key: string,
    ownerId: string,
  ): Promise<void> {
    const id = guardDocumentId(guardType, organizationId, key);
    const current = await this.readGuard(id, organizationId, guardType);
    if (current !== null && current.active === true && current.ownerId !== ownerId) {
      throw new OrgContentError('CONFLICT');
    }
    await this.writeGuard(id, organizationId, current?.document ?? null, {
      guardType,
      guardKey: key,
      active: false,
      ownerId,
    });
  }

  private async acquireParentPairGuard(
    organizationId: string,
    parentId: string,
    studentId: string,
    linkId: string,
  ): Promise<void> {
    const key = `${parentId}\u001f${studentId}`;
    const id = guardDocumentId('parent_student_pair', organizationId, key);
    const current = await this.readGuard(id, organizationId, 'parent_student_pair');
    if (current !== null && current.active === true) throw new OrgContentError('CONFLICT');
    const existing = await this.transaction.find(ORG_CONTENT_COLLECTIONS.parentLinks, {
      organizationId, parentId, studentId, status: 'active', deletedAt: null,
    });
    if (existing.some((document) => document._id !== linkId)) throw new OrgContentError('CONFLICT');
    await this.writeGuard(id, organizationId, current?.document ?? null, {
      guardType: 'parent_student_pair', guardKey: key, active: true, ownerId: linkId,
    });
  }

  private async releaseParentPairGuard(
    organizationId: string,
    parentId: string,
    studentId: string,
    linkId: string,
  ): Promise<void> {
    const key = `${parentId}\u001f${studentId}`;
    const id = guardDocumentId('parent_student_pair', organizationId, key);
    const current = await this.readGuard(id, organizationId, 'parent_student_pair');
    if (current !== null && current.active === true && current.ownerId !== linkId) {
      throw new OrgContentError('CONFLICT');
    }
    await this.writeGuard(id, organizationId, current?.document ?? null, {
      guardType: 'parent_student_pair', guardKey: key, active: false, ownerId: linkId,
    });
  }

  private async adjustCountGuard(
    guardType: 'parent_child_count' | 'student_parent_count',
    organizationId: string,
    subjectId: string,
    delta: 1 | -1,
    maximum: number,
    findCurrent: () => Promise<readonly VersionedDocument[]>,
  ): Promise<void> {
    const id = guardDocumentId(guardType, organizationId, subjectId);
    const current = await this.readGuard(id, organizationId, guardType);
    const baseCount = current?.count ?? (await findCurrent()).length;
    const nextCount = baseCount + delta;
    if (!Number.isInteger(nextCount) || nextCount < 0 || nextCount > maximum) {
      throw new OrgContentError('CONFLICT');
    }
    await this.writeGuard(id, organizationId, current?.document ?? null, {
      guardType, guardKey: subjectId, count: nextCount,
    });
  }

  private async readGuard(
    id: string,
    organizationId: string,
    guardType: string,
  ): Promise<Readonly<{
    document: VersionedDocument;
    active?: boolean;
    ownerId?: string;
    count?: number;
  }> | null> {
    const document = await this.transaction.get(ORG_CONTENT_COLLECTIONS.guards, id);
    if (document === null) return null;
    if (!isScopedVisible(document, organizationId) || document.guardType !== guardType) {
      throw new OrgContentError('CONFLICT');
    }
    const active = typeof document.active === 'boolean' ? document.active : undefined;
    const ownerId = typeof document.ownerId === 'string' ? document.ownerId : undefined;
    const count = typeof document.count === 'number' && Number.isInteger(document.count) && document.count >= 0
      ? document.count
      : undefined;
    return {
      document,
      ...(active === undefined ? {} : { active }),
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(count === undefined ? {} : { count }),
    };
  }

  private async writeGuard(
    id: string,
    organizationId: string,
    current: VersionedDocument | null,
    fields: JsonObject,
  ): Promise<void> {
    const version = (current?.version ?? 0) + 1;
    const document: VersionedDocument = {
      _id: id, organizationId, schemaVersion: 1, version, deletedAt: null, ...fields,
    };
    if (current === null) {
      if (!(await this.transaction.create(ORG_CONTENT_COLLECTIONS.guards, document))) {
        throw new OrgContentError('CONFLICT');
      }
      return;
    }
    if (!(await this.transaction.replace(ORG_CONTENT_COLLECTIONS.guards, id, current.version, document))) {
      throw new OrgContentError('CONFLICT');
    }
  }

  private async save(
    collection: string,
    id: string,
    organizationId: string,
    version: number,
    fields: JsonObject,
  ): Promise<void> {
    const current = await this.transaction.get(collection, id);
    const document: VersionedDocument = {
      _id: id, organizationId, schemaVersion: 1, version, deletedAt: null, ...fields,
    };
    if (current === null) {
      if (version !== 1 || !(await this.transaction.create(collection, document))) throw new OrgContentError('CONFLICT');
      return;
    }
    if (current.organizationId !== organizationId || current.deletedAt !== null || version !== current.version + 1
      || !(await this.transaction.replace(collection, id, current.version, document))) throw new OrgContentError('CONFLICT');
  }

  private async append(collection: string, id: string, organizationId: string, fields: JsonObject): Promise<void> {
    const document: VersionedDocument = {
      _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null, ...fields,
    };
    if (!(await this.transaction.append(collection, document))) throw new OrgContentError('CONFLICT');
  }

  private async appendOperationLog(entry: OperationLogRecord): Promise<void> {
    const documentId = orgContentAuditDocumentId(entry.organizationId, entry.requestId);
    await this.append(ORG_CONTENT_COLLECTIONS.organizationAudits, documentId, entry.organizationId, {
      id: documentId,
      requestId: entry.requestId,
      actorUserId: entry.actorUserId,
      actorRole: entry.actorRole,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      result: entry.result,
      errorCode: entry.errorCode,
      metadata: { ...entry.metadata },
      occurredAt: entry.occurredAt,
    });
  }

  private async replaceOperation(record: OrgContentOperationRecord): Promise<void> {
    if (!(await this.transaction.replace(
      ORG_CONTENT_COLLECTIONS.idempotency,
      record.id,
      1,
      operationDocument(record, 2),
    ))) throw new OrgContentError('CONFLICT');
  }
}

export function orgContentAuditDocumentId(organizationId: string, requestId: string): string {
  return `audit:${organizationId}:${requestId}`;
}

function operationDocument(record: OrgContentOperationRecord, version: number): VersionedDocument {
  return {
    _id: record.id,
    organizationId: record.organizationId,
    schemaVersion: 1,
    version,
    deletedAt: null,
    operationType: 'org_content',
    actorUserId: record.actorUserId,
    functionName: record.functionName,
    action: record.action,
    operationId: record.operationId,
    requestHash: record.requestHash,
    status: record.status,
    resultKind: record.resultKind,
    result: record.result,
    errorCode: record.errorCode,
  };
}

function encodeOutcome<T>(value: T): Readonly<{ kind: 'value' | 'void'; value: JsonValue }> {
  if (value === undefined) return { kind: 'void', value: null };
  return { kind: 'value', value: JSON.parse(JSON.stringify(value)) as JsonValue };
}

function cloneOutcome<T>(value: JsonValue, kind: 'value' | 'void'): T {
  return (kind === 'void' ? undefined : JSON.parse(JSON.stringify(value))) as T;
}

function decodeOrganization(document: VersionedDocument | null, organizationId: string): OrganizationEntity | null {
  if (!isScopedVisible(document, organizationId) || document._id !== organizationId) return null;
  const name = readString(document, 'name');
  const timeZone = readString(document, 'timeZone');
  if (name === null || timeZone === null || (document.status !== 'active' && document.status !== 'disabled')) return null;
  return { id: document._id, name, status: document.status, timeZone, version: document.version };
}

function decodeClass(document: VersionedDocument | null, organizationId: string): ClassEntity | null {
  if (!isScopedVisible(document, organizationId)) return null;
  const name = readString(document, 'name');
  const grade = readStringOrNumber(document, 'grade');
  const term = readString(document, 'term');
  if (name === null || grade === null || term === null
    || (document.status !== 'active' && document.status !== 'archived')) return null;
  return {
    id: document._id,
    organizationId,
    name,
    grade,
    term,
    status: document.status,
    version: document.version,
  };
}

function decodeUser(
  document: VersionedDocument | null,
  organizationId: string,
): Omit<UserEntity, 'roles'> | null {
  if (!isScopedVisible(document, organizationId)) return null;
  const displayName = readString(document, 'displayName');
  const displayNameMasked = readString(document, 'displayNameMasked');
  const authorizationVersion = readInteger(document, 'authorizationVersion', 1);
  const mobileMasked = readOptionalString(document, 'mobileMasked');
  const studentNumber = readOptionalString(document, 'studentNumber');
  if (displayName === null || displayNameMasked === null || authorizationVersion === null
    || mobileMasked === false || studentNumber === false
    || (document.status !== 'active' && document.status !== 'disabled')) return null;
  return {
    id: document._id,
    organizationId,
    authorizationVersion,
    displayName,
    displayNameMasked,
    ...(mobileMasked === undefined ? {} : { mobileMasked }),
    ...(studentNumber === undefined ? {} : { studentNumber }),
    status: document.status,
    version: document.version,
  };
}

function decodeMembership(document: VersionedDocument, organizationId: string): ClassMembershipEntity | null {
  const membership = decodeMembershipAnyStatus(document, organizationId);
  return membership?.status === 'active' ? membership : null;
}

function decodeMembershipAnyStatus(document: VersionedDocument, organizationId: string): ClassMembershipEntity | null {
  if (!isScopedVisible(document, organizationId)
    || (document.status !== 'active' && document.status !== 'transferred' && document.status !== 'inactive')) return null;
  const classId = readString(document, 'classId');
  const studentId = readString(document, 'studentId');
  const joinedAt = readOptionalString(document, 'joinedAt');
  const leftAt = readOptionalString(document, 'leftAt');
  if (classId === null || studentId === null || joinedAt === false || leftAt === false) return null;
  return {
    id: document._id,
    organizationId,
    classId,
    studentId,
    status: document.status,
    ...(joinedAt === undefined ? {} : { joinedAt }),
    ...(leftAt === undefined ? {} : { leftAt }),
    version: document.version,
  };
}

function selectCurrentMembership(
  memberships: readonly ClassMembershipEntity[],
): ClassMembershipEntity | null {
  const active = memberships.filter((item) => item.status === 'active');
  if (active.length === 1) return active[0] ?? null;
  if (active.length > 1) return null;
  const inactive = memberships.filter((item) => item.status === 'inactive');
  return inactive.length === 1 ? inactive[0] ?? null : null;
}

function decodeTeacherGrant(document: VersionedDocument, organizationId: string): TeacherClassGrantEntity | null {
  const grant = decodeTeacherGrantAnyStatus(document, organizationId);
  return grant?.status === 'active' ? grant : null;
}

function decodeTeacherGrantAnyStatus(
  document: VersionedDocument,
  organizationId: string,
): TeacherClassGrantEntity | null {
  if (!isScopedVisible(document, organizationId)
    || (document.status !== 'active' && document.status !== 'revoked')) return null;
  const teacherId = readString(document, 'teacherId');
  const classId = readString(document, 'classId');
  const permissions = readEnumArray(document, 'permissions', TEACHER_CLASS_PERMISSIONS);
  const grantedBy = readString(document, 'grantedBy');
  const grantedAt = readString(document, 'grantedAt');
  const revokedAt = readOptionalString(document, 'revokedAt');
  if (teacherId === null || classId === null || permissions === null || grantedBy === null || grantedAt === null
    || revokedAt === false) return null;
  return {
    id: document._id,
    organizationId,
    teacherId,
    classId,
    permissions,
    status: document.status,
    grantedBy,
    grantedAt,
    ...(revokedAt === undefined ? {} : { revokedAt }),
    version: document.version,
  };
}

function decodeBindingCode(document: VersionedDocument, organizationId: string): BindingCodeEntity | null {
  if (!isScopedVisible(document, organizationId)) return null;
  const studentId = readString(document, 'studentId');
  const codeDigest = readString(document, 'codeDigest');
  const status = readEnum(document.status, ['active', 'used', 'expired', 'revoked', 'locked'] as const);
  const attemptCount = readInteger(document, 'attemptCount', 0);
  const expiresAt = readString(document, 'expiresAt');
  const usedAt = readOptionalString(document, 'usedAt');
  const usedByParentId = readOptionalString(document, 'usedByParentId');
  const createdBy = readString(document, 'createdBy');
  const createdAt = readString(document, 'createdAt');
  if (studentId === null || codeDigest === null || status === null || attemptCount === null || expiresAt === null
    || usedAt === false || usedByParentId === false || createdBy === null || createdAt === null) return null;
  return {
    id: document._id,
    organizationId,
    studentId,
    codeDigest,
    status,
    attemptCount,
    expiresAt,
    ...(usedAt === undefined ? {} : { usedAt }),
    ...(usedByParentId === undefined ? {} : { usedByParentId }),
    createdBy,
    createdAt,
    version: document.version,
  };
}

function decodeRoleAssignment(document: VersionedDocument, organizationId: string): RoleAssignmentEntity | null {
  if (!isScopedVisible(document, organizationId)
    || (document.status !== 'active' && document.status !== 'revoked')) return null;
  const userId = readString(document, 'userId');
  const role = readEnum(document.role, USER_ROLES);
  // Persistence permits string permissions so older, more narrowly-scoped grants
  // can coexist during migration. Unknown values must never become domain powers,
  // but they also must not erase the user's role used by read-side projections.
  const permissions = readKnownEnumArray(document, 'permissions', ROLE_PERMISSIONS);
  const scopeType = readEnum(document.scopeType, ROLE_SCOPE_TYPES);
  const scopeIds = readStringArray(document, 'scopeIds');
  const grantedBy = readString(document, 'grantedBy');
  const grantedAt = readString(document, 'grantedAt');
  const revokedAt = readOptionalString(document, 'revokedAt');
  const revokedBy = readOptionalString(document, 'revokedBy');
  const revokeReason = readOptionalString(document, 'revokeReason');
  if (userId === null || role === null || permissions === null || scopeType === null || scopeIds === null
    || grantedBy === null || grantedAt === null || revokedAt === false || revokedBy === false || revokeReason === false) return null;
  return {
    id: document._id,
    organizationId,
    userId,
    role,
    status: document.status,
    permissions,
    scopeType,
    scopeIds,
    grantedBy,
    grantedAt,
    ...(revokedAt === undefined ? {} : { revokedAt }),
    ...(revokedBy === undefined ? {} : { revokedBy }),
    ...(revokeReason === undefined ? {} : { revokeReason }),
    version: document.version,
  };
}

function decodeParentLink(document: VersionedDocument, organizationId: string): ParentStudentLinkEntity | null {
  const link = decodeParentLinkAnyStatus(document, organizationId);
  return link?.status === 'active' ? link : null;
}

function decodeParentLinkAnyStatus(
  document: VersionedDocument,
  organizationId: string,
): ParentStudentLinkEntity | null {
  if (!isScopedVisible(document, organizationId)
    || (document.status !== 'active' && document.status !== 'revoked')) return null;
  const parentId = readString(document, 'parentId');
  const studentId = readString(document, 'studentId');
  const confirmedBy = readString(document, 'confirmedBy');
  const confirmedAt = readString(document, 'confirmedAt');
  const revokedAt = readOptionalString(document, 'revokedAt');
  const revokedBy = readOptionalString(document, 'revokedBy');
  const revokeReason = readOptionalString(document, 'revokeReason');
  if (parentId === null || studentId === null || confirmedBy === null || confirmedAt === null
    || revokedAt === false || revokedBy === false || revokeReason === false) return null;
  return {
    id: document._id,
    organizationId,
    parentId,
    studentId,
    status: document.status,
    confirmedBy,
    confirmedAt,
    confirmationSource: 'binding_code',
    ...(revokedAt === undefined ? {} : { revokedAt }),
    ...(revokedBy === undefined ? {} : { revokedBy }),
    ...(revokeReason === undefined ? {} : { revokeReason }),
    version: document.version,
  };
}

const OPERATION_LOG_ERROR_CODES = [
  'VALIDATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
  'RESOURCE_OFFLINE', 'TASK_NOT_SUBMITTABLE', 'REDO_LIMIT_REACHED',
  'DUPLICATE_OPERATION', 'NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR',
] as const;

function decodeOperationLog(
  document: VersionedDocument,
  organizationId: string,
): OperationLogRecord | null {
  if (!isScopedVisible(document, organizationId)) return null;
  const requestId = readString(document, 'requestId');
  const actorUserId = document.actorUserId === null ? null : readString(document, 'actorUserId');
  const actorRole = document.actorRole === null ? null : readEnum(document.actorRole, ACTOR_ROLES);
  const action = readString(document, 'action');
  const targetType = readString(document, 'targetType');
  const targetId = document.targetId === null ? null : readString(document, 'targetId');
  const result = readEnum(document.result, ['succeeded', 'denied', 'failed'] as const);
  const errorCode = document.errorCode === null ? null : readEnum(document.errorCode, OPERATION_LOG_ERROR_CODES);
  const occurredAt = readString(document, 'occurredAt');
  const metadata = isJsonObject(document.metadata) ? document.metadata : null;
  if (requestId === null || actorUserId === null && document.actorUserId !== null
    || actorRole === null && document.actorRole !== null || action === null || targetType === null
    || targetId === null && document.targetId !== null || result === null
    || errorCode === null && document.errorCode !== null || occurredAt === null || metadata === null) return null;
  return {
    id: document._id,
    organizationId,
    requestId,
    actorUserId,
    actorRole,
    action,
    targetType,
    targetId,
    result,
    errorCode,
    occurredAt,
    metadata: { ...metadata },
  };
}

function decodeLearningResource(
  document: VersionedDocument | null,
  organizationId: string,
): LearningResourceEntity | null {
  if (!isScopedVisible(document, organizationId) || document.status !== 'published') return null;
  const title = readString(document, 'title');
  const contentVersion = readStringOrNumber(document, 'contentVersion');
  const copyrightStatus = readEnum(document.copyrightStatus, ['demo', 'verified'] as const);
  const visibility = decodeVisibility(document);
  const payload = isJsonObject(document.payload) ? document.payload : document;
  if (title === null || contentVersion === null || copyrightStatus === null || visibility === null) return null;

  if (document.type === 'reading') {
    const legacyChapters = payload.demoOnly === true ? decodeLegacyReadingPages(payload.pages, title) : null;
    const category = readEnum(field(document, payload, 'category'), [
      'original', 'synchronized', 'picture_book', 'current_events', 'chapter_book',
    ] as const) ?? (legacyChapters === null ? null : 'picture_book');
    const grade = readStringFrom(document, payload, 'grade') ?? (legacyChapters === null ? null : '未分级');
    const difficulty = readStringFrom(document, payload, 'difficulty') ?? (legacyChapters === null ? null : '基础');
    const chapters = decodeChapters(field(document, payload, 'chapters')) ?? legacyChapters;
    const searchText = readOptionalStringFrom(document, payload, 'searchText');
    if (category === null || grade === null || difficulty === null || chapters === null || searchText === false) return null;
    return {
      id: document._id,
      organizationId,
      type: 'reading',
      title,
      contentVersion,
      status: 'published',
      visibility,
      copyrightStatus,
      category,
      grade,
      difficulty,
      chapters,
      ...(legacyChapters === null ? {} : { taskOnly: true }),
      ...(searchText === undefined ? {} : { searchText }),
    };
  }

  if (document.type === 'vocabulary') {
    const grade = readStringFrom(document, payload, 'grade');
    const unit = readStringFrom(document, payload, 'unit');
    const words = decodeWords(field(document, payload, 'words'));
    if (grade === null || unit === null || words === null) return null;
    return {
      id: document._id,
      organizationId,
      type: 'vocabulary',
      title,
      contentVersion,
      status: 'published',
      visibility,
      copyrightStatus,
      grade,
      unit,
      words,
    };
  }

  return null;
}

function decodeVisibility(document: VersionedDocument): ResourceVisibility | null {
  const candidate = isJsonObject(document.visibility)
    ? document.visibility
    : isJsonObject(document.visibilityScope) ? document.visibilityScope : null;
  if (candidate === null) return null;
  if (candidate.type === 'organization') return { type: 'organization' };
  const classIds = readStringArray(candidate, 'classIds');
  return classIds === null ? null : { type: 'classes', classIds };
}

function decodeChapters(value: JsonValue | undefined): readonly ReadingChapterEntity[] | null {
  if (!Array.isArray(value)) return null;
  const chapters: ReadingChapterEntity[] = [];
  for (const item of value) {
    if (!isJsonObject(item)) return null;
    const id = readString(item, 'id');
    const title = readString(item, 'title');
    const order = readInteger(item, 'order', 1);
    if (id === null || title === null || order === null || !Array.isArray(item.pages)) return null;
    const pages: ReadingPageEntity[] = [];
    for (const pageValue of item.pages) {
      const page = decodePage(pageValue);
      if (page === null) return null;
      pages.push(page);
    }
    chapters.push({ id, title, order, pages });
  }
  return chapters;
}

function decodeLegacyReadingPages(value: JsonValue | undefined, title: string): readonly ReadingChapterEntity[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const groups = new Map<string, ReadingPageEntity[]>();
  for (const [index, raw] of value.entries()) {
    if (!isJsonObject(raw)) return null;
    const chapterId = readString(raw, 'chapterId');
    const id = readString(raw, 'id');
    const pageNumber = readInteger(raw, 'pageNumber', 1);
    const thumbnailAssetKey = readString(raw, 'thumbnailAssetKey');
    const imageAssetKey = readString(raw, 'imageAssetKey');
    const width = readInteger(raw, 'width', 1);
    const height = readInteger(raw, 'height', 1);
    const version = readStringOrNumber(raw, 'version');
    if (chapterId === null || id === null || pageNumber === null || thumbnailAssetKey === null || imageAssetKey === null
      || width === null || height === null || version === null) return null;
    const pages = groups.get(chapterId) ?? [];
    pages.push({ id, pageNumber, order: index + 1, thumbnailAssetKey, imageAssetKey, width, height, assetVersion: version });
    groups.set(chapterId, pages);
  }
  return [...groups.entries()].map(([id, pages], index) => ({ id, title, order: index + 1, pages }));
}

function decodePage(value: JsonValue): ReadingPageEntity | null {
  if (!isJsonObject(value)) return null;
  const id = readString(value, 'id');
  const pageNumber = readInteger(value, 'pageNumber', 1);
  const order = readInteger(value, 'order', 1);
  const thumbnailAssetKey = readString(value, 'thumbnailAssetKey');
  const imageAssetKey = readString(value, 'imageAssetKey');
  const width = readInteger(value, 'width', 1);
  const height = readInteger(value, 'height', 1);
  const assetVersion = readString(value, 'assetVersion');
  const ocrText = readOptionalString(value, 'ocrText');
  const bodyBlocks = readOptionalStringArray(value, 'bodyBlocks');
  if (id === null || pageNumber === null || order === null || thumbnailAssetKey === null || imageAssetKey === null
    || width === null || height === null || assetVersion === null || ocrText === false || bodyBlocks === false) return null;
  return {
    id,
    pageNumber,
    order,
    thumbnailAssetKey,
    imageAssetKey,
    width,
    height,
    assetVersion,
    ...(ocrText === undefined ? {} : { ocrText }),
    ...(bodyBlocks === undefined ? {} : { bodyBlocks }),
  };
}

function decodeWords(value: JsonValue | undefined): readonly VocabularyWordEntity[] | null {
  if (!Array.isArray(value)) return null;
  const words: VocabularyWordEntity[] = [];
  for (const item of value) {
    if (!isJsonObject(item)) return null;
    const id = readString(item, 'id');
    const word = readString(item, 'word');
    const meaning = readString(item, 'meaning');
    const example = readString(item, 'example');
    const syllables = readStringArray(item, 'syllables');
    if (id === null || word === null || meaning === null || example === null || syllables === null) return null;
    words.push({ id, word, meaning, example, syllables });
  }
  return words;
}

function isScopedVisible(
  document: VersionedDocument | null,
  organizationId: string,
): document is VersionedDocument {
  return document !== null && document.organizationId === organizationId && document.deletedAt === null;
}

function field(primary: JsonObject, fallback: JsonObject, name: string): JsonValue | undefined {
  return primary[name] ?? fallback[name];
}

function readStringFrom(primary: JsonObject, fallback: JsonObject, name: string): string | null {
  const value = field(primary, fallback, name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readOptionalStringFrom(
  primary: JsonObject,
  fallback: JsonObject,
  name: string,
): string | undefined | false {
  const value = field(primary, fallback, name);
  return value === undefined || value === null ? undefined : typeof value === 'string' ? value : false;
}

function readString(record: JsonObject, name: string): string | null {
  const value = record[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readOptionalString(record: JsonObject, name: string): string | undefined | false {
  const value = record[name];
  return value === undefined || value === null ? undefined : typeof value === 'string' ? value : false;
}

function readStringOrNumber(record: JsonObject, name: string): string | null {
  const value = record[name];
  if (typeof value === 'string' && value.length > 0) return value;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}

function readInteger(record: JsonObject, name: string, minimum: number): number | null {
  const value = record[name];
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum ? value : null;
}

function readStringArray(record: JsonObject, name: string): readonly string[] | null {
  const value = record[name];
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') ? [...value] : null;
}

function readOptionalStringArray(record: JsonObject, name: string): readonly string[] | undefined | false {
  const value = record[name];
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') ? [...value] : false;
}

function readEnum<const T extends readonly string[]>(value: JsonValue | undefined, allowed: T): T[number] | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T[number] : null;
}

function readEnumArray<const T extends readonly string[]>(
  record: JsonObject,
  name: string,
  allowed: T,
): readonly T[number][] | null {
  const value = record[name];
  return Array.isArray(value) && value.every((item): item is T[number] => (
    typeof item === 'string' && (allowed as readonly string[]).includes(item)
  )) ? [...value] : null;
}

function readKnownEnumArray<const T extends readonly string[]>(
  record: JsonObject,
  name: string,
  allowed: T,
): readonly T[number][] | null {
  const value = record[name];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) return null;
  return value.filter((item): item is T[number] => (allowed as readonly string[]).includes(item));
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compact<T>(values: readonly (T | null)[]): T[] {
  return values.filter((value): value is T => value !== null);
}

function normalizeGuardValue(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function guardDocumentId(guardType: string, organizationId: string, key: string): string {
  return `guard:${encodeURIComponent(guardType)}:${encodeURIComponent(organizationId)}:${encodeURIComponent(key)}`;
}
