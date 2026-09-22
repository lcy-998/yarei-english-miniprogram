import type { TrustedActorContext } from '../auth/trusted-actor';
import type { ErrorCode, JsonValue } from '../shared/protocol';

export type SliceErrorCode = 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'RESOURCE_OFFLINE' | 'SERVICE_UNAVAILABLE';

export class OrgContentError extends Error {
  public constructor(public readonly code: SliceErrorCode) {
    super(code);
    this.name = 'OrgContentError';
  }
}

export interface SliceClock {
  nowIso(): string;
}

export interface OrganizationEntity {
  readonly id: string;
  readonly name: string;
  readonly status: 'active' | 'disabled';
  readonly timeZone: string;
  readonly version: number;
}

export interface ClassEntity {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly grade: string;
  readonly term: string;
  readonly status: 'active' | 'archived';
  readonly version: number;
}

export interface UserEntity {
  readonly id: string;
  readonly organizationId: string;
  readonly authorizationVersion: number;
  readonly displayName: string;
  readonly displayNameMasked: string;
  readonly mobileMasked?: string;
  readonly studentNumber?: string;
  readonly roles: readonly UserRole[];
  readonly status: 'active' | 'disabled';
  readonly version: number;
}

export const USER_ROLES = ['student', 'parent', 'teacher', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_SCOPE_TYPES = ['self', 'classes', 'organization'] as const;
export type RoleScopeType = (typeof ROLE_SCOPE_TYPES)[number];

export const ROLE_PERMISSIONS = [
  'organization.read',
  'organization.manage',
  'class.read',
  'class.manage',
  'user.read',
  'user.manage',
  'authorization.manage',
  'audit.read',
  'student.read',
  'student.manage',
  'student.bind-code.issue',
  'content.read',
  'task.read',
  'task.publish',
  'submission.review',
  'child.read',
  'child.bind',
  'child.unbind',
] as const;

export type RolePermission = (typeof ROLE_PERMISSIONS)[number];

export interface RoleAssignmentEntity {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: UserRole;
  readonly status: 'active' | 'revoked';
  readonly permissions: readonly RolePermission[];
  readonly scopeType: RoleScopeType;
  readonly scopeIds: readonly string[];
  readonly grantedBy: string;
  readonly grantedAt: string;
  readonly revokedAt?: string;
  readonly revokedBy?: string;
  readonly revokeReason?: string;
  readonly version: number;
}

export interface ClassMembershipEntity {
  readonly id: string;
  readonly organizationId: string;
  readonly classId: string;
  readonly studentId: string;
  readonly status: 'active' | 'transferred' | 'inactive';
  readonly joinedAt?: string;
  readonly leftAt?: string;
  readonly version: number;
}

export const TEACHER_CLASS_PERMISSIONS = [
  'class.read',
  'student.read',
  'student.manage',
  'student.bind-code.issue',
  'content.read',
  'task.read',
  'task.publish',
  'submission.review',
] as const;

export type TeacherClassPermission = (typeof TEACHER_CLASS_PERMISSIONS)[number];

export interface TeacherClassGrantEntity {
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

export interface ParentStudentLinkEntity {
  readonly id: string;
  readonly organizationId: string;
  readonly parentId: string;
  readonly studentId: string;
  readonly status: 'active' | 'revoked';
  readonly confirmedBy: string;
  readonly confirmedAt: string;
  readonly confirmationSource: 'binding_code';
  readonly revokedAt?: string;
  readonly revokedBy?: string;
  readonly revokeReason?: string;
  readonly version: number;
}

export interface BindingCodeEntity {
  readonly id: string;
  readonly organizationId: string;
  readonly studentId: string;
  readonly codeDigest: string;
  readonly status: 'active' | 'used' | 'expired' | 'revoked' | 'locked';
  readonly attemptCount: number;
  readonly expiresAt: string;
  readonly usedAt?: string;
  readonly usedByParentId?: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly version: number;
}

export interface RelationshipAuditEntity {
  readonly id: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly actorRole: TrustedActorContext['actorRole'];
  readonly action: 'binding_code.issued' | 'binding_code.rejected' | 'parent_student.bound' | 'parent_student.unbound';
  readonly targetType: 'binding_code' | 'parent_student_link';
  readonly targetId: string;
  readonly result: 'succeeded' | 'denied' | 'failed';
  readonly errorCode: ErrorCode | null;
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly occurredAt: string;
}

export interface OrganizationAuditEntity {
  readonly id: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly actorRole: TrustedActorContext['actorRole'];
  readonly action:
    | 'class.created'
    | 'class.updated'
    | 'class.disabled'
    | 'user.created'
    | 'user.updated'
    | 'user.disabled'
    | 'role.assigned'
    | 'role.revoked'
    | 'teacher_class.granted'
    | 'teacher_class.revoked'
    | 'student.profile.updated'
    | 'student.disabled'
    | 'student.restored'
    | 'student.transferred';
  readonly targetType: 'class' | 'user' | 'role_assignment' | 'teacher_class_grant' | 'class_membership';
  readonly targetId: string;
  readonly result: 'succeeded' | 'denied' | 'failed';
  readonly errorCode: ErrorCode | null;
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly occurredAt: string;
}

export type ResourceVisibility =
  | { readonly type: 'organization' }
  | { readonly type: 'classes'; readonly classIds: readonly string[] };

export interface ReadingPageEntity {
  readonly id: string;
  readonly pageNumber: number;
  readonly order: number;
  readonly thumbnailAssetKey: string;
  readonly imageAssetKey: string;
  readonly width: number;
  readonly height: number;
  readonly assetVersion: string;
  readonly ocrText?: string;
  readonly bodyBlocks?: readonly string[];
}

export interface ReadingChapterEntity {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly pages: readonly ReadingPageEntity[];
}

export interface VocabularyWordEntity {
  readonly id: string;
  readonly word: string;
  readonly meaning: string;
  readonly example: string;
  readonly syllables: readonly string[];
}

interface LearningResourceBase {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly contentVersion: string;
  readonly status: 'draft' | 'published' | 'offline';
  readonly visibility: ResourceVisibility;
  readonly copyrightStatus: 'demo' | 'verified';
}

export interface ReadingResourceEntity extends LearningResourceBase {
  readonly type: 'reading';
  readonly category: 'original' | 'synchronized' | 'picture_book' | 'current_events' | 'chapter_book';
  readonly grade: string;
  readonly difficulty: string;
  readonly chapters: readonly ReadingChapterEntity[];
  readonly searchText?: string;
}

export interface VocabularyResourceEntity extends LearningResourceBase {
  readonly type: 'vocabulary';
  readonly grade: string;
  readonly unit: string;
  readonly words: readonly VocabularyWordEntity[];
}

export type LearningResourceEntity = ReadingResourceEntity | VocabularyResourceEntity;

export interface OrganizationSafeView {
  readonly id: string;
  readonly name: string;
  readonly status: OrganizationEntity['status'];
  readonly timeZone: string;
  readonly version: number;
}

export interface ClassSafeView {
  readonly id: string;
  readonly name: string;
  readonly grade: string;
  readonly term: string;
  readonly status: ClassEntity['status'];
  readonly version: number;
  readonly studentCount?: number;
  readonly teacherIds?: readonly string[];
}

export interface UserSafeView {
  readonly id: string;
  readonly displayName: string;
  readonly displayNameMasked: string;
  readonly mobileMasked?: string;
  readonly studentNumber?: string;
  readonly roles: readonly UserEntity['roles'][number][];
  readonly status: UserEntity['status'];
  readonly version: number;
  readonly classIds?: readonly string[];
  readonly bindingCount?: number;
}

export interface RoleAssignmentSafeView {
  readonly id: string;
  readonly userId: string;
  readonly role: UserRole;
  readonly status: RoleAssignmentEntity['status'];
  readonly permissions: readonly RolePermission[];
  readonly scopeType: RoleScopeType;
  readonly scopeIds: readonly string[];
  readonly version: number;
}

export interface AdminPageView<T> {
  readonly items: readonly T[];
  /** Exact within the service's 1,000-record safety window. */
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

export interface OperationLogSafeView {
  readonly id: string;
  readonly requestId: string;
  readonly actorUserId: string | null;
  readonly actorRole: TrustedActorContext['actorRole'] | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly result: 'succeeded' | 'denied' | 'failed';
  readonly errorCode: ErrorCode | null;
  /** Server allowlist projection; arbitrary stored metadata is never returned. */
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly occurredAt: string;
}

export interface ReadingListItemView {
  readonly id: string;
  readonly title: string;
  readonly category: ReadingResourceEntity['category'];
  readonly grade: string;
  readonly difficulty: string;
  readonly contentVersion: string;
}

export interface ReadingPageView {
  readonly id: string;
  readonly pageNumber: number;
  readonly order: number;
  readonly thumbnailAssetKey: string;
  readonly imageAssetKey: string;
  readonly width: number;
  readonly height: number;
  readonly assetVersion: string;
}

export interface ReadingChapterView {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly pages: readonly ReadingPageView[];
}

export interface ReadingResourceView extends ReadingListItemView {
  readonly presentation: 'page_images_only';
  readonly textVisibility: Readonly<{ ocrExposed: false; standaloneBodyExposed: false }>;
  readonly chapters: readonly ReadingChapterView[];
}

export interface VocabularyPackView {
  readonly id: string;
  readonly title: string;
  readonly grade: string;
  readonly unit: string;
  readonly contentVersion: string;
  readonly words: readonly VocabularyWordEntity[];
}

export interface BindingCodeIssueView {
  readonly code: string;
  readonly expiresAt: string;
}

export interface ParentStudentLinkView {
  readonly id: string;
  readonly child: UserSafeView;
  readonly confirmedAt: string;
  readonly version: number;
}

export type Actor = TrustedActorContext;
