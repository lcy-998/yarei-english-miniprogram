import { describe, expect, it, vi } from 'vitest';
import { createTeacherStudentQueryFunction, main as unconfiguredTeacherStudents } from '../../functions/teacher-student-query';
import type { TrustedActorContext, TrustedActorResolver } from '../../src/auth/trusted-actor';
import { InMemoryOrgContentRepository } from '../../src/org-content/in-memory-repository';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import { NodeHmacCodec } from '../../src/runtime/node-crypto-capabilities';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import { TeacherStudentQueryService } from '../../src/teacher-students/service';
import type { TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';

const clock = { nowIso: (): string => '2026-09-16T08:00:00.000+08:00' };
let requestSequence = 0;
const requestIds = { next: (): string => `req_teacher_student_${++requestSequence}` };
const cursorCodec = new NodeHmacCodec('OT8k4PnWA7uAhuYjuwKZ-YRTScyXBqT-TrY8lajrQFo', 'teacher-student-test');

const teacher: TrustedActorContext = {
  requestId: 'req_teacher',
  sessionId: 'session_teacher',
  actorUserId: 'teacher_lin',
  actorRole: 'teacher',
  organizationId: 'org_demo',
  platformSubjectDigest: 'digest_teacher',
  permissions: ['student.read'],
  scopeIds: ['class_a', 'class_b'],
  authzVersion: 3,
};

function task(id: string, classId: string): TaskRecord {
  return {
    id, organizationId: 'org_demo', creatorTeacherId: 'teacher_lin', title: `虚构任务 ${id}`,
    deliveryType: 'classroom', status: 'active', targetType: 'classes', targetClassIds: [classId], targetStudentIds: [],
    startsAt: '2026-09-16T08:00:00.000+08:00', dueAt: '2026-09-16T20:00:00.000+08:00',
    latePolicy: { allowLate: true, lateDays: 7 }, description: '虚构说明', teacherNote: '不得返回的教师备注',
    itemRefs: [], items: [], publishedAt: '2026-09-16T08:00:00.000+08:00', version: 1,
  };
}

function assignment(id: string, taskId: string, studentId: string, classId: string, status: TaskAssignmentRecord['status'], submissionId: string | null): TaskAssignmentRecord {
  return {
    id, organizationId: 'org_demo', taskId, studentId, classId, status,
    latestSubmissionId: submissionId, latestSubmissionVersion: submissionId === null ? 0 : 1,
    redoCount: status === 'redo_required' ? 1 : 0, redoDueAt: null, isLate: status === 'overdue',
    submittedAt: submissionId === null ? null : '2026-09-16T10:00:00.000+08:00', reviewedAt: null, version: 1,
  };
}

function fixtures() {
  const organizations = new InMemoryOrgContentRepository({
    organizations: [{ id: 'org_demo', name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1 }],
    classes: [
      { id: 'class_a', organizationId: 'org_demo', name: '三年级 2 班', grade: '三年级', term: '上学期', status: 'active', version: 1 },
      { id: 'class_b', organizationId: 'org_demo', name: '四年级 1 班', grade: '四年级', term: '上学期', status: 'active', version: 1 },
    ],
    users: [
      { id: 'student_a', organizationId: 'org_demo', authorizationVersion: 1, displayName: '小宇', displayNameMasked: '小*', mobileMasked: '138****1001', studentNumber: '0321', roles: ['student'], status: 'active', version: 1 },
      { id: 'student_b', organizationId: 'org_demo', authorizationVersion: 1, displayName: '林可', displayNameMasked: '林*', mobileMasked: '138****1002', studentNumber: '0318', roles: ['student'], status: 'active', version: 1 },
      { id: 'student_hidden', organizationId: 'org_demo', authorizationVersion: 1, displayName: '他班学生', displayNameMasked: '他**', studentNumber: '0401', roles: ['student'], status: 'active', version: 1 },
      { id: 'parent_a', organizationId: 'org_demo', authorizationVersion: 1, displayName: '小宇家长', displayNameMasked: '小***', mobileMasked: '138****2046', roles: ['parent'], status: 'active', version: 1 },
    ],
    memberships: [
      { id: 'membership_a', organizationId: 'org_demo', classId: 'class_a', studentId: 'student_a', status: 'active', version: 1 },
      { id: 'membership_b', organizationId: 'org_demo', classId: 'class_a', studentId: 'student_b', status: 'active', version: 1 },
      { id: 'membership_hidden', organizationId: 'org_demo', classId: 'class_b', studentId: 'student_hidden', status: 'active', version: 1 },
    ],
    teacherGrants: [
      { id: 'grant_a', organizationId: 'org_demo', teacherId: 'teacher_lin', classId: 'class_a', permissions: ['student.read'], status: 'active', grantedBy: 'admin', grantedAt: clock.nowIso(), version: 1 },
      { id: 'grant_b_other', organizationId: 'org_demo', teacherId: 'teacher_other', classId: 'class_b', permissions: ['student.read'], status: 'active', grantedBy: 'admin', grantedAt: clock.nowIso(), version: 1 },
    ],
    parentLinks: [{ id: 'link_a', organizationId: 'org_demo', parentId: 'parent_a', studentId: 'student_a', status: 'active', confirmedBy: 'admin', confirmedAt: clock.nowIso(), confirmationSource: 'binding_code', version: 1 }],
  });
  const tasks = new InMemoryTaskQueryRepository({
    tasks: [task('task_1', 'class_a'), task('task_2', 'class_a'), task('task_hidden', 'class_b')],
    assignments: [
      assignment('assignment_a1', 'task_1', 'student_a', 'class_a', 'completed', 'submission_a1'),
      assignment('assignment_a2', 'task_2', 'student_a', 'class_a', 'overdue', null),
      assignment('assignment_b1', 'task_1', 'student_b', 'class_a', 'awaiting_review', 'submission_b1'),
      assignment('assignment_hidden', 'task_hidden', 'student_hidden', 'class_b', 'completed', 'submission_hidden'),
    ],
    feedback: [{ id: 'feedback_a1', organizationId: 'org_demo', assignmentId: 'assignment_a1', submissionId: 'submission_a1', submissionVersion: 1, teacherId: 'teacher_lin', decision: 'approved', score: 86, textComment: '虚构点评', returnReason: null, aiAssisted: false, publishedAt: clock.nowIso(), version: 1 }],
  });
  return { organizations, tasks };
}

describe('M1 教师学员目录查询', () => {
  it('列表只返回当前有效授权班级，并提供一致的轻量任务表现', async () => {
    const { organizations, tasks } = fixtures();
    const service = new TeacherStudentQueryService({ organizationRepository: organizations, taskRepository: tasks, clock, requestIds, cursorCodec });
    const result = await service.listStudents(teacher, { status: 'all' }, { limit: 20 });
    expect(result).toMatchObject({
      ok: true,
      data: {
        classes: [{ id: 'class_a', name: '三年级 2 班' }],
        total: 2,
        items: [
          { studentId: 'student_b', performance: { assignedCount: 1, completedCount: 1, completionRate: 100 } },
          { studentId: 'student_a', needsAttention: true, performance: { assignedCount: 2, completedCount: 1, overdueCount: 1, completionRate: 50, averageScore: 86 } },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('student_hidden');
    expect(JSON.stringify(result)).not.toContain('138****1001');
    expect(JSON.stringify(result)).not.toContain('不得返回的教师备注');
  });

  it('发布对象的 active 筛选排除停用学员，仍包含需跟进的有效学员', async () => {
    const { organizations, tasks } = fixtures();
    await organizations.transaction(async transaction => {
      const user = await transaction.findUser('org_demo', 'student_b');
      const membership = await transaction.findMembership('org_demo', 'student_b', 'class_a');
      if (!user || !membership) throw new Error('missing fixture');
      await transaction.saveUser({ ...user, status: 'disabled', version: user.version + 1 });
      await transaction.saveMembership({ ...membership, status: 'inactive', version: membership.version + 1 });
    });
    const service = new TeacherStudentQueryService({ organizationRepository: organizations, taskRepository: tasks, clock, requestIds, cursorCodec });
    const findUser = vi.spyOn(organizations, 'findUser');
    const active = await service.listStudents(teacher, { status: 'active' }, { limit: 20 });
    expect(active).toMatchObject({ ok: true, data: { total: 1, items: [{ studentId: 'student_a', needsAttention: true }] } });
    expect(findUser).not.toHaveBeenCalled();
    expect(await service.listStudents(teacher, { status: 'disabled' }, { limit: 20 }))
      .toMatchObject({ ok: true, data: { total: 1, items: [{ studentId: 'student_b' }] } });
  });

  it('详情只向当前授权教师返回脱敏家长摘要和安全任务记录', async () => {
    const { organizations, tasks } = fixtures();
    const service = new TeacherStudentQueryService({ organizationRepository: organizations, taskRepository: tasks, clock, requestIds, cursorCodec });
    const result = await service.getStudent(teacher, 'student_a');
    expect(result).toMatchObject({
      ok: true,
      data: {
        studentId: 'student_a', displayName: '小宇', studentNumber: '0321',
        classInfo: { id: 'class_a' },
        parents: [{ displayNameMasked: '小***', mobileMasked: '138****2046' }],
        performance: { completionRate: 50, averageScore: 86 },
      },
    });
    if (!result.ok) throw new Error('expected student detail');
    expect(result.data).toMatchObject({ userVersion: expect.any(Number), membershipVersion: expect.any(Number), membershipVersions: { class_a: expect.any(Number) }, classInfo: { version: expect.any(Number) } });
    expect(result.data.recentTasks).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: 'task_1', score: 86 })]));
    expect(JSON.stringify(result)).not.toContain('parent_a');
    expect(await service.getStudent(teacher, 'student_hidden')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('每次请求重新读取 grant，撤权后列表和详情立即不可访问', async () => {
    const { organizations, tasks } = fixtures();
    const service = new TeacherStudentQueryService({ organizationRepository: organizations, taskRepository: tasks, clock, requestIds, cursorCodec });
    expect(await service.getStudent(teacher, 'student_a')).toMatchObject({ ok: true });
    await organizations.transaction(async (transaction) => {
      const grant = await transaction.findActiveTeacherGrant('org_demo', 'teacher_lin', 'class_a');
      if (grant === null) throw new Error('missing fixture grant');
      await transaction.saveTeacherGrant({ ...grant, status: 'revoked', revokedAt: clock.nowIso(), version: grant.version + 1 });
    });
    expect(await service.listStudents(teacher, { status: 'all' }, { limit: 20 })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await service.getStudent(teacher, 'student_a')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('搜索、待跟进筛选和自包含游标均绑定当前教师、实时授权与筛选意图', async () => {
    const { organizations, tasks } = fixtures();
    const service = new TeacherStudentQueryService({ organizationRepository: organizations, taskRepository: tasks, clock, requestIds, cursorCodec });
    const attention = await service.listStudents(teacher, { status: 'attention', keyword: '0321' }, { limit: 1 });
    expect(attention).toMatchObject({ ok: true, data: { total: 1, items: [{ studentId: 'student_a' }] } });
    const first = await service.listStudents(teacher, { status: 'all' }, { limit: 1 });
    if (!first.ok || first.data.nextCursor === null) throw new Error('expected cursor');
    const resumedAfterColdStart = new TeacherStudentQueryService({ organizationRepository: organizations, taskRepository: tasks, clock, requestIds, cursorCodec });
    expect(await resumedAfterColdStart.listStudents(teacher, { status: 'all' }, { limit: 1, cursor: first.data.nextCursor }))
      .toMatchObject({ ok: true, data: { items: [{ studentId: 'student_a' }], nextCursor: null } });
    expect(await service.listStudents(teacher, { status: 'normal' }, { limit: 1, cursor: first.data.nextCursor })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await service.listStudents({ ...teacher, authzVersion: 4 }, { status: 'all' }, { limit: 1, cursor: first.data.nextCursor })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await service.listStudents({ ...teacher, permissions: ['student.read', 'student.export'] }, { status: 'all' }, { limit: 1, cursor: first.data.nextCursor })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await service.listStudents({ ...teacher, actorUserId: 'teacher_other' }, { status: 'all' }, { limit: 1, cursor: first.data.nextCursor })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const tampered = `${first.data.nextCursor.slice(0, -1)}${first.data.nextCursor.endsWith('0') ? '1' : '0'}`;
    expect(await service.listStudents(teacher, { status: 'all' }, { limit: 1, cursor: tampered })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
});

describe('M1 教师学员查询函数边界', () => {
  const runtime: CloudBaseRuntimePort = {
    functionName: 'teacher-student-query',
    getPlatformSubject: vi.fn(async () => ({ subject: 'subject_teacher', loginType: 'USERNAME' as const, isAuthenticated: true })),
    getBusinessSessionId: vi.fn(async () => 'session_teacher'),
  };
  const actorResolver: TrustedActorResolver = { resolve: vi.fn(async () => teacher) };

  it('严格校验嵌套 schema，且身份只来自可信会话', async () => {
    const handler = {
      listStudents: vi.fn(async () => ({ ok: true as const, data: { classes: [], items: [], total: 0, nextCursor: null }, meta: { requestId: 'req', serverTime: clock.nowIso(), apiVersion: 'm1.v1' as const } })),
      getStudent: vi.fn(async () => ({ ok: true as const, data: { studentId: 'student_a' }, meta: { requestId: 'req', serverTime: clock.nowIso(), apiVersion: 'm1.v1' as const } })),
    };
    const main = createTeacherStudentQueryFunction({ runtime, actorResolver, clock, requestIds, handler });
    expect(await main({ apiVersion: 'm1.v1', action: 'listStudents', payload: { filters: { status: 'all' }, page: { limit: 20 } } })).toMatchObject({ ok: true });
    expect(await main({ apiVersion: 'm1.v1', action: 'listStudents', payload: { filters: { status: 'active' }, page: { limit: 20 } } })).toMatchObject({ ok: true });
    expect(handler.listStudents).toHaveBeenCalledWith(teacher, { status: 'all' }, { limit: 20 });
    expect(await main({ apiVersion: 'm1.v1', action: 'listStudents', payload: { filters: { status: 'all', actorRole: 'admin' }, page: { limit: 20 } } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { 'filters.actorRole': expect.any(String) } } });
    expect(await main({ apiVersion: 'm1.v1', action: 'getStudent', payload: { studentId: 'student_a', organizationId: 'org_other' } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await main({ apiVersion: 'm1.v1', action: 'getStudent', payload: { studentId: 'student_a' }, operationId: 'not_allowed' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('默认 main 未配置且仍执行严格校验', async () => {
    expect(await unconfiguredTeacherStudents({ apiVersion: 'm1.v1', action: 'getStudent', payload: { studentId: 'student_a' } })).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredTeacherStudents({ apiVersion: 'm1.v1', action: 'listStudents', payload: { filters: { status: 'unknown' }, page: { limit: 20 } } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
