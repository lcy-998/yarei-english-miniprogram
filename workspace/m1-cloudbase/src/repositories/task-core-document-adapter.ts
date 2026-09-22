import type { JsonObject, JsonValue } from '../shared/protocol';
import type { IdempotencyRecord, OperationLogRecord, TeacherClassGrantRecord } from '../runtime/records';
import type {
  ClassMembershipGuardRecord,
  TaskCoreReader,
  TaskCoreTransaction,
  TaskCoreTransactionScope,
  TaskCoreUnitOfWork,
} from '../task-core/repository';
import type {
  ClassMembershipRecord,
  LearningResourceRecord,
  ReviewFeedbackRecord,
  SubmissionRecord,
  TaskAssignmentRecord,
  TaskRecord,
} from '../task-core/types';
import type {
  DocumentDatabasePort,
  DocumentDatabaseReaderPort,
  DocumentDatabaseTransactionPort,
  VersionedDocument,
} from './document-database-port';
import { TaskCorePersistenceError, toTaskCorePersistenceError } from './persistence-error';

export const TASK_CORE_COLLECTIONS = {
  classes: 'classes',
  resources: 'learning_resources',
  memberships: 'class_memberships',
  teacherGrants: 'teacher_class_grants',
  tasks: 'tasks',
  assignments: 'task_assignments',
  submissions: 'submissions',
  feedback: 'review_feedback',
  idempotency: 'idempotency_records',
  audit: 'operation_logs',
} as const;

export function createTaskCoreDocumentRepository(database: DocumentDatabasePort): TaskCoreUnitOfWork {
  return new TaskCoreDocumentRepository(database);
}

class TaskCoreDocumentRepository implements TaskCoreUnitOfWork {
  public constructor(private readonly database: DocumentDatabasePort) {}

  public async findResource(organizationId: string, resourceId: string): Promise<LearningResourceRecord | null> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).findResource(organizationId, resourceId));
  }

  public async listActiveClassMemberships(organizationId: string, classIds: readonly string[]): Promise<readonly ClassMembershipRecord[]> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).listActiveClassMemberships(organizationId, classIds));
  }

  public async listActiveStudentMemberships(organizationId: string, studentIds: readonly string[]): Promise<readonly ClassMembershipRecord[]> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).listActiveStudentMemberships(organizationId, studentIds));
  }

  public async listActiveTeacherGrants(organizationId: string, teacherId: string, classIds: readonly string[]): Promise<readonly TeacherClassGrantRecord[]> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).listActiveTeacherGrants(organizationId, teacherId, classIds));
  }

  public async findClassMembershipGuard(organizationId: string, classId: string): Promise<ClassMembershipGuardRecord | null> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).findClassMembershipGuard(organizationId, classId));
  }

  public async findTask(organizationId: string, taskId: string): Promise<TaskRecord | null> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).findTask(organizationId, taskId));
  }

  public async findAssignment(organizationId: string, taskId: string, studentId: string): Promise<TaskAssignmentRecord | null> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).findAssignment(organizationId, taskId, studentId));
  }

  public async findAssignmentById(organizationId: string, assignmentId: string): Promise<TaskAssignmentRecord | null> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).findAssignmentById(organizationId, assignmentId));
  }

  public async listTaskAssignments(organizationId: string, taskId: string): Promise<readonly TaskAssignmentRecord[]> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).listTaskAssignments(organizationId, taskId));
  }

  public async findSubmission(organizationId: string, submissionId: string): Promise<SubmissionRecord | null> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).findSubmission(organizationId, submissionId));
  }

  public async listTaskSubmissions(organizationId: string, taskId: string): Promise<readonly SubmissionRecord[]> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).listTaskSubmissions(organizationId, taskId));
  }

  public async findDraftSubmission(organizationId: string, assignmentId: string, submissionVersion: number): Promise<SubmissionRecord | null> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).findDraftSubmission(organizationId, assignmentId, submissionVersion));
  }

  public async findFeedbackBySubmission(organizationId: string, submissionId: string): Promise<ReviewFeedbackRecord | null> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).findFeedbackBySubmission(organizationId, submissionId));
  }

  public async findIdempotencyRecord(recordId: string): Promise<IdempotencyRecord | null> {
    return this.read((reader) => new TaskCoreDocumentReader(reader).findIdempotencyRecord(recordId));
  }

  public async runTransaction<T>(scope: TaskCoreTransactionScope, work: (transaction: TaskCoreTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.database.runTransaction(async (documents) => work(new TaskCoreDocumentTransaction(documents, scope)));
    } catch (error: unknown) {
      throw toTaskCorePersistenceError(error);
    }
  }

  private async read<T>(work: (reader: DocumentDatabaseReaderPort) => Promise<T>): Promise<T> {
    try {
      return await work(this.database);
    } catch (error: unknown) {
      throw toTaskCorePersistenceError(error);
    }
  }
}

