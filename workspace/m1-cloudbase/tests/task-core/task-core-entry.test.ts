import { describe, expect, it, vi } from 'vitest';
import { createParentQueryFunction, main as unconfiguredParentQuery } from '../../functions/parent-query';
import { createReviewCommandFunction } from '../../functions/review-command';
import { createSubmissionCommandFunction } from '../../functions/submission-command';
import { createTaskCommandFunction, main as unconfiguredTaskCommand } from '../../functions/task-command';
import type { TrustedActorContext, TrustedActorResolver } from '../../src/auth/trusted-actor';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import type { FunctionName, JsonObject, ResponseMeta, ServiceResult } from '../../src/shared/protocol';

const actor: TrustedActorContext = {
  requestId: 'req_actor',
  sessionId: 'session_trusted',
  actorUserId: 'user_teacher_lin',
  actorRole: 'teacher',
  organizationId: 'org_demo',
  platformSubjectDigest: 'digest_trusted',
  permissions: ['task.publish', 'submission.review'],
  scopeIds: ['class_grade3_2'],
  authzVersion: 1,
};

const clock = { nowIso: (): string => '2026-09-16T02:00:00.000Z' };

function meta(requestId: string): ResponseMeta {
  return { requestId, serverTime: clock.nowIso(), apiVersion: 'm1.v1' };
}

function ok(data: JsonObject, requestId = 'req_handler'): ServiceResult<JsonObject> {
  return { ok: true, data, meta: meta(requestId) };
}

function createBoundary(functionName: FunctionName, resolvedActor: TrustedActorContext | null = actor) {
  let requestSequence = 0;
  const runtime: CloudBaseRuntimePort = {
    functionName,
    getPlatformSubject: vi.fn(async () => ({ subject: 'platform-subject', loginType: 'USERNAME' as const, isAuthenticated: true })),
    getBusinessSessionId: vi.fn(async () => 'session_from_runtime'),
  };
  const actorResolver: TrustedActorResolver = {
    resolve: vi.fn(async () => resolvedActor),
  };
  return {
    runtime,
    actorResolver,
    clock,
    requestIds: { next: (): string => `req_boundary_${++requestSequence}` },
  };
}

const saveTaskRequest = {
  apiVersion: 'm1.v1',
  action: 'saveDraft',
  payload: {
    title: '虚构动物主题练习',
    itemRefs: [{
      id: 'item_exercise', resourceId: 'resource_demo',
      completionRule: { kind: 'answer_required' }, scoringRule: { kind: 'manual', maxScore: 100 }, order: 1,
    }],
    target: { type: 'classes', classIds: ['class_grade3_2'] },
    startsAt: '2026-09-16T00:00:00.000Z',
    dueAt: '2026-09-17T00:00:00.000Z',
    latePolicy: { allowLate: true, lateDays: 7 },
  },
  operationId: 'operation_save_task_0001',
} as const;

