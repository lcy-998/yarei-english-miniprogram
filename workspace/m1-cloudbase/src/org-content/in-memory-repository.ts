import type { OrgContentRepository, OrgContentTransaction } from './repository';
import type {
  BindingCodeEntity,
  ClassEntity,
  ClassMembershipEntity,
  LearningResourceEntity,
  OrganizationAuditEntity,
  OrganizationEntity,
  ParentStudentLinkEntity,
  RelationshipAuditEntity,
  RoleAssignmentEntity,
  TeacherClassGrantEntity,
  UserEntity,
} from './types';
import type { OperationLogRecord } from '../runtime/records';

export interface OrgContentFixture {
  readonly organizations?: readonly OrganizationEntity[];
  readonly classes?: readonly ClassEntity[];
  readonly users?: readonly UserEntity[];
  readonly memberships?: readonly ClassMembershipEntity[];
  readonly roleAssignments?: readonly RoleAssignmentEntity[];
  readonly teacherGrants?: readonly TeacherClassGrantEntity[];
  readonly parentLinks?: readonly ParentStudentLinkEntity[];
  readonly bindingCodes?: readonly BindingCodeEntity[];
  readonly resources?: readonly LearningResourceEntity[];
  readonly relationshipAudits?: readonly RelationshipAuditEntity[];
  readonly organizationAudits?: readonly OrganizationAuditEntity[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryOrgContentRepository implements OrgContentRepository, OrgContentTransaction {
  private organizations: OrganizationEntity[];
  private classes: ClassEntity[];
  private users: UserEntity[];
  private memberships: ClassMembershipEntity[];
  private roleAssignments: RoleAssignmentEntity[];
  private teacherGrants: TeacherClassGrantEntity[];
  private parentLinks: ParentStudentLinkEntity[];
  private bindingCodes: BindingCodeEntity[];
  private resources: LearningResourceEntity[];
  private relationshipAudits: RelationshipAuditEntity[];
  private organizationAudits: OrganizationAuditEntity[];
  private transactionTail: Promise<void> = Promise.resolve();


  public constructor(fixture: OrgContentFixture = {}) {
    this.organizations = clone([...fixture.organizations ?? []]);
    this.classes = clone([...fixture.classes ?? []]);
    this.users = clone([...fixture.users ?? []]);
    this.memberships = clone([...fixture.memberships ?? []]);
    this.roleAssignments = clone([...fixture.roleAssignments ?? []]);
    this.teacherGrants = clone([...fixture.teacherGrants ?? []]);
    this.parentLinks = clone([...fixture.parentLinks ?? []]);
    this.bindingCodes = clone([...fixture.bindingCodes ?? []]);
    this.resources = clone([...fixture.resources ?? []]);
    this.relationshipAudits = clone([...fixture.relationshipAudits ?? []]);
    this.organizationAudits = clone([...fixture.organizationAudits ?? []]);
  }

  public async listOrganizations(organizationIds: readonly string[]): Promise<readonly OrganizationEntity[]> {
    return clone(this.organizations.filter((item) => organizationIds.includes(item.id)));
  }

  public async findOrganization(organizationId: string): Promise<OrganizationEntity | null> {
    return clone(this.organizations.find((item) => item.id === organizationId) ?? null);
  }

  public async listClasses(organizationId: string): Promise<readonly ClassEntity[]> {
    return clone(this.classes.filter((item) => item.organizationId === organizationId));
  }

  public async findClass(organizationId: string, classId: string): Promise<ClassEntity | null> {
    return clone(this.classes.find((item) => item.organizationId === organizationId && item.id === classId) ?? null);
  }

  public async findClassByName(organizationId: string, name: string): Promise<ClassEntity | null> {
    return clone(this.classes.find((item) => item.organizationId === organizationId && item.name === name) ?? null);
  }

  public async saveClass(classEntity: ClassEntity): Promise<void> {
    const index = this.classes.findIndex((item) => item.id === classEntity.id);
    if (index < 0) this.classes.push(clone(classEntity));
    else this.classes[index] = clone(classEntity);
  }

  public async findUser(organizationId: string, userId: string): Promise<UserEntity | null> {
    return clone(this.users.find((item) => item.organizationId === organizationId && item.id === userId) ?? null);
  }

  public async listUsers(organizationId: string): Promise<readonly UserEntity[]> {
    return clone(this.users.filter((item) => item.organizationId === organizationId));
  }

  public async saveUser(user: UserEntity): Promise<void> {
    const index = this.users.findIndex((item) => item.id === user.id);
    if (index < 0) this.users.push(clone(user));
    else this.users[index] = clone(user);
  }

  public async findUserByStudentNumber(organizationId: string, studentNumber: string): Promise<UserEntity | null> {
    return clone(this.users.find((item) => item.organizationId === organizationId && item.studentNumber === studentNumber && item.roles.includes('student')) ?? null);
  }

  public async listUsersForClass(organizationId: string, classId: string): Promise<readonly UserEntity[]> {
    const studentIds = new Set(this.memberships.filter((item) => item.organizationId === organizationId && item.classId === classId && item.status === 'active').map((item) => item.studentId));
    return clone(this.users.filter((item) => item.organizationId === organizationId && studentIds.has(item.id)));
  }

  public async listActiveMembershipsForClass(organizationId: string, classId: string): Promise<readonly ClassMembershipEntity[]> {
    return clone(this.memberships.filter((item) => item.organizationId === organizationId && item.classId === classId && item.status === 'active'));
  }

  public async listMembershipsForClass(organizationId: string, classId: string): Promise<readonly ClassMembershipEntity[]> {
    return clone(this.memberships.filter((item) => item.organizationId === organizationId && item.classId === classId));
  }

  public async countActiveMembershipsForClass(organizationId: string, classId: string): Promise<number> {
    return this.memberships.filter((item) => item.organizationId === organizationId && item.classId === classId && item.status === 'active').length;
  }

  public async saveMembership(membership: ClassMembershipEntity): Promise<void> {
    const index = this.memberships.findIndex((item) => item.id === membership.id);
    if (index < 0) this.memberships.push(clone(membership));
    else this.memberships[index] = clone(membership);
  }

  public async findActiveMembershipForStudent(organizationId: string, studentId: string): Promise<ClassMembershipEntity | null> {
    return clone(this.memberships.find((item) => item.organizationId === organizationId && item.studentId === studentId && item.status === 'active') ?? null);
  }

  public async findMembership(organizationId: string, studentId: string, classId: string): Promise<ClassMembershipEntity | null> {
    return clone(this.memberships.find((item) => item.organizationId === organizationId
      && item.studentId === studentId && item.classId === classId) ?? null);
  }

  public async listActiveMembershipsForStudent(organizationId: string, studentId: string): Promise<readonly ClassMembershipEntity[]> {
    return clone(this.memberships.filter((item) => item.organizationId === organizationId && item.studentId === studentId && item.status === 'active'));
  }

  public async findActiveTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<TeacherClassGrantEntity | null> {
    return clone(this.teacherGrants.find((item) => item.organizationId === organizationId && item.teacherId === teacherId && item.classId === classId && item.status === 'active') ?? null);
  }

  public async findTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<TeacherClassGrantEntity | null> {
    return clone(this.teacherGrants.find((item) => item.organizationId === organizationId && item.teacherId === teacherId && item.classId === classId) ?? null);
  }

  public async listActiveTeacherGrants(organizationId: string, teacherId: string): Promise<readonly TeacherClassGrantEntity[]> {
    return clone(this.teacherGrants.filter((item) => item.organizationId === organizationId && item.teacherId === teacherId && item.status === 'active'));
  }

  public async listActiveTeacherGrantsForClass(organizationId: string, classId: string): Promise<readonly TeacherClassGrantEntity[]> {
    return clone(this.teacherGrants.filter((item) => item.organizationId === organizationId && item.classId === classId && item.status === 'active'));
  }

  public async findRoleAssignment(
    organizationId: string,
    userId: string,
    role: RoleAssignmentEntity['role'],
  ): Promise<RoleAssignmentEntity | null> {
    return clone(this.roleAssignments.find((item) => item.organizationId === organizationId && item.userId === userId && item.role === role) ?? null);
  }

  public async listRoleAssignments(organizationId: string, userId?: string): Promise<readonly RoleAssignmentEntity[]> {
    return clone(this.roleAssignments.filter((item) => item.organizationId === organizationId && (userId === undefined || item.userId === userId)));
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
    const records: readonly OperationLogRecord[] = [
      ...this.organizationAudits,
      ...this.relationshipAudits,
    ].map((item) => ({
      id: item.id,
      organizationId: item.organizationId,
      requestId: item.requestId,
      actorUserId: item.actorUserId,
      actorRole: item.actorRole,
      action: item.action,
      targetType: item.targetType,
      targetId: item.targetId,
      result: item.result,
      errorCode: item.errorCode,
      occurredAt: item.occurredAt,
      metadata: { ...item.metadata },
    }));
    return clone(records.filter((item) => item.organizationId === organizationId
      && (filter.actorUserId === undefined || item.actorUserId === filter.actorUserId)
      && (filter.action === undefined || item.action === filter.action)
      && (filter.result === undefined || item.result === filter.result)
      && (filter.targetType === undefined || item.targetType === filter.targetType)));
  }

  public async saveRoleAssignment(assignment: RoleAssignmentEntity): Promise<void> {
    const index = this.roleAssignments.findIndex((item) => item.id === assignment.id);
    if (index < 0) this.roleAssignments.push(clone(assignment));
    else this.roleAssignments[index] = clone(assignment);
  }

  public async saveTeacherGrant(grant: TeacherClassGrantEntity): Promise<void> {
    const index = this.teacherGrants.findIndex((item) => item.id === grant.id);
    if (index < 0) this.teacherGrants.push(clone(grant));
    else this.teacherGrants[index] = clone(grant);
  }

  public async appendOrganizationAudit(entry: OrganizationAuditEntity): Promise<void> {
    this.organizationAudits.push(clone(entry));
  }

  public async findActiveParentLink(organizationId: string, parentId: string, studentId: string): Promise<ParentStudentLinkEntity | null> {
    return clone(this.parentLinks.find((item) => item.organizationId === organizationId && item.parentId === parentId && item.studentId === studentId && item.status === 'active') ?? null);
  }

  public async listActiveParentLinks(organizationId: string, parentId: string): Promise<readonly ParentStudentLinkEntity[]> {
    return clone(this.parentLinks.filter((item) => item.organizationId === organizationId && item.parentId === parentId && item.status === 'active'));
  }

  public async listActiveParentLinksForStudent(organizationId: string, studentId: string): Promise<readonly ParentStudentLinkEntity[]> {
    return clone(this.parentLinks.filter((item) => item.organizationId === organizationId && item.studentId === studentId && item.status === 'active'));
  }

  public async countActiveChildren(organizationId: string, parentId: string): Promise<number> {
    return this.parentLinks.filter((item) => item.organizationId === organizationId && item.parentId === parentId && item.status === 'active').length;
  }

  public async countActiveParents(organizationId: string, studentId: string): Promise<number> {
    return this.parentLinks.filter((item) => item.organizationId === organizationId && item.studentId === studentId && item.status === 'active').length;
  }

  public async saveParentLink(link: ParentStudentLinkEntity): Promise<void> {
    const index = this.parentLinks.findIndex((item) => item.id === link.id);
    if (index < 0) this.parentLinks.push(clone(link));
    else this.parentLinks[index] = clone(link);
  }

  public async findActiveBindingCodeForStudent(organizationId: string, studentId: string): Promise<BindingCodeEntity | null> {
    return clone(this.bindingCodes.find((item) => item.organizationId === organizationId && item.studentId === studentId && item.status === 'active') ?? null);
  }

  public async saveBindingCode(code: BindingCodeEntity): Promise<void> {
    const index = this.bindingCodes.findIndex((item) => item.id === code.id);
    if (index < 0) this.bindingCodes.push(clone(code));
    else this.bindingCodes[index] = clone(code);
  }

  public async appendRelationshipAudit(entry: RelationshipAuditEntity): Promise<void> {
    this.relationshipAudits.push(clone(entry));
  }

  public async listLearningResources(organizationId: string, type: LearningResourceEntity['type']): Promise<readonly LearningResourceEntity[]> {
    return clone(this.resources.filter((item) => item.organizationId === organizationId && item.type === type));
  }

  public async findLearningResource(organizationId: string, resourceId: string): Promise<LearningResourceEntity | null> {
    return clone(this.resources.find((item) => item.organizationId === organizationId && item.id === resourceId) ?? null);
  }

  public async transaction<T>(work: (transaction: OrgContentTransaction) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshot = this.snapshotMutableState();
    try {
      return await work(this);
    } catch (error: unknown) {
      this.restoreMutableState(snapshot);
      throw error;
    } finally {
      release();
    }
  }

  public debugSnapshot(): Readonly<{
    bindingCodes: readonly BindingCodeEntity[];
    parentLinks: readonly ParentStudentLinkEntity[];
    teacherGrants: readonly TeacherClassGrantEntity[];
    roleAssignments: readonly RoleAssignmentEntity[];
    classes: readonly ClassEntity[];
    users: readonly UserEntity[];
    memberships: readonly ClassMembershipEntity[];
    relationshipAudits: readonly RelationshipAuditEntity[];
    organizationAudits: readonly OrganizationAuditEntity[];
  }> {
    return clone({ bindingCodes: this.bindingCodes, parentLinks: this.parentLinks, teacherGrants: this.teacherGrants, roleAssignments: this.roleAssignments, classes: this.classes, users: this.users, memberships: this.memberships, relationshipAudits: this.relationshipAudits, organizationAudits: this.organizationAudits });
  }

  private snapshotMutableState(): Readonly<{
    bindingCodes: BindingCodeEntity[];
    parentLinks: ParentStudentLinkEntity[];
    teacherGrants: TeacherClassGrantEntity[];
    roleAssignments: RoleAssignmentEntity[];
    classes: ClassEntity[];
    users: UserEntity[];
    memberships: ClassMembershipEntity[];
    relationshipAudits: RelationshipAuditEntity[];
    organizationAudits: OrganizationAuditEntity[];
  }> {
    return clone({ bindingCodes: this.bindingCodes, parentLinks: this.parentLinks, teacherGrants: this.teacherGrants, roleAssignments: this.roleAssignments, classes: this.classes, users: this.users, memberships: this.memberships, relationshipAudits: this.relationshipAudits, organizationAudits: this.organizationAudits });
  }

  private restoreMutableState(snapshot: Readonly<{
    bindingCodes: BindingCodeEntity[];
    parentLinks: ParentStudentLinkEntity[];
    teacherGrants: TeacherClassGrantEntity[];
    roleAssignments: RoleAssignmentEntity[];
    classes: ClassEntity[];
    users: UserEntity[];
    memberships: ClassMembershipEntity[];
    relationshipAudits: RelationshipAuditEntity[];
    organizationAudits: OrganizationAuditEntity[];
  }>): void {
    this.bindingCodes = snapshot.bindingCodes;
    this.parentLinks = snapshot.parentLinks;
    this.teacherGrants = snapshot.teacherGrants;
    this.roleAssignments = snapshot.roleAssignments;
    this.classes = snapshot.classes;
    this.users = snapshot.users;
    this.memberships = snapshot.memberships;
    this.relationshipAudits = snapshot.relationshipAudits;
    this.organizationAudits = snapshot.organizationAudits;
  }
}
