import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { DocumentNativeAdminGrantRepository, nativeAdminGrantId } from '../../src/native-admin/document-grant-repository';
import { NativeAdminOperationsService } from '../../src/native-admin/operations-service';

const actor: TrustedActorContext = { requestId: 'req_native_op', sessionId: 'ses_native_op',
  actorUserId: 'teacher_manager', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_teacher', permissions: ['task.read'],
  scopeIds: ['class_other'], authzVersion: 2 };

function fixture() {
  const base = { organizationId: 'org_demo', schemaVersion: 1 as const,
    version: 1, deletedAt: null };
  const database = new FakeDocumentDatabase({
    users: [{ _id: actor.actorUserId, ...base, version: 2, status: 'active', authorizationVersion: 2 }],
    native_admin_grants: [{ _id: nativeAdminGrantId(actor.organizationId, actor.actorUserId),
      ...base, teacherId: actor.actorUserId, status: 'active',
      permissions: ['textbook.manage', 'question.manage', 'task.manage'],
      scope: { organizationWide: false, classIds: ['class_one'] } }],
    classes: [{ _id: 'class_one', ...base, status: 'active' },
      { _id: 'class_other', ...base, status: 'active' }],
    learning_resources: [
      { _id: 'book_one', ...base, type: 'reading', category: 'synchronized', title: '虚构课本' },
      { _id: 'question_one', ...base, type: 'exercise', title: '虚构题目',
        status: 'draft', questionType: 'single_choice', stem: '虚构题干', correctAnswer: 'A', explanation: '虚构解析',
        visibility: { type: 'classes', classIds: ['class_one'] } },
      { _id: 'question_other', ...base, type: 'exercise', title: '另一班题目',
        status: 'draft', questionType: 'single_choice', stem: '虚构题干', correctAnswer: 'A', explanation: '虚构解析',
        visibility: { type: 'classes', classIds: ['class_other'] } },
      { _id: 'question_subjective', ...base, type: 'exercise', title: '虚构主观题',
        status: 'draft', questionType: 'subjective', stem: '请描述图片',
        correctAnswer: null, explanation: '',
        visibility: { type: 'classes', classIds: ['class_one'] } },
    ],
    tasks: [{ _id: 'task_one', ...base, status: 'scheduled', targetClassIds: ['class_one'] },
      { _id: 'task_bad_scope', ...base, status: 'scheduled', targetClassIds: ['class_one', 42] }],
    checkin_activities: [{ _id: 'activity_one', ...base, status: 'published',
      schedule: { classId: 'class_one' }, payload: { id: 'activity_one', organizationId: 'org_demo',
        status: 'published', version: 1 } }],
  });
  const service = new NativeAdminOperationsService(database,
    new DocumentNativeAdminGrantRepository(database), { nowIso: () => '2026-10-03T08:00:00+08:00' });
  return { database, service };
}

