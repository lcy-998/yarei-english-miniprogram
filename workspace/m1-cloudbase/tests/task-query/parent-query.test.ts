import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryIdentityRepository, type AuthorizationFixture } from '../../src/runtime/memory-ports';
import type { ParentStudentLinkRecord } from '../../src/runtime/records';
import type { ReviewFeedbackRecord, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import { ParentTaskQueryService } from '../../src/task-query/parent-service';

const ORGANIZATION_ID = 'org_demo';
const PARENT_ID = 'parent_demo';
const CHILD_ID = 'student_demo';

const parent: TrustedActorContext = {
  requestId: 'request_parent', sessionId: 'session_parent', actorUserId: PARENT_ID, actorRole: 'parent',
  organizationId: ORGANIZATION_ID, platformSubjectDigest: 'digest_parent', permissions: ['child.read'],
  scopeIds: [], authzVersion: 2,
};

function task(): TaskRecord {
  return {
    id: 'task_demo', organizationId: ORGANIZATION_ID, creatorTeacherId: 'teacher_demo', title: '虚构阅读任务',
    deliveryType: 'classroom', status: 'active', targetType: 'students', targetClassIds: ['class_demo'], targetStudentIds: [CHILD_ID],
    startsAt: '2026-09-15T00:00:00.000Z', dueAt: '2026-09-18T00:00:00.000Z', latePolicy: { allowLate: true, lateDays: 7 },
    description: '学生可见说明', teacherNote: '家长不可见备注', itemRefs: [], items: [], publishedAt: '2026-09-15T00:00:00.000Z',
    deadlineExtendedAt: null, visibility: 'visible', withdrawnAt: null, withdrawnBy: null, withdrawReason: null,
    recycledAt: null, recycledBy: null, recycleReason: null, recoverableUntil: null, version: 2,
  };
}

function assignment(): TaskAssignmentRecord {
  return {
    id: 'assignment_demo', organizationId: ORGANIZATION_ID, taskId: 'task_demo', studentId: CHILD_ID, classId: 'class_demo',
    status: 'completed', latestSubmissionId: 'submission_demo', latestSubmissionVersion: 1, redoCount: 0, redoDueAt: null,
    isLate: false, submittedAt: '2026-09-16T01:00:00.000Z', reviewedAt: '2026-09-16T02:00:00.000Z', version: 3,
  };
}

function submission(): SubmissionRecord {
  return {
    id: 'submission_demo', organizationId: ORGANIZATION_ID, taskId: 'task_demo', assignmentId: 'assignment_demo', studentId: CHILD_ID,
    submissionVersion: 1, recordVersion: 1, status: 'reviewed', answers: [{ itemId: 'item_demo', value: '虚构作答' }],
    isLate: false, submittedAt: '2026-09-16T01:00:00.000Z', supersedesSubmissionId: null,
  };
}

function draftSubmission(): SubmissionRecord {
  return {
    ...submission(), id: 'submission_private_draft', submissionVersion: 2, recordVersion: 3, status: 'draft',
    answers: [{ itemId: 'item_demo', value: '未提交的家长不可见草稿' }], submittedAt: null,
    supersedesSubmissionId: 'submission_demo',
  };
}

function feedback(): ReviewFeedbackRecord {
  return {
    id: 'feedback_demo', organizationId: ORGANIZATION_ID, taskId: 'task_demo', assignmentId: 'assignment_demo',
    submissionId: 'submission_demo', submissionVersion: 1, teacherId: 'teacher_demo', decision: 'approved', score: 92,
    textComment: '完成得很好。', returnReason: null, publishedAt: '2026-09-16T02:00:00.000Z', source: 'manual',
  };
}

function harness() {
  const links: ParentStudentLinkRecord[] = [{
    _id: 'link_demo', organizationId: ORGANIZATION_ID, parentId: PARENT_ID, studentId: CHILD_ID,
    status: 'active', version: 1, deletedAt: null, confirmedAt: '2026-09-16T00:00:00.000Z',
  }];
  const identities = new InMemoryIdentityRepository({
    organizations: [],
    users: [{
      _id: CHILD_ID, organizationId: ORGANIZATION_ID, authorizationVersion: 1, displayName: '小宇', displayNameMasked: '小*',
      studentNumber: 'STU-DEMO-0032', classId: 'class_demo', className: '三年级 2 班',
      status: 'active', version: 1, deletedAt: null,
    }],
    identities: [], roles: [], teacherGrants: [], parentLinks: links,
  } satisfies AuthorizationFixture);
  const repository = new InMemoryTaskQueryRepository({
    tasks: [task()], assignments: [assignment()], submissions: [submission(), draftSubmission()], feedback: [feedback()],
  });
  let sequence = 0;
  const service = new ParentTaskQueryService({
    repository, identities, clock: { nowIso: () => '2026-09-16T03:00:00.000Z' },
    requestIds: { next: () => `request_parent_query_${++sequence}` },
  });
  return { service, links };
}

describe('M1 家长只读查询', () => {
  it('只从可信家长身份列出当前有效关系的孩子安全视图', async () => {
    const { service, links } = harness();
    expect(await service.listChildren(parent)).toMatchObject({
      ok: true,
      data: [{
        linkId: 'link_demo', linkVersion: 1, childId: CHILD_ID, displayName: '小宇',
        studentNumber: 'STU-DEMO-0032', className: '三年级 2 班',
      }],
    });
    links[0] = { ...links[0], status: 'revoked', version: 2 };
    expect(await service.listChildren(parent)).toMatchObject({ ok: true, data: [] });
    expect(await service.listChildren({ ...parent, actorRole: 'student' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('首页、孩子任务、任务详情和反馈均返回安全视图并支持分页', async () => {
    const { service } = harness();
    expect(await service.getHome(parent, CHILD_ID)).toMatchObject({
      ok: true,
      data: {
        childId: CHILD_ID, pendingTaskCount: 0, completedTaskCount: 1,
        recentFeedback: [{ feedbackId: 'feedback_demo', taskId: 'task_demo', score: 92 }],
      },
    });
    const list = await service.listChildTasks(parent, CHILD_ID, { status: 'completed' }, { limit: 1 });
    expect(list).toMatchObject({ ok: true, data: { total: 1, items: [{ taskId: 'task_demo', feedbackId: 'feedback_demo' }], nextCursor: null } });
    const detail = await service.getParentTaskResult(parent, CHILD_ID, 'task_demo');
    expect(detail).toMatchObject({ ok: true, data: { taskId: 'task_demo', studentId: CHILD_ID, submission: { id: 'submission_demo' }, feedback: { id: 'feedback_demo' } } });
    const feedbackDetail = await service.getFeedback(parent, CHILD_ID, 'feedback_demo');
    expect(feedbackDetail).toMatchObject({
      ok: true,
      data: { childId: CHILD_ID, taskTitle: '虚构阅读任务', submission: { id: 'submission_demo' }, feedback: { score: 92 } },
    });
    for (const result of [list, detail, feedbackDetail]) {
      expect(JSON.stringify(result)).not.toContain('家长不可见备注');
      expect(JSON.stringify(result)).not.toContain('teacher_demo');
      expect(JSON.stringify(result)).not.toContain('未提交的家长不可见草稿');
      expect(JSON.stringify(result)).not.toContain('submission_private_draft');
    }
  });

  it('每次请求重新校验 active parent link，解绑后首页、列表、详情和反馈立即统一失权', async () => {
    const { service, links } = harness();
    expect(await service.getHome(parent, CHILD_ID)).toMatchObject({ ok: true });
    links[0] = { ...links[0], status: 'revoked', version: 2 };
    expect(await service.getHome(parent, CHILD_ID)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.listChildTasks(parent, CHILD_ID, {}, { limit: 10 })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.getParentTaskResult(parent, CHILD_ID, 'task_demo')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.getFeedback(parent, CHILD_ID, 'feedback_demo')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('每个家长查询入口均实时要求 child.read，角色存在但业务权限撤销后立即拒绝', async () => {
    const { service } = harness();
    const revoked = { ...parent, permissions: [] };

    expect(await service.listChildren(revoked)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await service.getHome(revoked, CHILD_ID)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.listChildTasks(revoked, CHILD_ID, {}, { limit: 10 })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.getParentTaskResult(revoked, CHILD_ID, 'task_demo')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.getFeedback(revoked, CHILD_ID, 'feedback_demo')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});
