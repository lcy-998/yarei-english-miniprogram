import type { JsonValue } from '../shared/protocol';
import type { IdempotencyRecord, OperationLogRecord, TeacherClassGrantRecord } from '../runtime/records';
import type { ClassMembershipGuardRecord, TaskCoreTransaction, TaskCoreTransactionScope, TaskCoreUnitOfWork } from './repository';
import type {
  ClassMembershipRecord,
  LearningResourceRecord,
  ReviewFeedbackRecord,
  SubmissionAnswer,
  SubmissionRecord,
  TaskAssignmentRecord,
  TaskRecord,
} from './types';

export interface TaskCoreFixture {
  readonly resources: readonly LearningResourceRecord[];
  readonly memberships: readonly ClassMembershipRecord[];
  readonly teacherGrants: readonly TeacherClassGrantRecord[];
  readonly tasks?: readonly TaskRecord[];
  readonly assignments?: readonly TaskAssignmentRecord[];
  readonly submissions?: readonly SubmissionRecord[];
  readonly feedback?: readonly ReviewFeedbackRecord[];
  readonly idempotencyRecords?: readonly IdempotencyRecord[];
  readonly operationLogs?: readonly OperationLogRecord[];
}

export type TaskCoreFailurePoint = 'idempotency.finalize' | 'audit.append';

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}

function cloneAnswers(answers: readonly SubmissionAnswer[]): readonly SubmissionAnswer[] {
  return answers.map((answer) => ({ itemId: answer.itemId, value: cloneJson(answer.value) }));
}

function cloneResource(resource: LearningResourceRecord): LearningResourceRecord {
  return {
    ...resource,
    allowedClassIds: [...resource.allowedClassIds],
    payload: cloneJson(resource.payload) as LearningResourceRecord['payload'],
  };
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    targetClassIds: [...task.targetClassIds],
    targetStudentIds: [...task.targetStudentIds],
    itemRefs: task.itemRefs.map((item) => ({
      ...item,
      ...(item.completionRule === undefined ? {} : { completionRule: cloneJson(item.completionRule) as LearningResourceRecord['payload'] }),
      ...(item.scoringRule === undefined ? {} : { scoringRule: cloneJson(item.scoringRule) as LearningResourceRecord['payload'] }),
    })),
    items: task.items.map((item) => ({
      ...item,
      resourceSnapshot: {
        ...item.resourceSnapshot,
        payload: cloneJson(item.resourceSnapshot.payload) as LearningResourceRecord['payload'],
      },
      completionRule: cloneJson(item.completionRule) as LearningResourceRecord['payload'],
      scoringRule: cloneJson(item.scoringRule) as LearningResourceRecord['payload'],
    })),
  };
}

function cloneSubmission(submission: SubmissionRecord): SubmissionRecord {
  return { ...submission, answers: cloneAnswers(submission.answers) };
}

function cloneIdempotencyRecord(record: IdempotencyRecord): IdempotencyRecord {
  return {
    ...record,
    result: record.result === null
      ? null
      : cloneJson(record.result as unknown as JsonValue) as unknown as IdempotencyRecord['result'],
  };
}

function cloneOperationLog(record: OperationLogRecord): OperationLogRecord {
  return { ...record, metadata: cloneJson(record.metadata) as OperationLogRecord['metadata'] };
}

function cloneTeacherGrant(record: TeacherClassGrantRecord): TeacherClassGrantRecord {
  return { ...record, permissions: [...record.permissions] };
}

export class InMemoryTaskCoreRepository implements TaskCoreUnitOfWork, TaskCoreTransaction {
  private resources: LearningResourceRecord[];
  private memberships: ClassMembershipRecord[];
  private membershipGuardVersions: Map<string, number>;
  private teacherGrants: TeacherClassGrantRecord[];
  private tasks: TaskRecord[];
  private assignments: TaskAssignmentRecord[];
  private submissions: SubmissionRecord[];
  private feedback: ReviewFeedbackRecord[];
  private idempotencyRecords: IdempotencyRecord[];
  private operationLogs: OperationLogRecord[];
  private transactionTail: Promise<void> = Promise.resolve();
  private nextFailure: TaskCoreFailurePoint | null = null;