class TaskCoreDocumentReader implements TaskCoreReader {
  public constructor(protected readonly documents: DocumentDatabaseReaderPort) {}

  public async findResource(organizationId: string, resourceId: string): Promise<LearningResourceRecord | null> {
    const found = await this.getScoped(TASK_CORE_COLLECTIONS.resources, resourceId, organizationId);
    return found === null ? null : decodeDocument<LearningResourceRecord>(found);
  }

  public async findIdempotencyRecord(recordId: string): Promise<IdempotencyRecord | null> {
    const found = await this.documents.get(TASK_CORE_COLLECTIONS.idempotency, recordId);
    return found === null ? null : decodeDocument<IdempotencyRecord>(found);
  }

  public async listActiveClassMemberships(organizationId: string, classIds: readonly string[]): Promise<readonly ClassMembershipRecord[]> {
    const found = await this.documents.find(TASK_CORE_COLLECTIONS.memberships, { organizationId, status: 'active', deletedAt: null });
    return found
      .filter((document) => classIds.includes(readString(document, 'classId')))
      .map(decodeMembership);
  }

  public async listActiveStudentMemberships(organizationId: string, studentIds: readonly string[]): Promise<readonly ClassMembershipRecord[]> {
    const found = await this.documents.find(TASK_CORE_COLLECTIONS.memberships, { organizationId, status: 'active', deletedAt: null });
    return found
      .filter((document) => studentIds.includes(readString(document, 'studentId')))
      .map(decodeMembership);
  }

  public async listActiveTeacherGrants(organizationId: string, teacherId: string, classIds: readonly string[]): Promise<readonly TeacherClassGrantRecord[]> {
    const found = await this.documents.find(TASK_CORE_COLLECTIONS.teacherGrants, {
      organizationId,
      teacherId,
      status: 'active',
      deletedAt: null,
    });
    return found
      .filter((document) => classIds.includes(readString(document, 'classId')))
      .map(decodeTeacherGrant);
  }

  public async findClassMembershipGuard(organizationId: string, classId: string): Promise<ClassMembershipGuardRecord | null> {
    const found = await this.getScoped(TASK_CORE_COLLECTIONS.classes, classId, organizationId);
    if (found === null || found.status !== 'active') return null;
    return { id: classId, organizationId, status: 'active', version: found.version };
  }

  public async findTask(organizationId: string, taskId: string): Promise<TaskRecord | null> {
    const found = await this.getScoped(TASK_CORE_COLLECTIONS.tasks, taskId, organizationId);
    return found === null ? null : decodeDocument<TaskRecord>(found, true);
  }

  public async findAssignment(organizationId: string, taskId: string, studentId: string): Promise<TaskAssignmentRecord | null> {
    const found = await this.getScoped(
      TASK_CORE_COLLECTIONS.assignments,
      assignmentDocumentId(organizationId, taskId, studentId),
      organizationId,
    );
    return found === null ? null : decodeDocument<TaskAssignmentRecord>(found, true);
  }

  public async findAssignmentById(organizationId: string, assignmentId: string): Promise<TaskAssignmentRecord | null> {
    const found = await this.getScoped(
      TASK_CORE_COLLECTIONS.assignments,
      assignmentByIdDocumentId(organizationId, assignmentId),
      organizationId,
    );
    return found === null ? null : decodeDocument<TaskAssignmentRecord>(found, true);
  }

