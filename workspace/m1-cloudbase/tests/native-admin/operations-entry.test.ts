import { describe, expect, it } from 'vitest';
import { main } from '../../functions/native-admin-operations-command';
import { validateNativeAdminOperationsRequest } from '../../functions/native-admin-operations-command/function-entry';

describe('native A-05—A-07 command entry', () => {
  it('requires exact payload, CAS and an operation key', () => {
    const request = { apiVersion: 'm1.v1' as const, action: 'setQuestionStatus' as const,
      payload: { questionId: 'question_demo', status: 'offline', reason: '版本纠错' },
      expectedVersion: 2, operationId: 'operation_question_offline' };
    expect(validateNativeAdminOperationsRequest(request)).toMatchObject({ ok: true });
    expect(validateNativeAdminOperationsRequest({ ...request, payload: { ...request.payload,
      actorRole: 'admin' } }).ok).toBe(false);
    expect(validateNativeAdminOperationsRequest({ ...request, expectedVersion: 0 }).ok).toBe(false);
  });

  it('validates publication lifecycle, scope changes and atomic question batches', () => {
    const base = { apiVersion: 'm1.v1' as const, expectedVersion: 1,
      operationId: 'operation_question_batch' }
    expect(validateNativeAdminOperationsRequest({ ...base, action: 'setTextbookConfigStatus',
      payload: { resourceId: 'book_demo', status: 'published', reason: '发布配置' } }).ok).toBe(true)
    expect(validateNativeAdminOperationsRequest({ ...base, action: 'setQuestionVisibility',
      payload: { questionId: 'question_demo', organizationWide: false,
        classIds: ['class_demo'], reason: '调整范围' } }).ok).toBe(true)
    expect(validateNativeAdminOperationsRequest({ ...base, action: 'setQuestionBatchStatus',
      payload: { status: 'offline', questions: [{ questionId: 'question_demo', expectedVersion: 2 }],
        reason: '批量下架' } }).ok).toBe(true)
    expect(validateNativeAdminOperationsRequest({ ...base, action: 'setQuestionBatchStatus',
      payload: { status: 'offline', questions: [{ questionId: 'question_demo', expectedVersion: 2,
        actorRole: 'admin' }], reason: '批量下架' } }).ok).toBe(false)
  })

  it('stays unavailable before reviewed native management rollout', async () => {
    expect(await main({ apiVersion: 'm1.v1', action: 'saveTextbookConfig',
      payload: { resourceId: 'book_demo', classIds: ['class_demo'], reason: '保存草稿' },
      expectedVersion: 0, operationId: 'operation_book_draft' }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});