  public constructor(fixture: TaskCoreFixture) {
    this.resources = fixture.resources.map(cloneResource);
    this.memberships = fixture.memberships.map((item) => ({ ...item }));
    this.membershipGuardVersions = new Map(
      [...new Set(fixture.memberships.map((item) => guardKey(item.organizationId, item.classId)))]
        .map((key) => [key, 1]),
    );
    this.teacherGrants = fixture.teacherGrants.map(cloneTeacherGrant);
    this.tasks = (fixture.tasks ?? []).map(cloneTask);
    this.assignments = (fixture.assignments ?? []).map((item) => ({ ...item }));
    this.submissions = (fixture.submissions ?? []).map(cloneSubmission);
    this.feedback = (fixture.feedback ?? []).map((item) => ({ ...item }));
    this.idempotencyRecords = (fixture.idempotencyRecords ?? []).map(cloneIdempotencyRecord);
    this.operationLogs = (fixture.operationLogs ?? []).map(cloneOperationLog);
  }

  /** Arms one deterministic failure for transaction rollback tests. */
  public failNext(point: TaskCoreFailurePoint): void {
    this.nextFailure = point;
  }

  /** Replaces fixture data to simulate a later resource revision in adapter tests. */
  public upsertResource(resource: LearningResourceRecord): void {
    this.resources = replaceById(this.resources, cloneResource(resource));
  }

  /** Replaces fixture data to simulate a later enrollment change in adapter tests. */
  public upsertMembership(membership: ClassMembershipRecord): void {
    const previous = this.memberships.find((item) => item.id === membership.id);
    this.memberships = replaceById(this.memberships, { ...membership });
    const affected = new Set([guardKey(membership.organizationId, membership.classId)]);
    if (previous !== undefined) affected.add(guardKey(previous.organizationId, previous.classId));
    for (const key of affected) this.membershipGuardVersions.set(key, (this.membershipGuardVersions.get(key) ?? 0) + 1);
  }

  /** Simulates a separately committed authorization command on the same store. */
  public async commitTeacherGrant(grant: TeacherClassGrantRecord): Promise<void> {
    await this.runTransaction(emptyTransactionScope(grant.organizationId), async () => {
      this.teacherGrants = replaceByDocumentId(this.teacherGrants, cloneTeacherGrant(grant));
    });
  }

  public async runTransaction<T>(scope: TaskCoreTransactionScope, work: (transaction: TaskCoreTransaction) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    for (const guard of scope.classMembershipGuards) {
      const currentVersion = this.membershipGuardVersions.get(guardKey(scope.organizationId, guard.classId)) ?? 0;
      if (currentVersion !== guard.expectedVersion) {
        release();
        throw new Error('class membership guard conflict');
      }
    }
    const snapshot = {
      resources: this.resources.map(cloneResource),
      memberships: this.memberships.map((item) => ({ ...item })),
      teacherGrants: this.teacherGrants.map(cloneTeacherGrant),
      tasks: this.tasks.map(cloneTask),
      assignments: this.assignments.map((item) => ({ ...item })),
      submissions: this.submissions.map(cloneSubmission),
      feedback: this.feedback.map((item) => ({ ...item })),
      idempotencyRecords: this.idempotencyRecords.map(cloneIdempotencyRecord),
      operationLogs: this.operationLogs.map(cloneOperationLog),
      membershipGuardVersions: new Map(this.membershipGuardVersions),
    };
    try {
      return await work(this);
    } catch (error: unknown) {
      this.resources = snapshot.resources;
      this.memberships = snapshot.memberships;
      this.teacherGrants = snapshot.teacherGrants;
      this.tasks = snapshot.tasks;
      this.assignments = snapshot.assignments;
      this.submissions = snapshot.submissions;
      this.feedback = snapshot.feedback;
      this.idempotencyRecords = snapshot.idempotencyRecords;
      this.operationLogs = snapshot.operationLogs;
      this.membershipGuardVersions = snapshot.membershipGuardVersions;
      throw error;
    } finally {
      release();
    }
  }