describe('native A-05/A-06/A-07 protected operations', () => {
  it('saves only a scoped textbook draft with CAS and idempotent audit', async () => {
    const { database, service } = fixture();
    const input = { resourceId: 'book_one', classIds: ['class_one'], reason: '配置虚构班级教材' };
    const first = await service.saveTextbookConfig(actor, input, 0, 'operation_textbook_config');
    expect(first).toMatchObject({ status: 'draft', version: 1 });
    expect(await service.saveTextbookConfig(actor, input, 0, 'operation_textbook_config')).toEqual(first);
    expect(database.snapshot().textbook_catalog_drafts).toHaveLength(1);
    expect(database.snapshot().operation_logs).toHaveLength(1);
    await expect(service.saveTextbookConfig(actor, { ...input, classIds: ['class_other'] }, 0,
      'operation_other_book')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('publishes and disables only a previously saved textbook scope', async () => {
    const { service } = fixture()
    const saved = await service.saveTextbookConfig(actor, { resourceId: 'book_one',
      classIds: ['class_one'], reason: '先保存配置' }, 0, 'operation_book_save')
    const published = await service.setTextbookConfigStatus(actor, { resourceId: 'book_one',
      status: 'published', reason: '发布授权范围' }, saved.version, 'operation_book_publish')
    expect(published).toMatchObject({ status: 'published', version: 2, classIds: ['class_one'] })
    expect(await service.setTextbookConfigStatus(actor, { resourceId: 'book_one',
      status: 'disabled', reason: '停止展示' }, published.version, 'operation_book_disable'))
      .toMatchObject({ status: 'disabled', version: 3 })
  })

  it('publishes only a question wholly in scope and preserves its content', async () => {
    const { database, service } = fixture();
    expect(await service.setQuestionStatus(actor, { questionId: 'question_one',
      status: 'published', reason: '核对虚构题目' }, 1, 'operation_question_publish'))
      .toMatchObject({ status: 'published', version: 2 });
    expect(database.snapshot().learning_resources?.find(row => row._id === 'question_one'))
      .toMatchObject({ correctAnswer: 'A', explanation: '虚构解析' });
    await expect(service.setQuestionStatus(actor, { questionId: 'question_other',
      status: 'published', reason: '越班尝试' }, 1, 'operation_question_cross'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.setQuestionStatus(actor, { questionId: 'question_subjective',
      status: 'published', reason: '主观题人工评分' }, 1, 'operation_subjective_publish'))
      .toMatchObject({ status: 'published', version: 2 });
  });

  it('updates question visibility only within the manager’s current class grant', async () => {
    const { database, service } = fixture()
    expect(await service.setQuestionVisibility(actor, { questionId: 'question_one',
      organizationWide: false, classIds: ['class_one'], reason: '确认可见班级' }, 1,
    'operation_question_scope')).toMatchObject({ classIds: ['class_one'], version: 2 })
    expect(database.snapshot().learning_resources?.find(row => row._id === 'question_one'))
      .toMatchObject({ visibility: { type: 'classes', classIds: ['class_one'] } })
    await expect(service.setQuestionVisibility(actor, { questionId: 'question_one',
      organizationWide: false, classIds: ['class_other'], reason: '越班尝试' }, 2,
    'operation_question_scope_other')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('applies question batch status changes atomically', async () => {
    const { database, service } = fixture()
    await expect(service.setQuestionBatchStatus(actor, { status: 'offline', reason: '整批下架',
      questions: [{ questionId: 'question_one', expectedVersion: 1 },
        { questionId: 'question_other', expectedVersion: 1 }] }, 'operation_question_batch_fail'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(database.snapshot().learning_resources?.find(row => row._id === 'question_one'))
      .toMatchObject({ status: 'draft', version: 1 })
    expect(await service.setQuestionBatchStatus(actor, { status: 'offline', reason: '整批下架',
      questions: [{ questionId: 'question_one', expectedVersion: 1 },
        { questionId: 'question_subjective', expectedVersion: 1 }] }, 'operation_question_batch_ok'))
      .toMatchObject({ changedCount: 2, items: [{ questionId: 'question_one', version: 2 },
        { questionId: 'question_subjective', version: 2 }] })
    expect(database.snapshot().learning_resources?.filter(row => row._id === 'question_one'
      || row._id === 'question_subjective').every(row => row.status === 'offline')).toBe(true)
  })

  it('withdraws a scheduled task and closes an activity with the same payload version', async () => {
    const { database, service } = fixture();
    expect(await service.stopManaged(actor, { kind: 'classroom', id: 'task_one',
      reason: '教学计划调整' }, 1, 'operation_stop_task'))
      .toMatchObject({ status: 'withdrawn', version: 2 });
    expect(await service.stopManaged(actor, { kind: 'activity', id: 'activity_one',
      reason: '活动提前结束' }, 1, 'operation_stop_activity'))
      .toMatchObject({ status: 'closed', version: 2 });
    expect(database.snapshot().checkin_activities?.[0]).toMatchObject({ status: 'closed',
      payload: { status: 'closed', version: 2 } });
    await expect(service.stopManaged({ ...actor, authzVersion: 1 }, { kind: 'classroom',
      id: 'task_one', reason: '旧会话' }, 2, 'operation_stale_stop'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.stopManaged(actor, { kind: 'classroom', id: 'task_bad_scope',
      reason: '坏班级标识' }, 1, 'operation_bad_scope'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});
