import type { CloudCallContext, FunctionName, JsonValue } from '../shared/protocol';
import type {
  AuthIdentityRecord,
  BusinessSessionRecord,
  IdempotencyRecord,
  OperationLogRecord,
  OrganizationRecord,
  ParentStudentLinkRecord,
  RoleAssignmentRecord,
  TeacherClassGrantRecord,
  UserRecord,
} from './records';

export interface Clock {
  nowIso(): string;
}

export interface IdentifierGenerator {
  next(prefix: string): string;
}

export interface SubjectDigestPort {
  digest(platformSubject: string): string;
}

export interface IdentityRepository {
  findIdentityByDigest(digest: string): Promise<AuthIdentityRecord | null>;
  findUser(userId: string, organizationId: string): Promise<UserRecord | null>;
  findOrganization(organizationId: string): Promise<OrganizationRecord | null>;
  listActiveRoles(userId: string, organizationId: string): Promise<readonly RoleAssignmentRecord[]>;
  findActiveTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<TeacherClassGrantRecord | null>;
  findActiveParentLink(organizationId: string, parentId: string, studentId: string): Promise<ParentStudentLinkRecord | null>;
  listActiveParentLinks(organizationId: string, parentId: string): Promise<readonly ParentStudentLinkRecord[]>;
}

export interface BusinessSessionRepository {
  /**
   * Atomically resumes the unexpired session for the same platform principal and
   * authorization version, or revokes older principal sessions and stores the
   * candidate. This makes bootstrap retries stable without trusting client IDs.
   */
  startOrResume(session: BusinessSessionRecord, nowIso: string): Promise<BusinessSessionRecord>;
  find(sessionId: string): Promise<BusinessSessionRecord | null>;
  /** Replaces only when the stored recordVersion matches; never performs a blind upsert. */
  replace(session: BusinessSessionRecord, expectedRecordVersion: number): Promise<boolean>;
}

export interface IdempotencyRepository {
  find(recordId: string): Promise<IdempotencyRecord | null>;
  create(record: IdempotencyRecord): Promise<boolean>;
  replace(record: IdempotencyRecord): Promise<void>;
}

export interface OperationLogRepository {
  append(entry: OperationLogRecord): Promise<void>;
}

export interface CloudBaseRuntimePort {
  readonly functionName: FunctionName;
  getPlatformSubject(): Promise<Readonly<{ subject: string; loginType: 'WECHAT' | 'USERNAME' | 'UNKNOWN'; isAuthenticated: boolean }>>;
  getBusinessSessionId(context: CloudCallContext): Promise<string | null>;
}

export interface SeedDocument {
  readonly collection: string;
  readonly document: Readonly<Record<string, JsonValue>>;
}

/**
 * The sole future dependency on the CloudBase document SDK. Implementations must
 * inject the active environment through the platform runtime, never an envId here.
 */
export interface CloudBaseDocumentDatabasePort {
  get<T extends Readonly<Record<string, JsonValue>>>(collection: string, id: string): Promise<T | null>;
  find<T extends Readonly<Record<string, JsonValue>>>(collection: string, criteria: Readonly<Record<string, JsonValue>>): Promise<readonly T[]>;
  runTransaction<T>(work: () => Promise<T>): Promise<T>;
}
