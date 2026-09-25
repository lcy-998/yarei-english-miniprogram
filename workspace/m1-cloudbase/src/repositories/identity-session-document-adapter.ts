import type { ActorRole } from '../auth/trusted-actor';
import type {
  AuthIdentityRecord,
  BusinessSessionRecord,
  OrganizationRecord,
  ParentStudentLinkRecord,
  RoleAssignmentRecord,
  TeacherClassGrantRecord,
  UserRecord,
} from '../runtime/records';
import type { BusinessSessionRepository, IdentityRepository } from '../runtime/ports';
import type { JsonObject, JsonValue } from '../shared/protocol';
import type {
  DocumentDatabasePort,
  DocumentDatabaseTransactionPort,
  VersionedDocument,
} from './document-database-port';

export const IDENTITY_SESSION_COLLECTIONS = {
  organizations: 'organizations',
  users: 'users',
  identities: 'auth_identities',
  roles: 'role_assignments',
  teacherGrants: 'teacher_class_grants',
  parentLinks: 'parent_student_links',
  sessions: 'business_sessions',
  sessionSlots: 'business_session_slots',
} as const;

export function createIdentityDocumentRepository(database: DocumentDatabasePort): IdentityDocumentRepository {
  return new IdentityDocumentRepository(database);
}

export function createBusinessSessionDocumentRepository(database: DocumentDatabasePort): BusinessSessionRepository {
  return new BusinessSessionDocumentRepository(database);
}

export interface ProfileDisplayNameMutation {
  updateDisplayName(
    userId: string,
    organizationId: string,
    expectedProfileVersion: number,
    displayName: string,
  ): Promise<Readonly<{ kind: 'updated'; user: UserRecord }> | Readonly<{ kind: 'conflict' | 'not_found' }>>;
}

export class IdentityDocumentRepository implements IdentityRepository, ProfileDisplayNameMutation {
  public constructor(private readonly database: DocumentDatabasePort) {}

  public async findIdentityByDigest(digest: string): Promise<AuthIdentityRecord | null> {
    const rows = await this.database.find(IDENTITY_SESSION_COLLECTIONS.identities, {
      provider: 'cloudbase_uid',
      providerSubjectDigest: digest,
      status: 'active',
      deletedAt: null,
    });
    const decoded = rows.map(decodeIdentity).filter((item): item is AuthIdentityRecord => item !== null);
    return decoded.length === 1 ? decoded[0] : null;
  }

  public async findUser(userId: string, organizationId: string): Promise<UserRecord | null> {
    return decodeScoped(
      await this.database.get(IDENTITY_SESSION_COLLECTIONS.users, userId),
      organizationId,
      decodeUser,
    );
  }

  public async findOrganization(organizationId: string): Promise<OrganizationRecord | null> {
    return decodeScoped(
      await this.database.get(IDENTITY_SESSION_COLLECTIONS.organizations, organizationId),
      organizationId,
      decodeOrganization,
    );
  }

  public async listActiveRoles(userId: string, organizationId: string): Promise<readonly RoleAssignmentRecord[]> {
    const rows = await this.database.find(IDENTITY_SESSION_COLLECTIONS.roles, {
      organizationId,
      userId,
      status: 'active',
      deletedAt: null,
    });
    return rows.map(decodeRole).filter((item): item is RoleAssignmentRecord => item !== null);
  }

  public async findActiveTeacherGrant(
    organizationId: string,
    teacherId: string,
    classId: string,
  ): Promise<TeacherClassGrantRecord | null> {
    const rows = await this.database.find(IDENTITY_SESSION_COLLECTIONS.teacherGrants, {
      organizationId,
      teacherId,
      classId,
      status: 'active',
      deletedAt: null,
    });
    const decoded = rows.map(decodeTeacherGrant).filter((item): item is TeacherClassGrantRecord => item !== null);
    return decoded.length === 1 ? decoded[0] : null;
  }

  public async findActiveParentLink(
    organizationId: string,
    parentId: string,
    studentId: string,
  ): Promise<ParentStudentLinkRecord | null> {
    const rows = await this.database.find(IDENTITY_SESSION_COLLECTIONS.parentLinks, {
      organizationId,
      parentId,
      studentId,
      status: 'active',
      deletedAt: null,
    });
    const decoded = rows.map(decodeParentLink).filter((item): item is ParentStudentLinkRecord => item !== null);
    return decoded.length === 1 ? decoded[0] : null;
  }