  public async listTaskAssignments(organizationId: string, taskId: string): Promise<readonly TaskAssignmentRecord[]> {
    const found = await this.documents.find(TASK_CORE_COLLECTIONS.assignments, { organizationId, taskId, deletedAt: null });
    return found.map((document) => decodeDocument<TaskAssignmentRecord>(document, true));
  }

  public async findSubmission(organizationId: string, submissionId: string): Promise<SubmissionRecord | null> {
    const found = await this.getScoped(
      TASK_CORE_COLLECTIONS.submissions,
      submissionByIdDocumentId(organizationId, submissionId),
      organizationId,
    );
    return found === null ? null : decodeDocument<SubmissionRecord>(found);
  }

  public async listTaskSubmissions(organizationId: string, taskId: string): Promise<readonly SubmissionRecord[]> {
    const found = await this.documents.find(TASK_CORE_COLLECTIONS.submissions, { organizationId, taskId, deletedAt: null });
    return found.map((document) => decodeDocument<SubmissionRecord>(document));
  }

  public async findDraftSubmission(organizationId: string, assignmentId: string, submissionVersion: number): Promise<SubmissionRecord | null> {
    const submissionId = deterministicSubmissionId(assignmentId, submissionVersion);
    const found = await this.getScoped(
      TASK_CORE_COLLECTIONS.submissions,
      submissionByIdDocumentId(organizationId, submissionId),
      organizationId,
    );
    if (found === null) return null;
    const submission = decodeDocument<SubmissionRecord>(found);
    return submission.assignmentId === assignmentId && submission.submissionVersion === submissionVersion && submission.status === 'draft'
      ? submission
      : null;
  }

  public async findFeedbackBySubmission(organizationId: string, submissionId: string): Promise<ReviewFeedbackRecord | null> {
    const found = await this.getScoped(
      TASK_CORE_COLLECTIONS.feedback,
      feedbackDocumentId(organizationId, submissionId),
      organizationId,
    );
    return found === null ? null : decodeDocument<ReviewFeedbackRecord>(found);
  }

  protected async getScoped(collection: string, documentId: string, organizationId: string): Promise<VersionedDocument | null> {
    const found = await this.documents.get(collection, documentId);
    return isVisibleInOrganization(found, organizationId) ? found : null;
  }
}

class TaskCoreDocumentTransaction implements TaskCoreTransaction {
  public constructor(
    private readonly transaction: DocumentDatabaseTransactionPort,
    private readonly scope: TaskCoreTransactionScope,
  ) {
    if (scope.organizationId.length === 0) throw new TaskCorePersistenceError('INTERNAL_ERROR');
  }

  public async findResource(organizationId: string, resourceId: string): Promise<LearningResourceRecord | null> {
    if (!this.scope.resourceIds.includes(resourceId)) return null;
    const found = await this.getScoped(TASK_CORE_COLLECTIONS.resources, resourceId, organizationId);
    return found === null ? null : decodeDocument<LearningResourceRecord>(found);
  }

  public async listActiveClassMemberships(organizationId: string, classIds: readonly string[]): Promise<readonly ClassMembershipRecord[]> {
    await this.validateClassMembershipGuards(organizationId, classIds);
    return this.readPreparedMemberships(organizationId, (membership) => classIds.includes(membership.classId));
  }

  public async listActiveStudentMemberships(organizationId: string, studentIds: readonly string[]): Promise<readonly ClassMembershipRecord[]> {
    return this.readPreparedMemberships(organizationId, (membership) => studentIds.includes(membership.studentId));
  }

  public async listActiveTeacherGrants(organizationId: string, teacherId: string, classIds: readonly string[]): Promise<readonly TeacherClassGrantRecord[]> {
    const grants = await this.readPreparedGrants(organizationId);
    return grants.filter((grant) => grant.teacherId === teacherId && classIds.includes(grant.classId));
  }