  public debugSnapshot(): Readonly<{
    tasks: readonly TaskRecord[];
    assignments: readonly TaskAssignmentRecord[];
    submissions: readonly SubmissionRecord[];
    feedback: readonly ReviewFeedbackRecord[];
    idempotencyRecords: readonly IdempotencyRecord[];
    operationLogs: readonly OperationLogRecord[];
    teacherGrants: readonly TeacherClassGrantRecord[];
  }> {
    return {
      tasks: this.tasks.map(cloneTask),
      assignments: this.assignments.map((item) => ({ ...item })),
      submissions: this.submissions.map(cloneSubmission),
      feedback: this.feedback.map((item) => ({ ...item })),
      idempotencyRecords: this.idempotencyRecords.map(cloneIdempotencyRecord),
      operationLogs: this.operationLogs.map(cloneOperationLog),
      teacherGrants: this.teacherGrants.map(cloneTeacherGrant),
    };
  }

  public async findActiveTeacherGrant(organizationId: string, teacherId: string, classId: string): Promise<TeacherClassGrantRecord | null> {
    const found = this.teacherGrants.find((item) => item.organizationId === organizationId
      && item.teacherId === teacherId
      && item.classId === classId
      && item.status === 'active'
      && item.deletedAt === null);
    return found === undefined ? null : cloneTeacherGrant(found);
  }

  public async listActiveTeacherGrants(organizationId: string, teacherId: string, classIds: readonly string[]): Promise<readonly TeacherClassGrantRecord[]> {
    return this.teacherGrants
      .filter((item) => item.organizationId === organizationId && item.teacherId === teacherId && item.status === 'active' && item.deletedAt === null && classIds.includes(item.classId))
      .map(cloneTeacherGrant);
  }

  public async findClassMembershipGuard(organizationId: string, classId: string): Promise<ClassMembershipGuardRecord | null> {
    const version = this.membershipGuardVersions.get(guardKey(organizationId, classId)) ?? 0;
    return { id: `membership_guard_${classId}`, organizationId, status: 'active', version };
  }

  public async findResource(organizationId: string, resourceId: string): Promise<LearningResourceRecord | null> {
    const found = this.resources.find((item) => item.organizationId === organizationId && item.id === resourceId);
    return found === undefined ? null : cloneResource(found);
  }

  public async listActiveClassMemberships(organizationId: string, classIds: readonly string[]): Promise<readonly ClassMembershipRecord[]> {
    return this.memberships
      .filter((item) => item.organizationId === organizationId && classIds.includes(item.classId) && item.status === 'active')
      .map((item) => ({ ...item }));
  }

  public async listActiveStudentMemberships(organizationId: string, studentIds: readonly string[]): Promise<readonly ClassMembershipRecord[]> {
    const allowed = new Set(studentIds);
    return this.memberships
      .filter((item) => item.organizationId === organizationId && item.status === 'active' && allowed.has(item.studentId))
      .map((item) => ({ ...item }));
  }

  public async findTask(organizationId: string, taskId: string): Promise<TaskRecord | null> {
    const found = this.tasks.find((item) => item.organizationId === organizationId && item.id === taskId);
    return found === undefined ? null : cloneTask(found);
  }

  public async saveTask(task: TaskRecord): Promise<void> {
    this.tasks = replaceById(this.tasks, cloneTask(task));
  }

  public async findAssignment(organizationId: string, taskId: string, studentId: string): Promise<TaskAssignmentRecord | null> {
    const found = this.assignments.find((item) => item.organizationId === organizationId && item.taskId === taskId && item.studentId === studentId);
    return found === undefined ? null : { ...found };
  }

  public async findAssignmentById(organizationId: string, assignmentId: string): Promise<TaskAssignmentRecord | null> {
    const found = this.assignments.find((item) => item.organizationId === organizationId && item.id === assignmentId);
    return found === undefined ? null : { ...found };
  }

  public async listTaskAssignments(organizationId: string, taskId: string): Promise<readonly TaskAssignmentRecord[]> {
    return this.assignments
      .filter((item) => item.organizationId === organizationId && item.taskId === taskId)
      .map((item) => ({ ...item }));
  }

  public async saveAssignment(assignment: TaskAssignmentRecord): Promise<void> {
    this.assignments = replaceById(this.assignments, { ...assignment });
  }

