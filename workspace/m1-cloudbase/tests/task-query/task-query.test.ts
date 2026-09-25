import { describe, expect, it, vi } from 'vitest';
import { createReviewQueryFunction, main as unconfiguredReviewQuery } from '../../functions/review-query';
import { createStudentTaskQueryFunction, main as unconfiguredStudentTaskQuery } from '../../functions/student-task-query';
import { createTaskQueryFunction, main as unconfiguredTaskQuery } from '../../functions/task-query';
import type { TrustedActorContext, TrustedActorResolver } from '../../src/auth/trusted-actor';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import type { JsonObject, ResponseMeta, ServiceResult } from '../../src/shared/protocol';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import { InMemoryOpaqueCursorCodec, ReviewQueryService, StudentTaskQueryService, TeacherTaskQueryService } from '../../src/task-query/service';
import type { CursorCodec, QueryTeacherGrantRecord } from '../../src/task-query/types';
import type { SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';

const clock = { nowIso: (): string => '2026-09-16T02:00:00.000Z' };
let requestSequence = 0;
const requestIds = { next: (): string => `req_query_${++requestSequence}` };

const teacher: TrustedActorContext = {
  requestId: 'req_teacher', sessionId: 'session_teacher', actorUserId: 'teacher_lin', actorRole: 'teacher',
  organizationId: 'org_demo', platformSubjectDigest: 'digest_teacher',
  permissions: ['task.read', 'task.publish', 'submission.review'], scopeIds: ['class_a', 'class_b'], authzVersion: 3,
};
const studentA: TrustedActorContext = {
  ...teacher, requestId: 'req_student_a', sessionId: 'session_student_a', actorUserId: 'student_a', actorRole: 'student',
  permissions: [], scopeIds: [],
};

const grants: QueryTeacherGrantRecord[] = [
  { id: 'grant_a', organizationId: 'org_demo', teacherId: 'teacher_lin', classId: 'class_a', className: '虚构三年级 2 班', permissions: ['task.read', 'task.publish', 'submission.review'], status: 'active' },
  { id: 'grant_b', organizationId: 'org_demo', teacherId: 'teacher_other', classId: 'class_b', className: '虚构四年级 1 班', permissions: ['task.read', 'task.publish', 'submission.review'], status: 'active' },
];

function task(id: string, classId: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id, organizationId: 'org_demo', creatorTeacherId: 'teacher_lin', title: `虚构任务 ${id}`, deliveryType: 'classroom',
    status: 'active', targetType: 'classes', targetClassIds: [classId], targetStudentIds: [],
    startsAt: '2026-09-16T00:00:00.000+08:00', dueAt: '2026-09-16T20:00:00.000+08:00',
    latePolicy: { allowLate: true, lateDays: 7 }, description: '虚构说明', teacherNote: '教师私密备注不得返回', itemRefs: [],
    items: [{ id: `item_${id}`, resourceId: 'resource_reading', resourceVersion: 2, snapshotSchemaVersion: 1, resourceSnapshot: { title: '虚构绘本', type: 'reading', payload: { pages: 3 } }, completionRule: { kind: 'reading', requiredPageCount: 3 }, scoringRule: {}, order: 1 }],
    publishedAt: '2026-09-15T00:00:00.000+08:00', version: 2, ...overrides,
  };
}

function assignment(id: string, taskId: string, studentId: string, classId: string, status: TaskAssignmentRecord['status'], submissionId: string | null): TaskAssignmentRecord {
  return {
    id, organizationId: 'org_demo', taskId, studentId, classId, status, latestSubmissionId: submissionId,
    latestSubmissionVersion: submissionId === null ? 0 : 1, redoCount: 0, redoDueAt: null, isLate: false,
    submittedAt: submissionId === null ? null : '2026-09-16T01:00:00.000Z', reviewedAt: null, version: 1,
  };
}

