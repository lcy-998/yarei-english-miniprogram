import { createHash } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import type { TeacherStudentImportCommandPlanRow } from './bulk-csv';
import type { BulkImportAccountReceipt, BulkImportRowOutcome,
  TeacherStudentBulkImportPort } from './bulk-import-command';

export const TEACHER_STUDENT_IMPORT_COLLECTIONS = {
  users: 'users', identities: 'auth_identities', roles: 'role_assignments',
  memberships: 'class_memberships', classes: 'classes', grants: 'teacher_class_grants',
  operations: 'teacher_student_import_operations', rows: 'teacher_student_import_rows',
  commits: 'teacher_student_import_commits', audit: 'operation_logs',
  studentNumbers: 'student_number_reservations',
} as const;

/** Auth account management runs only behind a protected server capability. */
export interface TeacherStudentAuthProvisioningPort {
  mobileExists(mobile: string, rowOperationId: string): Promise<boolean>;
  createExternalStudent(row: TeacherStudentImportCommandPlanRow,
    rowOperationId: string): Promise<BulkImportAccountReceipt>;
  blockUnlinkedAccount(account: BulkImportAccountReceipt, rowOperationId: string): Promise<void>;
}

export class DocumentTeacherStudentBulkImportPort implements TeacherStudentBulkImportPort {
  public constructor(private readonly database: DocumentDatabasePort,
    private readonly auth: TeacherStudentAuthProvisioningPort,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async authorizedClassIds(actor: TrustedActorContext): Promise<readonly string[]> {
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('student.import')) return [];
    const teacher = await this.database.get(TEACHER_STUDENT_IMPORT_COLLECTIONS.users, actor.actorUserId);
    if (!visible(teacher, actor.organizationId) || teacher.status !== 'active'
      || teacher.authorizationVersion !== actor.authzVersion) return [];
    const grants = await this.database.find(TEACHER_STUDENT_IMPORT_COLLECTIONS.grants, {
      organizationId: actor.organizationId, teacherId: actor.actorUserId,
      status: 'active', deletedAt: null });
    return grants.filter(grant => typeof grant.classId === 'string'
      && actor.scopeIds.includes(grant.classId)
      && Array.isArray(grant.permissions) && grant.permissions.includes('student.import'))
      .map(grant => grant.classId as string);
  }

  public async existingStudentNumbers(organizationId: string): Promise<readonly string[]> {
    const users = await this.database.find(TEACHER_STUDENT_IMPORT_COLLECTIONS.users,
      { organizationId, deletedAt: null });
    return users.filter(user => typeof user.studentNumber === 'string')
      .map(user => String(user.studentNumber));
  }

  public mobileExists(mobile: string, rowOperationId: string): Promise<boolean> {
    return this.auth.mobileExists(mobile, rowOperationId);
  }

  public async findOperation(organizationId: string, teacherId: string,
    operationId: string): Promise<Readonly<{ fileDigest: string; totalRowCount: number;
      outcomes: readonly BulkImportRowOutcome[] }> | null> {
    const row = await this.database.get(TEACHER_STUDENT_IMPORT_COLLECTIONS.operations,
      documentId('batch', [organizationId, teacherId, operationId]));
    if (!visible(row, organizationId) || row.teacherId !== teacherId
      || row.operationId !== operationId || typeof row.fileDigest !== 'string'
      || !Number.isSafeInteger(row.totalRowCount) || !Array.isArray(row.outcomes)) return null;
    const outcomes = row.outcomes.map(projectOutcome);
    return outcomes.every(item => item !== null) ? { fileDigest: row.fileDigest,
      totalRowCount: Number(row.totalRowCount), outcomes: outcomes as BulkImportRowOutcome[] } : null;
  }

  public async findRowOutcome(organizationId: string, teacherId: string, operationId: string,
    lineNumber: number): Promise<BulkImportRowOutcome | null> {
    const row = await this.database.get(TEACHER_STUDENT_IMPORT_COLLECTIONS.rows,
      documentId('row', [organizationId, teacherId, operationId, lineNumber]));
    return visible(row, organizationId) && row.teacherId === teacherId
      ? projectOutcome(row.outcome) : null;
  }

  public createAuthAccount(row: TeacherStudentImportCommandPlanRow,
    rowOperationId: string): Promise<BulkImportAccountReceipt> {
    return this.auth.createExternalStudent(row, rowOperationId);
  }

