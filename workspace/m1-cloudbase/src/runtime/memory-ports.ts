import type { CloudCallContext, FunctionName } from '../shared/protocol';
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
import type { BusinessSessionRepository, IdempotencyRepository, IdentityRepository, OperationLogRepository } from './ports';

export interface AuthorizationFixture {
  readonly organizations: readonly OrganizationRecord[];
  readonly users: readonly UserRecord[];
  readonly identities: readonly AuthIdentityRecord[];
  readonly roles: readonly RoleAssignmentRecord[];
  readonly teacherGrants: readonly TeacherClassGrantRecord[];
  readonly parentLinks: readonly ParentStudentLinkRecord[];
}

export class InMemoryIdentityRepository implements IdentityRepository {
  public constructor(private readonly fixture: AuthorizationFixture) {}

  public async findIdentityByDigest(digest: string): Promise<AuthIdentityRecord | null> {
    return this.fixture.identities.find((item) => item.providerSubjectDigest === digest && item.deletedAt === null) ?? null;
  }

  public async findUser(userId: string, organizationId: string): Promise<UserRecord | null> {
    const user = this.fixture.users.find((item) => item._id === userId && item.organizationId === organizationId && item.deletedAt === null);
    return user === undefined ? null : { ...user };
  }

  public async findOrganization(organizationId: string): Promise<OrganizationRecord | null> {
    return this.fixture.organizations.find((item) => item._id === organizationId && item.deletedAt === null) ?? null;
  }

  public async listActiveRoles(userId: string, organizationId: string): Promise<readonly RoleAssignmentRecord[]> {
    return this.fixture.roles.filter((item) => item.userId === userId && item.organizationId === organizationId && item.status === 'active' && item.deletedAt === null);
  }

  public async findActiveTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<TeacherClassGrantRecord | null> {
    return this.fixture.teacherGrants.find((item) => item.organizationId === organizationId && item.teacherId === teacherId && item.classId === classId && item.status === 'active' && item.deletedAt === null) ?? null;
  }

  public async findActiveParentLink(organizationId: string, parentId: string, studentId: string): Promise<ParentStudentLinkRecord | null> {
    return this.fixture.parentLinks.find((item) => item.organizationId === organizationId && item.parentId === parentId && item.studentId === studentId && item.status === 'active' && item.deletedAt === null) ?? null;
  }

  public async listActiveParentLinks(organizationId: string, parentId: string): Promise<readonly ParentStudentLinkRecord[]> {
    return this.fixture.parentLinks.filter((item) => (
      item.organizationId === organizationId
      && item.parentId === parentId
      && item.status === 'active'
      && item.deletedAt === null
    ));
  }
}

export class InMemoryBusinessSessionRepository implements BusinessSessionRepository {
  private readonly sessions = new Map<string, BusinessSessionRecord>();

  public async startOrResume(candidate: BusinessSessionRecord, nowIso: string): Promise<BusinessSessionRecord> {
    const matching = [...this.sessions.values()].filter((session) =>
      session.userId === candidate.userId
      && session.organizationId === candidate.organizationId
      && session.subjectDigest === candidate.subjectDigest
      && sessionAudience(session) === sessionAudience(candidate)
      && session.authzVersion === candidate.authzVersion
      && session.revokedAt === null
      && session.expiresAt > nowIso,
    );
    const active = matching[0];
    if (active !== undefined) {
      for (const duplicate of matching.slice(1)) {
        this.sessions.set(duplicate.id, { ...duplicate, revokedAt: nowIso, recordVersion: duplicate.recordVersion + 1 });
      }
      return { ...active };
    }
    for (const session of this.sessions.values()) {
      if (session.userId === candidate.userId
        && session.organizationId === candidate.organizationId
        && session.subjectDigest === candidate.subjectDigest
        && sessionAudience(session) === sessionAudience(candidate)
        && session.revokedAt === null) {
        this.sessions.set(session.id, { ...session, revokedAt: nowIso, recordVersion: session.recordVersion + 1 });
      }
    }
    this.sessions.set(candidate.id, { ...candidate });
    return { ...candidate };
  }
  public async find(sessionId: string): Promise<BusinessSessionRecord | null> {
    const session = this.sessions.get(sessionId);
    return session === undefined ? null : { ...session };
  }
  public async replace(session: BusinessSessionRecord, expectedRecordVersion: number): Promise<boolean> {
    const current = this.sessions.get(session.id);
    if (current === undefined || current.recordVersion !== expectedRecordVersion) return false;
    if (session.recordVersion !== expectedRecordVersion + 1) return false;
    this.sessions.set(session.id, { ...session });
    return true;
  }
}

function sessionAudience(session: BusinessSessionRecord): 'mini-program' | 'admin-console' {
  return session.audience ?? 'mini-program';
}

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly records = new Map<string, IdempotencyRecord>();

  public async find(recordId: string): Promise<IdempotencyRecord | null> { return this.records.get(recordId) ?? null; }
  public async create(record: IdempotencyRecord): Promise<boolean> {
    if (this.records.has(record.id)) return false;
    this.records.set(record.id, record);
    return true;
  }
  public async replace(record: IdempotencyRecord): Promise<void> { this.records.set(record.id, record); }
}

export class InMemoryOperationLogRepository implements OperationLogRepository {
  public readonly entries: OperationLogRecord[] = [];
  public async append(entry: OperationLogRecord): Promise<void> { this.entries.push(entry); }
}

export class FixedFunctionRuntime {
  public constructor(
    public readonly functionName: FunctionName,
    private readonly subject: string,
    private readonly authenticated: boolean,
    private readonly sessionId: string | null,
  ) {}

  public async getPlatformSubject(): Promise<Readonly<{ subject: string; loginType: 'WECHAT' | 'USERNAME' | 'UNKNOWN'; isAuthenticated: boolean }>> {
    return { subject: this.subject, loginType: 'USERNAME', isAuthenticated: this.authenticated };
  }
  public async getBusinessSessionId(_context: CloudCallContext): Promise<string | null> { return this.sessionId; }
}
