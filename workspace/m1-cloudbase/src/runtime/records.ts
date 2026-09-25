import type { ActorRole } from '../auth/trusted-actor';
import type { ErrorCode, FunctionName, JsonValue, ServiceResult } from '../shared/protocol';

export interface TimestampedRecord {
  readonly _id: string;
  readonly organizationId: string;
  readonly status: string;
  readonly version: number;
  readonly deletedAt: string | null;
}

export interface OrganizationRecord extends TimestampedRecord {
  readonly name: string;
  readonly status: 'active' | 'disabled';
  readonly timeZone: string;
}

export interface UserRecord extends TimestampedRecord {
  readonly authorizationVersion: number;
  readonly profileVersion?: number;
  readonly displayName: string;
  readonly displayNameMasked: string;
  readonly studentNumber?: string;
  readonly classId?: string;
  readonly className?: string;
  readonly status: 'active' | 'disabled';
}

export interface AuthIdentityRecord extends TimestampedRecord {
  readonly userId: string;
  readonly provider: 'cloudbase_uid';
  readonly providerSubjectDigest: string;
  readonly status: 'active' | 'revoked';
}

export interface RoleAssignmentRecord extends TimestampedRecord {
  readonly userId: string;
  readonly role: ActorRole;
  readonly status: 'active' | 'revoked';
  readonly permissions: readonly string[];
  readonly scopeIds: readonly string[];
}

export interface TeacherClassGrantRecord extends TimestampedRecord {
  readonly teacherId: string;
  readonly classId: string;
  readonly status: 'active' | 'revoked';
  readonly permissions: readonly string[];
}

export interface ParentStudentLinkRecord extends TimestampedRecord {
  readonly parentId: string;
  readonly studentId: string;
  readonly status: 'active' | 'revoked';
  readonly confirmedAt?: string;
}

export interface BusinessSessionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly subjectDigest: string;
  /** Records created before the audience split are mini-program sessions. */
  readonly audience?: 'mini-program' | 'admin-console';
  readonly role: ActorRole | null;
  readonly authzVersion: number;
  readonly recordVersion: number;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

export interface IdempotencyRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly functionName: FunctionName;
  readonly action: string;
  readonly operationId: string;
  readonly requestHash: string;
  readonly status: 'processing' | 'succeeded' | 'failed';
  readonly result: ServiceResult<JsonValue> | null;
}

export interface OperationLogRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly actorUserId: string | null;
  readonly actorRole: ActorRole | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly result: 'succeeded' | 'denied' | 'failed';
  readonly errorCode: ErrorCode | null;
  readonly occurredAt: string;
  readonly metadata: Readonly<Record<string, JsonValue>>;
}