  public async commitStudent(input: Readonly<{ actor: TrustedActorContext;
    row: TeacherStudentImportCommandPlanRow; account: BulkImportAccountReceipt;
    rowOperationId: string; sourceFileDigest: string }>): Promise<string> {
    const { actor, row, account, rowOperationId, sourceFileDigest } = input;
    if (!/^sd1_[A-Za-z0-9_-]+$/.test(account.subjectDigest)
      || !/^[a-f0-9]{64}$/.test(sourceFileDigest)) throw new Error('INVALID_IMPORT_IDENTITY');
    return this.database.runTransaction(async transaction => {
      const [teacher, classRecord, grants] = await Promise.all([
        transaction.get(TEACHER_STUDENT_IMPORT_COLLECTIONS.users, actor.actorUserId),
        transaction.get(TEACHER_STUDENT_IMPORT_COLLECTIONS.classes, row.classId),
        transaction.find(TEACHER_STUDENT_IMPORT_COLLECTIONS.grants, {
          organizationId: actor.organizationId, teacherId: actor.actorUserId,
          classId: row.classId, status: 'active', deletedAt: null }),
      ]);
      if (!visible(teacher, actor.organizationId) || teacher.status !== 'active'
        || teacher.authorizationVersion !== actor.authzVersion
        || !visible(classRecord, actor.organizationId) || classRecord.status !== 'active'
        || !actor.scopeIds.includes(row.classId)
        || !grants.some(grant => Array.isArray(grant.permissions)
          && grant.permissions.includes('student.import'))) throw new Error('IMPORT_FORBIDDEN');
      const commitId = documentId('commit', [actor.organizationId, rowOperationId]);
      const previous = await transaction.get(TEACHER_STUDENT_IMPORT_COLLECTIONS.commits, commitId);
      if (visible(previous, actor.organizationId) && previous.sourceFileDigest === sourceFileDigest
        && typeof previous.studentId === 'string') return previous.studentId;
      const studentNumber = row.studentNumber.toUpperCase();
      const duplicate = await transaction.find(TEACHER_STUDENT_IMPORT_COLLECTIONS.users,
        { organizationId: actor.organizationId, studentNumber, deletedAt: null });
      const identities = await transaction.find(TEACHER_STUDENT_IMPORT_COLLECTIONS.identities,
        { provider: 'cloudbase_uid', providerSubjectDigest: account.subjectDigest, deletedAt: null });
      if (duplicate.length > 0 || identities.length > 0) throw new Error('IMPORT_DUPLICATE');
      const now = this.clock.nowIso();
      const studentId = documentId('usr_import', [actor.organizationId, rowOperationId]);
      const base = { organizationId: actor.organizationId, schemaVersion: 1 as const,
        version: 1, deletedAt: null };
      const user: VersionedDocument = { _id: studentId, ...base, authorizationVersion: 1,
        displayName: row.displayName, displayNameMasked: maskName(row.displayName),
        studentNumber, status: 'active' };
      const identity: VersionedDocument = { _id: documentId('auth_import', [actor.organizationId, rowOperationId]),
        ...base, userId: studentId, provider: 'cloudbase_uid',
        providerSubjectDigest: account.subjectDigest, status: 'active', verifiedAt: now };
      const role: VersionedDocument = { _id: documentId('role_import', [actor.organizationId, rowOperationId]),
        ...base, userId: studentId, role: 'student', status: 'active',
        permissions: ['content.read', 'task.read'], scopeType: 'self', scopeIds: [studentId],
        grantedBy: actor.actorUserId, grantedAt: now };
      const membership: VersionedDocument = { _id: documentId('mem_import', [actor.organizationId, rowOperationId]),
        ...base, classId: row.classId, studentId, status: 'active', joinedAt: now };
      const reservation: VersionedDocument = { _id: documentId('student_number', [actor.organizationId, studentNumber]),
        ...base, studentNumber, studentId, createdAt: now };
      const marker: VersionedDocument = { _id: commitId, ...base, studentId,
        sourceFileDigest, rowOperationId, sourceLineNumber: row.sourceLineNumber,
        classId: row.classId, createdAt: now };
      for (const [collection, document] of [
        [TEACHER_STUDENT_IMPORT_COLLECTIONS.users, user],
        [TEACHER_STUDENT_IMPORT_COLLECTIONS.identities, identity],
        [TEACHER_STUDENT_IMPORT_COLLECTIONS.roles, role],
        [TEACHER_STUDENT_IMPORT_COLLECTIONS.memberships, membership],
        [TEACHER_STUDENT_IMPORT_COLLECTIONS.studentNumbers, reservation],
        [TEACHER_STUDENT_IMPORT_COLLECTIONS.commits, marker],
      ] as const) if (!await transaction.create(collection, document)) throw new Error('IMPORT_CONFLICT');
      if (!await transaction.replace(TEACHER_STUDENT_IMPORT_COLLECTIONS.classes,
        row.classId, classRecord.version, { ...classRecord, version: classRecord.version + 1 })) {
        throw new Error('IMPORT_CLASS_VERSION_CONFLICT');
      }
      const audit: VersionedDocument = { _id: documentId('student_import_audit', [actor.organizationId, rowOperationId]),
        ...base, requestId: actor.requestId, actorUserId: actor.actorUserId,
        actorRole: actor.actorRole, action: 'student.imported', targetType: 'user',
        targetId: studentId, result: 'succeeded', errorCode: null, occurredAt: now,
        metadata: { operationId: rowOperationId, classId: row.classId,
          sourceFileDigest, sourceLineNumber: row.sourceLineNumber } };
      if (!await transaction.append(TEACHER_STUDENT_IMPORT_COLLECTIONS.audit, audit)) {
        throw new Error('IMPORT_AUDIT_FAILED');
      }
      return studentId;
    });
  }

