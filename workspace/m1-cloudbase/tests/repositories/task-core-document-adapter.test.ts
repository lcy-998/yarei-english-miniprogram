import { describe, expect, it } from 'vitest';
import type { IdempotencyRecord, OperationLogRecord, TeacherClassGrantRecord } from '../../src/runtime/records';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { TaskCorePersistenceError } from '../../src/repositories/persistence-error';
import {
  TASK_CORE_COLLECTIONS,
  assignmentDocumentId,
  auditDocumentId,
  createDocument,
  createTaskCoreDocumentRepository,
  deterministicSubmissionId,
  feedbackDocumentId,
  submissionDocumentId,
} from '../../src/repositories/task-core-document-adapter';
import type {
  ClassMembershipRecord,
  LearningResourceRecord,
  ReviewFeedbackRecord,
  SubmissionRecord,
  TaskAssignmentRecord,
  TaskRecord,
} from '../../src/task-core/types';

const ORGANIZATION_ID = 'organization_demo';
const TEACHER_ID = 'teacher_demo';
const CLASS_ID = 'class_demo';
const STUDENT_ID = 'student_demo';
const TASK_ID = 'task_demo';
const ASSIGNMENT_ID = `assignment_${TASK_ID}_${STUDENT_ID}`;
const SUBMISSION_ID = deterministicSubmissionId(ASSIGNMENT_ID, 1);

