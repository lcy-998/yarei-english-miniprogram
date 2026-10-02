import { describe, expect, it } from 'vitest';
import { createStudentTaskQueryFunction } from '../../functions/student-task-query/function-entry';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryIdentityRepository, type AuthorizationFixture } from '../../src/runtime/memory-ports';
import type { ParentStudentLinkRecord } from '../../src/runtime/records';
import type {
  LearningResourceRecord,
  ReviewFeedbackRecord,
  SubmissionRecord,
  TaskAssignmentRecord,
  TaskRecord,
} from '../../src/task-core/types';
import { ParentTaskQueryService } from '../../src/task-query/parent-service';
import { ReviewQueryService, StudentTaskQueryService, TeacherTaskQueryService } from '../../src/task-query/service';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { TaskCorePersistenceError } from '../../src/repositories/persistence-error';
import {
  TASK_CORE_COLLECTIONS,
  assignmentByIdDocumentId,
  createDocument,
  feedbackDocumentId,
  submissionByIdDocumentId,
} from '../../src/repositories/task-core-document-adapter';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';

const ORGANIZATION_ID = 'org_demo';
const TEACHER_ID = 'teacher_lin';
const STUDENT_ID = 'student_xiaoyu';
const PARENT_ID = 'parent_xiaoyu';
const CLASS_ID = 'class_demo';
const TASK_ID = 'task_demo';
const ASSIGNMENT_ID = `assignment_${TASK_ID}_${STUDENT_ID}`;
const SUBMISSION_ID = `submission_${ASSIGNMENT_ID}_1`;
const DRAFT_ID = `submission_${ASSIGNMENT_ID}_2`;

const teacher: TrustedActorContext = {
  requestId: 'request_teacher', sessionId: 'session_teacher', actorUserId: TEACHER_ID, actorRole: 'teacher',
  organizationId: ORGANIZATION_ID, platformSubjectDigest: 'digest_teacher',
  permissions: ['task.read', 'task.publish', 'submission.review'], scopeIds: [CLASS_ID], authzVersion: 1,
};
const student: TrustedActorContext = {
  ...teacher, requestId: 'request_student', sessionId: 'session_student', actorUserId: STUDENT_ID, actorRole: 'student',
  permissions: ['content.read'], scopeIds: [STUDENT_ID],
};
const parent: TrustedActorContext = {
  ...teacher, requestId: 'request_parent', sessionId: 'session_parent', actorUserId: PARENT_ID, actorRole: 'parent',
  permissions: ['child.read'], scopeIds: [],
};