  public async listActiveParentLinks(
    organizationId: string,
    parentId: string,
  ): Promise<readonly ParentStudentLinkRecord[]> {
    const rows = await this.database.find(IDENTITY_SESSION_COLLECTIONS.parentLinks, {
      organizationId,
      parentId,
      status: 'active',
      deletedAt: null,
    });
    return rows.map(decodeParentLink).filter((item): item is ParentStudentLinkRecord => item !== null);
  }

  public async updateDisplayName(
    userId: string,
    organizationId: string,
    expectedProfileVersion: number,
    displayName: string,
  ): Promise<Readonly<{ kind: 'updated'; user: UserRecord }> | Readonly<{ kind: 'conflict' | 'not_found' }>> {
    return this.database.runTransaction(async (transaction) => {
      const current = await transaction.get(IDENTITY_SESSION_COLLECTIONS.users, userId);
      const user = current === null ? null : decodeScoped(current, organizationId, decodeUser);
      if (current === null || user === null || user.status !== 'active') return { kind: 'not_found' as const };
      const profileVersion = user.profileVersion ?? 1;
      if (profileVersion !== expectedProfileVersion) return { kind: 'conflict' as const };
      const next: VersionedDocument = {
        ...current,
        displayName,
        displayNameMasked: displayName,
        profileVersion: profileVersion + 1,
        version: current.version + 1,
      };
      if (!await transaction.replace(IDENTITY_SESSION_COLLECTIONS.users, userId, current.version, next)) {
        return { kind: 'conflict' as const };
      }
      const updated = decodeUser(next);
      return updated === null ? { kind: 'conflict' as const } : { kind: 'updated' as const, user: updated };
    });
  }
}

interface SessionSlot {
  readonly activeSessionId: string;
  readonly userId: string;
  readonly subjectDigest: string;
  readonly authzVersion: number;
  readonly audience: 'mini-program' | 'admin-console';
}

class BusinessSessionDocumentRepository implements BusinessSessionRepository {
  public constructor(private readonly database: DocumentDatabasePort) {}

  public async startOrResume(candidate: BusinessSessionRecord, nowIso: string): Promise<BusinessSessionRecord> {
    requireNewSessionCandidate(candidate, nowIso);
    const prepared = await this.database.find(IDENTITY_SESSION_COLLECTIONS.sessions, {
      organizationId: candidate.organizationId,
      userId: candidate.userId,
      subjectDigest: candidate.subjectDigest,
      deletedAt: null,
    });
    const preparedIds = prepared.map((document) => document._id);
    const preparedResumable = prepared
      .map((document) => decodeSession(document))
      .find((session): session is BusinessSessionRecord => session !== null
        && samePrincipal(session, candidate)
        && isResumable(session, candidate.authzVersion, nowIso));
    if (preparedResumable !== undefined) return preparedResumable;
    const slotId = sessionSlotDocumentId(
      candidate.organizationId,
      candidate.userId,
      candidate.subjectDigest,
      sessionAudience(candidate),
    );

    return this.database.runTransaction(async (transaction) => {
      const slotDocument = await transaction.get(IDENTITY_SESSION_COLLECTIONS.sessionSlots, slotId);
      const slot = decodeSessionSlot(slotDocument, candidate);
      const sessionIds = unique([
        ...(slot === null ? [] : [slot.activeSessionId]),
        ...preparedIds,
      ]);
      // CloudBase document transactions reject overlapping reads as busy. Keep
      // session history lookup ordered so stale admin sessions can be resumed
      // or replaced without being misreported as a CAS conflict.
      const currentSessions: BusinessSessionRecord[] = [];
      for (const sessionId of sessionIds) {
        const session = decodeSession(await transaction.get(IDENTITY_SESSION_COLLECTIONS.sessions, sessionId));
        if (session !== null && samePrincipal(session, candidate)) currentSessions.push(session);
      }
      const preferred = slot === null
        ? null
        : currentSessions.find((session) => session.id === slot.activeSessionId) ?? null;
      const resumable = [preferred, ...currentSessions]
        .filter((session): session is BusinessSessionRecord => session !== null)
        .find((session) => isResumable(session, candidate.authzVersion, nowIso)) ?? null;
      const staleSlot = slotDocument !== null && (slot === null || preferred === null
        || !isResumable(preferred, candidate.authzVersion, nowIso));

      if (resumable !== null) {
        if (slot !== null && slot.activeSessionId === resumable.id && slot.authzVersion === resumable.authzVersion) {
          return resumable;
        }
        await saveSlot(transaction, slotId, slotDocument, candidate, resumable.id, resumable.authzVersion);
        return resumable;
      }

      const created = await transaction.create(
        IDENTITY_SESSION_COLLECTIONS.sessions,
        sessionDocument(candidate),
      );
      if (!created) throw new Error('Business session id collision.');
      // A legacy or expired slot can be impossible to CAS-update on some
      // CloudBase transaction histories. The new session remains the single
      // resumable record and is found before slot resolution on the next
      // bootstrap. Do not let that obsolete pointer block a fresh login.
      if (!staleSlot) {
        await saveSlot(transaction, slotId, slotDocument, candidate, candidate.id, candidate.authzVersion);
      }
      return cloneSession(candidate);
    });
  }

