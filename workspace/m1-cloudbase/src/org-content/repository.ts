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
import type { JsonValue } from '../shared/protocol';
import type { OrgContentError } from './types';

export interface OrgContentTransaction {
  findUser(organizationId: string, userId: string): Promise<UserEntity | null>;
  findUserByStudentNumber(organizationId: string, studentNumber: string): Promise<UserEntity | null>;
  findClass(organizationId: string, classId: string): Promise<ClassEntity | null>;
  findClassByName(organizationId: string, name: string): Promise<ClassEntity | null>;
  saveClass(classEntity: ClassEntity): Promise<void>;
  countActiveMembershipsForClass(organizationId: string, classId: string): Promise<number>;
  listActiveMembershipsForStudent(organizationId: string, studentId: string): Promise<readonly ClassMembershipEntity[]>;
  findMembership(organizationId: string, studentId: string, classId: string): Promise<ClassMembershipEntity | null>;
  saveMembership(membership: ClassMembershipEntity): Promise<void>;
  saveUser(user: UserEntity): Promise<void>;
  findRoleAssignment(organizationId: string, userId: string, role: RoleAssignmentEntity['role']): Promise<RoleAssignmentEntity | null>;
  saveRoleAssignment(assignment: RoleAssignmentEntity): Promise<void>;
  findActiveMembershipForStudent(organizationId: string, studentId: string): Promise<ClassMembershipEntity | null>;
  findActiveTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<TeacherClassGrantEntity | null>;
  findTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<TeacherClassGrantEntity | null>;
  saveTeacherGrant(grant: TeacherClassGrantEntity): Promise<void>;
  appendOrganizationAudit(entry: OrganizationAuditEntity): Promise<void>;
  findActiveBindingCodeForStudent(organizationId: string, studentId: string): Promise<BindingCodeEntity | null>;
  saveBindingCode(code: BindingCodeEntity): Promise<void>;
  countActiveChildren(organizationId: string, parentId: string): Promise<number>;
  countActiveParents(organizationId: string, studentId: string): Promise<number>;
  findActiveParentLink(organizationId: string, parentId: string, studentId: string): Promise<ParentStudentLinkEntity | null>;
  saveParentLink(link: ParentStudentLinkEntity): Promise<void>;
  appendRelationshipAudit(entry: RelationshipAuditEntity): Promise<void>;
}

export interface OrgContentRepository {
  listOrganizations(organizationIds: readonly string[]): Promise<readonly OrganizationEntity[]>;
  findOrganization(organizationId: string): Promise<OrganizationEntity | null>;
  listClasses(organizationId: string): Promise<readonly ClassEntity[]>;
  findClass(organizationId: string, classId: string): Promise<ClassEntity | null>;
  findUser(organizationId: string, userId: string): Promise<UserEntity | null>;
  listUsers(organizationId: string): Promise<readonly UserEntity[]>;
  listUsersForClass(organizationId: string, classId: string): Promise<readonly UserEntity[]>;
  listActiveMembershipsForClass(organizationId: string, classId: string): Promise<readonly ClassMembershipEntity[]>;
  listMembershipsForClass(organizationId: string, classId: string): Promise<readonly ClassMembershipEntity[]>;
  findMembership(organizationId: string, studentId: string, classId: string): Promise<ClassMembershipEntity | null>;
  findActiveMembershipForStudent(organizationId: string, studentId: string): Promise<ClassMembershipEntity | null>;
  listActiveMembershipsForStudent(organizationId: string, studentId: string): Promise<readonly ClassMembershipEntity[]>;
  findActiveTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<TeacherClassGrantEntity | null>;
  listActiveTeacherGrants(organizationId: string, teacherId: string): Promise<readonly TeacherClassGrantEntity[]>;
  listActiveTeacherGrantsForClass(organizationId: string, classId: string): Promise<readonly TeacherClassGrantEntity[]>;
  listRoleAssignments(organizationId: string, userId?: string): Promise<readonly RoleAssignmentEntity[]>;
  listOperationLogs(
    organizationId: string,
    filter: Readonly<{
      actorUserId?: string;
      action?: string;
      result?: OperationLogRecord['result'];
      targetType?: string;
    }>,
  ): Promise<readonly OperationLogRecord[]>;
  findActiveParentLink(organizationId: string, parentId: string, studentId: string): Promise<ParentStudentLinkEntity | null>;
  listActiveParentLinks(organizationId: string, parentId: string): Promise<readonly ParentStudentLinkEntity[]>;
  listActiveParentLinksForStudent(organizationId: string, studentId: string): Promise<readonly ParentStudentLinkEntity[]>;
  listLearningResources(organizationId: string, type: LearningResourceEntity['type']): Promise<readonly LearningResourceEntity[]>;
  findLearningResource(organizationId: string, resourceId: string): Promise<LearningResourceEntity | null>;
  findOperation?(recordId: string, organizationId: string): Promise<Readonly<{ requestHash: string; status: 'processing' | 'succeeded' | 'failed'; resultKind: 'value' | 'void'; result: JsonValue; errorCode: OrgContentError['code'] | null }> | null>;
  transaction<T>(work: (transaction: OrgContentTransaction) => Promise<T>): Promise<T>;
}
