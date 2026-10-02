import { describe, expect, it, vi } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { ActivityService } from '../../src/activity/activity-service';
import { ACTIVITY_COLLECTIONS, DocumentActivityRepository } from '../../src/activity/document-repository';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import type { JsonValue } from '../../src/shared/protocol';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { assignmentByIdDocumentId, submissionByIdDocumentId } from '../../src/repositories/task-core-document-adapter';
import { DocumentStudentWorkRepository } from '../../src/student-work/document-repository';
import { StudentWorkService } from '../../src/student-work/service';

const organizationId = 'org_activity_demo';
const classId = 'class_activity_demo';
const teacherId = 'teacher_activity_demo';
const studentId = 'student_activity_demo';
const teacher: TrustedActorContext = { requestId: 'request_teacher', sessionId: 'session_teacher', actorUserId: teacherId,
  actorRole: 'teacher', organizationId, platformSubjectDigest: 'digest_teacher', permissions: ['task.publish', 'task.read'],
  scopeIds: [classId], authzVersion: 1 };
const student: TrustedActorContext = { ...teacher, requestId: 'request_student', sessionId: 'session_student',
  actorUserId: studentId, actorRole: 'student', permissions: [], scopeIds: [] };
const input = { title: '虚构阅读打卡', classId, startsOn: '2026-09-27', endsOn: '2026-09-29',
  restDates: ['2026-09-28'], conditions: [{ kind: 'reading' as const, resourceId: 'read_demo' }] };
const clock = { nowIso: () => '2026-09-26T04:00:00.000Z' };
let idSequence = 0;
const ids = { next: (prefix: string) => `${prefix}_demo_${++idSequence}` };

function document(id: string, fields: Record<string, VersionedDocument[string]>): VersionedDocument {
  return { _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null, ...fields };
}

function database(): FakeDocumentDatabase {
  return new FakeDocumentDatabase({
    [ACTIVITY_COLLECTIONS.organizations]: [document(organizationId, { status: 'active', timeZone: 'Asia/Shanghai' })],
    [ACTIVITY_COLLECTIONS.classes]: [document(classId, { status: 'active' })],
    [ACTIVITY_COLLECTIONS.grants]: [document('grant_activity', { teacherId, classId, status: 'active',
      permissions: ['task.publish', 'task.read'] })],
    [ACTIVITY_COLLECTIONS.memberships]: [document('membership_student', { classId, studentId, status: 'active' }),
      document('membership_inactive', { classId, studentId: 'student_inactive', status: 'inactive' })],
    [ACTIVITY_COLLECTIONS.users]: [document(studentId, { status: 'active', displayNameMasked: '小宇' }),
      document('student_inactive', { status: 'active', displayNameMasked: '不应出现' })],
    [ACTIVITY_COLLECTIONS.resources]: [document('read_demo', { type: 'reading', status: 'published', contentVersion: 'demo-v1',
      chapters: [{ id: 'chapter_1', pages: [{ id: 'page_1', pageNumber: 1 }, { id: 'page_2', pageNumber: 2 }] }],
      visibility: { type: 'classes', classIds: [classId] } }),
      document('read_other_class', { type: 'reading', status: 'published', contentVersion: 'demo-v1',
        pages: [{ id: 'page_other', chapterId: 'chapter_1', pageNumber: 1 }],
        visibility: { type: 'classes', classIds: ['class_other'] } }),
      document('read_offline', { type: 'reading', status: 'offline', contentVersion: 'demo-v1',
        pages: [{ id: 'page_offline', chapterId: 'chapter_1', pageNumber: 1 }],
        visibility: { type: 'classes', classIds: [classId] } })],
  });
}

