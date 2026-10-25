import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import type { ActivityService } from '../../src/activity/activity-service';
import type { ActivityEntity } from '../../src/activity/types';
import { InMemoryOrgContentRepository } from '../../src/org-content/in-memory-repository';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import type { TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';
import { TeacherCheckListService } from '../../src/teacher-check/service';

const organizationId = 'org_demo';
const classId = 'class_demo';
const teacher: TrustedActorContext = { requestId: 'req_demo', sessionId: 'ses_demo',
  actorUserId: 'teacher_demo', actorRole: 'teacher', organizationId,
  platformSubjectDigest: 'digest_demo', permissions: ['task.read'], scopeIds: [classId], authzVersion: 1 };
const now = '2026-10-02T09:00:00+08:00';

function task(id: string, title: string, status: TaskRecord['status'], dueAt: string): TaskRecord {
  return { id, organizationId, creatorTeacherId: teacher.actorUserId, title, deliveryType: 'classroom',
    status, targetType: 'classes', targetClassIds: [classId], targetStudentIds: [],
    startsAt: '2026-10-02T08:00:00+08:00', dueAt,
    latePolicy: { allowLate: true, lateDays: 7 }, description: null, teacherNote: null,
    itemRefs: [], items: [], publishedAt: status === 'draft' ? null : now,
    deadlineExtendedAt: null, visibility: 'visible', withdrawnAt: null, withdrawnBy: null,
    withdrawReason: null, recycledAt: null, recycledBy: null, recycleReason: null,
    recoverableUntil: null, version: 1 };
}

function fixture(extraTasks: readonly TaskRecord[] = []) {
  const tasks = new InMemoryTaskQueryRepository({
    teacherGrants: [{ id: 'grant_demo', organizationId, teacherId: teacher.actorUserId,
      classId, className: '虚构班级', permissions: ['task.read'], status: 'active' }],
    tasks: [task('task_active', '动物阅读任务', 'scheduled', '2026-10-03T20:00:00+08:00'),
      task('task_draft', '动物练习草稿', 'draft', ''), ...extraTasks],
    assignments: [{ id: 'assignment_demo', organizationId, taskId: 'task_active',
      studentId: 'student_demo', classId, status: 'awaiting_review', latestSubmissionId: 'submission_demo',
      latestSubmissionVersion: 1, redoCount: 0, redoDueAt: null, isLate: false,
      submittedAt: now, reviewedAt: null, version: 1 } as TaskAssignmentRecord],
  });
  const organization = new InMemoryOrgContentRepository({ organizations: [{ id: organizationId,
    name: '虚构学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1 }] });
  const activity = { id: 'activity_demo', organizationId, creatorTeacherId: teacher.actorUserId,
    title: '动物主题打卡', description: '', status: 'published',
    schedule: { classId, startsOn: '2026-10-01', endsOn: '2026-10-07', restDates: [],
      conditions: [{ kind: 'reading', resourceId: 'read_demo' }], schoolTimeZone: 'Asia/Shanghai' },
    participants: [{ studentId: 'student_demo', displayNameMasked: '小*' }],
    conditionSnapshots: [], dailyInstances: [], version: 2, createdAt: now, updatedAt: now,
    publishedAt: now, closedAt: null } as ActivityEntity;
  const activities = {
    async listForTeacher() { return [activity]; },
    async getTeacherProgress() { return { completedCount: 1, participantCount: 1 }; },
  } as unknown as ActivityService;
  return new TeacherCheckListService(tasks, organization, activities, { nowIso: () => now });
}

describe('T-07 unified teacher check list', () => {
  it('filters classroom and check-in rows on the server with current lifecycle state and pages', async () => {
    const service = fixture();
    expect(await service.list(teacher, {}, { limit: 1, offset: 0 }))
      .toMatchObject({ total: 3, nextOffset: 1, items: [{ id: 'activity_demo', kind: 'checkin',
        status: 'active', completedCount: 1 }] });
    expect(await service.list(teacher, { type: 'classroom', status: 'active', keyword: '阅读' },
      { limit: 20, offset: 0 })).toMatchObject({ total: 1, items: [{ id: 'task_active',
        status: 'active', pendingReviewCount: 1 }] });
    expect(await service.list(teacher, { type: 'checkin', classId, startsOn: '2026-10-06' },
      { limit: 20, offset: 0 })).toMatchObject({ total: 1 });
    await expect(service.list(teacher, { classId: 'class_other' }, { limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.list({ ...teacher, actorRole: 'student' }, {}, { limit: 20, offset: 0 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('can locate and page records beyond the former 2000-row client limit', async () => {
    const bulk = Array.from({ length: 2101 }, (_item, index) => task(`task_bulk_${String(index).padStart(4, '0')}`,
      `批量任务 ${index}`, 'scheduled', '2026-10-03T20:00:00+08:00'));
    const service = fixture(bulk);
    const lastPage = await service.list(teacher, { type: 'classroom' }, { limit: 20, offset: 2100 });
    expect(lastPage.total).toBe(2103);
    expect(lastPage.items).toHaveLength(3);
    expect(lastPage.items.some(item => item.id === 'task_bulk_2100')).toBe(true);

    const filtered = await service.list(teacher, { type: 'classroom', keyword: '批量任务 2100' },
      { limit: 20, offset: 0 });
    expect(filtered).toMatchObject({ total: 1, items: [{ id: 'task_bulk_2100' }], nextOffset: null });
  });
});