  public async find(sessionId: string): Promise<BusinessSessionRecord | null> {
    return decodeSession(await this.database.get(IDENTITY_SESSION_COLLECTIONS.sessions, sessionId));
  }

  public async replace(session: BusinessSessionRecord, expectedRecordVersion: number): Promise<boolean> {
    if (session.recordVersion !== expectedRecordVersion + 1) return false;
    return this.database.runTransaction(async (transaction) => {
      const currentDocument = await transaction.get(IDENTITY_SESSION_COLLECTIONS.sessions, session.id);
      const current = decodeSession(currentDocument);
      if (currentDocument === null || current === null || current.recordVersion !== expectedRecordVersion) return false;
      if (!canReplaceSession(current, session)) return false;
      return transaction.replace(
        IDENTITY_SESSION_COLLECTIONS.sessions,
        session.id,
        currentDocument.version,
        sessionDocument(session),
      );
    });
  }
}

async function saveSlot(
  transaction: DocumentDatabaseTransactionPort,
  slotId: string,
  current: VersionedDocument | null,
  principal: BusinessSessionRecord,
  activeSessionId: string,
  authzVersion: number,
): Promise<void> {
  const slot: SessionSlot = {
    activeSessionId,
    userId: principal.userId,
    subjectDigest: principal.subjectDigest,
    authzVersion,
    audience: sessionAudience(principal),
  };
  if (current === null) {
    if (!(await transaction.create(
      IDENTITY_SESSION_COLLECTIONS.sessionSlots,
      createDocument(slotId, principal.organizationId, 1, slot),
    ))) throw new Error('Business session slot changed concurrently.');
    return;
  }
  if (!(await transaction.replace(
    IDENTITY_SESSION_COLLECTIONS.sessionSlots,
    slotId,
    current.version,
    createDocument(slotId, principal.organizationId, current.version + 1, slot),
  ))) throw new Error('Business session slot changed concurrently.');
}

function sessionDocument(session: BusinessSessionRecord): VersionedDocument {
  return createDocument(session.id, session.organizationId, session.recordVersion, session);
}

function decodeSession(document: VersionedDocument | null): BusinessSessionRecord | null {
  if (document === null || document.deletedAt !== null) return null;
  const id = readString(document, 'id');
  const userId = readString(document, 'userId');
  const subjectDigest = readString(document, 'subjectDigest');
  const role = document.role;
  const authzVersion = readInteger(document, 'authzVersion', 0);
  const recordVersion = readInteger(document, 'recordVersion', 1);
  const expiresAt = readString(document, 'expiresAt');
  const revokedAt = document.revokedAt;
  const storedAudience = document.audience;
  const audience = storedAudience === undefined ? 'mini-program' : storedAudience;
  if (id === null || id !== document._id || userId === null || subjectDigest === null
    || !isActorRoleOrNull(role) || authzVersion === null || recordVersion === null
    || recordVersion !== document.version || expiresAt === null || !isIso(expiresAt)
    || (audience !== 'mini-program' && audience !== 'admin-console')
    || (revokedAt !== null && typeof revokedAt !== 'string')) return null;
  return {
    id,
    organizationId: document.organizationId,
    userId,
    subjectDigest,
    ...(storedAudience === undefined ? {} : { audience }),
    role,
    authzVersion,
    recordVersion,
    expiresAt,
    revokedAt,
  };
}