describe('task query document repository', () => {
  it('reads every TaskQueryRepository aggregate with tenant and soft-delete boundaries', async () => {
    const database = seededDatabase();
    const repository = createTaskQueryDocumentRepository(database);

    await expect(repository.listActiveTeacherGrants(ORGANIZATION_ID, TEACHER_ID)).resolves.toEqual([
      expect.objectContaining({ id: 'grant_demo', classId: CLASS_ID, className: '虚构三年级 2 班' }),
    ]);
    await expect(repository.listTasks(ORGANIZATION_ID)).resolves.toEqual([
      expect.objectContaining({ id: TASK_ID, version: 2 }),
    ]);
    await expect(repository.findTask(ORGANIZATION_ID, TASK_ID)).resolves.toMatchObject({ id: TASK_ID, version: 2 });
    await expect(repository.listAssignments(ORGANIZATION_ID)).resolves.toEqual([
      expect.objectContaining({ id: ASSIGNMENT_ID, version: 3 }),
    ]);
    await expect(repository.findAssignment(ORGANIZATION_ID, TASK_ID, STUDENT_ID))
      .resolves.toMatchObject({ id: ASSIGNMENT_ID });
    await expect(repository.findAssignmentById(ORGANIZATION_ID, ASSIGNMENT_ID))
      .resolves.toMatchObject({ taskId: TASK_ID });
    await expect(repository.listSubmissions(ORGANIZATION_ID)).resolves.toHaveLength(2);
    await expect(repository.findSubmission(ORGANIZATION_ID, SUBMISSION_ID))
      .resolves.toMatchObject({ id: SUBMISSION_ID, status: 'submitted' });
    await expect(repository.findDraftSubmission(ORGANIZATION_ID, ASSIGNMENT_ID, 2))
      .resolves.toMatchObject({ id: DRAFT_ID, status: 'draft', recordVersion: 2 });
    await expect(repository.findFeedback(ORGANIZATION_ID, SUBMISSION_ID))
      .resolves.toMatchObject({ id: 'feedback_demo', score: 92 });
    await expect(repository.listPublishedResourceOptions(ORGANIZATION_ID)).resolves.toEqual([
      expect.objectContaining({ id: 'resource_demo', title: '虚构绘本', allowedClassIds: [CLASS_ID] }),
    ]);
    await expect(repository.findPublishedResourceOption(ORGANIZATION_ID, 'resource_demo'))
      .resolves.toMatchObject({ id: 'resource_demo', title: '虚构绘本', allowedClassIds: [CLASS_ID] });
    await expect(repository.findPublishedResourceOption('org_other', 'resource_demo')).resolves.toBeNull();
    await expect(repository.findTask('org_other', TASK_ID)).resolves.toBeNull();
  });

  it('returns deep copies and maps document platform failures to safe persistence errors', async () => {
    const database = seededDatabase();
    const repository = createTaskQueryDocumentRepository(database);
    const first = await repository.findTask(ORGANIZATION_ID, TASK_ID);
    if (first === null) throw new Error('task fixture expected');
    (first.targetClassIds as string[]).push('class_mutated');
    (first.items[0]?.resourceSnapshot.payload as Record<string, number>).pageCount = 99;
    await expect(repository.findTask(ORGANIZATION_ID, TASK_ID)).resolves.toMatchObject({
      targetClassIds: [CLASS_ID],
      items: [{ resourceSnapshot: { payload: { pageCount: 3 } } }],
    });

    database.failNext({ operation: 'find', collection: TASK_CORE_COLLECTIONS.tasks, kind: 'unavailable' });
    await expect(repository.listTasks(ORGANIZATION_ID))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true });
  });

  it('supports teacher, student, review and parent query services from the same documents', async () => {
    const repository = createTaskQueryDocumentRepository(seededDatabase());
    let sequence = 0;
    const dependencies = {
      repository,
      clock: { nowIso: () => '2026-09-16T03:00:00.000Z' },
      requestIds: { next: () => `request_query_${++sequence}` },
    };
    const teacherService = new TeacherTaskQueryService(dependencies);
    const studentService = new StudentTaskQueryService(dependencies);
    const reviewService = new ReviewQueryService(dependencies);
    const parentService = new ParentTaskQueryService({ ...dependencies, identities: parentIdentities() });

    await expect(teacherService.listTeacherTasks(teacher, {}, { limit: 10 })).resolves.toMatchObject({
      ok: true,
      data: { total: 1, items: [{ taskId: TASK_ID, classIds: [CLASS_ID] }] },
    });
    await expect(teacherService.getDraftOptions(teacher)).resolves.toMatchObject({
      ok: true,
      data: { classes: [{ id: CLASS_ID }], resources: [{ id: 'resource_demo' }] },
    });
    await expect(studentService.getMyTask(student, TASK_ID)).resolves.toMatchObject({
      ok: true,
      data: { taskId: TASK_ID, submission: { id: DRAFT_ID, status: 'draft', assignmentVersion: 3 } },
    });
    await expect(reviewService.getSubmissionForReview(teacher, SUBMISSION_ID)).resolves.toMatchObject({
      ok: true,
      data: { submissionId: SUBMISSION_ID, feedback: { score: 92 } },
    });
    await expect(parentService.getParentTaskResult(parent, STUDENT_ID, TASK_ID)).resolves.toMatchObject({
      ok: true,
      data: { taskId: TASK_ID, studentId: STUDENT_ID, submission: { id: SUBMISSION_ID }, feedback: { score: 92 } },
    });
  });

  it('maps document unavailability at the query function boundary without exposing diagnostics', async () => {
    const unavailable = async (): Promise<never> => {
      throw new TaskCorePersistenceError('SERVICE_UNAVAILABLE');
    };
    const entry = createStudentTaskQueryFunction({
      runtime: {
        functionName: 'student-task-query',
        getPlatformSubject: async () => ({ subject: 'subject_demo', loginType: 'WECHAT', isAuthenticated: true }),
        getBusinessSessionId: async () => 'session_student',
      },
      actorResolver: { resolve: async () => student },
      clock: { nowIso: () => '2026-09-16T03:00:00.000Z' },
      requestIds: { next: () => 'request_query_failure' },
      handler: { getHome: unavailable, listMyTasks: unavailable, getMyTask: unavailable },
    });

    await expect(entry({
      apiVersion: 'm1.v1', action: 'getHome', payload: { localDate: '2026-09-16' },
    })).resolves.toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', retryable: true } });
  });
});

