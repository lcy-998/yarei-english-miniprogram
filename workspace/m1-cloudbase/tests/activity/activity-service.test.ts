import { describe, expect, it, vi } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { ActivityService } from '../../src/activity/activity-service';
import { InMemoryActivityRepository } from '../../src/activity/memory-repository';
import { activityDays } from '../../src/task-core/activity-rules';
import type { SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';
import type { StudentWork } from '../../src/student-work/types';

const organizationId = 'org_qihang_demo';
const classId = 'class_grade3_demo';
const teacherId = 'teacher_lin_demo';
const teacher: TrustedActorContext = { requestId: 'request_teacher', sessionId: 'session_teacher', actorUserId: teacherId,
  actorRole: 'teacher', organizationId, platformSubjectDigest: 'digest_teacher', permissions: ['task.publish', 'task.read'],
  scopeIds: [classId], authzVersion: 1 };
const student: TrustedActorContext = { ...teacher, requestId: 'request_student', sessionId: 'session_student',
  actorUserId: 'student_xiaoyu_demo', actorRole: 'student', permissions: [], scopeIds: [] };
const clock = { nowIso: () => '2026-09-26T02:00:00.000Z' };
let sequence = 0;
const ids = { next: (prefix: string) => `${prefix}_demo_${++sequence}` };

function fixture(): InMemoryActivityRepository {
  return new InMemoryActivityRepository({
    organizations: [{ id: organizationId, status: 'active', timeZone: 'Asia/Shanghai' }],
    classes: [{ id: classId, organizationId, status: 'active' }],
    grants: [{ organizationId, teacherId, classId, status: 'active', permissions: ['task.publish', 'task.read'] }],
    memberships: [
      { organizationId, classId, studentId: student.actorUserId, status: 'active' },
      { organizationId, classId, studentId: student.actorUserId, status: 'active' },
      { organizationId, classId, studentId: 'student_lingke_demo', status: 'active' },
      { organizationId, classId, studentId: 'student_inactive_demo', status: 'active' },
    ],
    users: [
      { id: student.actorUserId, organizationId, status: 'active', displayNameMasked: '小宇' },
      { id: 'student_lingke_demo', organizationId, status: 'active', displayNameMasked: '小可' },
      { id: 'student_inactive_demo', organizationId, status: 'disabled', displayNameMasked: '停用学员' },
    ],
    resources: [
      { id: 'read_zoo_demo', organizationId, type: 'reading', status: 'published', contentVersion: 'demo-v1',
        pageIds: ['page_1', 'page_2'], visibility: { type: 'classes', classIds: [classId] } },
      { id: 'vocab_animals_demo', organizationId, type: 'vocabulary', status: 'published', contentVersion: 'demo-v1',
        wordIds: ['word_1', 'word_2', 'word_3'], visibility: { type: 'classes', classIds: [classId] } },
    ],
  });
}

const input = { title: '动物主题打卡', description: '完成阅读与单词', classId,
  startsOn: '2026-09-27', endsOn: '2026-09-30', restDates: ['2026-09-29'],
  conditions: [{ kind: 'reading' as const, resourceId: 'read_zoo_demo' },
    { kind: 'vocabulary' as const, resourceId: 'vocab_animals_demo', requiredWordCount: 3 }] };

describe('M2 activity draft and participant snapshot', () => {
  it('adds only a future rest day with a versioned reason and preserves completed evidence', async () => {
    const repository = fixture();
    const publishService = new ActivityService(repository, clock, ids);
    const draft = await publishService.saveDraft(teacher, { ...input, conditions: [input.conditions[0]!] },
      0, 'operation_future_rest_draft');
    const published = await publishService.publish(teacher, draft.id, 1, 'operation_future_rest_publish');
    const service = new ActivityService(repository, { nowIso: () => '2026-09-28T10:00:00+08:00' }, ids);
    await service.setOverride(teacher, { activityId: draft.id, studentId: student.actorUserId,
      date: '2026-09-27', active: true, reason: '核对阅读完成' }, 0, 'operation_future_rest_override');
    const before = await service.getLeaderboard(student, draft.id);
    const changed = await service.addFutureRestDay(teacher, draft.id, '2026-09-30', '学校活动暂停练习',
      published.version, 'operation_future_rest_add');
    expect(changed.schedule.restDates).toEqual(['2026-09-29', '2026-09-30']);
    expect(changed.dailyInstances.map(item => item.date)).toEqual(['2026-09-27', '2026-09-28']);
    expect(changed.participants).toEqual(published.participants);
    expect(changed.conditionSnapshots).toEqual(published.conditionSnapshots);
    expect(changed.restDayChanges).toMatchObject([{ date: '2026-09-30', reason: '学校活动暂停练习',
      teacherId, activityVersion: published.version + 1 }]);
    expect(await service.addFutureRestDay(teacher, draft.id, '2026-09-30', '学校活动暂停练习',
      published.version, 'operation_future_rest_add')).toEqual(changed);
    expect(await service.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: true, supplemented: true });
    expect(await service.getMyDay(student, draft.id, '2026-09-30')).toMatchObject({ restDay: true, complete: null });
    expect(JSON.stringify(await service.getForStudent(student, draft.id))).not.toContain('学校活动暂停练习');
    expect(JSON.stringify(await service.listForStudent(student))).not.toContain('学校活动暂停练习');
    const after = await service.getLeaderboard(student, draft.id);
    expect(after.leaderboard?.ranks).toEqual(before.leaderboard?.ranks);
    expect(after.leaderboard?.effectiveDayCount).toBe(2);
    expect(repository.snapshot().overrides).toHaveLength(1);
    expect(repository.snapshot().receipts.filter(item => item.action === 'addFutureRestDay')).toHaveLength(1);
  });

  it('rejects past, duplicate, out-of-range, stale, unauthorized and locked rest-day changes', async () => {
    const repository = fixture();
    const publishService = new ActivityService(repository, clock, ids);
    const draft = await publishService.saveDraft(teacher, input, 0, 'operation_rest_guard_draft');
    const published = await publishService.publish(teacher, draft.id, 1, 'operation_rest_guard_publish');
    const service = new ActivityService(repository, { nowIso: () => '2026-09-28T10:00:00+08:00' }, ids);
    for (const [date, op] of [['2026-09-27', 'past'], ['2026-09-28', 'today'],
      ['2026-09-29', 'duplicate'], ['2026-10-01', 'outside']] as const) {
      await expect(service.addFutureRestDay(teacher, draft.id, date, '教学安排变化',
        published.version, `operation_rest_${op}`)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    await expect(service.addFutureRestDay(student, draft.id, '2026-09-30', '学生伪造',
      published.version, 'operation_rest_student')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.addFutureRestDay({ ...teacher, scopeIds: [] }, draft.id, '2026-09-30', '越权变更',
      published.version, 'operation_rest_scope')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const changed = await service.addFutureRestDay(teacher, draft.id, '2026-09-30', '教学安排变化',
      published.version, 'operation_rest_valid');
    await expect(service.addFutureRestDay(teacher, draft.id, '2026-09-30', '复用标识修改原因',
      published.version, 'operation_rest_valid')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.addFutureRestDay(teacher, draft.id, '2026-09-30', '旧版本',
      published.version, 'operation_rest_stale')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(changed.restDayChanges).toHaveLength(1);
    expect(repository.snapshot().activities[0]?.version).toBe(changed.version);
    const lockedRepository = new InMemoryActivityRepository({ ...repository.snapshot(), finalSnapshots: [{
      organizationId, activityId: draft.id, activityVersion: changed.version,
      lockedAt: '2026-10-01T00:00:00+08:00', leaderboard: { classId, effectiveDayCount: 2,
        finalized: true, ranks: [] }, completedDatesByStudent: {}, supplementedDatesByStudent: {},
    }] });
    const lockedService = new ActivityService(lockedRepository, { nowIso: () => '2026-09-28T10:00:00+08:00' }, ids);
    await expect(lockedService.addFutureRestDay(teacher, draft.id, '2026-09-28', '锁榜后变更',
      changed.version, 'operation_rest_locked')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('serializes concurrent rest-day writes against the published version', async () => {
    const repository = fixture();
    const publishService = new ActivityService(repository, clock, ids);
    const draft = await publishService.saveDraft(teacher, { ...input, restDates: [] }, 0, 'operation_rest_race_draft');
    const published = await publishService.publish(teacher, draft.id, 1, 'operation_rest_race_publish');
    const service = new ActivityService(repository, { nowIso: () => '2026-09-27T10:00:00+08:00' }, ids);
    const outcomes = await Promise.allSettled([
      service.addFutureRestDay(teacher, draft.id, '2026-09-28', '校内活动甲', published.version, 'operation_rest_race_a'),
      service.addFutureRestDay(teacher, draft.id, '2026-09-29', '校内活动乙', published.version, 'operation_rest_race_b'),
    ]);
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(item => item.status === 'rejected')).toMatchObject([{ reason: { code: 'CONFLICT' } }]);
    expect(repository.snapshot().activities[0]?.restDayChanges).toHaveLength(1);
  });
  it('saves a teacher draft and publishes one immutable class roster without rest-day instances', async () => {
    const repository = fixture();
    const service = new ActivityService(repository, clock, ids);
    const draft = await service.saveDraft(teacher, { ...input, schoolTimeZone: 'UTC' }, 0, 'operation_activity_draft_1');
    expect(draft).toMatchObject({ status: 'draft', version: 1, schedule: { schoolTimeZone: 'Asia/Shanghai' }, participants: [], conditionSnapshots: [] });
    expect(activityDays(draft.schedule)).toEqual(['2026-09-27', '2026-09-28', '2026-09-30']);
    await expect(service.getForStudent(student, draft.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const published = await service.publish(teacher, draft.id, 1, 'operation_activity_publish_1');
    expect(published).toMatchObject({ status: 'published', version: 2, conditionSnapshots: [
      { kind: 'reading', resourceId: 'read_zoo_demo', pageIds: ['page_1', 'page_2'], contentVersion: 'demo-v1' },
      { kind: 'vocabulary', resourceId: 'vocab_animals_demo', wordIds: ['word_1', 'word_2', 'word_3'], contentVersion: 'demo-v1' },
    ], participants: [
      { studentId: student.actorUserId, displayNameMasked: '小宇' },
      { studentId: 'student_lingke_demo', displayNameMasked: '小可' },
    ] });
    expect(await service.publish(teacher, draft.id, 1, 'operation_activity_publish_1')).toEqual(published);
    expect(await service.getForStudent(student, draft.id)).toMatchObject({ id: draft.id, participants: published.participants });
    expect(await service.listForStudent(student)).toMatchObject([{ id: draft.id, status: 'published' }]);
    const afterTransfer = repository.snapshot();
    const transferredService = new ActivityService(new InMemoryActivityRepository({ ...afterTransfer,
      memberships: afterTransfer.memberships.filter(item => item.studentId !== student.actorUserId),
    }), clock, ids);
    await expect(transferredService.getForStudent(student, draft.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(transferredService.getMyDay(student, draft.id, '2026-09-27'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await service.listForTeacher(teacher)).toHaveLength(1);
    expect(published.dailyInstances.map(instance => instance.date)).toEqual(['2026-09-27', '2026-09-28', '2026-09-30']);
    expect(published.dailyInstances.every(instance => instance.activityVersion === 2
      && instance.classId === classId)).toBe(true);
    expect(repository.snapshot().activities).toHaveLength(1);
  });

  it('keeps a 500-person long custom schedule within the serialized activity budget and rejects an oversized one', async () => {
    const base = fixture().snapshot();
    const extraIds = Array.from({ length: 498 }, (_, index) => `student_long_${String(index).padStart(3, '0')}`);
    const repository = new InMemoryActivityRepository({ ...base,
      memberships: [...base.memberships, ...extraIds.map(studentId => ({ organizationId, classId, studentId,
        status: 'active' as const }))],
      users: [...base.users, ...extraIds.map(studentId => ({ id: studentId, organizationId,
        status: 'active' as const, displayNameMasked: `学员${studentId.slice(-3)}` }))] });
    const service = new ActivityService(repository, clock, ids);
    const end = new Date('2026-09-27T00:00:00.000Z');
    end.setUTCDate(end.getUTCDate() + 999);
    const longDraft = await service.saveDraft(teacher, { ...input, endsOn: end.toISOString().slice(0, 10),
      conditions: [input.conditions[0]!] }, 0, 'operation_long_draft');
    const longPublished = await service.publish(teacher, longDraft.id, 1, 'operation_long_publish');
    expect(longPublished.participants).toHaveLength(500);
    expect(longPublished.dailyInstances).toHaveLength(999);
    expect(Buffer.byteLength(JSON.stringify(longPublished), 'utf8')).toBeLessThan(1_000_000);
    const oversizedDraft = await service.saveDraft(teacher, { ...input, endsOn: '2126-09-30',
      conditions: [input.conditions[0]!] }, 0, 'operation_oversized_draft');
    await expect(service.publish(teacher, oversizedDraft.id, 1, 'operation_oversized_publish'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await service.listForTeacher(teacher)).find(item => item.id === oversizedDraft.id)?.status).toBe('draft');
  });

  it('rejects invalid conditions, other classes, stale versions and changed idempotent operations', async () => {
    const repository = fixture();
    const service = new ActivityService(repository, clock, ids);
    await expect(service.saveDraft(teacher, { ...input, conditions: [{ kind: 'exercise', resourceId: 'exercise_demo', minimumScore: 101 }] },
      0, 'operation_activity_invalid')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const forgedCondition = { kind: 'reading' as const, resourceId: 'read_zoo_demo', studentNumber: 'not_allowed' };
    await expect(service.saveDraft(teacher, { ...input, conditions: [forgedCondition] }, 0, 'operation_activity_extra'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.saveDraft(teacher, { ...input, classId: 'class_other' }, 0, 'operation_activity_other'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    const draft = await service.saveDraft(teacher, input, 0, 'operation_activity_draft_2');
    expect(await service.saveDraft(teacher, input, 0, 'operation_activity_draft_2')).toEqual(draft);
    await expect(service.saveDraft(teacher, { ...input, title: '修改后的名称' }, 0, 'operation_activity_draft_2'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.publish(teacher, draft.id, 0, 'operation_activity_stale'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.publish({ ...teacher, scopeIds: [] }, draft.id, 1, 'operation_activity_revoked'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.getForStudent({ ...student, actorUserId: 'student_inactive_demo' }, draft.id))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps a failed publication atomic so the teacher can retry after correcting the class roster', async () => {
    const repository = new InMemoryActivityRepository({
      ...fixture().snapshot(),
      memberships: [],
    });
    const service = new ActivityService(repository, clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_activity_draft_3');
    await expect(service.publish(teacher, draft.id, 1, 'operation_activity_empty')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repository.snapshot().activities[0]).toMatchObject({ status: 'draft', version: 1 });
    expect(repository.snapshot().receipts.filter(item => item.action === 'publish')).toHaveLength(0);
  });

  it('serializes concurrent retries of the same create operation', async () => {
    const repository = fixture();
    const service = new ActivityService(repository, clock, ids);
    const [first, second] = await Promise.all([
      service.saveDraft(teacher, input, 0, 'operation_activity_concurrent'),
      service.saveDraft(teacher, input, 0, 'operation_activity_concurrent'),
    ]);
    expect(first).toEqual(second);
    expect(repository.snapshot().activities).toHaveLength(1);
    expect(repository.snapshot().receipts).toHaveLength(1);
  });

  it('blocks publication when an activity condition cites a missing resource', async () => {
    const repository = fixture();
    const service = new ActivityService(repository, clock, ids);
    const draft = await service.saveDraft(teacher, { ...input, conditions: [{ kind: 'exercise', resourceId: 'exercise_missing', minimumScore: 60 }] },
      0, 'operation_activity_missing_draft');
    await expect(service.publish(teacher, draft.id, 1, 'operation_activity_missing_publish'))
      .rejects.toMatchObject({ code: 'RESOURCE_OFFLINE' });
    expect(repository.snapshot().activities[0]).toMatchObject({ status: 'draft', version: 1 });
  });

  it('rejects incomplete resource snapshots before publishing an activity', async () => {
    const initial = fixture().snapshot();
    const repository = new InMemoryActivityRepository({ ...initial, resources: initial.resources.map(item =>
      item.id === 'read_zoo_demo' ? { ...item, pageIds: [] } : item) });
    const service = new ActivityService(repository, clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_snapshot_incomplete_draft');
    await expect(service.publish(teacher, draft.id, 1, 'operation_snapshot_incomplete_publish'))
      .rejects.toMatchObject({ code: 'RESOURCE_OFFLINE' });
  });

  it('rolls back a publish write if its idempotency receipt cannot be saved', async () => {
    const repository = fixture();
    const service = new ActivityService(repository, clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_activity_draft_rollback');
    vi.spyOn(repository, 'saveReceipt').mockResolvedValueOnce(false);
    await expect(service.publish(teacher, draft.id, 1, 'operation_activity_publish_rollback'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.snapshot().activities[0]).toMatchObject({ status: 'draft', version: 1, participants: [] });
    expect(repository.snapshot().receipts.filter(item => item.action === 'publish')).toHaveLength(0);
  });

  it('reads a verified reading day and treats an unattempted word condition as incomplete', async () => {
    const repository = fixture();
    const service = new ActivityService(repository, clock, ids);
    const readingDraft = await service.saveDraft(teacher, { ...input, conditions: [input.conditions[0]!] },
      0, 'operation_reading_day_draft');
    await service.publish(teacher, readingDraft.id, 1, 'operation_reading_day_publish');
    const mixedDraft = await service.saveDraft(teacher, input, 0, 'operation_mixed_day_draft');
    await service.publish(teacher, mixedDraft.id, 1, 'operation_mixed_day_publish');
    const withEvents = new InMemoryActivityRepository({ ...repository.snapshot(), readingPageEvents: [
      { id: 'visit_page_1', organizationId, studentId: student.actorUserId, resourceId: 'read_zoo_demo',
        chapterId: 'chapter_1', pageId: 'page_1', pageNumber: 1, progressVersion: 1,
        contentVersion: 'demo-v1', operationId: 'operation_visit_page_1', visitedAt: '2026-09-27T09:00:00+08:00' },
      { id: 'visit_page_2', organizationId, studentId: student.actorUserId, resourceId: 'read_zoo_demo',
        chapterId: 'chapter_1', pageId: 'page_2', pageNumber: 2, progressVersion: 2,
        contentVersion: 'demo-v1', operationId: 'operation_visit_page_2', visitedAt: '2026-09-27T09:05:00+08:00' },
    ] });
    const checked = new ActivityService(withEvents, clock, ids);
    expect(await checked.getMyDay(student, readingDraft.id, '2026-09-27')).toMatchObject({
      complete: true, evidenceStatus: 'available', verifiedConditions: 1, totalConditions: 1,
    });
    expect(await checked.getMyDay(student, readingDraft.id, '2026-09-29')).toMatchObject({ restDay: true, complete: null });
    expect(await checked.getMyDay(student, mixedDraft.id, '2026-09-27')).toMatchObject({
      complete: false, evidenceStatus: 'available', verifiedConditions: 1, totalConditions: 2,
      conditionProgress: [{ index: 0, kind: 'reading', resourceId: 'read_zoo_demo', complete: true },
        { index: 1, kind: 'vocabulary', resourceId: 'vocab_animals_demo', complete: false }],
    });
    await expect(checked.getMyDay({ ...student, actorUserId: 'student_inactive_demo' }, readingDraft.id, '2026-09-27'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('counts distinct first-spelled words on the school day and includes them in the final board', async () => {
    const repository = fixture();
    const publishing = new ActivityService(repository, clock, ids);
    const draft = await publishing.saveDraft(teacher, { ...input, conditions: [input.conditions[1]!] },
      0, 'operation_word_day_draft');
    await publishing.publish(teacher, draft.id, 1, 'operation_word_day_publish');
    const base = { organizationId, studentId: student.actorUserId, packId: 'vocab_animals_demo',
      taskId: null, itemId: null, round: 0, contentVersion: 'demo-v1', isCorrect: false,
      firstAttempt: true, attemptNumber: 1 };
    const attempts = [
      { ...base, id: 'word_day_1', wordId: 'word_1', studentInput: 'wrong', attemptedAt: '2026-09-27T09:00:00+08:00' },
      { ...base, id: 'word_day_2', wordId: 'word_2', studentInput: 'wrong', attemptedAt: '2026-09-27T09:01:00+08:00' },
      { ...base, id: 'word_day_3', wordId: 'word_3', studentInput: 'wrong', attemptedAt: '2026-09-27T09:02:00+08:00' },
      { ...base, id: 'word_day_retry', wordId: 'word_1', studentInput: 'correct', isCorrect: true,
        firstAttempt: false, attemptNumber: 2, attemptedAt: '2026-09-27T09:03:00+08:00' },
      { ...base, id: 'word_other_student', studentId: 'student_lingke_demo', wordId: 'word_1',
        studentInput: 'wrong', attemptedAt: '2026-09-27T09:00:00+08:00' },
    ];
    const checked = new ActivityService(new InMemoryActivityRepository({ ...repository.snapshot(),
      vocabularyAttempts: attempts }), { nowIso: () => '2026-09-27T10:00:00+08:00' }, ids);
    expect(await checked.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: true,
      evidenceStatus: 'available', verifiedConditions: 1, completedAt: '2026-09-27T09:02:00+08:00' });
    expect(await checked.getMyDay(student, draft.id, '2026-09-28')).toMatchObject({ complete: false,
      evidenceStatus: 'available', verifiedConditions: 0 });
    expect(await checked.getLeaderboard(student, draft.id)).toMatchObject({ evidenceStatus: 'available',
      leaderboard: { ranks: [{ studentId: student.actorUserId, completedDays: 1, rank: 1 },
        { studentId: 'student_lingke_demo', completedDays: 0, rank: 2 }] } });
    const locked = new ActivityService(new InMemoryActivityRepository({ ...repository.snapshot(),
      vocabularyAttempts: attempts }), { nowIso: () => '2026-10-01T00:00:00+08:00' }, ids);
    expect(await locked.finalizeActivity(organizationId, draft.id)).toMatchObject({
      completedDatesByStudent: { [student.actorUserId]: ['2026-09-27'] },
      leaderboard: { finalized: true, ranks: [{ completedDays: 1, rank: 1 }, { completedDays: 0, rank: 2 }] },
    });
  });

  it('uses a sealed autonomous work as the submitted-work condition for day and leaderboard', async () => {
    const initial = fixture().snapshot();
    const materialId = 'material_dubbing_demo';
    const repository = new InMemoryActivityRepository({ ...initial, resources: [...initial.resources,
      { id: materialId, organizationId, type: 'work', status: 'published', contentVersion: 'demo-v1',
        visibility: { type: 'classes', classIds: [classId] } }] });
    const publishing = new ActivityService(repository, clock, ids);
    const draft = await publishing.saveDraft(teacher, { ...input, conditions: [{ kind: 'work', resourceId: materialId }] },
      0, 'operation_work_day_draft');
    await publishing.publish(teacher, draft.id, 1, 'operation_work_day_publish');
    const digest = 'b'.repeat(64);
    const work: StudentWork = { id: 'student_work_day_1', organizationId, studentId: student.actorUserId,
      classId, materialId, materialVersion: 'demo-v1', stagingPath: 'student-works/staging/demo/work.mp3',
      status: 'submitted', fileId: `cloud://demo/student-works/private/demo/student_work_day_1/${digest}.mp3`,
      contentSha256: digest, sizeBytes: 100_000, durationMs: 10_000, note: '', version: 2,
      createdAt: '2026-09-27T08:00:00+08:00', submittedAt: '2026-09-27T09:00:00+08:00' };
    const withWorks = new InMemoryActivityRepository({ ...repository.snapshot(), studentWorks: [work] });
    const checked = new ActivityService(withWorks, { nowIso: () => '2026-09-27T10:00:00+08:00' }, ids);
    expect(await checked.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: true,
      evidenceStatus: 'available', verifiedConditions: 1, completedAt: work.submittedAt });
    expect(await checked.getLeaderboard(student, draft.id)).toMatchObject({ evidenceStatus: 'available',
      leaderboard: { ranks: [{ studentId: student.actorUserId, completedDays: 1, rank: 1 },
        { studentId: 'student_lingke_demo', completedDays: 0, rank: 2 }] } });
    const locked = new ActivityService(withWorks, { nowIso: () => '2026-10-01T00:00:00+08:00' }, ids);
    expect(await locked.finalizeActivity(organizationId, draft.id)).toMatchObject({
      completedDatesByStudent: { [student.actorUserId]: ['2026-09-27'] },
    });
  });

  it('does not retroactively credit reading visits from before activity publication', async () => {
    const repository = fixture();
    const dayClock = { nowIso: () => '2026-09-27T04:00:00.000Z' };
    const service = new ActivityService(repository, dayClock, ids);
    const draft = await service.saveDraft(teacher, { ...input, conditions: [input.conditions[0]!] },
      0, 'operation_same_day_draft');
    await service.publish(teacher, draft.id, 1, 'operation_same_day_publish');
    const baseEvent = { organizationId, studentId: student.actorUserId, resourceId: 'read_zoo_demo',
      chapterId: 'chapter_1', contentVersion: 'demo-v1' };
    const checked = new ActivityService(new InMemoryActivityRepository({ ...repository.snapshot(), readingPageEvents: [
      { ...baseEvent, id: 'page_before', pageId: 'page_1', pageNumber: 1, progressVersion: 1,
        operationId: 'operation_page_before', visitedAt: '2026-09-27T09:00:00+08:00' },
      { ...baseEvent, id: 'page_after', pageId: 'page_2', pageNumber: 2, progressVersion: 2,
        operationId: 'operation_page_after', visitedAt: '2026-09-27T13:00:00+08:00' },
    ] }), dayClock, ids);
    expect(await checked.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: false,
      verifiedConditions: 0, evidenceStatus: 'available' });
  });

  it('counts only a current, version-matched exercise submission above the daily threshold', async () => {
    const resourceId = 'exercise_bird_demo';
    const initial = fixture().snapshot();
    const repository = new InMemoryActivityRepository({ ...initial, resources: [...initial.resources,
      { id: resourceId, organizationId, type: 'exercise', status: 'published', contentVersion: '1',
        questionIds: [resourceId], visibility: { type: 'classes', classIds: [classId] } }],
    });
    const service = new ActivityService(repository, clock, ids);
    const draft = await service.saveDraft(teacher, { ...input, conditions: [{ kind: 'exercise', resourceId, minimumScore: 60 }] },
      0, 'operation_exercise_day_draft');
    await service.publish(teacher, draft.id, 1, 'operation_exercise_day_publish');
    const task: TaskRecord = { id: 'task_exercise', organizationId, creatorTeacherId: teacherId, title: '鸟类练习',
      deliveryType: 'classroom', status: 'active', targetType: 'classes', targetClassIds: [classId], targetStudentIds: [],
      startsAt: '2026-09-27T00:00:00+08:00', dueAt: '2026-09-28T00:00:00+08:00',
      latePolicy: { allowLate: true, lateDays: 7 }, description: null, teacherNote: null, itemRefs: [],
      items: [{ id: 'item_bird', resourceId, resourceVersion: 1, snapshotSchemaVersion: 1,
        resourceSnapshot: { title: '鸟类练习', type: 'exercise', payload: { questionIds: [resourceId],
          questionType: 'single_choice', stem: 'Which animal can fly?', options: ['bird', 'lion'],
          correctAnswer: 'bird', explanation: 'Birds can fly.' } },
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 }, scoringRule: {}, order: 1 }],
      publishedAt: '2026-09-26T10:00:00+08:00', deadlineExtendedAt: null, visibility: 'visible',
      withdrawnAt: null, withdrawnBy: null, withdrawReason: null, recycledAt: null, recycledBy: null,
      recycleReason: null, recoverableUntil: null, version: 2 };
    const assignment: TaskAssignmentRecord = { id: 'assignment_exercise', organizationId, taskId: task.id,
      studentId: student.actorUserId, classId, status: 'awaiting_review', latestSubmissionId: 'submission_exercise',
      latestSubmissionVersion: 1, redoCount: 0, redoDueAt: null, isLate: false,
      submittedAt: '2026-09-27T09:00:00+08:00', reviewedAt: null, version: 2 };
    const submission: SubmissionRecord = { id: 'submission_exercise', organizationId, taskId: task.id,
      assignmentId: assignment.id, studentId: student.actorUserId, submissionVersion: 1, recordVersion: 1,
      status: 'submitted', answers: [{ itemId: 'item_bird', value: { kind: 'exercise', answeredQuestionCount: 1,
        questionResponses: [{ questionId: resourceId, response: 'bird', isCorrect: true }], correctQuestionCount: 1 } }],
      isLate: false, submittedAt: '2026-09-27T09:00:00+08:00', supersedesSubmissionId: null };
    const source = repository.snapshot();
    const withSubmission = (nextTask: TaskRecord, nextAssignment: TaskAssignmentRecord, nextSubmission: SubmissionRecord) =>
      new ActivityService(new InMemoryActivityRepository({ ...source, tasks: [nextTask], assignments: [nextAssignment],
        submissions: [nextSubmission] }), clock, ids);
    expect(await withSubmission(task, assignment, submission).getMyDay(student, draft.id, '2026-09-27'))
      .toMatchObject({ complete: true, evidenceStatus: 'available', verifiedConditions: 1 });
    expect(await withSubmission(task, { ...assignment, status: 'redo_required' }, submission).getMyDay(student, draft.id, '2026-09-27'))
      .toMatchObject({ complete: false, verifiedConditions: 0 });
    expect(await withSubmission({ ...task, items: [{ ...task.items[0]!, resourceVersion: 2 }] }, assignment, submission)
      .getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: false, verifiedConditions: 0 });
  });

  it('records teacher supplements and revocations with versioned reasons and recomputes the student day', async () => {
    const repository = fixture();
    const service = new ActivityService(repository, clock, ids);
    const draft = await service.saveDraft(teacher, { ...input, conditions: [input.conditions[0]!] },
      0, 'operation_override_draft');
    await service.publish(teacher, draft.id, 1, 'operation_override_publish');
    const overrideService = new ActivityService(repository, { nowIso: () => '2026-09-27T10:00:00+08:00' }, ids);
    const supplementInput = { activityId: draft.id, studentId: student.actorUserId,
      date: '2026-09-27', active: true, reason: '核对线下阅读作品后补记' };
    expect(await overrideService.getOverrideForTeacher(teacher, draft.id, student.actorUserId, '2026-09-27'))
      .toMatchObject({ version: 0, active: false, reason: null });
    await expect(service.setOverride(teacher, supplementInput, 0, 'operation_override_future'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const first = await overrideService.setOverride(teacher, supplementInput, 0, 'operation_override_first');
    expect(first).toMatchObject({ version: 1, active: true, reason: supplementInput.reason, teacherId });
    expect(await overrideService.setOverride(teacher, supplementInput, 0, 'operation_override_first')).toEqual(first);
    expect(await overrideService.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: true,
      supplemented: true, verifiedConditions: 1 });
    expect(await overrideService.getOverrideForTeacher(teacher, draft.id, student.actorUserId, '2026-09-27'))
      .toMatchObject({ version: 1, active: true, reason: supplementInput.reason });
    await expect(overrideService.getOverrideForTeacher(student, draft.id, student.actorUserId, '2026-09-27'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(overrideService.setOverride(teacher, { ...supplementInput, reason: '复用操作号修改原因' }, 0, 'operation_override_first'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(overrideService.setOverride(teacher, { ...supplementInput, date: '2026-09-29' }, 0, 'operation_override_rest'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const revoked = await overrideService.setOverride(teacher, { ...supplementInput, active: false, reason: '撤销误记' },
      1, 'operation_override_revoke');
    expect(revoked).toMatchObject({ version: 2, active: false, reason: '撤销误记' });
    expect(await overrideService.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: false,
      supplemented: false, verifiedConditions: 0 });
    expect(await overrideService.getOverrideForTeacher(teacher, draft.id, student.actorUserId, '2026-09-27'))
      .toMatchObject({ version: 2, active: false, reason: '撤销误记' });
    expect(repository.snapshot().overrides).toHaveLength(2);
    await expect(overrideService.setOverride(teacher, { ...supplementInput, active: false }, 2, 'operation_override_double_revoke'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const afterFinal = new ActivityService(repository, { nowIso: () => '2026-10-01T00:00:00+08:00' }, ids);
    await expect(afterFinal.setOverride(teacher, supplementInput, 2, 'operation_override_after_lock'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('ranks only verifiable days, preserves ties and recomputes after teacher overrides', async () => {
    const repository = fixture();
    const publishService = new ActivityService(repository, clock, ids);
    const draft = await publishService.saveDraft(teacher, { ...input, conditions: [input.conditions[0]!] },
      0, 'operation_board_draft');
    await publishService.publish(teacher, draft.id, 1, 'operation_board_publish');
    const participantIds = [student.actorUserId, 'student_lingke_demo'];
    const events = participantIds.flatMap((studentId, studentIndex) => [
      { id: `board_${studentIndex}_a`, organizationId, studentId, resourceId: 'read_zoo_demo',
        chapterId: 'chapter_1', pageId: 'page_1', pageNumber: 1, progressVersion: 1,
        contentVersion: 'demo-v1', operationId: `operation_board_${studentIndex}_a`, visitedAt: '2026-09-27T09:00:00+08:00' },
      { id: `board_${studentIndex}_b`, organizationId, studentId, resourceId: 'read_zoo_demo',
        chapterId: 'chapter_1', pageId: 'page_2', pageNumber: 2, progressVersion: 2,
        contentVersion: 'demo-v1', operationId: `operation_board_${studentIndex}_b`, visitedAt: '2026-09-27T09:05:00+08:00' },
    ]);
    events.push({ id: 'board_student_2_a', organizationId, studentId: student.actorUserId,
      resourceId: 'read_zoo_demo', chapterId: 'chapter_1', pageId: 'page_1', pageNumber: 1,
      progressVersion: 3, contentVersion: 'demo-v1', operationId: 'operation_board_2_a',
      visitedAt: '2026-09-28T09:00:00+08:00' });
    events.push({ id: 'board_student_2_b', organizationId, studentId: student.actorUserId,
      resourceId: 'read_zoo_demo', chapterId: 'chapter_1', pageId: 'page_2', pageNumber: 2,
      progressVersion: 4, contentVersion: 'demo-v1', operationId: 'operation_board_2_b',
      visitedAt: '2026-09-28T09:05:00+08:00' });
    const boardRepository = new InMemoryActivityRepository({ ...repository.snapshot(), readingPageEvents: events });
    const boardClock = { nowIso: () => '2026-09-28T10:00:00+08:00' };
    const boardService = new ActivityService(boardRepository, boardClock, ids);
    const first = await boardService.getLeaderboard(student, draft.id);
    expect(first).toMatchObject({ evidenceStatus: 'available', schoolToday: '2026-09-28', leaderboard: { effectiveDayCount: 3,
      ranks: [{ studentId: student.actorUserId, completedDays: 2, rank: 1 },
        { studentId: 'student_lingke_demo', completedDays: 1, rank: 2 }] }, myRank: { rank: 1 } });
    await boardService.setOverride(teacher, { activityId: draft.id, studentId: 'student_lingke_demo',
      date: '2026-09-28', active: true, reason: '核对线下阅读完成' }, 0, 'operation_board_supplement');
    expect((await boardService.getLeaderboard(teacher, draft.id)).leaderboard?.ranks.map(item => item.rank)).toEqual([1, 1]);
    await boardService.setOverride(teacher, { activityId: draft.id, studentId: 'student_lingke_demo',
      date: '2026-09-28', active: false, reason: '撤销误记' }, 1, 'operation_board_revoke');
    expect((await boardService.getLeaderboard(student, draft.id)).leaderboard?.ranks.map(item => item.rank)).toEqual([1, 2]);
    const tooEarly = new ActivityService(boardRepository, { nowIso: () => '2026-09-30T23:59:00+08:00' }, ids);
    await expect(tooEarly.finalizeActivity(organizationId, draft.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    const tooLate = new ActivityService(boardRepository, { nowIso: () => '2026-10-01T00:06:00+08:00' }, ids);
    await expect(tooLate.finalizeActivity(organizationId, draft.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    const locked = new ActivityService(boardRepository, { nowIso: () => '2026-10-01T00:00:00+08:00' }, ids);
    expect(await locked.getLeaderboard(student, draft.id)).toMatchObject({ evidenceStatus: 'not_available', leaderboard: null });
    const final = await locked.finalizeActivity(organizationId, draft.id);
    expect(final).toMatchObject({ lockedAt: '2026-10-01T00:00:00+08:00',
      leaderboard: { finalized: true, ranks: [{ studentId: student.actorUserId, completedDays: 2, rank: 1 },
        { studentId: 'student_lingke_demo', completedDays: 1, rank: 2 }] },
      completedDatesByStudent: { [student.actorUserId]: ['2026-09-27', '2026-09-28'] } });
    expect(await locked.finalizeActivity(organizationId, draft.id)).toEqual(final);
    expect(await locked.getLeaderboard(student, draft.id)).toMatchObject({ evidenceStatus: 'available',
      leaderboard: { finalized: true, ranks: [{ rank: 1 }, { rank: 2 }] } });
    const changedSources = new ActivityService(new InMemoryActivityRepository({ ...boardRepository.snapshot(), readingPageEvents: [] }),
      { nowIso: () => '2026-10-03T10:00:00+08:00' }, ids);
    expect(await changedSources.getLeaderboard(student, draft.id)).toMatchObject({ evidenceStatus: 'available',
      leaderboard: { ranks: [{ studentId: student.actorUserId, completedDays: 2 },
        { studentId: 'student_lingke_demo', completedDays: 1 }] } });
    expect(await changedSources.getMyDay(student, draft.id, '2026-09-28')).toMatchObject({ complete: true,
      evidenceStatus: 'available' });
    const transferred = new ActivityService(new InMemoryActivityRepository({ ...boardRepository.snapshot(),
      memberships: boardRepository.snapshot().memberships.filter(item => item.studentId !== student.actorUserId) }),
    boardClock, ids);
    await expect(transferred.getLeaderboard(student, draft.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await transferred.listForStudent(student)).toEqual([]);
  });
});