function decodeSessionSlot(
  document: VersionedDocument | null,
  principal: BusinessSessionRecord,
): SessionSlot | null {
  if (document === null || document.deletedAt !== null || document.organizationId !== principal.organizationId) return null;
  const activeSessionId = readString(document, 'activeSessionId');
  const userId = readString(document, 'userId');
  const subjectDigest = readString(document, 'subjectDigest');
  const authzVersion = readInteger(document, 'authzVersion', 0);
  const audience = document.audience === undefined ? 'mini-program' : document.audience;
  if (activeSessionId === null || userId !== principal.userId || subjectDigest !== principal.subjectDigest
    || authzVersion === null || audience !== sessionAudience(principal)) return null;
  return { activeSessionId, userId, subjectDigest, authzVersion, audience };
}

function decodeIdentity(document: VersionedDocument): AuthIdentityRecord | null {
  if (!hasBase(document) || document.provider !== 'cloudbase_uid'
    || (document.status !== 'active' && document.status !== 'revoked')) return null;
  const userId = readString(document, 'userId');
  const providerSubjectDigest = readString(document, 'providerSubjectDigest');
  if (userId === null || providerSubjectDigest === null) return null;
  return { ...baseRecord(document), userId, provider: 'cloudbase_uid', providerSubjectDigest, status: document.status };
}

function decodeUser(document: VersionedDocument): UserRecord | null {
  if (!hasBase(document) || (document.status !== 'active' && document.status !== 'disabled')) return null;
  const authorizationVersion = readInteger(document, 'authorizationVersion', 1);
  const profileVersion = document.profileVersion === undefined ? 1 : readInteger(document, 'profileVersion', 1);
  const displayName = readString(document, 'displayName');
  const displayNameMasked = readString(document, 'displayNameMasked');
  if (authorizationVersion === null || profileVersion === null || displayName === null || displayNameMasked === null) return null;
  const studentNumber = readOptionalString(document, 'studentNumber');
  const classId = readOptionalString(document, 'classId');
  const className = readOptionalString(document, 'className');
  if (studentNumber === false || classId === false || className === false) return null;
  return {
    ...baseRecord(document),
    authorizationVersion,
    profileVersion,
    displayName,
    displayNameMasked,
    status: document.status,
    ...(studentNumber === undefined ? {} : { studentNumber }),
    ...(classId === undefined ? {} : { classId }),
    ...(className === undefined ? {} : { className }),
  };
}

function decodeOrganization(document: VersionedDocument): OrganizationRecord | null {
  if (!hasBase(document) || (document.status !== 'active' && document.status !== 'disabled')) return null;
  const name = readString(document, 'name');
  const timeZone = readString(document, 'timeZone');
  if (name === null || timeZone === null) return null;
  return { ...baseRecord(document), name, timeZone, status: document.status };
}

function decodeRole(document: VersionedDocument): RoleAssignmentRecord | null {
  if (!hasBase(document) || (document.status !== 'active' && document.status !== 'revoked')) return null;
  const userId = readString(document, 'userId');
  const role = document.role;
  const permissions = readStringArray(document, 'permissions');
  const scopeIds = readStringArray(document, 'scopeIds');
  if (userId === null || !isActorRole(role) || permissions === null || scopeIds === null) return null;
  return { ...baseRecord(document), userId, role, permissions, scopeIds, status: document.status };
}

function decodeTeacherGrant(document: VersionedDocument): TeacherClassGrantRecord | null {
  if (!hasBase(document) || (document.status !== 'active' && document.status !== 'revoked')) return null;
  const teacherId = readString(document, 'teacherId');
  const classId = readString(document, 'classId');
  const permissions = readStringArray(document, 'permissions');
  if (teacherId === null || classId === null || permissions === null) return null;
  return { ...baseRecord(document), teacherId, classId, permissions, status: document.status };
}

function decodeParentLink(document: VersionedDocument): ParentStudentLinkRecord | null {
  if (!hasBase(document) || (document.status !== 'active' && document.status !== 'revoked')) return null;
  const parentId = readString(document, 'parentId');
  const studentId = readString(document, 'studentId');
  const confirmedAt = readOptionalString(document, 'confirmedAt');
  if (parentId === null || studentId === null || confirmedAt === false) return null;
  return {
    ...baseRecord(document),
    parentId,
    studentId,
    status: document.status,
    ...(confirmedAt === undefined ? {} : { confirmedAt }),
  };
}