  public async findClassMembershipGuard(organizationId: string, classId: string): Promise<ClassMembershipGuardRecord | null> {
    this.ensureScopeOrganization(organizationId);
    const found = await this.transaction.get(TASK_CORE_COLLECTIONS.classes, classId);
    if (!isVisibleInOrganization(found, organizationId) || found.status !== 'active') return null;
    return { id: classId, organizationId, status: 'active', version: found.version };
  }

  public async findTask(organizationId: string, taskId: string): Promise<TaskRecord | null> {
    const found = await this.getScoped(TASK_CORE_COLLECTIONS.tasks, taskId, organizationId);
    return found === null ? null : decodeDocument<TaskRecord>(found, true);
  }

  public async findAssignment(organizationId: string, taskId: string, studentId: string): Promise<TaskAssignmentRecord | null> {
    const found = await this.getScoped(
      TASK_CORE_COLLECTIONS.assignments,
      assignmentDocumentId(organizationId, taskId, studentId),
      organizationId,
    );
    return found === null ? null : decodeDocument<TaskAssignmentRecord>(found, true);
  }

  public async findAssignmentById(organizationId: string, assignmentId: string): Promise<TaskAssignmentRecord | null> {
    const found = await this.getScoped(
      TASK_CORE_COLLECTIONS.assignments,
      assignmentByIdDocumentId(organizationId, assignmentId),
      organizationId,
    );
    return found === null ? null : decodeDocument<TaskAssignmentRecord>(found, true);
  }

  public async listTaskAssignments(organizationId: string, taskId: string): Promise<readonly TaskAssignmentRecord[]> {
    this.ensureScopeOrganization(organizationId);
    const assignments: TaskAssignmentRecord[] = [];
    for (const assignmentId of this.scope.assignmentIds) {
      const documentId = assignmentByIdDocumentId(organizationId, assignmentId);
      const found = await this.transaction.get(TASK_CORE_COLLECTIONS.assignments, documentId);
      if (!isVisibleInOrganization(found, organizationId)) throw new TaskCorePersistenceError('CONFLICT');
      const assignment = decodeDocument<TaskAssignmentRecord>(found, true);
      if (assignment.taskId === taskId) assignments.push(assignment);
    }
    return assignments;
  }

  public async findSubmission(organizationId: string, submissionId: string): Promise<SubmissionRecord | null> {
    const found = await this.getScoped(
      TASK_CORE_COLLECTIONS.submissions,
      submissionByIdDocumentId(organizationId, submissionId),
      organizationId,
    );
    return found === null ? null : decodeDocument<SubmissionRecord>(found);
  }

  public async listTaskSubmissions(organizationId: string, taskId: string): Promise<readonly SubmissionRecord[]> {
    this.ensureScopeOrganization(organizationId);
    const submissions: SubmissionRecord[] = [];
    for (const submissionId of this.scope.submissionIds) {
      const documentId = submissionByIdDocumentId(organizationId, submissionId);
      const found = await this.transaction.get(TASK_CORE_COLLECTIONS.submissions, documentId);
      if (!isVisibleInOrganization(found, organizationId)) throw new TaskCorePersistenceError('CONFLICT');
      const submission = decodeDocument<SubmissionRecord>(found);
      if (submission.taskId === taskId) submissions.push(submission);
    }
    return submissions;
  }

  public async findDraftSubmission(organizationId: string, assignmentId: string, submissionVersion: number): Promise<SubmissionRecord | null> {
    const submissionId = deterministicSubmissionId(assignmentId, submissionVersion);
    const found = await this.getScoped(
      TASK_CORE_COLLECTIONS.submissions,
      submissionByIdDocumentId(organizationId, submissionId),
      organizationId,
    );
    if (found === null) return null;
    const submission = decodeDocument<SubmissionRecord>(found);
    return submission.assignmentId === assignmentId
      && submission.submissionVersion === submissionVersion
      && submission.status === 'draft'
      ? submission
      : null;
  }

  public async findFeedbackBySubmission(organizationId: string, submissionId: string): Promise<ReviewFeedbackRecord | null> {
    const found = await this.getScoped(
      TASK_CORE_COLLECTIONS.feedback,
      feedbackDocumentId(organizationId, submissionId),
      organizationId,
    );
    return found === null ? null : decodeDocument<ReviewFeedbackRecord>(found);
  }