function submission(id: string, assignmentId: string, taskId: string, studentId: string): SubmissionRecord {
  return {
    id, organizationId: 'org_demo', taskId, assignmentId, studentId, submissionVersion: 1, recordVersion: 1,
    status: 'submitted', answers: [{ itemId: `item_${taskId}`, value: { kind: 'reading', completedPageCount: 3 } }],
    isLate: false, submittedAt: '2026-09-16T01:00:00.000Z', supersedesSubmissionId: null,
  };
}

function fixture() {
  return new InMemoryTaskQueryRepository({
    teacherGrants: grants,
    resources: [
      { id: 'resource_reading', organizationId: 'org_demo', title: '虚构绘本', type: 'reading', status: 'published', allowedClassIds: ['class_a'] },
      { id: 'resource_hidden', organizationId: 'org_demo', title: '他班资源', type: 'exercise', status: 'published', allowedClassIds: ['class_b'] },
    ],
    tasks: [task('task_a', 'class_a'), task('task_b', 'class_b')],
    assignments: [
      assignment('assign_a1', 'task_a', 'student_a', 'class_a', 'awaiting_review', 'submission_a1'),
      assignment('assign_a2', 'task_a', 'student_a2', 'class_a', 'not_started', null),
      assignment('assign_b1', 'task_b', 'student_b', 'class_b', 'awaiting_review', 'submission_b1'),
    ],
    submissions: [submission('submission_a1', 'assign_a1', 'task_a', 'student_a'), submission('submission_b1', 'assign_b1', 'task_b', 'student_b')],
    feedback: [],
  });
}