  public async findCommittedStudent(organizationId: string, rowOperationId: string): Promise<string | null> {
    const row = await this.database.get(TEACHER_STUDENT_IMPORT_COLLECTIONS.commits,
      documentId('commit', [organizationId, rowOperationId]));
    return visible(row, organizationId) && typeof row.studentId === 'string' ? row.studentId : null;
  }

  public blockUnlinkedAccount(account: BulkImportAccountReceipt, rowOperationId: string): Promise<void> {
    return this.auth.blockUnlinkedAccount(account, rowOperationId);
  }

  public async saveRowOutcome(organizationId: string, teacherId: string, operationId: string,
    outcome: BulkImportRowOutcome): Promise<void> {
    const id = documentId('row', [organizationId, teacherId, operationId, outcome.lineNumber]);
    const existing = await this.database.get(TEACHER_STUDENT_IMPORT_COLLECTIONS.rows, id);
    if (visible(existing, organizationId)) {
      if (existing.teacherId !== teacherId
        || JSON.stringify(existing.outcome) !== JSON.stringify(outcome)) throw new Error('IMPORT_ROW_CONFLICT');
      return;
    }
    const created = await this.database.runTransaction(tx => tx.create(TEACHER_STUDENT_IMPORT_COLLECTIONS.rows,
      { _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null,
        teacherId, operationId, outcome: JSON.parse(JSON.stringify(outcome)) }));
    if (!created) throw new Error('IMPORT_ROW_CONFLICT');
  }

  public async saveOperation(organizationId: string, teacherId: string,
    operationId: string, fileDigest: string, totalRowCount: number,
    outcomes: readonly BulkImportRowOutcome[]): Promise<void> {
    const id = documentId('batch', [organizationId, teacherId, operationId]);
    const existing = await this.findOperation(organizationId, teacherId, operationId);
    if (existing !== null) {
      if (existing.fileDigest !== fileDigest) throw new Error('IMPORT_BATCH_CONFLICT');
      return;
    }
    const created = await this.database.runTransaction(tx => tx.create(TEACHER_STUDENT_IMPORT_COLLECTIONS.operations,
      { _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null,
        teacherId, operationId, fileDigest, totalRowCount,
        outcomes: JSON.parse(JSON.stringify(outcomes)) }));
    if (!created) throw new Error('IMPORT_BATCH_CONFLICT');
  }

  public async appendAudit(entry: Readonly<{ organizationId: string; teacherId: string;
    operationId: string; fileDigest: string; createdCount: number; rejectedCount: number;
    failedCount: number }>): Promise<void> {
    const id = documentId('batch_audit', [entry.organizationId, entry.teacherId, entry.operationId]);
    const existing = await this.database.get(TEACHER_STUDENT_IMPORT_COLLECTIONS.audit, id);
    if (visible(existing, entry.organizationId)) return;
    const created = await this.database.runTransaction(tx => tx.append(TEACHER_STUDENT_IMPORT_COLLECTIONS.audit,
      { _id: id, organizationId: entry.organizationId, schemaVersion: 1, version: 1,
        deletedAt: null, requestId: entry.operationId, actorUserId: entry.teacherId,
        actorRole: 'teacher', action: 'student.import.batch', targetType: 'teacher_student_import',
        targetId: entry.operationId, result: 'succeeded', errorCode: null,
        occurredAt: this.clock.nowIso(), metadata: { fileDigest: entry.fileDigest,
          createdCount: entry.createdCount, rejectedCount: entry.rejectedCount,
          failedCount: entry.failedCount } }));
    if (!created) throw new Error('IMPORT_AUDIT_CONFLICT');
  }
}

function documentId(prefix: string, parts: readonly (string | number)[]): string {
  return `${prefix}_${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40)}`;
}

function visible(row: VersionedDocument | null, organizationId: string): row is VersionedDocument {
  return row !== null && row.organizationId === organizationId && row.deletedAt === null;
}

function projectOutcome(value: unknown): BulkImportRowOutcome | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.lineNumber) || Number(row.lineNumber) < 2) return null;
  if (row.status === 'created' && typeof row.studentId === 'string'
    && typeof row.classId === 'string') return { lineNumber: Number(row.lineNumber),
    status: 'created', studentId: row.studentId, classId: row.classId };
  if ((row.status === 'rejected' || row.status === 'failed') && typeof row.code === 'string') {
    return { lineNumber: Number(row.lineNumber), status: row.status, code: row.code };
  }
  return null;
}

function maskName(name: string): string {
  return name.length <= 1 ? name : `${name[0]}${'*'.repeat(Math.min(2, name.length - 1))}`;
}