  public async findActiveTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<TeacherClassGrantRecord | null> {
    const grants = await this.readPreparedGrants(organizationId);
    return grants.find((grant) => grant.teacherId === teacherId && grant.classId === classId) ?? null;
  }

  public async saveTask(task: TaskRecord): Promise<void> {
    await this.saveVersioned(TASK_CORE_COLLECTIONS.tasks, task.id, task.organizationId, task.version, task);
  }

  public async saveAssignment(assignment: TaskAssignmentRecord): Promise<void> {
    const documentId = assignmentByIdDocumentId(assignment.organizationId, assignment.id);
    await this.saveVersioned(TASK_CORE_COLLECTIONS.assignments, documentId, assignment.organizationId, assignment.version, assignment);
  }

  public async deleteAssignment(assignment: TaskAssignmentRecord): Promise<void> {
    const documentId = assignmentByIdDocumentId(assignment.organizationId, assignment.id);
    if (!(await this.transaction.delete(TASK_CORE_COLLECTIONS.assignments, documentId, assignment.version))) {
      throw new TaskCorePersistenceError('CONFLICT');
    }
  }

  public async saveSubmission(submission: SubmissionRecord): Promise<void> {
    if (submission.id !== deterministicSubmissionId(submission.assignmentId, submission.submissionVersion)) {
      throw new TaskCorePersistenceError('INTERNAL_ERROR');
    }
    const documentId = submissionByIdDocumentId(submission.organizationId, submission.id);
    const current = await this.transaction.get(TASK_CORE_COLLECTIONS.submissions, documentId);
    if (current === null) {
      if (submission.recordVersion !== 1) throw new TaskCorePersistenceError('CONFLICT');
      await requireCreated(this.transaction, TASK_CORE_COLLECTIONS.submissions, createDocument(
        documentId,
        submission.organizationId,
        1,
        submission,
      ));
      return;
    }
    ensureWritable(current, submission.organizationId);
    const previous = decodeDocument<SubmissionRecord>(current);
    if (submission.recordVersion < previous.recordVersion || submission.recordVersion > previous.recordVersion + 1) {
      throw new TaskCorePersistenceError('CONFLICT');
    }
    await requireReplaced(this.transaction, TASK_CORE_COLLECTIONS.submissions, documentId, current.version, createDocument(
      documentId,
      submission.organizationId,
      current.version + 1,
      submission,
    ));
  }

  public async saveFeedback(feedback: ReviewFeedbackRecord): Promise<void> {
    const documentId = feedbackDocumentId(feedback.organizationId, feedback.submissionId);
    await requireCreated(this.transaction, TASK_CORE_COLLECTIONS.feedback, createDocument(
      documentId,
      feedback.organizationId,
      1,
      feedback,
    ));
  }

  public async findIdempotencyRecord(recordId: string): Promise<IdempotencyRecord | null> {
    const found = await this.transaction.get(TASK_CORE_COLLECTIONS.idempotency, recordId);
    return isVisibleInOrganization(found, this.scope.organizationId) ? decodeDocument<IdempotencyRecord>(found) : null;
  }

  public async createIdempotencyRecord(record: IdempotencyRecord): Promise<boolean> {
    return this.transaction.create(TASK_CORE_COLLECTIONS.idempotency, createDocument(
      record.id,
      record.organizationId,
      1,
      record,
    ));
  }

  public async replaceIdempotencyRecord(record: IdempotencyRecord): Promise<void> {
    const current = await this.transaction.get(TASK_CORE_COLLECTIONS.idempotency, record.id);
    if (current === null) throw new TaskCorePersistenceError('INTERNAL_ERROR');
    ensureWritable(current, record.organizationId);
    await requireReplaced(this.transaction, TASK_CORE_COLLECTIONS.idempotency, record.id, current.version, createDocument(
      record.id,
      record.organizationId,
      current.version + 1,
      record,
    ));
  }