function seededDatabase(): FakeDocumentDatabase {
  const taskRecord = task();
  const assignmentRecord = assignment();
  const submitted = submission();
  const draft = draftSubmission();
  const feedbackRecord = feedback();
  const resource = learningResource();
  return new FakeDocumentDatabase({
    [TASK_CORE_COLLECTIONS.classes]: [createDocument(CLASS_ID, ORGANIZATION_ID, 1, {
      id: CLASS_ID, organizationId: ORGANIZATION_ID, name: '虚构三年级 2 班', status: 'active',
    })],
    [TASK_CORE_COLLECTIONS.teacherGrants]: [createDocument('grant_demo', ORGANIZATION_ID, 1, {
      id: 'grant_demo', organizationId: ORGANIZATION_ID, teacherId: TEACHER_ID, classId: CLASS_ID,
      status: 'active', permissions: ['task.read', 'task.publish', 'submission.review'],
    })],
    [TASK_CORE_COLLECTIONS.tasks]: [
      createDocument(taskRecord.id, ORGANIZATION_ID, taskRecord.version, taskRecord),
      { ...createDocument('task_deleted', ORGANIZATION_ID, 1, { ...taskRecord, id: 'task_deleted', version: 1 }), deletedAt: '2026-09-16T00:00:00.000Z' },
      createDocument('task_other', 'org_other', 1, { ...taskRecord, id: 'task_other', organizationId: 'org_other', version: 1 }),
    ],
    [TASK_CORE_COLLECTIONS.assignments]: [createDocument(
      assignmentByIdDocumentId(ORGANIZATION_ID, assignmentRecord.id),
      ORGANIZATION_ID,
      assignmentRecord.version,
      assignmentRecord,
    )],
    [TASK_CORE_COLLECTIONS.submissions]: [
      createDocument(submissionByIdDocumentId(ORGANIZATION_ID, submitted.id), ORGANIZATION_ID, 1, submitted),
      createDocument(submissionByIdDocumentId(ORGANIZATION_ID, draft.id), ORGANIZATION_ID, 2, draft),
    ],
    [TASK_CORE_COLLECTIONS.feedback]: [createDocument(
      feedbackDocumentId(ORGANIZATION_ID, submitted.id), ORGANIZATION_ID, 1, feedbackRecord,
    )],
    [TASK_CORE_COLLECTIONS.resources]: [
      createDocument(resource.id, ORGANIZATION_ID, 1, resource),
      createDocument('resource_draft', ORGANIZATION_ID, 1, { ...resource, id: 'resource_draft', status: 'draft' }),
    ],
  });
}