describe('M1 task-core 可注入函数入口', () => {
  it('按 action 分发任务草稿与发布，并只把 resolver 返回的 actor 交给 handler', async () => {
    const boundary = createBoundary('task-command');
    const handler = {
      saveTaskDraft: vi.fn(async () => ok({ action: 'saved' })),
      copyTaskSnapshot: vi.fn(async () => ok({ action: 'copied' })),
      instantiateTemplate: vi.fn(async () => ok({ action: 'instantiated' })),
      publishTask: vi.fn(async () => ok({ action: 'published' })),
      updatePublishedTask: vi.fn(async () => ok({ action: 'updated' })),
      withdrawTask: vi.fn(async () => ok({ action: 'withdrawn' })),
      recycleTask: vi.fn(async () => ok({ action: 'recycled' })),
    };
    const main = createTaskCommandFunction({ ...boundary, handler });

    expect(await main(saveTaskRequest)).toMatchObject({ ok: true, data: { action: 'saved' } });
    expect(handler.saveTaskDraft).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ title: '虚构动物主题练习', targetClassIds: ['class_grade3_2'] }),
      0,
      'operation_save_task_0001',
    );
    expect(await main({
      ...saveTaskRequest,
      payload: { ...saveTaskRequest.payload, target: { type: 'students', studentIds: ['user_student_xiaoyu'] } },
      operationId: 'operation_save_student_target_0001',
    })).toMatchObject({ ok: true, data: { action: 'saved' } });
    expect(handler.saveTaskDraft).toHaveBeenLastCalledWith(
      actor,
      expect.objectContaining({ targetType: 'students', targetClassIds: [], targetStudentIds: ['user_student_xiaoyu'] }),
      0,
      'operation_save_student_target_0001',
    );
    expect(await main({
      apiVersion: 'm1.v1', action: 'publishTask', payload: { taskId: 'task_demo' },
      expectedVersion: 1, operationId: 'operation_publish_task_0001',
    })).toMatchObject({ ok: true, data: { action: 'published' } });
    expect(handler.publishTask).toHaveBeenCalledWith(actor, 'task_demo', 1, 'operation_publish_task_0001');
    expect(await main({
      apiVersion: 'm1.v1', action: 'copyTaskSnapshot', payload: { sourceTaskId: 'task_demo' },
      expectedVersion: 2, operationId: 'operation_copy_task_0001',
    })).toMatchObject({ ok: true, data: { action: 'copied' } });
    expect(handler.copyTaskSnapshot).toHaveBeenCalledWith(actor, 'task_demo', 2, 'operation_copy_task_0001');
    expect(await main({
      apiVersion: 'm1.v1', action: 'copyTaskSnapshot',
      payload: { sourceTaskId: 'task_demo', items: [{ resourceSnapshot: { title: '伪造内容' } }] },
      expectedVersion: 2, operationId: 'operation_copy_forged_0001',
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(handler.copyTaskSnapshot).toHaveBeenCalledTimes(1);
    expect(await main({ apiVersion: 'm1.v1', action: 'instantiateTemplate',
      payload: { templateId: 'template_demo' }, expectedVersion: 3,
      operationId: 'operation_instantiate_template_0001' }))
      .toMatchObject({ ok: true, data: { action: 'instantiated' } });
    expect(handler.instantiateTemplate).toHaveBeenCalledWith(actor, 'template_demo', 3,
      'operation_instantiate_template_0001');
    expect(await main({ apiVersion: 'm1.v1', action: 'instantiateTemplate',
      payload: { templateId: 'template_demo', items: [{ resourceSnapshot: { title: '伪造内容' } }] },
      expectedVersion: 3, operationId: 'operation_instantiate_forged_0001' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(handler.instantiateTemplate).toHaveBeenCalledTimes(1);
    expect(await main({
      apiVersion: 'm1.v1', action: 'updatePublishedTask',
      payload: { taskId: 'task_demo', dueAt: '2026-09-18T00:00:00.000Z', description: '更新说明' },
      expectedVersion: 2, operationId: 'operation_update_task_0001',
    })).toMatchObject({ ok: true, data: { action: 'updated' } });
    expect(handler.updatePublishedTask).toHaveBeenCalledWith(
      actor,
      { taskId: 'task_demo', dueAt: '2026-09-18T00:00:00.000Z', description: '更新说明' },
      2,
      'operation_update_task_0001',
    );
    expect(await main({
      apiVersion: 'm1.v1', action: 'updatePublishedTask',
      payload: {
        taskId: 'task_demo',
        itemRefs: [{ id: 'item_v2', resourceId: 'resource_demo', completionRule: {}, scoringRule: {}, order: 1 }],
        target: { type: 'students', studentIds: ['user_student_xiaoyu'] },
      },
      expectedVersion: 2, operationId: 'operation_update_task_full_0001',
    })).toMatchObject({ ok: true, data: { action: 'updated' } });
    expect(handler.updatePublishedTask).toHaveBeenLastCalledWith(
      actor,
      expect.objectContaining({
        taskId: 'task_demo', itemRefs: [expect.objectContaining({ id: 'item_v2' })],
        targetType: 'students', targetClassIds: [], targetStudentIds: ['user_student_xiaoyu'],
      }),
      2,
      'operation_update_task_full_0001',
    );
    expect(await main({
      apiVersion: 'm1.v1', action: 'withdrawTask', payload: { taskId: 'task_demo', reason: '计划调整' },
      expectedVersion: 3, operationId: 'operation_withdraw_task_0001',
    })).toMatchObject({ ok: true, data: { action: 'withdrawn' } });
    expect(await main({
      apiVersion: 'm1.v1', action: 'recycleTask', payload: { taskId: 'task_demo', reason: '确认删除' },
      expectedVersion: 4, operationId: 'operation_recycle_task_0001',
    })).toMatchObject({ ok: true, data: { action: 'recycled' } });
    expect(boundary.actorResolver.resolve).toHaveBeenCalledWith(
      { subject: 'platform-subject', loginType: 'USERNAME', isAuthenticated: true },
      'task-command',
      'session_from_runtime',
    );
  });

  it('按 action 分发学生草稿与正式提交，并映射顶层关系版本和 payload 草稿版本', async () => {
    const handler = {
      saveSubmissionDraft: vi.fn(async () => ok({ action: 'draft-saved' })),
      submit: vi.fn(async () => ok({ action: 'submitted' })),
    };
    const main = createSubmissionCommandFunction({ ...createBoundary('submission-command'), handler });
    const base = {
      apiVersion: 'm1.v1',
      payload: { taskId: 'task_demo', answers: [{ itemId: 'item_exercise', value: 'answer' }], draftVersion: 2 },
      expectedVersion: 3,
      operationId: 'operation_submission_0001',
    } as const;

    expect(await main({ ...base, action: 'saveDraft' })).toMatchObject({ ok: true, data: { action: 'draft-saved' } });
    expect(handler.saveSubmissionDraft).toHaveBeenCalledWith(actor, 'task_demo', [{ itemId: 'item_exercise', value: 'answer' }], 3, 2, 'operation_submission_0001');
    expect(await main({ ...base, action: 'submit', operationId: 'operation_submission_0002' })).toMatchObject({ ok: true, data: { action: 'submitted' } });
    expect(handler.submit).toHaveBeenCalledWith(actor, 'task_demo', [{ itemId: 'item_exercise', value: 'answer' }], 3, 2, 'operation_submission_0002');
  });

  it('分发人工点评和家长只读任务查询', async () => {
    const reviewHandler = {
      publishReview: vi.fn(async () => ok({ action: 'reviewed' })),
      publishBatchComment: vi.fn(async () => ok({ action: 'batch-reviewed' })),
    };
    const review = createReviewCommandFunction({ ...createBoundary('review-command'), handler: reviewHandler });
    expect(await review({
      apiVersion: 'm1.v1', action: 'publishReview',
      payload: { submissionId: 'submission_demo', decision: 'approved', score: 92, expectedSubmissionVersion: 1 },
      expectedVersion: 4, operationId: 'operation_review_0001',
    })).toMatchObject({ ok: true, data: { action: 'reviewed' } });
    expect(reviewHandler.publishReview).toHaveBeenCalledWith(
      actor,
      { submissionId: 'submission_demo', decision: 'approved', score: 92, expectedSubmissionVersion: 1 },
      4,
      'operation_review_0001',
    );
    expect(await review({
      apiVersion: 'm1.v1', action: 'publishReview',
      payload: { submissionId: 'submission_demo', decision: 'approved', score: 75,
        overrideReason: '复核原始作答后调整', expectedSubmissionVersion: 1 },
      expectedVersion: 4, operationId: 'operation_review_override_0001',
    })).toMatchObject({ ok: true });
    expect(reviewHandler.publishReview).toHaveBeenLastCalledWith(actor, expect.objectContaining({
      overrideReason: '复核原始作答后调整',
    }), 4, 'operation_review_override_0001');
    expect(await review({ apiVersion: 'm1.v1', action: 'publishReview',
      payload: { submissionId: 'submission_demo', decision: 'approved', expectedSubmissionVersion: 1,
        itemScores: [{ itemId: 'item_record', score: 80 }] },
      expectedVersion: 4, operationId: 'operation_review_item_scores_0001' })).toMatchObject({ ok: true });
    expect(reviewHandler.publishReview).toHaveBeenLastCalledWith(actor, expect.objectContaining({
      itemScores: [{ itemId: 'item_record', score: 80 }],
    }), 4, 'operation_review_item_scores_0001');
    expect(await review({ apiVersion: 'm1.v1', action: 'publishReview',
      payload: { submissionId: 'submission_demo', decision: 'approved', expectedSubmissionVersion: 1,
        itemScores: [{ itemId: 'item_record', score: 80, actorUserId: 'forged' }] },
      expectedVersion: 4, operationId: 'operation_review_item_scores_forged' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await review({
      apiVersion: 'm1.v1', action: 'publishBatchComment',
      payload: { previewToken: 'preview_token_demo', previewVersion: 5, textComment: '统一点评' },
      operationId: 'operation_batch_review_0001',
    })).toMatchObject({ ok: true, data: { action: 'batch-reviewed' } });
    expect(reviewHandler.publishBatchComment).toHaveBeenCalledWith(
      actor,
      'preview_token_demo',
      5,
      '统一点评',
      'operation_batch_review_0001',
    );
    expect(await review({
      apiVersion: 'm1.v1', action: 'publishBatchComment',
      payload: { previewToken: 'preview_token_demo', previewVersion: 5, textComment: '统一点评', submissionIds: ['submission_forged'] },
      operationId: 'operation_batch_review_0002',
    })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', fieldErrors: { submissionIds: expect.any(String) } },
    });
    expect(await review({
      apiVersion: 'm1.v1', action: 'publishBatchComment',
      payload: { previewToken: 'preview_token_demo', textComment: '统一点评' },
      operationId: 'operation_batch_review_0003',
    })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', fieldErrors: { previewVersion: expect.any(String) } },
    });

    const parentActor = { ...actor, actorUserId: 'user_parent', actorRole: 'parent' as const };
    const parentData = {
      taskId: 'task_demo', title: '虚构任务', studentId: 'user_student', assignmentStatus: 'completed' as const,
      submission: null, feedback: null,
    };
    const parentHandler = {
      listChildren: vi.fn(async () => ok([{ childId: 'user_student', linkId: 'link_demo' }], 'req_parent_children')),
      getHome: vi.fn(async () => ok({ action: 'parent-home' }, 'req_parent_home')),
      listChildTasks: vi.fn(async () => ok({ action: 'parent-list' }, 'req_parent_list')),
      getParentTaskResult: vi.fn(async () => ({ ok: true as const, data: parentData, meta: meta('req_parent') })),
      getFeedback: vi.fn(async () => ok({ action: 'parent-feedback' }, 'req_parent_feedback')),
    };
    const parent = createParentQueryFunction({ ...createBoundary('parent-query', parentActor), handler: parentHandler });
    expect(await parent({ apiVersion: 'm1.v1', action: 'listChildren', payload: {} })).toMatchObject({
      ok: true, data: [{ childId: 'user_student', linkId: 'link_demo' }],
    });
    expect(parentHandler.listChildren).toHaveBeenCalledWith(parentActor);
    expect(await parent({
      apiVersion: 'm1.v1', action: 'listChildren', payload: { actorUserId: 'user_forged' },
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { actorUserId: expect.any(String) } } });
    expect(await parent({ apiVersion: 'm1.v1', action: 'getChildTask', payload: { childId: 'user_student', taskId: 'task_demo' } })).toMatchObject({
      ok: true, data: { studentId: 'user_student', taskId: 'task_demo' },
    });
    expect(parentHandler.getParentTaskResult).toHaveBeenCalledWith(parentActor, 'user_student', 'task_demo');
    expect(await parent({ apiVersion: 'm1.v1', action: 'getHome', payload: { childId: 'user_student' } })).toMatchObject({ ok: true, data: { action: 'parent-home' } });
    expect(await parent({
      apiVersion: 'm1.v1', action: 'listChildTasks',
      payload: { childId: 'user_student', filters: { status: 'completed' }, page: { limit: 20 } },
    })).toMatchObject({ ok: true, data: { action: 'parent-list' } });
    expect(parentHandler.listChildTasks).toHaveBeenCalledWith(parentActor, 'user_student', { status: 'completed' }, { limit: 20 });
    expect(await parent({ apiVersion: 'm1.v1', action: 'getFeedback', payload: { childId: 'user_student', feedbackId: 'feedback_demo' } })).toMatchObject({
      ok: true, data: { action: 'parent-feedback' },
    });
  });

  it('严格拒绝顶层、payload 及嵌套对象的未知字段，包括所有伪造身份字段', async () => {
    const boundary = createBoundary('task-command');
    const handler = {
      saveTaskDraft: vi.fn(async () => ok({ action: 'saved' })),
      publishTask: vi.fn(async () => ok({ action: 'published' })),
      updatePublishedTask: vi.fn(async () => ok({ action: 'updated' })),
      withdrawTask: vi.fn(async () => ok({ action: 'withdrawn' })),
      recycleTask: vi.fn(async () => ok({ action: 'recycled' })),
    };
    const main = createTaskCommandFunction({ ...boundary, handler });
    const topLevel = await main({ ...saveTaskRequest, actorUserId: 'user_forged' });
    expect(topLevel).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { actorUserId: expect.any(String) } } });

    const payloadActor = await main({
      ...saveTaskRequest,
      payload: { ...saveTaskRequest.payload, organizationId: 'org_forged' },
    });
    expect(payloadActor).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { organizationId: expect.any(String) } } });

    const nestedActor = await main({
      ...saveTaskRequest,
      payload: { ...saveTaskRequest.payload, target: { ...saveTaskRequest.payload.target, actorRole: 'admin' } },
    });
    expect(nestedActor).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { 'target.actorRole': expect.any(String) } } });
    expect(boundary.actorResolver.resolve).not.toHaveBeenCalled();
    expect(handler.saveTaskDraft).not.toHaveBeenCalled();
  });

  it('递归拒绝非 JSON 作答值，且不静默忽略尚未接入 core 的 draftSubmissionId', async () => {
    const handler = {
      saveSubmissionDraft: vi.fn(async () => ok({ action: 'draft-saved' })),
      submit: vi.fn(async () => ok({ action: 'submitted' })),
    };
    const main = createSubmissionCommandFunction({ ...createBoundary('submission-command'), handler });
    const request = {
      apiVersion: 'm1.v1', action: 'submit', expectedVersion: 1, operationId: 'operation_submit_strict_0001',
    } as const;
    expect(await main({
      ...request,
      payload: { taskId: 'task_demo', answers: [{ itemId: 'item_exercise', value: Number.POSITIVE_INFINITY }] },
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { 'answers[0].value': expect.any(String) } } });
    expect(await main({
      ...request,
      payload: { taskId: 'task_demo', answers: [{ itemId: 'item_exercise', value: new Date() }] },
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { 'answers[0].value': expect.any(String) } } });
    expect(await main({
      ...request,
      payload: { taskId: 'task_demo', answers: [{ itemId: 'item_exercise', value: 'answer' }], draftSubmissionId: 'submission_draft' },
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { draftSubmissionId: expect.any(String) } } });
    expect(handler.submit).not.toHaveBeenCalled();
  });

  it('将 runtime、resolver 和 handler 异常映射为不含内部细节的安全错误', async () => {
    const runtimeBoundary = createBoundary('task-command');
    runtimeBoundary.runtime.getPlatformSubject = vi.fn(async () => { throw new Error('secret runtime detail'); });
    const inertHandler = {
      saveTaskDraft: vi.fn(async () => ok({})), publishTask: vi.fn(async () => ok({})),
      updatePublishedTask: vi.fn(async () => ok({})), withdrawTask: vi.fn(async () => ok({})), recycleTask: vi.fn(async () => ok({})),
    };
    const runtimeFailure = await createTaskCommandFunction({ ...runtimeBoundary, handler: inertHandler })(saveTaskRequest);
    expect(runtimeFailure).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', retryable: true } });
    expect(JSON.stringify(runtimeFailure)).not.toContain('secret runtime detail');

    const actorBoundary = createBoundary('task-command');
    actorBoundary.actorResolver.resolve = vi.fn(async () => { throw new Error('secret identity detail'); });
    const actorFailure = await createTaskCommandFunction({ ...actorBoundary, handler: inertHandler })(saveTaskRequest);
    expect(actorFailure).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', retryable: true } });
    expect(JSON.stringify(actorFailure)).not.toContain('secret identity detail');

    const throwingHandler = {
      saveTaskDraft: vi.fn(async () => { throw new Error('secret database detail'); }),
      publishTask: vi.fn(async () => ok({})),
      updatePublishedTask: vi.fn(async () => ok({})),
      withdrawTask: vi.fn(async () => ok({})),
      recycleTask: vi.fn(async () => ok({})),
    };
    const handlerFailure = await createTaskCommandFunction({ ...createBoundary('task-command'), handler: throwingHandler })(saveTaskRequest);
    expect(handlerFailure).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', retryable: true } });
    expect(JSON.stringify(handlerFailure)).not.toContain('secret database detail');
  });

  it('无可信 actor 时拒绝请求，默认 main 仍只返回未配置错误且不执行业务', async () => {
    const handler = {
      saveTaskDraft: vi.fn(async () => ok({})), publishTask: vi.fn(async () => ok({})),
      updatePublishedTask: vi.fn(async () => ok({})), withdrawTask: vi.fn(async () => ok({})), recycleTask: vi.fn(async () => ok({})),
    };
    const unauthenticated = await createTaskCommandFunction({ ...createBoundary('task-command', null), handler })(saveTaskRequest);
    expect(unauthenticated).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(handler.saveTaskDraft).not.toHaveBeenCalled();

    expect(await unconfiguredTaskCommand(saveTaskRequest)).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await unconfiguredParentQuery({
      apiVersion: 'm1.v1', action: 'getChildTask', payload: { childId: 'user_student', taskId: 'task_demo' },
    })).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});