describe('M1 本地只读任务查询', () => {
  it('教师工作台、任务列表和完成情况只聚合当前授权班级且统计一致', async () => {
    const service = new TeacherTaskQueryService({ repository: fixture(), clock, requestIds });
    const workbench = await service.getTeacherWorkbench(teacher, '2026-09-16');
    expect(workbench).toMatchObject({ ok: true, data: { classIds: ['class_a'], activeTaskCount: 1, pendingReviewCount: 1, pendingCommentCount: 1 } });
    const list = await service.listTeacherTasks(teacher, {}, { limit: 10 });
    expect(list).toMatchObject({ ok: true, data: { total: 1, items: [{ taskId: 'task_a', completedCount: 1, totalCount: 2, pendingReviewCount: 1, classIds: ['class_a'] }] } });
    expect(JSON.stringify(list)).not.toContain('教师私密备注');
    expect(JSON.stringify(list)).not.toContain('student_b');
    const completion = await service.getCompletion(teacher, 'task_a', {}, { limit: 10 });
    expect(completion).toMatchObject({
      ok: true,
      data: {
        task: { completedCount: 1, totalCount: 2, pendingReviewCount: 1 },
        counts: { awaiting_review: 1, not_started: 1 },
        assignments: { total: 2 },
      },
    });
  });

  it('草稿选项为授权资源提供可直接发布的三类完成阈值与评分规则', async () => {
    const service = new TeacherTaskQueryService({ repository: fixture(), clock, requestIds });
    const options = await service.getDraftOptions(teacher);
    expect(options).toMatchObject({
      ok: true,
      data: {
        classes: [{ id: 'class_a' }],
        resources: [{
          id: 'resource_reading',
          completionRule: { kind: 'reading_pages', requiredPageCount: 1 },
          scoringRule: { kind: 'manual', maxScore: 100 },
        }],
      },
    });
  });

  it('编辑详情仅向任务创建者返回原始配置与版本', async () => {
    const service = new TeacherTaskQueryService({ repository: fixture(), clock, requestIds });
    expect(await service.getTaskForEdit(teacher, 'task_a')).toMatchObject({
      ok: true, data: { taskId: 'task_a', version: 2, teacherNote: '教师私密备注不得返回', target: { type: 'classes', classIds: ['class_a'] } },
    });
    expect(await service.getTaskForEdit(teacher, 'task_b')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('未授权筛选只能收窄为空，分页游标不能跨筛选或授权版本复用', async () => {
    let cursorSequence = 0;
    const cursorCodec = new InMemoryOpaqueCursorCodec({ next: () => `test_cursor_${++cursorSequence}` });
    const repository = fixture();
    repository.replaceTeacherGrant({ ...grants[0], id: 'grant_a_teacher_alt', teacherId: 'teacher_alt' });
    const service = new TeacherTaskQueryService({ repository, clock, requestIds, cursorCodec });
    const hidden = await service.listTeacherTasks(teacher, { classId: 'class_b' }, { limit: 10 });
    expect(hidden).toMatchObject({ ok: true, data: { total: 0, items: [] } });
    const first = await service.getCompletion(teacher, 'task_a', {}, { limit: 1 });
    if (!first.ok) throw new Error('expected page');
    expect(first.data.assignments.nextCursor).toEqual(expect.any(String));
    const changedFilter = await service.getCompletion(teacher, 'task_a', { status: 'not_started' }, { limit: 1, cursor: first.data.assignments.nextCursor as string });
    expect(changedFilter).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const changedAuthz = await service.getCompletion({ ...teacher, authzVersion: 4 }, 'task_a', {}, { limit: 1, cursor: first.data.assignments.nextCursor as string });
    expect(changedAuthz).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const crossActor = await service.getCompletion({ ...teacher, actorUserId: 'teacher_alt' }, 'task_a', {}, { limit: 1, cursor: first.data.assignments.nextCursor as string });
    expect(crossActor).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const tampered = await service.getCompletion(teacher, 'task_a', {}, { limit: 1, cursor: `${first.data.assignments.nextCursor as string}_2` });
    expect(tampered).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('完成情况筛选班级后列表、分组统计和任务摘要使用完全相同的范围', async () => {
    const repository = new InMemoryTaskQueryRepository({
      teacherGrants: [
        grants[0],
        { ...grants[1], id: 'grant_b_teacher_lin', teacherId: 'teacher_lin' },
      ],
      tasks: [task('task_multi', 'class_a', { targetClassIds: ['class_a', 'class_b'] })],
      assignments: [
        assignment('assign_multi_a', 'task_multi', 'student_a', 'class_a', 'awaiting_review', 'submission_multi_a'),
        assignment('assign_multi_b', 'task_multi', 'student_b', 'class_b', 'not_started', null),
      ],
      submissions: [submission('submission_multi_a', 'assign_multi_a', 'task_multi', 'student_a')],
    });
    const service = new TeacherTaskQueryService({ repository, clock, requestIds });
    const result = await service.getCompletion(teacher, 'task_multi', { classId: 'class_a' }, { limit: 10 });
    expect(result).toMatchObject({
      ok: true,
      data: {
        task: { classIds: ['class_a'], completedCount: 1, totalCount: 1, pendingReviewCount: 1 },
        counts: { awaiting_review: 1, not_started: 0 },
        assignments: { total: 1, items: [{ classId: 'class_a' }] },
      },
    });
  });

  it('每次查询重新读取 grant，撤权后历史创建者也立即失去任务和提交访问', async () => {
    const repository = fixture();
    const teacherService = new TeacherTaskQueryService({ repository, clock, requestIds });
    const reviewService = new ReviewQueryService({ repository, clock, requestIds });
    expect(await teacherService.getCompletion(teacher, 'task_a', {}, { limit: 10 })).toMatchObject({ ok: true });
    expect(await reviewService.getSubmissionForReview(teacher, 'submission_a1')).toMatchObject({ ok: true });
    repository.replaceTeacherGrant({ ...grants[0], status: 'revoked' });
    expect(await teacherService.getCompletion(teacher, 'task_a', {}, { limit: 10 })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await reviewService.getSubmissionForReview(teacher, 'submission_a1')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('学生首页、列表和详情只读取本人 assignment，并且安全模型不含教师备注或他人数据', async () => {
    const service = new StudentTaskQueryService({ repository: fixture(), clock, requestIds });
    expect(await service.getHome(studentA, '2026-09-16')).toMatchObject({ ok: true, data: { completedCount: 1, totalCount: 1, nextTask: null } });
    const list = await service.listMyTasks(studentA, {}, { limit: 10 });
    expect(list).toMatchObject({ ok: true, data: { total: 1, items: [{ taskId: 'task_a', status: 'awaiting_review' }] } });
    const detail = await service.getMyTask(studentA, 'task_a');
    expect(detail).toMatchObject({ ok: true, data: { taskId: 'task_a', submission: { id: 'submission_a1' }, submissionHistory: [{ version: 1, status: 'submitted' }] } });
    expect(JSON.stringify(detail)).not.toContain('teacherNote');
    expect(JSON.stringify(detail)).not.toContain('student_a2');
    expect(await service.getMyTask(studentA, 'task_b')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.listMyTasks({ ...studentA, actorRole: 'parent' }, {}, { limit: 10 })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('历史任务快照缺少资源标识时从已发布的引用恢复学生阅读入口', async () => {
    const legacy = task('task_legacy', 'class_a');
    const repository = new InMemoryTaskQueryRepository({
      teacherGrants: grants,
      resources: [],
      tasks: [{ ...legacy, itemRefs: [{ id: 'item_task_legacy', resourceId: 'resource_reading', order: 1 }],
        items: legacy.items.map(({ resourceId: _resourceId, ...item }) => item as TaskRecord['items'][number]) }],
      assignments: [assignment('assign_legacy', 'task_legacy', 'student_a', 'class_a', 'not_started', null)],
      submissions: [], feedback: [],
    });
    const service = new StudentTaskQueryService({ repository, clock, requestIds });
    expect(await service.getMyTask(studentA, 'task_legacy')).toMatchObject({ ok: true, data: { items: [{ resourceId: 'resource_reading' }] } });
  });

  it('学生详情优先恢复当前 assignment 下一版本草稿，且教师点评入口和其他学生均不可见', async () => {
    const currentAssignment = assignment('assign_draft', 'task_draft', 'student_a', 'class_a', 'in_progress', 'submission_previous');
    const repository = new InMemoryTaskQueryRepository({
      teacherGrants: grants,
      tasks: [task('task_draft', 'class_a')],
      assignments: [currentAssignment],
      submissions: [
        submission('submission_previous', 'assign_draft', 'task_draft', 'student_a'),
        {
          ...submission('submission_draft', 'assign_draft', 'task_draft', 'student_a'),
          submissionVersion: 2,
          recordVersion: 4,
          status: 'draft',
          answers: [{ itemId: 'item_task_draft', value: { kind: 'reading', completedPageCount: 2 } }],
          submittedAt: null,
          supersedesSubmissionId: 'submission_previous',
        },
      ],
    });
    const studentService = new StudentTaskQueryService({ repository, clock, requestIds });
    const detail = await studentService.getMyTask(studentA, 'task_draft');
    expect(detail).toMatchObject({
      ok: true,
      data: {
        assignment: { version: 1 },
        submission: {
          id: 'submission_draft', version: 2, status: 'draft', recordVersion: 4, assignmentVersion: 1,
          answers: [{ itemId: 'item_task_draft', value: { completedPageCount: 2 } }],
        },
        feedback: null,
      },
    });
    expect(await studentService.getMyTask({ ...studentA, actorUserId: 'student_a2' }, 'task_draft')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    const reviewService = new ReviewQueryService({ repository, clock, requestIds });
    expect(await reviewService.getSubmissionForReview(teacher, 'submission_draft')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('空状态稳定返回零统计；点评查询和批量预览逐条排除越权或不合格提交', async () => {
    const empty = new StudentTaskQueryService({ repository: new InMemoryTaskQueryRepository({}), clock, requestIds });
    expect(await empty.getHome(studentA, '2026-09-16')).toMatchObject({ ok: true, data: { completedCount: 0, totalCount: 0, nextTask: null } });

    const service = new ReviewQueryService({ repository: fixture(), clock, requestIds });
    expect(await service.listReviewTasks(teacher, { status: 'pending' }, { limit: 10 })).toMatchObject({ ok: true, data: { total: 1, items: [{ taskId: 'task_a', pendingReviewCount: 1 }] } });
    const detail = await service.getSubmissionForReview(teacher, 'submission_a1');
    expect(detail).toMatchObject({ ok: true, data: { submissionId: 'submission_a1', classId: 'class_a' } });
    expect(JSON.stringify(detail)).not.toContain('教师私密备注');
    expect(await service.getSubmissionForReview(teacher, 'submission_b1')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    const preview = await service.previewBatchComment(
      teacher, 'task_a', {}, { mode: 'ids', submissionIds: ['submission_a1', 'submission_b1', 'missing_submission'] }, '继续保持',
    );
    expect(preview).toMatchObject({ ok: true, data: { eligibleCount: 1, excludedCount: 2, commentSummary: { length: 4 } } });
    expect(JSON.stringify(preview)).not.toContain('继续保持');
  });

  it('批量点评令牌绑定完整规范化意图、实际 eligible 集合及授权和任务版本', async () => {
    const codec = new RecordingCursorCodec();
    const service = new ReviewQueryService({ repository: fixture(), clock, requestIds, cursorCodec: codec });
    const first = await service.previewBatchComment(
      teacher, 'task_a', { classId: 'class_a' }, { mode: 'ids', submissionIds: ['submission_a1'] }, '表现很好',
    );
    const second = await service.previewBatchComment(
      teacher, 'task_a', { classId: 'class_a' }, { mode: 'ids', submissionIds: ['submission_a1'] }, '继续努力',
    );
    if (!first.ok || !second.ok) throw new Error('expected batch previews');
    expect(first.data.previewToken).not.toBe(second.data.previewToken);
    const firstPayload = codec.decode(first.data.previewToken);
    const secondPayload = codec.decode(second.data.previewToken);
    expect(firstPayload).toContain('表现很好');
    expect(secondPayload).toContain('继续努力');
    expect(firstPayload).toContain('submission_a1');
    expect(firstPayload).toContain('class_a');
    expect(firstPayload).toContain('teacher_lin');
    expect(firstPayload).toContain('"authzVersion":3');
    expect(firstPayload).toContain('"version":2');
  });
});

class RecordingCursorCodec implements CursorCodec {
  private readonly values = new Map<string, string>();
  private sequence = 0;

  public encode(payload: string): string {
    const token = `recorded_${++this.sequence}`;
    this.values.set(token, payload);
    return token;
  }

  public decode(token: string): string | null {
    return this.values.get(token) ?? null;
  }
}

function responseMeta(): ResponseMeta {
  return { requestId: 'req_handler', serverTime: clock.nowIso(), apiVersion: 'm1.v1' };
}

function ok(data: JsonObject): ServiceResult<JsonObject> {
  return { ok: true, data, meta: responseMeta() };
}

function boundary(functionName: CloudBaseRuntimePort['functionName'], actor: TrustedActorContext) {
  const runtime: CloudBaseRuntimePort = {
    functionName,
    getPlatformSubject: vi.fn(async () => ({ subject: 'subject', loginType: 'USERNAME' as const, isAuthenticated: true })),
    getBusinessSessionId: vi.fn(async () => 'session_trusted'),
  };
  const actorResolver: TrustedActorResolver = { resolve: vi.fn(async () => actor) };
  return { runtime, actorResolver, clock, requestIds };
}

describe('M1 只读查询函数边界', () => {
  it('严格分发三组查询动作并拒绝未知嵌套字段、伪造身份与查询 operationId', async () => {
    const taskHandler = {
      getTeacherWorkbench: vi.fn(async () => ok({ action: 'workbench' })),
      listTeacherTasks: vi.fn(async () => ok({ action: 'tasks' })),
      getDraftOptions: vi.fn(async () => ok({ action: 'options' })),
      previewTask: vi.fn(async () => ok({ action: 'preview' })),
      getTaskForEdit: vi.fn(async () => ok({ action: 'edit' })),
      getCompletion: vi.fn(async () => ok({ action: 'completion' })),
    };
    const taskMain = createTaskQueryFunction({ ...boundary('task-query', teacher), handler: taskHandler });
    expect(await taskMain({ apiVersion: 'm1.v1', action: 'getTeacherWorkbench', payload: { date: '2026-09-16' } })).toMatchObject({ ok: true, data: { action: 'workbench' } });
    expect(taskHandler.getTeacherWorkbench).toHaveBeenCalledWith(teacher, '2026-09-16', undefined);
    expect(await taskMain({ apiVersion: 'm1.v1', action: 'getTaskForEdit', payload: { taskId: 'task_a' } })).toMatchObject({ ok: true, data: { action: 'edit' } });
    expect(taskHandler.getTaskForEdit).toHaveBeenCalledWith(teacher, 'task_a');
    expect(await taskMain({ apiVersion: 'm1.v1', action: 'listTeacherTasks', payload: { filters: { classId: 'class_a', actorRole: 'admin' }, page: { limit: 20 } } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { 'filters.actorRole': expect.any(String) } } });
    expect(await taskMain({ apiVersion: 'm1.v1', action: 'getDraftOptions', payload: { organizationId: 'org_other' } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await taskMain({ apiVersion: 'm1.v1', action: 'getDraftOptions', payload: {}, operationId: 'operation_query_0001' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { operationId: expect.any(String) } } });

    const studentHandler = { getHome: vi.fn(async () => ok({ action: 'home' })), listMyTasks: vi.fn(async () => ok({ action: 'mine' })), getMyTask: vi.fn(async () => ok({ action: 'detail' })) };
    const studentMain = createStudentTaskQueryFunction({ ...boundary('student-task-query', studentA), handler: studentHandler });
    expect(await studentMain({ apiVersion: 'm1.v1', action: 'getMyTask', payload: { taskId: 'task_a' } })).toMatchObject({ ok: true, data: { action: 'detail' } });

    const reviewHandler = { listReviewTasks: vi.fn(async () => ok({ action: 'list' })), getSubmissionForReview: vi.fn(async () => ok({ action: 'submission' })), previewBatchComment: vi.fn(async () => ok({ action: 'batch' })) };
    const reviewMain = createReviewQueryFunction({ ...boundary('review-query', teacher), handler: reviewHandler });
    expect(await reviewMain({ apiVersion: 'm1.v1', action: 'previewBatchComment', payload: { taskId: 'task_a', filter: {}, selection: { mode: 'ids', submissionIds: ['submission_a1'], studentId: 'student_b' }, comment: '虚构点评' } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { 'selection.studentId': expect.any(String) } } });
    expect(reviewHandler.previewBatchComment).not.toHaveBeenCalled();
  });

  it('默认 main 保持未配置状态', async () => {
    expect(await unconfiguredTaskQuery({ apiVersion: 'm1.v1', action: 'getDraftOptions', payload: {} })).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredStudentTaskQuery({ apiVersion: 'm1.v1', action: 'getHome', payload: { localDate: '2026-09-16' } })).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredReviewQuery({ apiVersion: 'm1.v1', action: 'getSubmissionForReview', payload: { submissionId: 'submission_a1' } })).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredTaskQuery({ apiVersion: 'm1.v1', action: 'getDraftOptions', payload: { actorRole: 'admin' } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await unconfiguredStudentTaskQuery({ apiVersion: 'm1.v1', action: 'getHome', payload: { localDate: '2026-02-31' } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { localDate: expect.any(String) } } });
    expect(await unconfiguredReviewQuery({ apiVersion: 'm1.v1', action: 'previewBatchComment', payload: { taskId: 'task_a', filter: {}, selection: { mode: 'ids', submissionIds: [] }, comment: '虚构点评' } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