function task(): TaskRecord {
  return {
    id: TASK_ID, organizationId: ORGANIZATION_ID, creatorTeacherId: TEACHER_ID, title: '虚构阅读任务',
    deliveryType: 'classroom', status: 'active', targetType: 'classes', targetClassIds: [CLASS_ID], targetStudentIds: [STUDENT_ID],
    startsAt: '2026-09-16T00:00:00.000+08:00', dueAt: '2026-09-16T20:00:00.000+08:00',
    latePolicy: { allowLate: true, lateDays: 7 }, description: '虚构说明', teacherNote: '教师私密备注', itemRefs: [],
    items: [{
      id: 'item_demo', resourceId: 'resource_demo', resourceVersion: 1, snapshotSchemaVersion: 1,
      resourceSnapshot: { title: '虚构绘本', type: 'reading', payload: { pageCount: 3 } },
      completionRule: { kind: 'reading_pages', requiredPageCount: 3 }, scoringRule: {}, order: 1,
    }],
    publishedAt: '2026-09-15T00:00:00.000+08:00', deadlineExtendedAt: null, visibility: 'visible',
    withdrawnAt: null, withdrawnBy: null, withdrawReason: null, recycledAt: null, recycledBy: null,
    recycleReason: null, recoverableUntil: null, version: 2,
  };
}

function assignment(): TaskAssignmentRecord {
  return {
    id: ASSIGNMENT_ID, organizationId: ORGANIZATION_ID, taskId: TASK_ID, studentId: STUDENT_ID, classId: CLASS_ID,
    status: 'in_progress', latestSubmissionId: SUBMISSION_ID, latestSubmissionVersion: 1, redoCount: 0,
    redoDueAt: null, isLate: false, submittedAt: '2026-09-16T01:00:00.000Z', reviewedAt: null, version: 3,
  };
}

function submission(): SubmissionRecord {
  return {
    id: SUBMISSION_ID, organizationId: ORGANIZATION_ID, taskId: TASK_ID, assignmentId: ASSIGNMENT_ID,
    studentId: STUDENT_ID, submissionVersion: 1, recordVersion: 1, status: 'submitted',
    answers: [{ itemId: 'item_demo', value: { kind: 'reading', completedPageCount: 3 } }],
    isLate: false, submittedAt: '2026-09-16T01:00:00.000Z', supersedesSubmissionId: null,
  };
}

function draftSubmission(): SubmissionRecord {
  return {
    ...submission(), id: DRAFT_ID, submissionVersion: 2, recordVersion: 2, status: 'draft',
    answers: [{ itemId: 'item_demo', value: { kind: 'reading', completedPageCount: 2 } }],
    submittedAt: null, supersedesSubmissionId: SUBMISSION_ID,
  };
}

function feedback(): ReviewFeedbackRecord {
  return {
    id: 'feedback_demo', organizationId: ORGANIZATION_ID, taskId: TASK_ID, assignmentId: ASSIGNMENT_ID,
    submissionId: SUBMISSION_ID, submissionVersion: 1, teacherId: TEACHER_ID, decision: 'approved', score: 92,
    textComment: '完成得很好。', returnReason: null, publishedAt: '2026-09-16T02:00:00.000Z', source: 'manual',
  };
}

function learningResource(): LearningResourceRecord {
  return {
    id: 'resource_demo', organizationId: ORGANIZATION_ID, title: '虚构绘本', type: 'reading', contentVersion: 1,
    status: 'published', visibility: 'classes', allowedClassIds: [CLASS_ID], payload: { pageCount: 3 },
  };
}

function parentIdentities(): InMemoryIdentityRepository {
  const link: ParentStudentLinkRecord = {
    _id: 'link_demo', organizationId: ORGANIZATION_ID, parentId: PARENT_ID, studentId: STUDENT_ID,
    status: 'active', version: 1, deletedAt: null, confirmedAt: '2026-09-16T00:00:00.000Z',
  };
  return new InMemoryIdentityRepository({
    organizations: [],
    users: [{
      _id: STUDENT_ID, organizationId: ORGANIZATION_ID, authorizationVersion: 1, displayName: '小宇', displayNameMasked: '小*',
      studentNumber: 'STU-DEMO', classId: CLASS_ID, className: '虚构三年级 2 班', status: 'active', version: 1, deletedAt: null,
    }],
    identities: [], roles: [], teacherGrants: [], parentLinks: [link],
  } satisfies AuthorizationFixture);
}