  public async deleteAssignment(assignment: TaskAssignmentRecord): Promise<void> {
    const current = this.assignments.find((item) => item.id === assignment.id && item.organizationId === assignment.organizationId);
    if (current === undefined || current.version !== assignment.version) throw new Error('assignment version conflict');
    this.assignments = this.assignments.filter((item) => item.id !== assignment.id);
  }

  public async findSubmission(organizationId: string, submissionId: string): Promise<SubmissionRecord | null> {
    const found = this.submissions.find((item) => item.organizationId === organizationId && item.id === submissionId);
    return found === undefined ? null : cloneSubmission(found);
  }

  public async listTaskSubmissions(organizationId: string, taskId: string): Promise<readonly SubmissionRecord[]> {
    return this.submissions
      .filter((item) => item.organizationId === organizationId && item.taskId === taskId)
      .map(cloneSubmission);
  }

  public async findDraftSubmission(organizationId: string, assignmentId: string, submissionVersion: number): Promise<SubmissionRecord | null> {
    const found = this.submissions.find((item) => item.organizationId === organizationId && item.assignmentId === assignmentId && item.submissionVersion === submissionVersion && item.status === 'draft');
    return found === undefined ? null : cloneSubmission(found);
  }

  public async saveSubmission(submission: SubmissionRecord): Promise<void> {
    this.submissions = replaceById(this.submissions, cloneSubmission(submission));
  }

  public async findFeedbackBySubmission(organizationId: string, submissionId: string): Promise<ReviewFeedbackRecord | null> {
    const found = this.feedback.find((item) => item.organizationId === organizationId && item.submissionId === submissionId);
    return found === undefined ? null : { ...found };
  }

  public async saveFeedback(feedback: ReviewFeedbackRecord): Promise<void> {
    if (this.feedback.some((item) => item.organizationId === feedback.organizationId && item.submissionId === feedback.submissionId)) {
      throw new Error('feedback already exists');
    }
    this.feedback.push({ ...feedback });
  }

  public async findIdempotencyRecord(recordId: string): Promise<IdempotencyRecord | null> {
    const found = this.idempotencyRecords.find((item) => item.id === recordId);
    return found === undefined ? null : cloneIdempotencyRecord(found);
  }

  public async createIdempotencyRecord(record: IdempotencyRecord): Promise<boolean> {
    if (this.idempotencyRecords.some((item) => item.id === record.id)) return false;
    this.idempotencyRecords.push(cloneIdempotencyRecord(record));
    return true;
  }

  public async replaceIdempotencyRecord(record: IdempotencyRecord): Promise<void> {
    this.throwIfArmed('idempotency.finalize');
    const index = this.idempotencyRecords.findIndex((item) => item.id === record.id);
    if (index < 0) throw new Error('idempotency record does not exist');
    this.idempotencyRecords = this.idempotencyRecords.map((item, itemIndex) => itemIndex === index ? cloneIdempotencyRecord(record) : item);
  }

  public async appendOperationLog(entry: OperationLogRecord): Promise<void> {
    this.throwIfArmed('audit.append');
    if (this.operationLogs.some((item) => item.requestId === entry.requestId)) throw new Error('operation log requestId already exists');
    this.operationLogs.push(cloneOperationLog(entry));
  }

  private throwIfArmed(point: TaskCoreFailurePoint): void {
    if (this.nextFailure !== point) return;
    this.nextFailure = null;
    throw new Error(`simulated ${point} failure`);
  }
}

function replaceById<T extends Readonly<{ id: string }>>(records: readonly T[], next: T): T[] {
  const index = records.findIndex((item) => item.id === next.id);
  if (index < 0) return [...records, next];
  return records.map((item, itemIndex) => itemIndex === index ? next : item);
}

function replaceByDocumentId<T extends Readonly<{ _id: string }>>(records: readonly T[], next: T): T[] {
  const index = records.findIndex((item) => item._id === next._id);
  if (index < 0) return [...records, next];
  return records.map((item, itemIndex) => itemIndex === index ? next : item);
}

function emptyTransactionScope(organizationId: string): TaskCoreTransactionScope {
  return {
    organizationId,
    resourceIds: [],
    membershipIds: [],
    teacherGrantIds: [],
    assignmentIds: [],
    submissionIds: [],
    classMembershipGuards: [],
  };
}

function guardKey(organizationId: string, classId: string): string {
  return `${organizationId}:${classId}`;
}