function decodeScoped<T>(
  document: VersionedDocument | null,
  organizationId: string,
  decode: (value: VersionedDocument) => T | null,
): T | null {
  return document === null || document.organizationId !== organizationId || document.deletedAt !== null
    ? null
    : decode(document);
}

function hasBase(document: VersionedDocument): boolean {
  return document.deletedAt === null && document._id.length > 0 && document.organizationId.length > 0;
}

function baseRecord(document: VersionedDocument) {
  return {
    _id: document._id,
    organizationId: document.organizationId,
    version: document.version,
    deletedAt: document.deletedAt,
  };
}

function createDocument(
  documentId: string,
  organizationId: string,
  version: number,
  record: unknown,
): VersionedDocument {
  const encoded = toJsonObject(record);
  return {
    ...encoded,
    _id: documentId,
    organizationId,
    schemaVersion: 1,
    version,
    deletedAt: null,
  };
}

function toJsonObject(value: unknown): JsonObject {
  const encoded = toJsonValue(value);
  if (!isJsonObject(encoded)) {
    throw new Error('Document record must be an object.');
  }
  return encoded;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Document number must be finite.');
    return value;
  }
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) result[key] = toJsonValue(item);
    }
    return result;
  }
  throw new Error('Document record contains an unsupported value.');
}

function requireNewSessionCandidate(candidate: BusinessSessionRecord, nowIso: string): void {
  if (candidate.id.trim().length === 0 || candidate.organizationId.trim().length === 0
    || candidate.userId.trim().length === 0 || candidate.subjectDigest.trim().length === 0
    || candidate.recordVersion !== 1 || candidate.revokedAt !== null
    || !Number.isInteger(candidate.authzVersion) || candidate.authzVersion < 0
    || !isIso(nowIso) || !isAfter(candidate.expiresAt, nowIso)) {
    throw new Error('Invalid business session candidate.');
  }
}

function samePrincipal(left: BusinessSessionRecord, right: BusinessSessionRecord): boolean {
  return left.organizationId === right.organizationId
    && left.userId === right.userId
    && left.subjectDigest === right.subjectDigest
    && sessionAudience(left) === sessionAudience(right);
}

function canReplaceSession(left: BusinessSessionRecord, right: BusinessSessionRecord): boolean {
  return left.id === right.id
    && samePrincipal(left, right)
    && left.authzVersion === right.authzVersion
    && isIso(right.expiresAt)
    && Date.parse(right.expiresAt) >= Date.parse(left.expiresAt);
}

function isResumable(session: BusinessSessionRecord, authzVersion: number, nowIso: string): boolean {
  return session.revokedAt === null
    && session.authzVersion === authzVersion
    && isAfter(session.expiresAt, nowIso);
}

function cloneSession(session: BusinessSessionRecord): BusinessSessionRecord {
  return { ...session };
}

function sessionSlotDocumentId(
  organizationId: string,
  userId: string,
  subjectDigest: string,
  audience: 'mini-program' | 'admin-console',
): string {
  return `session-slot:${audience}:${encodeIdComponent(organizationId)}:${encodeIdComponent(userId)}:${encodeIdComponent(subjectDigest)}`;
}

function sessionAudience(session: BusinessSessionRecord): 'mini-program' | 'admin-console' {
  return session.audience ?? 'mini-program';
}

function encodeIdComponent(value: string): string {
  return [...value].map((character) => character.codePointAt(0)?.toString(16) ?? '').join('-');
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function readString(document: VersionedDocument, field: string): string | null {
  const value = document[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readOptionalString(document: VersionedDocument, field: string): string | undefined | false {
  const value = document[field];
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.length > 0 ? value : false;
}

function readStringArray(document: VersionedDocument, field: string): readonly string[] | null {
  const value = document[field];
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...value] : null;
}

function readInteger(document: VersionedDocument, field: string, minimum: number): number | null {
  const value = document[field];
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum ? value : null;
}

function isActorRole(value: JsonValue | undefined): value is ActorRole {
  return value === 'student' || value === 'parent' || value === 'teacher' || value === 'admin';
}

function isActorRoleOrNull(value: JsonValue | undefined): value is ActorRole | null {
  return value === null || isActorRole(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function isAfter(left: string, right: string): boolean {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime > rightTime;
}
