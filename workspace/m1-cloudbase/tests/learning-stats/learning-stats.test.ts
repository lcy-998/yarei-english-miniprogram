import { describe, expect, it } from 'vitest';
import { LearningStatsService, type LearningStatsDependencies } from '../../src/learning-stats/service';
import { InMemoryOrgContentRepository } from '../../src/org-content/in-memory-repository';
import { InMemoryIdentityRepository } from '../../src/runtime/memory-ports';
import type { ParentStudentLinkRecord } from '../../src/runtime/records';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import type { ReviewFeedbackRecord, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import { InMemoryStudentWorkRepository } from '../../src/student-work/memory-repository';
import type { StudentWork } from '../../src/student-work/types';
import { validateLearningStatsRequest } from '../../src/contracts/learning-stats-functions';
import { InMemoryPhonicsRepository } from '../../src/phonics/memory-repository';

const now = '2026-09-26T12:00:00.000+08:00';
const filters = { startsOn: '2026-09-20', endsOn: '2026-09-26' };
const teacher: TrustedActorContext = { requestId: 'req', sessionId: 'ses', actorUserId: 'teacher_1', actorRole: 'teacher',
  organizationId: 'org_1', platformSubjectDigest: 'digest', permissions: ['student.read', 'task.read'],
  scopeIds: ['class_a'], authzVersion: 1 };
const parent: TrustedActorContext = { ...teacher, actorRole: 'parent', actorUserId: 'parent_1',
  permissions: ['child.read'], scopeIds: [] };

function task(id: string, classId: string, title: string, dueAt = '2026-09-25T20:00:00.000+08:00'): TaskRecord {
  return { id, organizationId: 'org_1', creatorTeacherId: 'teacher_1', title, deliveryType: 'classroom',
    status: 'completed', targetType: 'classes', targetClassIds: [classId], targetStudentIds: [],
    startsAt: '2026-09-20T08:00:00.000+08:00', dueAt, latePolicy: { allowLate: true, lateDays: 7 },
    description: null, teacherNote: '私密教师备注', itemRefs: [], items: [], publishedAt: now,
    deadlineExtendedAt: null, visibility: 'visible', withdrawnAt: null, withdrawnBy: null,
    withdrawReason: null, recycledAt: null, recycledBy: null, recycleReason: null, recoverableUntil: null, version: 1 };
}
function assignment(id: string, taskId: string, classId: string, studentId: string, status: TaskAssignmentRecord['status'],
  submissionId: string | null): TaskAssignmentRecord {
  return { id, organizationId: 'org_1', taskId, studentId, classId, status, latestSubmissionId: submissionId,
    latestSubmissionVersion: submissionId ? 1 : 0, redoCount: 0, redoDueAt: null, isLate: status === 'overdue',
    submittedAt: submissionId ? now : null, reviewedAt: null, version: 1 };
}
function submission(id: string, assignmentId: string, taskId: string, studentId: string): SubmissionRecord {
  return { id, organizationId: 'org_1', taskId, assignmentId, studentId, submissionVersion: 1, recordVersion: 1,
    status: 'reviewed', answers: [{ itemId: 'item_1', value: '私密作答' }], isLate: false,
    submittedAt: now, supersedesSubmissionId: null };
}

function harness(recycled = false, sources: Pick<LearningStatsDependencies, 'phonics' | 'activities'> = {},
  options: Readonly<{ primaryTask?: TaskRecord; primarySubmission?: SubmissionRecord; noFeedback?: boolean }> = {}) {
  const organizations = new InMemoryOrgContentRepository({
    organizations: [{ id: 'org_1', name: '虚构学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1 }],
    classes: [
      { id: 'class_a', organizationId: 'org_1', name: '三年级 2 班', grade: '三年级', term: '上学期', status: 'active', version: 1 },
      { id: 'class_b', organizationId: 'org_1', name: '四年级 1 班', grade: '四年级', term: '上学期', status: 'active', version: 1 },
    ],
    users: [
      { id: 'student_1', organizationId: 'org_1', authorizationVersion: 1, displayName: '小宇',
        displayNameMasked: '小*', roles: ['student'], status: 'active', version: 1 },
      { id: 'student_2', organizationId: 'org_1', authorizationVersion: 1, displayName: '林可',
        displayNameMasked: '林*', roles: ['student'], status: 'active', version: 1 },
      { id: 'student_other', organizationId: 'org_1', authorizationVersion: 1, displayName: '越权学生',
        displayNameMasked: '越**', roles: ['student'], status: 'active', version: 1 },
    ],
    memberships: [
      { id: 'membership_1', organizationId: 'org_1', classId: 'class_a', studentId: 'student_1', status: 'active', version: 1 },
      { id: 'membership_2', organizationId: 'org_1', classId: 'class_a', studentId: 'student_2', status: 'active', version: 1 },
      { id: 'membership_other', organizationId: 'org_1', classId: 'class_b', studentId: 'student_other', status: 'active', version: 1 },
    ],
    teacherGrants: [{ id: 'grant_a', organizationId: 'org_1', teacherId: 'teacher_1', classId: 'class_a',
      permissions: ['student.read', 'task.read'], status: 'active', grantedBy: 'admin', grantedAt: now, version: 1 }],
    parentLinks: [{ id: 'link_1', organizationId: 'org_1', parentId: 'parent_1', studentId: 'student_1',
      status: 'active', confirmedBy: 'teacher_1', confirmedAt: now, confirmationSource: 'binding_code', version: 1 }],
  });
  const links: ParentStudentLinkRecord[] = [{ _id: 'link_1', organizationId: 'org_1', parentId: 'parent_1', studentId: 'student_1',
    status: 'active', version: 1, deletedAt: null, confirmedAt: now }];
  const identities = new InMemoryIdentityRepository({ organizations: [], users: [], identities: [], roles: [],
    teacherGrants: [], parentLinks: links });
  const feedback: ReviewFeedbackRecord = { id: 'feedback_1', organizationId: 'org_1', taskId: 'task_1',
    assignmentId: 'assignment_1', submissionId: 'submission_1', submissionVersion: 1,
    teacherId: 'teacher_1', decision: 'approved', score: 88, textComment: '虚构点评', returnReason: null,
    publishedAt: now, source: 'manual' };
  const tasks = new InMemoryTaskQueryRepository({
    tasks: [{ ...(options.primaryTask ?? task('task_1', 'class_a', '=危险公式')),
      ...(recycled ? { visibility: 'recycled' as const, recycledAt: now, recycledBy: 'teacher_1',
        recycleReason: '虚构报告回归', recoverableUntil: '2026-10-03T12:00:00.000+08:00' } : {}) },
      task('task_old', 'class_a', '旧任务', '2026-09-01T20:00:00.000+08:00'),
      task('task_other', 'class_b', '越权任务')],
    assignments: [assignment('assignment_1', 'task_1', 'class_a', 'student_1', 'completed', 'submission_1'),
      assignment('assignment_2', 'task_1', 'class_a', 'student_2', 'overdue', null),
      assignment('assignment_old', 'task_old', 'class_a', 'student_1', 'completed', null),
      assignment('assignment_other', 'task_other', 'class_b', 'student_other', 'completed', null)],
    submissions: [options.primarySubmission ?? submission('submission_1', 'assignment_1', 'task_1', 'student_1')],
    feedback: options.noFeedback ? [] : [feedback],
  });
  const work: StudentWork = { id: 'work_1', organizationId: 'org_1', studentId: 'student_1',
    classId: 'class_a', materialId: 'material_1', materialVersion: '1', stagingPath: 'virtual',
    status: 'submitted', fileId: 'sealed_file', contentSha256: 'digest', sizeBytes: 12000,
    durationMs: 5000, note: '', version: 2, createdAt: now, submittedAt: now };
  const works = new InMemoryStudentWorkRepository({ works: [work,
    { ...work, id: 'work_old_class', classId: 'class_b' },
    { ...work, id: 'work_draft', status: 'draft', submittedAt: null }] });
  let sequence = 0;
  const service = new LearningStatsService({ organization: organizations, tasks, identities, works, ...sources,
    clock: { nowIso: () => now }, requestIds: { next: () => `req_${++sequence}` } });
  return { service, links, organizations };
}

describe('M2 T-04 / G-04 可信基础统计', () => {
  it('软回收后保留已提交的成绩与点评统计，隐藏未提交入口', async () => {
    const { service } = harness(true);
    const teacherReport = await service.teacher(teacher, filters);
    expect(teacherReport).toMatchObject({ ok: true, data: { summary: {
      assignedCount: 1, completedCount: 1, taskSubmissionCount: 1, averageScore: 88,
    }, details: [{ taskId: 'task_1', studentId: 'student_1', score: 88, submissionCount: 1 }] } });
    const parentReport = await service.parent(parent, 'student_1', filters);
    expect(parentReport).toMatchObject({ ok: true, data: { summary: {
      assignedCount: 1, completedCount: 1, averageScore: 88,
    }, details: [{ taskId: 'task_1', score: 88 }] } });
  });

  it('班级、时间与学员筛选在卡片、明细和 CSV 中一致，且没有无来源指标', async () => {
    const { service } = harness();
    const all = await service.teacher(teacher, filters);
    expect(all).toMatchObject({ ok: true, data: { summary: { assignedCount: 2, completedCount: 1,
      completionRate: 50, overdueCount: 1, taskSubmissionCount: 1, averageScore: 88,
      learningMinutes: null, practiceAccuracy: null, dubbingCount: 1 } } });
    if (!all.ok) throw new Error('expected report');
    expect(all.data.details.map((item) => item.studentId)).toEqual(expect.arrayContaining(['student_1', 'student_2']));
    expect(JSON.stringify(all.data)).not.toContain('student_other');
    expect(JSON.stringify(all.data)).not.toContain('私密作答');
    expect(JSON.stringify(all.data)).not.toContain('私密教师备注');
    expect(await service.teacher(teacher, { ...filters, studentId: 'student_1' }))
      .toMatchObject({ ok: true, data: { summary: { assignedCount: 1, completedCount: 1 }, details: [{ studentId: 'student_1' }] } });
    const exported = await service.exportTeacherCsv(teacher, { ...filters, studentId: 'student_1' });
    if (!exported.ok) throw new Error('expected CSV');
    expect(exported.data.csv).toContain("'=危险公式");
    expect(exported.data.csv).not.toContain('student_2');
  });

  it('教师跨班/跨学员和家长跨孩子被拒绝，解绑后立即失去报告访问', async () => {
    const { service, links } = harness();
    expect(await service.teacher(teacher, { ...filters, classId: 'class_b' }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await service.teacher(teacher, { ...filters, studentId: 'student_other' }))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.parent(parent, 'student_1', filters))
      .toMatchObject({ ok: true, data: { canExport: false, summary: { assignedCount: 1, averageScore: 88, dubbingCount: 2 } } });
    expect(await service.parent(parent, 'student_2', filters))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    links[0] = { ...links[0], status: 'revoked' };
    expect(await service.parent(parent, 'student_1', filters))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('严格限制日期和请求字段', async () => {
    const { service } = harness();
    expect(await service.teacher(teacher, { startsOn: '2026-02-30', endsOn: '2026-03-05' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(validateLearningStatsRequest({ apiVersion: 'm1.v1', action: 'teacherReport',
      payload: { filters, actorUserId: 'teacher_1' } })).toMatchObject({ ok: false });
  });

  it('家长报告只汇总本人孩子的可信拼读首次作答与打卡证据', async () => {
    const course = { id: 'phonics_demo', organizationId: 'org_1', title: '虚构自然拼读', grade: '三年级', unit: '1',
      contentVersion: 'v1', status: 'published' as const,
      visibility: { type: 'classes' as const, classIds: ['class_a', 'class_b'] },
      phonemes: [], questions: [] };
    const baseAnswer = { organizationId: 'org_1', courseId: course.id, contentVersion: 'v1',
      round: 1, questionId: 'question_1', selectedOptionId: 'option_1', firstAttempt: true,
      attemptNumber: 1, attemptedAt: '2026-09-25T09:00:00.000+08:00' };
    const phonics = new InMemoryPhonicsRepository({ courses: [course], answers: [
      { ...baseAnswer, id: 'answer_own', studentId: 'student_1', isCorrect: true },
      { ...baseAnswer, id: 'answer_other', studentId: 'student_other', isCorrect: false },
      { ...baseAnswer, id: 'answer_repeat', studentId: 'student_1', firstAttempt: false, isCorrect: false },
      { ...baseAnswer, id: 'answer_old', studentId: 'student_1', attemptedAt: '2026-09-19T09:00:00.000+08:00', isCorrect: false },
    ] });
    const activities: NonNullable<LearningStatsDependencies['activities']> = {
      listVerifiedDaysForStatistics: async () => ({ evidenceStatus: 'available', events: [
        { activityId: 'activity_1', activityTitle: '虚构打卡', classId: 'class_a', studentId: 'student_1',
          date: '2026-09-25', supplemented: false },
        { activityId: 'activity_other', activityTitle: '其他班打卡', classId: 'class_b', studentId: 'student_other',
          date: '2026-09-25', supplemented: false },
      ] }),
    };
    const { service, links } = harness(false, { phonics, activities });
    const result = await service.parent(parent, 'student_1', filters);
    expect(result).toMatchObject({ ok: true, data: { learningPeriodBasis: 'eventSchoolDate',
      summary: { phonicsPracticeCount: 1, practiceAccuracy: 100, checkinCompletedDays: 1,
        checkinEvidenceStatus: 'available', shadowingCount: null } } });
    if (!result.ok) throw new Error('expected parent report');
    expect(result.data.learningEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'phonics', studentId: 'student_1' }),
      expect.objectContaining({ kind: 'checkin', studentId: 'student_1' }),
    ]));
    const teacherResult = await service.teacher(teacher, { ...filters, studentId: 'student_1' });
    if (!teacherResult.ok) throw new Error('expected teacher report');
    expect({ phonics: teacherResult.data.summary.phonicsPracticeCount,
      accuracy: teacherResult.data.summary.practiceAccuracy,
      checkin: teacherResult.data.summary.checkinCompletedDays }).toEqual({
      phonics: result.data.summary.phonicsPracticeCount,
      accuracy: result.data.summary.practiceAccuracy,
      checkin: result.data.summary.checkinCompletedDays,
    });
    expect(JSON.stringify(result)).not.toContain('student_other');
    links[0] = { ...links[0], status: 'revoked' };
    expect(await service.parent(parent, 'student_1', filters))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('打卡证据不完整时不把局部记录伪装为完整汇总', async () => {
    const activities: NonNullable<LearningStatsDependencies['activities']> = {
      listVerifiedDaysForStatistics: async () => ({ evidenceStatus: 'partial', events: [
        { activityId: 'activity_1', activityTitle: '虚构打卡', classId: 'class_a', studentId: 'student_1',
          date: '2026-09-25', supplemented: false },
      ] }),
    };
    const { service } = harness(false, { activities });
    const result = await service.parent(parent, 'student_1', filters);
    expect(result).toMatchObject({ ok: true, data: { summary: {
      checkinCompletedDays: null, checkinEvidenceStatus: 'partial', phonicsPracticeCount: null,
      practiceAccuracy: null, shadowingCount: null,
    }, learningEvents: [{ kind: 'checkin', sourceId: 'activity_1' }] } });
  });

  it('家长报告与教师正式平均分均排除试验性自动分', async () => {
    const experimentalTask: TaskRecord = { ...task('task_1', 'class_a', '虚构试验任务'), items: [{
      id: 'item_1', resourceId: 'question_1', resourceVersion: 1, snapshotSchemaVersion: 1,
      resourceSnapshot: { title: '虚构选择题', type: 'exercise', payload: {
        questionIds: ['question_1'], questionType: 'single_choice', stem: 'A?', options: ['A', 'B'],
        correctAnswer: 'A', explanation: '虚构解析',
      } }, completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
      scoringRule: { kind: 'automatic', maxScore: 100, experimental: true }, order: 1,
    }] };
    const answered: SubmissionRecord = { ...submission('submission_1', 'assignment_1', 'task_1', 'student_1'),
      status: 'submitted', answers: [{ itemId: 'item_1', value: {
        kind: 'exercise', answeredQuestionCount: 1, correctQuestionCount: 1,
        questionResponses: [{ questionId: 'question_1', response: 'A', isCorrect: true }],
      } }] };
    const { service } = harness(false, {}, { primaryTask: experimentalTask,
      primarySubmission: answered, noFeedback: true });
    expect(await service.parent(parent, 'student_1', filters))
      .toMatchObject({ ok: true, data: { summary: { averageScore: null },
        details: [{ taskId: 'task_1', score: null }] } });
    expect(await service.teacher(teacher, { ...filters, studentId: 'student_1' }))
      .toMatchObject({ ok: true, data: { summary: { averageScore: null } } });
  });
});