describe('TaskCore document database adapter contract', () => {
  it('rolls task, assignment, submission, feedback, idempotency and audit back when finalization fails after grant recheck', async () => {
    const database = createDatabaseWithGrant();
    const repository = createTaskCoreDocumentRepository(database);
    database.failNext({
      operation: 'replace',
      collection: TASK_CORE_COLLECTIONS.idempotency,
      kind: 'unavailable',
      diagnosticMessage: 'platform secret: unavailable cluster shard',
    });

    let caught: unknown;
    try {
      await repository.runTransaction(scope({ teacherGrantIds: [`grant_${TEACHER_ID}_${CLASS_ID}`] }), async (transaction) => {
        expect(await transaction.findActiveTeacherGrant(ORGANIZATION_ID, TEACHER_ID, CLASS_ID)).toMatchObject({
          teacherId: TEACHER_ID,
          permissions: ['task.publish', 'submission.review'],
        });
        await transaction.saveTask(task());
        await transaction.saveAssignment(assignment());
        await transaction.saveSubmission(submission());
        await transaction.saveFeedback(feedback());
        expect(await transaction.createIdempotencyRecord(processingIdempotency())).toBe(true);
        await transaction.appendOperationLog(operationLog());
        await transaction.replaceIdempotencyRecord({
          ...processingIdempotency(),
          status: 'succeeded',
          result: resultPayload(),
        });
      });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TaskCorePersistenceError);
    expect(caught).toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true });
    expect((caught as Error).message).not.toContain('cluster shard');
    const snapshot = database.snapshot();
    expect(snapshot[TASK_CORE_COLLECTIONS.teacherGrants]).toHaveLength(1);
    for (const collection of [
      TASK_CORE_COLLECTIONS.tasks,
      TASK_CORE_COLLECTIONS.assignments,
      TASK_CORE_COLLECTIONS.submissions,
      TASK_CORE_COLLECTIONS.feedback,
      TASK_CORE_COLLECTIONS.idempotency,
      TASK_CORE_COLLECTIONS.audit,
    ]) {
      expect(snapshot[collection] ?? []).toHaveLength(0);
    }
  });

  it('commits every aggregate with tenant scope, optimistic version and deterministic document id', async () => {
    const database = createDatabaseWithGrant();
    const repository = createTaskCoreDocumentRepository(database);

    await repository.runTransaction(scope({ teacherGrantIds: [`grant_${TEACHER_ID}_${CLASS_ID}`] }), async (transaction) => {
      expect(await transaction.findActiveTeacherGrant(ORGANIZATION_ID, TEACHER_ID, CLASS_ID)).not.toBeNull();
      await transaction.saveTask(task());
      await transaction.saveAssignment(assignment());
      await transaction.saveSubmission(submission());
      await transaction.saveFeedback(feedback());
      expect(await transaction.createIdempotencyRecord(processingIdempotency())).toBe(true);
      await transaction.appendOperationLog(operationLog());
      await transaction.replaceIdempotencyRecord({
        ...processingIdempotency(),
        status: 'succeeded',
        result: resultPayload(),
      });
    });

    const snapshot = database.snapshot();
    expect(snapshot[TASK_CORE_COLLECTIONS.tasks]?.[0]).toMatchObject({
      _id: TASK_ID,
      organizationId: ORGANIZATION_ID,
      schemaVersion: 1,
      version: 1,
    });
    expect(snapshot[TASK_CORE_COLLECTIONS.assignments]?.[0]?._id).toBe(
      assignmentDocumentId(ORGANIZATION_ID, TASK_ID, STUDENT_ID),
    );
    expect(snapshot[TASK_CORE_COLLECTIONS.submissions]?.[0]?._id).toBe(
      submissionDocumentId(ORGANIZATION_ID, ASSIGNMENT_ID, 1),
    );
    expect(snapshot[TASK_CORE_COLLECTIONS.feedback]?.[0]?._id).toBe(
      feedbackDocumentId(ORGANIZATION_ID, SUBMISSION_ID),
    );
    expect(snapshot[TASK_CORE_COLLECTIONS.idempotency]?.[0]).toMatchObject({
      _id: 'idempotency_demo',
      organizationId: ORGANIZATION_ID,
      version: 2,
      status: 'succeeded',
    });
    expect(snapshot[TASK_CORE_COLLECTIONS.audit]?.[0]?._id).toBe(
      auditDocumentId(ORGANIZATION_ID, 'request_demo'),
    );
    for (const documents of Object.values(snapshot)) {
      for (const document of documents) {
        expect(document.organizationId).toBe(ORGANIZATION_ID);
        expect(document.version).toBeGreaterThan(0);
        expect(document._id.length).toBeGreaterThan(0);
      }
    }
    expect(await repository.findTask(ORGANIZATION_ID, TASK_ID)).toEqual(task());
    expect(await repository.findSubmission(ORGANIZATION_ID, SUBMISSION_ID)).toEqual(submission());
    expect(await repository.findFeedbackBySubmission(ORGANIZATION_ID, SUBMISSION_ID)).toEqual(feedback());
  });

  it('rejects stale versions and duplicate semantic feedback ids without partial writes', async () => {
    const database = createDatabaseWithGrant();
    const repository = createTaskCoreDocumentRepository(database);
    await repository.runTransaction(scope(), async (transaction) => transaction.saveTask(task()));

    await expect(repository.runTransaction(scope(), async (transaction) => {
      await transaction.saveAssignment(assignment());
      await transaction.saveTask({ ...task(), title: 'stale update', version: 3 });
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(database.snapshot()[TASK_CORE_COLLECTIONS.assignments] ?? []).toHaveLength(0);
    expect(await repository.findTask(ORGANIZATION_ID, TASK_ID)).toEqual(task());

    await repository.runTransaction(scope(), async (transaction) => transaction.saveFeedback(feedback()));
    await expect(repository.runTransaction(scope(), async (transaction) => transaction.saveFeedback({
      ...feedback(),
      id: 'different_domain_feedback_id',
    }))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(database.snapshot()[TASK_CORE_COLLECTIONS.feedback]).toHaveLength(1);
  });

  it('rejects a class snapshot when a student is added after pre-read, and rechecks revoked grants and soft-deleted resources', async () => {
    const membership: ClassMembershipRecord = {
      id: 'membership_demo',
      organizationId: ORGANIZATION_ID,
      classId: CLASS_ID,
      studentId: STUDENT_ID,
      status: 'active',
    };
    const resource: LearningResourceRecord = {
      id: 'resource_demo',
      organizationId: ORGANIZATION_ID,
      type: 'exercise',
      title: '虚构练习',
      contentVersion: 1,
      status: 'published',
      visibility: 'organization',
      allowedClassIds: [],
      payload: {},
    };
    const grant = teacherGrant();
    const database = new FakeDocumentDatabase({
      [TASK_CORE_COLLECTIONS.classes]: [createDocument(CLASS_ID, ORGANIZATION_ID, 1, {
        id: CLASS_ID,
        organizationId: ORGANIZATION_ID,
        status: 'active',
      })],
      [TASK_CORE_COLLECTIONS.memberships]: [createDocument(membership.id, ORGANIZATION_ID, 1, membership)],
      [TASK_CORE_COLLECTIONS.teacherGrants]: [createDocument(grant._id, ORGANIZATION_ID, 1, grant)],
      [TASK_CORE_COLLECTIONS.resources]: [createDocument(resource.id, ORGANIZATION_ID, 1, resource)],
    });
    const repository = createTaskCoreDocumentRepository(database);

    const preparedClassGuard = await repository.findClassMembershipGuard(ORGANIZATION_ID, CLASS_ID);
    const preparedMemberships = await repository.listActiveClassMemberships(ORGANIZATION_ID, [CLASS_ID]);
    const preparedGrants = await repository.listActiveTeacherGrants(ORGANIZATION_ID, TEACHER_ID, [CLASS_ID]);
    expect(await repository.findResource(ORGANIZATION_ID, resource.id)).not.toBeNull();
    expect(preparedMemberships).toHaveLength(1);
    expect(preparedGrants).toHaveLength(1);
    expect(preparedClassGuard).toMatchObject({ id: CLASS_ID, version: 1 });

    await database.runTransaction(async (transaction) => {
      const classDocument = await transaction.get(TASK_CORE_COLLECTIONS.classes, CLASS_ID);
      if (classDocument === null) throw new Error('class fixture expected');
      expect(await transaction.create(TASK_CORE_COLLECTIONS.memberships, createDocument(
        'membership_added_after_prepare',
        ORGANIZATION_ID,
        1,
        {
          ...membership,
          id: 'membership_added_after_prepare',
          studentId: 'student_added_after_prepare',
        },
      ))).toBe(true);
      expect(await transaction.replace(TASK_CORE_COLLECTIONS.classes, CLASS_ID, classDocument.version, {
        ...classDocument,
        version: classDocument.version + 1,
      })).toBe(true);
    });
    await mutateDocument(database, TASK_CORE_COLLECTIONS.teacherGrants, grant._id, { status: 'revoked' });
    await mutateDocument(database, TASK_CORE_COLLECTIONS.resources, resource.id, { deletedAt: '2026-09-16T11:00:00.000+08:00' });

    await expect(repository.runTransaction(scope({
      membershipIds: preparedMemberships.map((item) => item.id),
      classMembershipGuards: preparedClassGuard === null ? [] : [{
        classId: preparedClassGuard.id,
        expectedVersion: preparedClassGuard.version,
      }],
    }), async (transaction) => {
      await transaction.listActiveClassMemberships(ORGANIZATION_ID, [CLASS_ID]);
      await transaction.saveTask(task());
    })).rejects.toMatchObject({ code: 'CONFLICT' });

    const grantResult = await repository.runTransaction(scope({
      teacherGrantIds: preparedGrants.map((item) => item._id),
    }), async (transaction) => {
      const current = await transaction.findActiveTeacherGrant(ORGANIZATION_ID, TEACHER_ID, CLASS_ID);
      if (current === null) return 'FORBIDDEN' as const;
      await transaction.saveTask(task());
      return 'WRITTEN' as const;
    });
    expect(grantResult).toBe('FORBIDDEN');

    const resourceResult = await repository.runTransaction(scope({ resourceIds: [resource.id] }), async (transaction) => {
      const current = await transaction.findResource(ORGANIZATION_ID, resource.id);
      if (current === null) return 'NOT_FOUND' as const;
      await transaction.saveTask(task());
      return 'WRITTEN' as const;
    });
    expect(resourceResult).toBe('NOT_FOUND');
    expect(database.snapshot()[TASK_CORE_COLLECTIONS.tasks] ?? []).toHaveLength(0);
    expect(await repository.listActiveClassMemberships(ORGANIZATION_ID, [CLASS_ID])).toHaveLength(2);
    expect(await repository.listActiveTeacherGrants(ORGANIZATION_ID, TEACHER_ID, [CLASS_ID])).toHaveLength(0);
    expect(await repository.findResource(ORGANIZATION_ID, resource.id)).toBeNull();
  });
});

function createDatabaseWithGrant(): FakeDocumentDatabase {
  const grant = teacherGrant();
  return new FakeDocumentDatabase({
    [TASK_CORE_COLLECTIONS.teacherGrants]: [createDocument(grant._id, ORGANIZATION_ID, 1, grant)],
  });
}

function teacherGrant(): TeacherClassGrantRecord {
  return {
    _id: `grant_${TEACHER_ID}_${CLASS_ID}`,
    organizationId: ORGANIZATION_ID,
    teacherId: TEACHER_ID,
    classId: CLASS_ID,
    status: 'active',
    permissions: ['task.publish', 'submission.review'],
    version: 1,
    deletedAt: null,
  };
}

function task(): TaskRecord {
  return {
    id: TASK_ID,
    organizationId: ORGANIZATION_ID,
    creatorTeacherId: TEACHER_ID,
    title: '虚构事务任务',
    deliveryType: 'classroom',
    status: 'active',
    targetType: 'classes',
    targetClassIds: [CLASS_ID],
    targetStudentIds: [STUDENT_ID],
    startsAt: '2026-09-16T08:00:00.000+08:00',
    dueAt: '2026-09-17T08:00:00.000+08:00',
    latePolicy: { allowLate: true, lateDays: 7 },
    description: null,
    teacherNote: null,
    itemRefs: [],
    items: [],
    publishedAt: '2026-09-16T08:00:00.000+08:00',
    deadlineExtendedAt: null,
    visibility: 'visible',
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawReason: null,
    recycledAt: null,
    recycledBy: null,
    recycleReason: null,
    recoverableUntil: null,
    version: 1,
  };
}

function assignment(): TaskAssignmentRecord {
  return {
    id: ASSIGNMENT_ID,
    organizationId: ORGANIZATION_ID,
    taskId: TASK_ID,
    studentId: STUDENT_ID,
    classId: CLASS_ID,
    status: 'awaiting_review',
    latestSubmissionId: SUBMISSION_ID,
    latestSubmissionVersion: 1,
    redoCount: 0,
    redoDueAt: null,
    isLate: false,
    submittedAt: '2026-09-16T09:00:00.000+08:00',
    reviewedAt: null,
    version: 1,
  };
}

function submission(): SubmissionRecord {
  return {
    id: SUBMISSION_ID,
    organizationId: ORGANIZATION_ID,
    taskId: TASK_ID,
    assignmentId: ASSIGNMENT_ID,
    studentId: STUDENT_ID,
    submissionVersion: 1,
    recordVersion: 1,
    status: 'submitted',
    answers: [],
    isLate: false,
    submittedAt: '2026-09-16T09:00:00.000+08:00',
    supersedesSubmissionId: null,
  };
}

function feedback(): ReviewFeedbackRecord {
  return {
    id: 'feedback_demo',
    organizationId: ORGANIZATION_ID,
    taskId: TASK_ID,
    assignmentId: ASSIGNMENT_ID,
    submissionId: SUBMISSION_ID,
    submissionVersion: 1,
    teacherId: TEACHER_ID,
    decision: 'approved',
    score: 95,
    textComment: '虚构点评',
    returnReason: null,
    publishedAt: '2026-09-16T10:00:00.000+08:00',
    source: 'manual',
  };
}

function processingIdempotency(): IdempotencyRecord {
  return {
    id: 'idempotency_demo',
    organizationId: ORGANIZATION_ID,
    actorUserId: TEACHER_ID,
    functionName: 'review-command',
    action: 'publishReview',
    operationId: 'operation_demo',
    requestHash: 'hash_demo',
    status: 'processing',
    result: null,
  };
}

function operationLog(): OperationLogRecord {
  return {
    id: 'log_demo',
    organizationId: ORGANIZATION_ID,
    requestId: 'request_demo',
    actorUserId: TEACHER_ID,
    actorRole: 'teacher',
    action: 'submission.review',
    targetType: 'submission',
    targetId: SUBMISSION_ID,
    result: 'succeeded',
    errorCode: null,
    occurredAt: '2026-09-16T10:00:00.000+08:00',
    metadata: { submissionVersion: 1 },
  };
}

function resultPayload(): NonNullable<IdempotencyRecord['result']> {
  return {
    ok: true,
    data: { feedbackId: 'feedback_demo' },
    meta: {
      requestId: 'request_demo',
      serverTime: '2026-09-16T10:00:00.000+08:00',
      apiVersion: 'm1.v1',
    },
  };
}

function scope(overrides: Partial<Readonly<{
  resourceIds: readonly string[];
  membershipIds: readonly string[];
  teacherGrantIds: readonly string[];
  assignmentIds: readonly string[];
  submissionIds: readonly string[];
  classMembershipGuards: readonly Readonly<{ classId: string; expectedVersion: number }>[];
}>> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    resourceIds: overrides.resourceIds ?? [],
    membershipIds: overrides.membershipIds ?? [],
    teacherGrantIds: overrides.teacherGrantIds ?? [],
    assignmentIds: overrides.assignmentIds ?? [],
    submissionIds: overrides.submissionIds ?? [],
    classMembershipGuards: overrides.classMembershipGuards ?? [],
  };
}

async function mutateDocument(
  database: FakeDocumentDatabase,
  collection: string,
  documentId: string,
  changes: Readonly<Record<string, string | null>>,
): Promise<void> {
  await database.runTransaction(async (transaction) => {
    const current = await transaction.get(collection, documentId);
    if (current === null) throw new Error('fixture document expected');
    const replaced = await transaction.replace(collection, documentId, current.version, {
      ...current,
      ...changes,
      version: current.version + 1,
    });
    if (!replaced) throw new Error('fixture mutation expected');
  });
}