describe('M2 activity CloudBase document boundary', () => {
  it('publishes a catalog reading resource whose chapters are stored in its payload', async () => {
    const documents = database();
    await documents.runTransaction(transaction => transaction.create(ACTIVITY_COLLECTIONS.resources,
      document('read_payload_demo', { type: 'reading', status: 'published', contentVersion: 2,
        visibility: { type: 'classes', classIds: [classId] },
        payload: { chapters: [{ id: 'chapter_payload', pages: [{ id: 'page_payload_1' },
          { id: 'page_payload_2' }] }] } })));
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, { ...input,
      conditions: [{ kind: 'reading', resourceId: 'read_payload_demo' }] },
    0, 'operation_payload_reading_draft');
    const published = await service.publish(teacher, draft.id, draft.version, 'operation_payload_reading_publish');
    expect(published).toMatchObject({ status: 'published', conditionSnapshots: [{
      resourceId: 'read_payload_demo', contentVersion: '2', pageIds: ['page_payload_1', 'page_payload_2'],
    }] });
  });

  it('commits draft, participant snapshot and receipts in document transactions', async () => {
    const documents = database();
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_document_draft');
    expect(draft).toMatchObject({ version: 1, status: 'draft', schedule: { schoolTimeZone: 'Asia/Shanghai' } });
    const published = await service.publish(teacher, draft.id, 1, 'operation_document_publish');
    expect(published).toMatchObject({ version: 2, status: 'published', participants: [{ studentId, displayNameMasked: '小宇' }],
      conditionSnapshots: [{ resourceId: 'read_demo', contentVersion: 'demo-v1', pageIds: ['page_1', 'page_2'] }] });
    expect(await service.publish(teacher, draft.id, 1, 'operation_document_publish')).toEqual(published);
    expect(await service.getForStudent(student, draft.id)).toMatchObject({ id: draft.id, version: 2 });
    const snapshot = documents.snapshot();
    expect(snapshot[ACTIVITY_COLLECTIONS.activities]).toHaveLength(1);
    expect(snapshot[ACTIVITY_COLLECTIONS.activities]?.[0]).toMatchObject({ endsOn: '2026-09-29',
      payload: { dailyInstances: [{ date: '2026-09-27' }, { date: '2026-09-29' }] } });
    expect(snapshot[ACTIVITY_COLLECTIONS.receipts]).toHaveLength(2);
    expect(JSON.stringify(snapshot[ACTIVITY_COLLECTIONS.activities])).not.toContain('student_inactive');
  });

  it('commits a future rest-day change, its receipt and its daily-instance removal atomically', async () => {
    const documents = database();
    const publishing = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await publishing.saveDraft(teacher, input, 0, 'operation_document_rest_draft');
    const published = await publishing.publish(teacher, draft.id, 1, 'operation_document_rest_publish');
    const service = new ActivityService(new DocumentActivityRepository(documents),
      { nowIso: () => '2026-09-27T10:00:00+08:00' }, ids);
    documents.failNext({ operation: 'create', collection: ACTIVITY_COLLECTIONS.receipts, kind: 'conflict' });
    await expect(service.addFutureRestDay(teacher, draft.id, '2026-09-29', '校内活动',
      published.version, 'operation_document_rest_rollback')).rejects.toThrow();
    expect(documents.snapshot()[ACTIVITY_COLLECTIONS.activities]?.[0]).toMatchObject({ version: 2,
      payload: { schedule: { restDates: ['2026-09-28'] }, restDayChanges: [] } });
    const changed = await service.addFutureRestDay(teacher, draft.id, '2026-09-29', '校内活动',
      published.version, 'operation_document_rest_success');
    expect(await service.addFutureRestDay(teacher, draft.id, '2026-09-29', '校内活动',
      published.version, 'operation_document_rest_success')).toEqual(changed);
    expect(await service.listForTeacher(teacher)).toMatchObject([{ restDayChanges: [{ date: '2026-09-29',
      reason: '校内活动', teacherId, activityVersion: 3 }] }]);
    const studentView = await service.getForStudent(student, draft.id);
    expect(studentView).toMatchObject({ schedule: { restDates: ['2026-09-28', '2026-09-29'] },
      dailyInstances: [{ date: '2026-09-27' }] });
    expect(JSON.stringify(studentView)).not.toContain('校内活动');
    expect(documents.snapshot()[ACTIVITY_COLLECTIONS.receipts]).toHaveLength(3);
  });

  it('rejects a published activity whose stored daily occurrence omits an effective date', async () => {
    const documents = database();
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_instances_draft');
    const published = await service.publish(teacher, draft.id, 1, 'operation_instances_publish');
    const stored = documents.snapshot()[ACTIVITY_COLLECTIONS.activities]?.[0];
    if (!stored) throw new Error('activity document missing');
    await documents.runTransaction(tx => tx.replace(ACTIVITY_COLLECTIONS.activities, published.id, 2,
      { ...stored, version: 3, payload: { ...published, version: 3,
        dailyInstances: published.dailyInstances.slice(1) } as unknown as JsonValue }));
    await expect(service.getForStudent(student, published.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps a stopped draft readable to its teacher without creating student occurrences', async () => {
    const documents = database();
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_stopped_draft');
    const stored = documents.snapshot()[ACTIVITY_COLLECTIONS.activities]?.[0];
    if (!stored) throw new Error('activity document missing');
    await documents.runTransaction(tx => tx.replace(ACTIVITY_COLLECTIONS.activities, draft.id, 1,
      { ...stored, version: 2, status: 'closed', payload: { ...draft, version: 2, status: 'closed',
        closedAt: clock.nowIso(), updatedAt: clock.nowIso() } as unknown as JsonValue }));
    expect(await service.listForTeacher(teacher)).toMatchObject([{ status: 'closed', dailyInstances: [] }]);
    await expect(service.getForStudent(student, draft.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rolls back the activity state when the receipt write fails', async () => {
    const documents = database();
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_document_rollback_draft');
    documents.failNext({ operation: 'create', collection: ACTIVITY_COLLECTIONS.receipts, kind: 'conflict' });
    await expect(service.publish(teacher, draft.id, 1, 'operation_document_rollback_publish')).rejects.toThrow();
    const stored = documents.snapshot()[ACTIVITY_COLLECTIONS.activities]?.[0];
    expect(stored).toMatchObject({ version: 1, status: 'draft' });
    expect(documents.snapshot()[ACTIVITY_COLLECTIONS.receipts]).toHaveLength(1);
  });

  it('rechecks resource type, current status and class visibility at publish time', async () => {
    const documents = database();
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    for (const resourceId of ['read_other_class', 'read_offline']) {
      const draft = await service.saveDraft(teacher, { ...input, conditions: [{ kind: 'reading', resourceId }] },
        0, `operation_draft_${resourceId}`);
      await expect(service.publish(teacher, draft.id, 1, `operation_publish_${resourceId}`))
        .rejects.toMatchObject({ code: 'RESOURCE_OFFLINE' });
    }
    const wrongType = await service.saveDraft(teacher, { ...input, conditions: [{ kind: 'vocabulary', resourceId: 'read_demo', requiredWordCount: 1 }] },
      0, 'operation_draft_wrong_type');
    await expect(service.publish(teacher, wrongType.id, 1, 'operation_publish_wrong_type'))
      .rejects.toMatchObject({ code: 'RESOURCE_OFFLINE' });
    expect(documents.snapshot()[ACTIVITY_COLLECTIONS.activities]?.every(activity => activity.status === 'draft')).toBe(true);
  });

  it('rejects cross-organization actor reads and malformed stored activities', async () => {
    const documents = database();
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    await expect(service.saveDraft({ ...teacher, organizationId: 'org_other' }, input, 0, 'operation_other_org'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await documents.runTransaction(transaction => transaction.create(ACTIVITY_COLLECTIONS.activities,
      document('activity_corrupt', { status: 'published', classId, payload: { title: 'missing fields' } })));
    await expect(service.getForStudent(student, 'activity_corrupt')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('projects only approved fields from stored activity payloads', async () => {
    const documents = database();
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_document_projection_draft');
    const published = await service.publish(teacher, draft.id, 1, 'operation_document_projection_publish');
    const stored = documents.snapshot()[ACTIVITY_COLLECTIONS.activities]?.[0];
    if (!stored) throw new Error('activity document missing');
    const polluted = { ...published, version: 3, privateNote: '教师内部信息',
      participants: published.participants.map(person => ({ ...person, studentNumber: '0321' })),
      schedule: { ...published.schedule, conditions: [{ kind: 'reading', resourceId: 'read_demo', studentNumber: '0321' }] } };
    await documents.runTransaction(transaction => transaction.replace(ACTIVITY_COLLECTIONS.activities, published.id, 2,
      { ...stored, version: 3, payload: JSON.parse(JSON.stringify(polluted)) as JsonValue }));
    const visible = await service.getForStudent(student, published.id);
    expect(visible.version).toBe(3);
    expect(JSON.stringify(visible)).not.toContain('studentNumber');
    expect(JSON.stringify(visible)).not.toContain('教师内部信息');
  });

  it('keeps the published page set and version after the source reading content changes', async () => {
    const documents = database();
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_snapshot_draft');
    const published = await service.publish(teacher, draft.id, 1, 'operation_snapshot_publish');
    const originalResource = documents.snapshot()[ACTIVITY_COLLECTIONS.resources]?.find(item => item._id === 'read_demo');
    if (!originalResource) throw new Error('reading resource missing');
    await documents.runTransaction(transaction => transaction.replace(ACTIVITY_COLLECTIONS.resources, 'read_demo', 1,
      { ...originalResource, version: 2, status: 'offline', contentVersion: 'demo-v2',
        chapters: [{ id: 'chapter_new', pages: [{ id: 'page_new', pageNumber: 1 }] }] }));
    expect(await service.getForStudent(student, published.id)).toMatchObject({ conditionSnapshots: [{
      contentVersion: 'demo-v1', pageIds: ['page_1', 'page_2'],
    }] });
  });

  it('reconstructs a reading day from saved page events and rejects a corrupt event', async () => {
    const documents = database();
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_document_day_draft');
    await service.publish(teacher, draft.id, 1, 'operation_document_day_publish');
    await documents.runTransaction(async transaction => {
      await transaction.create(ACTIVITY_COLLECTIONS.readingPageEvents, document('visit_page_1', {
        id: 'visit_page_1', studentId, resourceId: 'read_demo', chapterId: 'chapter_1', pageId: 'page_1',
        pageNumber: 1, progressVersion: 1, contentVersion: 'demo-v1', operationId: 'operation_visit_1',
        visitedAt: '2026-09-27T09:00:00+08:00',
      }));
      await transaction.create(ACTIVITY_COLLECTIONS.readingPageEvents, document('visit_page_2', {
        id: 'visit_page_2', studentId, resourceId: 'read_demo', chapterId: 'chapter_1', pageId: 'page_2',
        pageNumber: 2, progressVersion: 2, contentVersion: 'demo-v1', operationId: 'operation_visit_2',
        visitedAt: '2026-09-27T09:05:00+08:00',
      }));
    });
    expect(await service.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: true, verifiedConditions: 1 });
    expect(await service.getLeaderboard(student, draft.id)).toMatchObject({ evidenceStatus: 'available',
      leaderboard: { ranks: [{ studentId, completedDays: 1, rank: 1 }] } });
    await documents.runTransaction(transaction => transaction.replace(ACTIVITY_COLLECTIONS.readingPageEvents,
      'visit_page_2', 1, { ...documents.snapshot()[ACTIVITY_COLLECTIONS.readingPageEvents]![1]!, version: 2, pageNumber: -1 }));
    await expect(service.getMyDay(student, draft.id, '2026-09-27')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('reads saved first spelling attempts for a frozen word condition and rejects corrupt records', async () => {
    const documents = database();
    await documents.runTransaction(transaction => transaction.create(ACTIVITY_COLLECTIONS.resources,
      document('pack_animals_demo', { type: 'vocabulary', status: 'published', contentVersion: 'demo-v1',
        words: [{ id: 'word_1', word: 'tiger' }, { id: 'word_2', word: 'lion' }],
        visibility: { type: 'classes', classIds: [classId] } })));
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, { ...input, conditions: [{ kind: 'vocabulary',
      resourceId: 'pack_animals_demo', requiredWordCount: 2 }] }, 0, 'operation_doc_words_draft');
    await service.publish(teacher, draft.id, 1, 'operation_doc_words_publish');
    const attempt = (id: string, wordId: string, attemptedAt: string) => document(id, { id, studentId,
      packId: 'pack_animals_demo', taskId: null, itemId: null, round: 0, contentVersion: 'demo-v1',
      wordId, studentInput: 'wrong', isCorrect: false, firstAttempt: true,
      attemptNumber: 1, attemptedAt });
    await documents.runTransaction(async transaction => {
      await transaction.create(ACTIVITY_COLLECTIONS.vocabularyAttempts,
        attempt('attempt_word_1', 'word_1', '2026-09-27T09:00:00+08:00'));
      await transaction.create(ACTIVITY_COLLECTIONS.vocabularyAttempts,
        attempt('attempt_word_2', 'word_2', '2026-09-27T09:01:00+08:00'));
    });
    expect(await service.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: true,
      evidenceStatus: 'available', completedAt: '2026-09-27T09:01:00+08:00' });
    await documents.runTransaction(transaction => transaction.replace(ACTIVITY_COLLECTIONS.vocabularyAttempts,
      'attempt_word_2', 1, { ...documents.snapshot()[ACTIVITY_COLLECTIONS.vocabularyAttempts]![1]!,
        version: 2, firstAttempt: false }));
    await expect(service.getMyDay(student, draft.id, '2026-09-27')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('counts a submitted, sealed student work from the shared document store', async () => {
    const documents = database();
    const materialId = 'material_dubbing_demo';
    await documents.runTransaction(transaction => transaction.create(ACTIVITY_COLLECTIONS.resources,
      document(materialId, { id: materialId, type: 'work', title: '动物配音', status: 'published',
        contentVersion: 'demo-v1', visibility: { type: 'classes', classIds: [classId] },
        payload: { demonstrationFileId: 'cloud://demo/materials/animals.mp4', subtitle: 'Animals are here.' } })));
    const activity = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await activity.saveDraft(teacher, { ...input, conditions: [{ kind: 'work', resourceId: materialId }] },
      0, 'operation_doc_work_activity_draft');
    await activity.publish(teacher, draft.id, 1, 'operation_doc_work_activity_publish');
    const digest = 'c'.repeat(64);
    const works = new StudentWorkService(new DocumentStudentWorkRepository(documents), {
      async inspectAndSeal(input) { return { fileId: `cloud://demo/student-works/private/demo/${input.workId}/${digest}.mp3`,
        contentSha256: digest, sizeBytes: 100_000, durationMs: 10_000, codec: 'mp3' }; },
    }, { nowIso: () => '2026-09-27T09:00:00+08:00' }, ids);
    const workDraft = await works.beginDraft(student, materialId, 'operation_doc_work_begin');
    await works.submit(student, { workId: workDraft.id, stagingFileId: `cloud://demo/${workDraft.stagingPath}`,
      note: '' }, 1, 'operation_doc_work_submit');
    expect(await activity.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: true,
      evidenceStatus: 'available', verifiedConditions: 1 });
  });

  it('reads only the current saved exercise submission from document records', async () => {
    const documents = database();
    const questionId = 'exercise_bird_demo';
    await documents.runTransaction(async transaction => {
      await transaction.create(ACTIVITY_COLLECTIONS.resources, document(questionId, { type: 'exercise',
        status: 'published', contentVersion: 1, visibility: { type: 'classes', classIds: [classId] },
        payload: { questionIds: [questionId] } }));
      await transaction.create(ACTIVITY_COLLECTIONS.tasks, document('task_exercise_demo', { id: 'task_exercise_demo',
        status: 'active', publishedAt: '2026-09-26T00:00:00+08:00', items: [{ id: 'item_bird', resourceId: questionId,
          resourceVersion: 1, resourceSnapshot: { title: '鸟类题', type: 'exercise', payload: {
            questionIds: [questionId], questionType: 'single_choice', stem: 'Which animal can fly?',
            options: ['bird', 'lion'], correctAnswer: 'bird', explanation: 'Birds can fly.' } } }] }));
      await transaction.create(ACTIVITY_COLLECTIONS.assignments,
        document(assignmentByIdDocumentId(organizationId, 'assignment_exercise_demo'), { id: 'assignment_exercise_demo',
          taskId: 'task_exercise_demo', studentId, classId, status: 'awaiting_review',
          latestSubmissionId: 'submission_exercise_demo', latestSubmissionVersion: 1 }));
      await transaction.create(ACTIVITY_COLLECTIONS.submissions,
        document(submissionByIdDocumentId(organizationId, 'submission_exercise_demo'), { id: 'submission_exercise_demo',
          taskId: 'task_exercise_demo', assignmentId: 'assignment_exercise_demo', studentId,
          status: 'submitted', submissionVersion: 1, submittedAt: '2026-09-27T09:00:00+08:00',
          answers: [{ itemId: 'item_bird', value: { kind: 'exercise', answeredQuestionCount: 1,
            correctQuestionCount: 1, questionResponses: [{ questionId, response: 'bird', isCorrect: true }] } }] }));
    });
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, { ...input,
      conditions: [{ kind: 'exercise', resourceId: questionId, minimumScore: 60 }] }, 0, 'operation_doc_exercise_draft');
    await service.publish(teacher, draft.id, 1, 'operation_doc_exercise_publish');
    expect(await service.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: true,
      evidenceStatus: 'available', verifiedConditions: 1 });
    const boardService = new ActivityService(new DocumentActivityRepository(documents),
      { nowIso: () => '2026-09-27T10:00:00+08:00' }, ids);
    expect(await boardService.getLeaderboard(student, draft.id)).toMatchObject({
      leaderboard: { ranks: [{ studentId, completedDays: 1, rank: 1 }] },
    });
  });

  it('keeps an unrelated legacy assignment with only _id from breaking the exercise leaderboard', async () => {
    const documents = database();
    const questionId = 'exercise_legacy_boundary_demo';
    await documents.runTransaction(async transaction => {
      await transaction.create(ACTIVITY_COLLECTIONS.resources, document(questionId, { type: 'exercise',
        status: 'published', contentVersion: 1, visibility: { type: 'classes', classIds: [classId] },
        payload: { questionIds: [questionId] } }));
      await transaction.create(ACTIVITY_COLLECTIONS.assignments,
        document('legacy_assignment_without_id', { taskId: 'legacy_task_unrelated', studentId, classId,
          status: 'not_started', latestSubmissionId: null }));
      await transaction.create(ACTIVITY_COLLECTIONS.assignments,
        document('legacy_assignment_with_unrelated_submission', { taskId: 'legacy_task_unrelated',
          studentId, classId, status: 'completed', latestSubmissionId: 'legacy_submission_unrelated' }));
      await transaction.create(ACTIVITY_COLLECTIONS.tasks,
        document('legacy_task_unrelated', { status: 'completed', publishedAt: '2026-09-25T00:00:00+08:00',
          items: [{ id: 'legacy_reading_item', resourceId: 'read_demo' }] }));
    });
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, { ...input,
      conditions: [{ kind: 'exercise', resourceId: questionId, minimumScore: 60 }] }, 0,
    'operation_legacy_exercise_draft');
    await service.publish(teacher, draft.id, 1, 'operation_legacy_exercise_publish');
    expect(await service.getLeaderboard(student, draft.id)).toMatchObject({ evidenceStatus: 'available',
      leaderboard: { ranks: [{ studentId, completedDays: 0, rank: 1 }] } });
  });

  it('reads active users once when publishing a 500-person activity', async () => {
    const documents = database();
    await documents.runTransaction(async tx => {
      for (let index = 1; index < 500; index += 1) {
        const id = `student_capacity_${index}`;
        await tx.create(ACTIVITY_COLLECTIONS.users, document(id, { status: 'active',
          displayNameMasked: `虚构学员${index}` }));
        await tx.create(ACTIVITY_COLLECTIONS.memberships,
          document(`member_capacity_${index}`, { classId, studentId: id, status: 'active' }));
      }
    });
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_bulk_users_draft');
    let userGets = 0;
    let userFinds = 0;
    const original = documents.runTransaction.bind(documents);
    vi.spyOn(documents, 'runTransaction').mockImplementation(work => original(tx => work({
      get: (collection, id) => { if (collection === ACTIVITY_COLLECTIONS.users) userGets += 1;
        return tx.get(collection, id); },
      find: (collection, criteria) => { if (collection === ACTIVITY_COLLECTIONS.users) userFinds += 1;
        return tx.find(collection, criteria); },
      create: (collection, row) => tx.create(collection, row),
      replace: (collection, id, version, row) => tx.replace(collection, id, version, row),
      delete: (collection, id, version) => tx.delete(collection, id, version),
      append: (collection, row) => tx.append(collection, row),
    })));
    const published = await service.publish(teacher, draft.id, 1, 'operation_bulk_users_publish');
    expect(published.participants).toHaveLength(500);
    expect(userGets).toBe(0);
    expect(userFinds).toBe(1);
  }, 30_000);

  it('persists append-only teacher supplements and rolls them back with failed receipts', async () => {
    const documents = database();
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_document_override_draft');
    await service.publish(teacher, draft.id, 1, 'operation_document_override_publish');
    const overrideService = new ActivityService(new DocumentActivityRepository(documents),
      { nowIso: () => '2026-09-27T10:00:00+08:00' }, ids);
    const supplement = { activityId: draft.id, studentId, date: '2026-09-27', active: true,
      reason: '核对线下作品' };
    const first = await overrideService.setOverride(teacher, supplement, 0, 'operation_document_override_first');
    expect(first).toMatchObject({ active: true, version: 1 });
    expect(await service.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: true, supplemented: true });
    documents.failNext({ operation: 'create', collection: ACTIVITY_COLLECTIONS.receipts, kind: 'conflict' });
    await expect(overrideService.setOverride(teacher, { ...supplement, active: false, reason: '撤销误记' },
      1, 'operation_document_override_failed_revoke')).rejects.toThrow();
    expect(documents.snapshot()[ACTIVITY_COLLECTIONS.overrides]).toHaveLength(1);
    expect(await service.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: true, supplemented: true });
    await overrideService.setOverride(teacher, { ...supplement, active: false, reason: '撤销误记' },
      1, 'operation_document_override_revoke');
    expect(await service.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: false, supplemented: false });
    expect(documents.snapshot()[ACTIVITY_COLLECTIONS.overrides]).toHaveLength(2);
  });

  it('creates one immutable final board and serves it after source events change', async () => {
    const documents = database();
    const service = new ActivityService(new DocumentActivityRepository(documents), clock, ids);
    const draft = await service.saveDraft(teacher, input, 0, 'operation_final_document_draft');
    await service.publish(teacher, draft.id, 1, 'operation_final_document_publish');
    await documents.runTransaction(async transaction => {
      for (const [index, pageId] of ['page_1', 'page_2'].entries()) {
        await transaction.create(ACTIVITY_COLLECTIONS.readingPageEvents, document(`final_visit_${index}`, {
          id: `final_visit_${index}`, studentId, resourceId: 'read_demo', chapterId: 'chapter_1', pageId,
          pageNumber: index + 1, progressVersion: index + 1, contentVersion: 'demo-v1',
          operationId: `operation_final_visit_${index}`, visitedAt: `2026-09-27T09:0${index}:00+08:00`,
        }));
      }
    });
    const locked = new ActivityService(new DocumentActivityRepository(documents),
      { nowIso: () => '2026-09-30T00:00:00+08:00' }, ids);
    expect(await locked.getLeaderboard(student, draft.id)).toMatchObject({ evidenceStatus: 'not_available', leaderboard: null });
    const final = await locked.finalizeActivity(organizationId, draft.id);
    expect(final).toMatchObject({ leaderboard: { finalized: true, ranks: [{ completedDays: 1, rank: 1 }] },
      completedDatesByStudent: { [studentId]: ['2026-09-27'] } });
    expect(await locked.finalizeActivity(organizationId, draft.id)).toEqual(final);
    expect(documents.snapshot()[ACTIVITY_COLLECTIONS.finalBoards]).toHaveLength(1);
    await documents.runTransaction(transaction => transaction.delete(ACTIVITY_COLLECTIONS.readingPageEvents, 'final_visit_0', 1));
    expect(await locked.getLeaderboard(student, draft.id)).toMatchObject({ evidenceStatus: 'available',
      leaderboard: { finalized: true, ranks: [{ completedDays: 1, rank: 1 }] } });
    expect(await locked.getMyDay(student, draft.id, '2026-09-27')).toMatchObject({ complete: true });
  });
});