  public async appendOperationLog(entry: OperationLogRecord): Promise<void> {
    const documentId = auditDocumentId(entry.organizationId, entry.requestId);
    const appended = await this.transaction.append(TASK_CORE_COLLECTIONS.audit, createDocument(
      documentId,
      entry.organizationId,
      1,
      entry,
    ));
    if (!appended) throw new TaskCorePersistenceError('CONFLICT');
  }

  private async saveVersioned(
    collection: string,
    documentId: string,
    organizationId: string,
    nextVersion: number,
    record: unknown,
  ): Promise<void> {
    if (nextVersion === 1) {
      if (!(await this.transaction.create(collection, createDocument(documentId, organizationId, nextVersion, record)))) {
        throw new TaskCorePersistenceError('CONFLICT');
      }
      return;
    }
    const current = await this.transaction.get(collection, documentId);
    if (current === null) throw new TaskCorePersistenceError('CONFLICT');
    ensureWritable(current, organizationId);
    if (nextVersion !== current.version + 1) throw new TaskCorePersistenceError('CONFLICT');
    await requireReplaced(
      this.transaction,
      collection,
      documentId,
      current.version,
      createDocument(documentId, organizationId, nextVersion, record),
    );
  }

  private async readPreparedMemberships(
    organizationId: string,
    predicate: (membership: ClassMembershipRecord) => boolean,
  ): Promise<readonly ClassMembershipRecord[]> {
    this.ensureScopeOrganization(organizationId);
    const memberships: ClassMembershipRecord[] = [];
    for (const documentId of this.scope.membershipIds) {
      const found = await this.transaction.get(TASK_CORE_COLLECTIONS.memberships, documentId);
      if (!isVisibleInOrganization(found, organizationId)) throw new TaskCorePersistenceError('CONFLICT');
      const membership = decodeMembership(found);
      if (membership.status !== 'active') throw new TaskCorePersistenceError('CONFLICT');
      if (predicate(membership)) memberships.push(membership);
    }
    return memberships;
  }

  private async readPreparedGrants(organizationId: string): Promise<readonly TeacherClassGrantRecord[]> {
    this.ensureScopeOrganization(organizationId);
    const grants: TeacherClassGrantRecord[] = [];
    for (const documentId of this.scope.teacherGrantIds) {
      const found = await this.transaction.get(TASK_CORE_COLLECTIONS.teacherGrants, documentId);
      if (!isVisibleInOrganization(found, organizationId)) continue;
      const grant = decodeTeacherGrant(found);
      if (grant.status === 'active') grants.push(grant);
    }
    return grants;
  }

  private async validateClassMembershipGuards(organizationId: string, classIds: readonly string[]): Promise<void> {
    // `classes.version` guards the pre-transaction membership range query. A
    // membership writer must update both membership documents and this version
    // in one native transaction, otherwise a class snapshot could omit students.
    this.ensureScopeOrganization(organizationId);
    for (const classId of [...new Set(classIds)]) {
      const prepared = this.scope.classMembershipGuards.find((guard) => guard.classId === classId);
      if (prepared === undefined) throw new TaskCorePersistenceError('CONFLICT');
      const current = await this.transaction.get(TASK_CORE_COLLECTIONS.classes, classId);
      if (!isVisibleInOrganization(current, organizationId)
        || current.status !== 'active'
        || current.version !== prepared.expectedVersion) {
        throw new TaskCorePersistenceError('CONFLICT');
      }
    }
  }

  private async getScoped(collection: string, documentId: string, organizationId: string): Promise<VersionedDocument | null> {
    this.ensureScopeOrganization(organizationId);
    const found = await this.transaction.get(collection, documentId);
    return isVisibleInOrganization(found, organizationId) ? found : null;
  }

  private ensureScopeOrganization(organizationId: string): void {
    if (organizationId !== this.scope.organizationId) throw new TaskCorePersistenceError('CONFLICT');
  }
}

export function createDocument(
  documentId: string,
  organizationId: string,
  version: number,
  record: unknown,
): VersionedDocument {
  if (documentId.length === 0 || organizationId.length === 0 || !Number.isInteger(version) || version < 1) {
    throw new TaskCorePersistenceError('INTERNAL_ERROR');
  }
  const encoded = toJsonObject(record);
  const deletedAt = encoded.deletedAt;
  if (deletedAt !== undefined && deletedAt !== null && typeof deletedAt !== 'string') {
    throw new TaskCorePersistenceError('INTERNAL_ERROR');
  }
  return {
    ...encoded,
    _id: documentId,
    organizationId,
    schemaVersion: 1,
    version,
    deletedAt: deletedAt ?? null,
  };
}

export function assignmentDocumentId(organizationId: string, taskId: string, studentId: string): string {
  return assignmentByIdDocumentId(organizationId, `assignment_${taskId}_${studentId}`);
}

export function submissionDocumentId(organizationId: string, assignmentId: string, submissionVersion: number): string {
  return submissionByIdDocumentId(organizationId, deterministicSubmissionId(assignmentId, submissionVersion));
}

export function assignmentByIdDocumentId(organizationId: string, assignmentId: string): string {
  return `assignment:${organizationId}:${assignmentId}`;
}

export function deterministicSubmissionId(assignmentId: string, submissionVersion: number): string {
  return `submission_${assignmentId}_${submissionVersion}`;
}

export function submissionByIdDocumentId(organizationId: string, submissionId: string): string {
  return `submission:${organizationId}:${submissionId}`;
}

export function feedbackDocumentId(organizationId: string, submissionId: string): string {
  return `feedback:${organizationId}:${submissionId}`;
}

export function auditDocumentId(organizationId: string, requestId: string): string {
  return `audit:${organizationId}:${requestId}`;
}

function decodeDocument<T>(document: VersionedDocument, includeVersion = false): T {
  const { _id: ignoredId, schemaVersion: ignoredSchemaVersion, version, deletedAt: ignoredDeletedAt, ...record } = document;
  void ignoredId;
  void ignoredSchemaVersion;
  void ignoredDeletedAt;
  const decoded = includeVersion ? { ...record, version } : record;
  return cloneJson(decoded) as unknown as T;
}

function decodeTeacherGrant(document: VersionedDocument): TeacherClassGrantRecord {
  return {
    ...decodeDocument<Omit<TeacherClassGrantRecord, '_id' | 'version'>>(document),
    _id: document._id,
    version: document.version,
    deletedAt: document.deletedAt,
  };
}

function decodeMembership(document: VersionedDocument): ClassMembershipRecord {
  return {
    ...decodeDocument<Omit<ClassMembershipRecord, 'id'>>(document),
    id: document._id,
  };
}

function isVisibleInOrganization(
  document: VersionedDocument | null,
  organizationId: string,
): document is VersionedDocument {
  return document !== null && document.organizationId === organizationId && document.deletedAt === null;
}

function ensureWritable(document: VersionedDocument, organizationId: string): void {
  if (document.organizationId !== organizationId || document.deletedAt !== null) {
    throw new TaskCorePersistenceError('CONFLICT');
  }
}

function readString(document: VersionedDocument, field: string): string {
  const value = document[field];
  if (typeof value !== 'string') throw new TaskCorePersistenceError('INTERNAL_ERROR');
  return value;
}

async function requireCreated(
  transaction: DocumentDatabaseTransactionPort,
  collection: string,
  document: VersionedDocument,
): Promise<void> {
  if (!(await transaction.create(collection, document))) throw new TaskCorePersistenceError('CONFLICT');
}

async function requireReplaced(
  transaction: DocumentDatabaseTransactionPort,
  collection: string,
  documentId: string,
  expectedVersion: number,
  document: VersionedDocument,
): Promise<void> {
  if (!(await transaction.replace(collection, documentId, expectedVersion, document))) {
    throw new TaskCorePersistenceError('CONFLICT');
  }
}

function toJsonObject(value: unknown): JsonObject {
  const encoded = toJsonValue(value);
  if (!isJsonObject(encoded)) {
    throw new TaskCorePersistenceError('INTERNAL_ERROR');
  }
  return encoded;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TaskCorePersistenceError('INTERNAL_ERROR');
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
  throw new TaskCorePersistenceError('INTERNAL_ERROR');
}

function cloneJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)])) as T;
  }
  return value;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
