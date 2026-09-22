import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceResult } from '../../miniprogram/domain/types'
import {
  CloudCallContext,
  CloudFunctionInvoker,
  FunctionName,
  FunctionRequest,
} from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories, getRepositoryMode } from '../../miniprogram/repositories/repository-factory'
import { getDraftOptions, getHome, getParentFeedback, getParentHome, getReadingProgress, getReadingResource, getTaskDetail, getVocabularyProgress, listReadingResources, listVocabularyPacks, login, logout, publishClassroomTask, requestPasswordResetCode, resetPassword, saveDraft, saveReadingProgress, saveVocabularyProgress, selectRole, submitTask } from '../../miniprogram/services/app-service'
import { initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'
import {
  PARENT_QUERY_ACTIONS,
  SUBMISSION_COMMAND_ACTIONS,
  TASK_COMMAND_ACTIONS,
  validateParentQueryRequest,
  validateSubmissionCommandRequest,
  validateTaskCommandRequest,
} from '../../m1-cloudbase/src/contracts/task-core-functions'
import { parseFunctionRequest } from '../../m1-cloudbase/src/shared/validation'
import { createTaskCommandFunction } from '../../m1-cloudbase/functions/task-command'
import { createSubmissionCommandFunction } from '../../m1-cloudbase/functions/submission-command'
import { createParentQueryFunction } from '../../m1-cloudbase/functions/parent-query'
import { createTaskQueryFunction } from '../../m1-cloudbase/functions/task-query'
import type { TrustedActorContext } from '../../m1-cloudbase/src/auth/trusted-actor'
import type { FunctionName as ServerFunctionName } from '../../m1-cloudbase/src/shared/protocol'

const structuredDraft = {
  items: [
    { id: 'item_reading', resourceId: 'resource_reading', type: 'reading' as const, requiredCount: 3, maxScore: 100 },
    { id: 'item_words', resourceId: 'resource_words', type: 'vocabulary' as const, requiredCount: 8, maxScore: 100 },
    { id: 'item_questions', resourceId: 'resource_questions', type: 'exercise' as const, requiredCount: 5, maxScore: 100 },
  ],
  target: { type: 'classes' as const, classIds: ['class_grade3_2'] },
  startsAt: '2026-09-16T00:00:00.000Z',
  dueAt: '2026-09-17T00:00:00.000Z',
  latePolicy: { allowLate: true, lateDays: 7 },
}

const structuredAnswers = [
  { itemId: 'item_reading', value: { kind: 'reading' as const, completedPageCount: 3 } },
  { itemId: 'item_words', value: { kind: 'vocabulary' as const, completedWordCount: 8, correctWordCount: 7 } },
  { itemId: 'item_questions', value: { kind: 'exercise' as const, answeredQuestionCount: 5, correctQuestionCount: 4 } },
]

const serverActor = (role: 'student' | 'parent' | 'teacher'): TrustedActorContext => ({
  requestId: `req_${role}`,
  sessionId: `ses_${role}`,
  actorUserId: `user_${role}`,
  actorRole: role,
  organizationId: 'org_demo',
  platformSubjectDigest: `digest_${role}`,
  permissions: role === 'teacher' ? ['task.publish'] : [],
  scopeIds: role === 'teacher' ? ['class_grade3_2'] : [`user_${role}`],
  authzVersion: 1,
})

function serverBoundary(functionName: ServerFunctionName, role: 'student' | 'parent' | 'teacher') {
  return {
    runtime: {
      functionName,
      getPlatformSubject: async () => ({ subject: `subject_${role}`, loginType: 'USERNAME' as const, isAuthenticated: true }),
      getBusinessSessionId: async () => `ses_${role}`,
    },
    actorResolver: { resolve: async () => serverActor(role) },
    clock: { nowIso: () => '2026-09-16T05:00:00.000Z' },
    requestIds: { next: () => `req_boundary_${functionName}` },
  }
}

const serverSuccess = (data: object) => ({
  ok: true as const,
  data,
  meta: { requestId: 'req_handler', serverTime: '2026-09-16T05:00:00.000Z', apiVersion: 'm1.v1' as const },
})

interface RecordedCall {
  functionName: FunctionName
  request: FunctionRequest<string, object>
  context: CloudCallContext
}

class FakeInvoker implements CloudFunctionInvoker {
  public readonly calls: RecordedCall[] = []
  private readonly responses: ServiceResult<unknown>[] = []
  private nextError: unknown = null

  public enqueue<T>(response: ServiceResult<T>): void {
    this.responses.push(response)
  }

  public rejectNext(error: unknown): void {
    this.nextError = error
  }

  public async call<TAction extends string, TPayload extends object, TResult>(
    functionName: FunctionName,
    request: FunctionRequest<TAction, TPayload>,
    context: CloudCallContext,
  ): Promise<ServiceResult<TResult>> {
    this.calls.push({ functionName, request: request as FunctionRequest<string, object>, context })
    if (this.nextError !== null) {
      const error = this.nextError
      this.nextError = null
      throw error
    }
    const response = this.responses.shift()
    if (response === undefined) throw new Error('FakeInvoker response queue is empty')
    return response as ServiceResult<TResult>
  }
}

const success = <T>(data: T, requestId = 'req_test'): ServiceResult<T> => ({ ok: true, data, meta: { requestId } })

describe('repository factory and CloudBase request mapping', () => {
  beforeEach(() => {
    configureRepositories({ mode: 'memory' })
    replaceState(initialState)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    configureRepositories({ mode: 'memory' })
  })

  it('keeps memory as the default and preserves the existing M0 login behavior', async () => {
    expect(getRepositoryMode()).toBe('memory')

    const result = await login('13800000001', '123456')
    const options = await getDraftOptions('usr_teacher_lin', { now: () => new Date('2026-09-16T02:00:00.000Z') })

    expect(result).toMatchObject({ ok: true, data: { user: { id: 'usr_student_xiaoyu', role: 'student' } } })
    expect(options).toMatchObject({ ok: true, data: { resources: [{ type: 'reading' }, { type: 'vocabulary' }, { type: 'exercise' }] } })
  })

  it('maps a student home query without putting caller identity in the payload', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success({ localDate: '2026-09-16', completedCount: 2, totalCount: 3, nextTask: null }))
    configureRepositories({
      mode: 'cloudbase',
      invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_student', localDate: '2026-09-16' }),
    })

    const result = await getHome('untrusted_student_id')

    expect(getRepositoryMode()).toBe('cloudbase')
    expect(result).toMatchObject({ ok: true, data: { completedCount: 2, totalCount: 3 } })
    expect(invoker.calls).toEqual([{
      functionName: 'student-task-query',
      request: { apiVersion: 'm1.v1', action: 'getHome', payload: { localDate: '2026-09-16' } },
      context: { businessSessionToken: 'ses_student' },
    }])
    expect(invoker.calls[0]?.request.payload).not.toHaveProperty('userId')
    expect(invoker.calls[0]?.request.payload).not.toHaveProperty('sessionId')
  })

  it('authenticates outside the business function and never sends a stale local token to bootstrap', async () => {
    const invoker = new FakeInvoker()
    const credentials: { mobile: string; password: string }[] = []
    invoker.enqueue(success({
      sessionId: 'ses_bootstrap', userId: 'usr_student', organizationId: 'org_demo',
      activeRole: null, roles: ['student'], displayName: '小宇',
    }, 'req_bootstrap'))
    invoker.enqueue(success({
      sessionId: 'ses_bootstrap', userId: 'usr_student', organizationId: 'org_demo',
      activeRole: 'student', roles: ['student'], displayName: '小宇',
    }, 'req_select'))
    configureRepositories({
      mode: 'cloudbase',
      invoker,
      authentication: { signIn: async input => { credentials.push(input) } },
      context: () => ({ sessionId: 'ses_stale_memory_session' }),
    })

    const result = await login('13800000001', 'secret-only-for-auth-sdk')

    expect(credentials).toEqual([{ mobile: '13800000001', password: 'secret-only-for-auth-sdk' }])
    expect(result).toMatchObject({
      ok: true,
      data: { sessionId: 'ses_bootstrap', user: { id: 'usr_student', displayName: '小宇', role: 'student' } },
      meta: { requestId: 'req_select' },
    })
    expect(invoker.calls).toEqual([
      {
        functionName: 'auth-session',
        request: { apiVersion: 'm1.v1', action: 'bootstrap', payload: {} },
      context: { businessSessionToken: null },
      },
      {
        functionName: 'auth-session',
        request: { apiVersion: 'm1.v1', action: 'selectRole', payload: { role: 'student' } },
        context: { businessSessionToken: 'ses_bootstrap' },
      },
    ])
    expect(JSON.stringify(invoker.calls)).not.toContain('secret-only-for-auth-sdk')
  })

  it('uses the assignment aggregate version and maps all three structured answer types for a draft write', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success({
      submissionId: 'sub_1', submissionVersion: 4, recordVersion: 1,
      assignmentVersion: 2, status: 'draft', submittedAt: null,
    }, 'req_draft'))
    configureRepositories({
      mode: 'cloudbase',
      invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_student' }),
    })

    const result = await saveDraft('untrusted_student_id', {
      operationId: 'op_save_12345678', expectedVersion: 0, assignmentVersion: 1,
      taskId: 'task_1', answer: '保留在页面的文字输入', structuredAnswers,
    })

    expect(result).toMatchObject({ ok: true, data: { id: 'sub_1', version: 4, recordVersion: 1, assignmentVersion: 2 }, meta: { requestId: 'req_draft' } })
    expect(invoker.calls[0]).toEqual({
      functionName: 'submission-command',
      request: {
        apiVersion: 'm1.v1',
        action: 'saveDraft',
        payload: { taskId: 'task_1', answers: structuredAnswers },
        operationId: 'op_save_12345678',
        expectedVersion: 1,
      },
      context: { businessSessionToken: 'ses_student' },
    })
    const parsed = parseFunctionRequest(invoker.calls[0]?.request, SUBMISSION_COMMAND_ACTIONS)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(validateSubmissionCommandRequest(parsed.value).ok).toBe(true)
    const saveSubmissionDraft = vi.fn(async () => serverSuccess({ submissionId: 'accepted_draft' }))
    const submissionMain = createSubmissionCommandFunction({
      ...serverBoundary('submission-command', 'student'),
      handler: { saveSubmissionDraft, submit: vi.fn(async () => serverSuccess({ submissionId: 'unused' })) },
    })
    expect(await submissionMain(invoker.calls[0]?.request)).toMatchObject({ ok: true })
    expect(saveSubmissionDraft).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: 'student' }), 'task_1', structuredAnswers, 1, undefined, 'op_save_12345678',
    )
  })

  it('reads initial assignment version 1, advances it from a receipt, and refuses legacy string-only cloud submission', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success({
      taskId: 'task_1', title: '三类学习任务', description: null,
      startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-17T00:00:00.000Z',
      items: [
        { id: 'item_reading', title: '阅读', type: 'reading', completionRule: { kind: 'reading_pages', requiredPageCount: 3 } },
        { id: 'item_words', title: '单词', type: 'vocabulary', completionRule: { kind: 'vocabulary_words', requiredWordCount: 8 } },
        { id: 'item_questions', title: '习题', type: 'exercise', completionRule: { kind: 'exercise_questions', requiredQuestionCount: 5 } },
      ], assignment: { status: 'not_started', submittedAt: null, redoCount: 0, redoDueAt: null, version: 1 },
      submission: null, feedback: null,
    }))
    configureRepositories({
      mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_student' }),
    })

    const detail = await getTaskDetail('untrusted_student_id', 'task_1')
    expect(detail).toMatchObject({
      ok: true,
      data: {
        assignment: { version: 1 },
        task: { items: [
          { completionRuleData: { kind: 'reading_pages', requiredPageCount: 3 } },
          { completionRuleData: { kind: 'vocabulary_words', requiredWordCount: 8 } },
          { completionRuleData: { kind: 'exercise_questions', requiredQuestionCount: 5 } },
        ] },
      },
    })
    const rejected = await submitTask('untrusted_student_id', {
      operationId: 'op_submit_legacy', expectedVersion: 0, assignmentVersion: 1,
      taskId: 'task_1', answer: '只有旧字符串',
    })
    expect(rejected).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { structuredAnswers: expect.any(String) } } })
    expect(invoker.calls).toHaveLength(1)

    invoker.enqueue(success({
      submissionId: 'sub_2', submissionVersion: 1, recordVersion: 1,
      assignmentVersion: 2, status: 'submitted', submittedAt: '2026-09-16T03:00:00.000Z',
    }))
    const submitted = await submitTask('untrusted_student_id', {
      operationId: 'op_submit_structured', expectedVersion: 0, assignmentVersion: 1,
      taskId: 'task_1', answer: '页面文字仍保留', structuredAnswers,
    })
    expect(submitted).toMatchObject({ ok: true, data: { assignmentVersion: 2, recordVersion: 1 } })
    expect(invoker.calls[1]?.request).toMatchObject({ expectedVersion: 1, payload: { answers: structuredAnswers } })
    const parsed = parseFunctionRequest(invoker.calls[1]?.request, SUBMISSION_COMMAND_ACTIONS)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(validateSubmissionCommandRequest(parsed.value).ok).toBe(true)
    const submitHandler = vi.fn(async () => serverSuccess({ submissionId: 'accepted_submit' }))
    const submissionMain = createSubmissionCommandFunction({
      ...serverBoundary('submission-command', 'student'),
      handler: { saveSubmissionDraft: vi.fn(async () => serverSuccess({ submissionId: 'unused' })), submit: submitHandler },
    })
    expect(await submissionMain(invoker.calls[1]?.request)).toMatchObject({ ok: true })
    expect(submitHandler).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: 'student' }), 'task_1', structuredAnswers, 1, undefined, 'op_submit_structured',
    )
  })

  it('restores a cloud draft across refreshes and carries record and assignment versions into continued save and submit', async () => {
    const invoker = new FakeInvoker()
    configureRepositories({
      mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_student' }),
    })

    invoker.enqueue(success({
      submissionId: 'submission_draft', submissionVersion: 1, recordVersion: 1,
      assignmentVersion: 2, status: 'draft', submittedAt: null,
    }))
    const firstSave = await saveDraft('student_self', {
      operationId: 'op_draft_first_0001', expectedVersion: 0, assignmentVersion: 1,
      taskId: 'task_draft', answer: '', structuredAnswers: [structuredAnswers[0]],
    })
    expect(firstSave).toMatchObject({ ok: true, data: { status: 'draft', recordVersion: 1, assignmentVersion: 2 } })

    invoker.enqueue(success({
      taskId: 'task_draft', title: '跨刷新草稿任务', description: null,
      startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-17T00:00:00.000Z',
      items: [{ id: 'item_reading', title: '阅读', type: 'reading', completionRule: { kind: 'reading_pages', requiredPageCount: 3 } }],
      assignment: { status: 'in_progress', submittedAt: null, redoCount: 0, redoDueAt: null, version: 2 },
      submission: {
        id: 'submission_draft', version: 1, status: 'draft', answers: [structuredAnswers[0]], submittedAt: null,
        recordVersion: 1, assignmentVersion: 2,
      },
      feedback: null,
    }))
    const firstRefresh = await getTaskDetail('student_self', 'task_draft')
    expect(firstRefresh).toMatchObject({
      ok: true,
      data: {
        assignment: { version: 2 },
        submission: { id: 'submission_draft', status: 'draft', version: 1, recordVersion: 1, assignmentVersion: 2 },
      },
    })
    if (!firstRefresh.ok || firstRefresh.data.submission === undefined) throw new Error('restored draft expected')

    invoker.enqueue(success({
      submissionId: 'submission_draft', submissionVersion: 1, recordVersion: 2,
      assignmentVersion: 3, status: 'draft', submittedAt: null,
    }))
    const secondSave = await saveDraft('student_self', {
      operationId: 'op_draft_second_0002', expectedVersion: firstRefresh.data.submission.version,
      assignmentVersion: firstRefresh.data.assignment.version,
      draftVersion: firstRefresh.data.submission.recordVersion,
      taskId: 'task_draft', answer: '', structuredAnswers: [structuredAnswers[0]],
    })
    expect(secondSave).toMatchObject({ ok: true, data: { recordVersion: 2, assignmentVersion: 3 } })
    expect(invoker.calls[2]?.request).toMatchObject({
      action: 'saveDraft', expectedVersion: 2,
      payload: { taskId: 'task_draft', draftVersion: 1 },
    })

    invoker.enqueue(success({
      taskId: 'task_draft', title: '跨刷新草稿任务', description: null,
      startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-17T00:00:00.000Z',
      items: [{ id: 'item_reading', title: '阅读', type: 'reading', completionRule: { kind: 'reading_pages', requiredPageCount: 3 } }],
      assignment: { status: 'in_progress', submittedAt: null, redoCount: 0, redoDueAt: null, version: 3 },
      submission: {
        id: 'submission_draft', version: 1, status: 'draft', answers: [structuredAnswers[0]], submittedAt: null,
        recordVersion: 2, assignmentVersion: 3,
      },
      feedback: null,
    }))
    const secondRefresh = await getTaskDetail('student_self', 'task_draft')
    if (!secondRefresh.ok || secondRefresh.data.submission === undefined) throw new Error('second restored draft expected')
    expect(secondRefresh.data.submission).toMatchObject({ status: 'draft', recordVersion: 2, assignmentVersion: 3 })

    invoker.enqueue(success({
      submissionId: 'submission_draft', submissionVersion: 1, recordVersion: 3,
      assignmentVersion: 4, status: 'submitted', submittedAt: '2026-09-16T06:00:00.000Z',
    }))
    const submitted = await submitTask('student_self', {
      operationId: 'op_draft_submit_0003', expectedVersion: secondRefresh.data.submission.version,
      assignmentVersion: secondRefresh.data.assignment.version,
      draftVersion: secondRefresh.data.submission.recordVersion,
      taskId: 'task_draft', answer: '', structuredAnswers: [structuredAnswers[0]],
    })
    expect(submitted).toMatchObject({ ok: true, data: { status: 'submitted', recordVersion: 3, assignmentVersion: 4 } })
    expect(invoker.calls[4]?.request).toMatchObject({
      action: 'submit', expectedVersion: 3,
      payload: { taskId: 'task_draft', draftVersion: 2 },
    })
  })

  it('composes the legacy publish call into saveDraft then publishTask', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success({ taskId: 'task_new', status: 'draft', version: 1 }, 'req_save'))
    invoker.enqueue(success({ taskId: 'task_new', status: 'active', version: 2 }, 'req_publish'))
    configureRepositories({
      mode: 'cloudbase',
      invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_teacher' }),
    })

    const result = await publishClassroomTask('untrusted_teacher_id', {
      operationId: 'op_publish_12345678', expectedVersion: 0, title: ' 阅读任务 ', description: ' 完成练习 ', structuredDraft,
    })

    expect(result).toMatchObject({ ok: true, data: { id: 'task_new', title: '阅读任务', status: 'active', version: 2 }, meta: { requestId: 'req_publish' } })
    expect(invoker.calls.map(call => ({ name: call.functionName, action: call.request.action }))).toEqual([
      { name: 'task-command', action: 'saveDraft' },
      { name: 'task-command', action: 'publishTask' },
    ])
    expect(invoker.calls[0]?.request).toMatchObject({ operationId: 'op_publish_12345678' })
    expect(invoker.calls[0]?.request.payload).toMatchObject({
      itemRefs: [
        { completionRule: { kind: 'reading_pages', requiredPageCount: 3 }, scoringRule: { kind: 'manual', maxScore: 100 } },
        { completionRule: { kind: 'vocabulary_words', requiredWordCount: 8 }, scoringRule: { kind: 'manual', maxScore: 100 } },
        { completionRule: { kind: 'exercise_questions', requiredQuestionCount: 5 }, scoringRule: { kind: 'manual', maxScore: 100 } },
      ],
    })
    expect(invoker.calls[0]?.request).not.toHaveProperty('expectedVersion')
    expect(invoker.calls[1]?.request).toMatchObject({
      payload: { taskId: 'task_new' }, operationId: 'op_publish_12345678', expectedVersion: 1,
    })
    const parsed = parseFunctionRequest(invoker.calls[0]?.request, TASK_COMMAND_ACTIONS)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(validateTaskCommandRequest(parsed.value).ok).toBe(true)
    const saveTaskDraft = vi.fn(async () => serverSuccess({ taskId: 'accepted_task' }))
    const taskMain = createTaskCommandFunction({
      ...serverBoundary('task-command', 'teacher'),
      handler: {
        saveTaskDraft,
        publishTask: vi.fn(async () => serverSuccess({ taskId: 'published' })),
        updatePublishedTask: vi.fn(async () => serverSuccess({ taskId: 'updated' })),
        withdrawTask: vi.fn(async () => serverSuccess({ taskId: 'withdrawn' })),
        recycleTask: vi.fn(async () => serverSuccess({ taskId: 'recycled' })),
      },
    })
    expect(await taskMain(invoker.calls[0]?.request)).toMatchObject({ ok: true })
    expect(saveTaskDraft).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: 'teacher' }),
      expect.objectContaining({
        itemRefs: expect.arrayContaining([
          expect.objectContaining({ completionRule: { kind: 'reading_pages', requiredPageCount: 3 } }),
          expect.objectContaining({ completionRule: { kind: 'vocabulary_words', requiredWordCount: 8 } }),
          expect.objectContaining({ completionRule: { kind: 'exercise_questions', requiredQuestionCount: 5 } }),
        ]),
      }),
      0,
      'op_publish_12345678',
    )
  })

  it('loads an authorized page-facing structured draft and publishes it through strict query and command entries', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success({
      classes: [{ id: 'class_grade3_2', name: '虚构三年级 2 班' }],
      resources: [
        { id: 'resource_reading', title: '虚构绘本', type: 'reading', allowedClassIds: ['class_grade3_2'], completionRule: { kind: 'reading_pages', requiredPageCount: 3 }, scoringRule: { kind: 'manual', maxScore: 100 } },
        { id: 'resource_words', title: '虚构词包', type: 'vocabulary', allowedClassIds: ['class_grade3_2'], completionRule: { kind: 'vocabulary_words', requiredWordCount: 8 }, scoringRule: { kind: 'manual', maxScore: 100 } },
        { id: 'resource_questions', title: '虚构习题', type: 'exercise', allowedClassIds: ['class_grade3_2'], completionRule: { kind: 'exercise_questions', requiredQuestionCount: 5 }, scoringRule: { kind: 'manual', maxScore: 100 } },
      ],
    }, 'req_options'))
    invoker.enqueue(success({ taskId: 'task_page', status: 'draft', version: 1 }, 'req_save'))
    invoker.enqueue(success({ taskId: 'task_page', status: 'active', version: 2 }, 'req_publish'))
    configureRepositories({
      mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_teacher' }),
    })

    const options = await getDraftOptions('teacher', { now: () => new Date('2026-09-16T02:00:00.000Z') })
    expect(options).toMatchObject({
      ok: true,
      data: {
        selectedClassName: '虚构三年级 2 班',
        resources: [{ type: 'reading', requiredCount: 3 }, { type: 'vocabulary', requiredCount: 8 }, { type: 'exercise', requiredCount: 5 }],
      },
    })
    if (!options.ok) return
    const published = await publishClassroomTask('teacher', {
      operationId: 'op_page_publish', expectedVersion: 0, title: '页面发布任务', description: '使用加载结果',
      structuredDraft: options.data.structuredDraft,
    })
    expect(published).toMatchObject({ ok: true, data: { id: 'task_page' } })

    const queryHandler = { getTeacherWorkbench: vi.fn(), listTeacherTasks: vi.fn(), previewTask: vi.fn(), getCompletion: vi.fn(), getDraftOptions: vi.fn(async () => serverSuccess({ classes: [], resources: [] })) }
    const queryMain = createTaskQueryFunction({ ...serverBoundary('task-query', 'teacher'), handler: queryHandler })
    expect(await queryMain(invoker.calls[0]?.request)).toMatchObject({ ok: true })
    expect(queryHandler.getDraftOptions).toHaveBeenCalledWith(expect.objectContaining({ actorRole: 'teacher' }))

    const saveTaskDraft = vi.fn(async () => serverSuccess({ taskId: 'task_page' }))
    const taskMain = createTaskCommandFunction({
      ...serverBoundary('task-command', 'teacher'),
      handler: {
        saveTaskDraft,
        publishTask: vi.fn(async () => serverSuccess({ taskId: 'task_page' })),
        updatePublishedTask: vi.fn(async () => serverSuccess({ taskId: 'updated' })),
        withdrawTask: vi.fn(async () => serverSuccess({ taskId: 'withdrawn' })),
        recycleTask: vi.fn(async () => serverSuccess({ taskId: 'recycled' })),
      },
    })
    expect(await taskMain(invoker.calls[1]?.request)).toMatchObject({ ok: true })
    expect(saveTaskDraft).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: 'teacher' }),
      expect.objectContaining({ targetClassIds: ['class_grade3_2'], itemRefs: expect.arrayContaining([
        expect.objectContaining({ completionRule: { kind: 'reading_pages', requiredPageCount: 3 } }),
        expect.objectContaining({ completionRule: { kind: 'vocabulary_words', requiredWordCount: 8 } }),
        expect.objectContaining({ completionRule: { kind: 'exercise_questions', requiredQuestionCount: 5 } }),
      ]) }),
      0,
      'op_page_publish',
    )
  })

  it('rejects incomplete cloud publish metadata before invoking the backend', async () => {
    const invoker = new FakeInvoker()
    configureRepositories({
      mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_teacher' }),
    })

    const result = await publishClassroomTask('teacher', {
      operationId: 'op_publish_incomplete', expectedVersion: 0, title: '保留的标题', description: '保留的描述',
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { structuredDraft: expect.any(String) } } })
    expect(invoker.calls).toHaveLength(0)
  })

  it('maps the parent home wrapper into the current page view model without expecting child or tasks fields', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success({
      childId: 'student_xiaoyu', pendingTaskCount: 1, completedTaskCount: 0,
      recentTasks: [{
        taskId: 'task_parent', title: '家长可见任务', status: 'awaiting_review',
        startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-17T00:00:00.000Z',
        submittedAt: '2026-09-16T03:00:00.000Z', feedbackId: 'feedback_1', feedbackPublishedAt: '2026-09-16T04:00:00.000Z', isLate: false,
      }],
      recentFeedback: [{
        feedbackId: 'feedback_1', taskId: 'task_parent', taskTitle: '家长可见任务',
        decision: 'approved', score: 92, publishedAt: '2026-09-16T04:00:00.000Z',
      }],
    }))
    invoker.enqueue(success({
      taskId: 'task_parent', title: '家长可见任务', studentId: 'student_xiaoyu', assignmentStatus: 'completed',
      submission: { id: 'submission_1', version: 1, answers: structuredAnswers, submittedAt: '2026-09-16T03:00:00.000Z' },
      feedback: { id: 'feedback_1', decision: 'approved', score: 92, textComment: '完成得很好', returnReason: null, publishedAt: '2026-09-16T04:00:00.000Z' },
    }))
    configureRepositories({
      mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_parent', activeChildId: 'student_xiaoyu' }),
    })

    const result = await getParentHome('parent_user')

    expect(result).toMatchObject({
      ok: true,
      data: {
        child: { id: 'student_xiaoyu', role: 'student' },
        tasks: [{ task: { id: 'task_parent', startsAt: '2026-09-16T00:00:00.000Z' }, feedback: { id: 'feedback_1', textComment: '完成得很好' } }],
      },
    })
    for (const call of invoker.calls) {
      const parsed = parseFunctionRequest(call.request, PARENT_QUERY_ACTIONS)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(validateParentQueryRequest(parsed.value).ok).toBe(true)
    }
    const getParentHomeHandler = vi.fn(async () => serverSuccess({ childId: 'student_xiaoyu' }))
    const getParentTaskResult = vi.fn(async () => serverSuccess({ taskId: 'task_parent' }))
    const parentMain = createParentQueryFunction({
      ...serverBoundary('parent-query', 'parent'),
      handler: {
        getHome: getParentHomeHandler,
        listChildTasks: vi.fn(async () => serverSuccess({ items: [] })),
        getParentTaskResult,
        getFeedback: vi.fn(async () => serverSuccess({ feedbackId: 'feedback_1' })),
      },
    })
    expect(await parentMain(invoker.calls[0]?.request)).toMatchObject({ ok: true })
    expect(await parentMain(invoker.calls[1]?.request)).toMatchObject({ ok: true })
    expect(getParentHomeHandler).toHaveBeenCalledWith(expect.objectContaining({ actorRole: 'parent' }), 'student_xiaoyu')
    expect(getParentTaskResult).toHaveBeenCalledWith(expect.objectContaining({ actorRole: 'parent' }), 'student_xiaoyu', 'task_parent')
  })

  it('unwraps FeedbackDetailView instead of treating the parent feedback response as a bare feedback', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success({
      taskId: 'task_parent', title: '家长可见任务', studentId: 'student_xiaoyu', assignmentStatus: 'completed',
      submission: { id: 'submission_1', version: 1, answers: structuredAnswers, submittedAt: '2026-09-16T03:00:00.000Z' },
      feedback: { id: 'feedback_1', decision: 'approved', score: 92, textComment: '完成得很好', returnReason: null, publishedAt: '2026-09-16T04:00:00.000Z' },
    }))
    invoker.enqueue(success({
      feedbackId: 'feedback_1', childId: 'student_xiaoyu', taskId: 'task_parent', taskTitle: '家长可见任务',
      submission: { id: 'submission_1', version: 1, answers: structuredAnswers, submittedAt: '2026-09-16T03:00:00.000Z' },
      feedback: { decision: 'approved', score: 92, textComment: '完成得很好', returnReason: null, publishedAt: '2026-09-16T04:00:00.000Z' },
    }))
    configureRepositories({
      mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_parent', activeChildId: 'student_xiaoyu' }),
    })

    const result = await getParentFeedback('parent_user', 'task_parent')

    expect(result).toMatchObject({
      ok: true,
      data: { id: 'feedback_1', assignmentId: 'asn_task_parent_student_xiaoyu', submissionId: 'submission_1', score: 92, textComment: '完成得很好' },
    })
    expect(invoker.calls[1]?.request).toMatchObject({
      action: 'getFeedback', payload: { childId: 'student_xiaoyu', feedbackId: 'feedback_1' },
    })
    const parsed = parseFunctionRequest(invoker.calls[1]?.request, PARENT_QUERY_ACTIONS)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(validateParentQueryRequest(parsed.value).ok).toBe(true)
    const getFeedbackHandler = vi.fn(async () => serverSuccess({ feedbackId: 'feedback_1' }))
    const parentMain = createParentQueryFunction({
      ...serverBoundary('parent-query', 'parent'),
      handler: {
        getHome: vi.fn(async () => serverSuccess({ childId: 'student_xiaoyu' })),
        listChildTasks: vi.fn(async () => serverSuccess({ items: [] })),
        getParentTaskResult: vi.fn(async () => serverSuccess({ taskId: 'task_parent' })),
        getFeedback: getFeedbackHandler,
      },
    })
    expect(await parentMain(invoker.calls[1]?.request)).toMatchObject({ ok: true })
    expect(getFeedbackHandler).toHaveBeenCalledWith(expect.objectContaining({ actorRole: 'parent' }), 'student_xiaoyu', 'feedback_1')
  })

  it('maps thrown platform failures to a safe retryable ServiceResult', async () => {
    const invoker = new FakeInvoker()
    invoker.rejectNext({ code: 'NETWORK_TIMEOUT', detail: 'sensitive platform detail' })
    configureRepositories({
      mode: 'cloudbase',
      invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_student', localDate: '2026-09-16' }),
    })

    const result = await getHome('untrusted_student_id')

    expect(result).toEqual({
      ok: false,
      error: { code: 'NETWORK_ERROR', message: '网络连接失败，请检查网络后重试', retryable: true },
    })
    expect(JSON.stringify(result)).not.toContain('sensitive platform detail')
  })

  it('keeps M1 reading and vocabulary available through the memory fallback', async () => {
    const readings = await listReadingResources('usr_student_xiaoyu')
    const detail = await getReadingResource('usr_student_xiaoyu', 'read_zoo')
    const vocabulary = await listVocabularyPacks('usr_student_xiaoyu')

    expect(readings.ok && readings.data[0]).toMatchObject({ id: 'read_zoo', category: 'picture_book' })
    expect(detail).toMatchObject({ ok: true, data: { presentation: 'page_images_only', textVisibility: { ocrExposed: false, standaloneBodyExposed: false } } })
    expect(vocabulary.ok && vocabulary.data[0]).toMatchObject({ id: 'vocab_animals' })
    expect(vocabulary.ok && vocabulary.data[0]?.words[0]).toMatchObject({ word: 'sunshine', syllables: ['sun', 'shine'] })
  })

  it('validates and idempotently persists memory learning progress for the signed-in student only', async () => {
    const session = {
      sessionId: 'ses_student_xiaoyu',
      user: initialState.users.find(item => item.id === 'usr_student_xiaoyu')!,
      availableRoles: ['student'], activeRole: 'student',
    }
    vi.stubGlobal('wx', { getStorageSync: vi.fn(() => session) })

    await expect(saveReadingProgress('usr_student_demo_02', {
      operationId: 'memory_forged_reading_0001', expectedVersion: 0, resourceId: 'read_zoo',
      chapterId: 'chapter_zoo_1', pageId: 'page_zoo_1', pageNumber: 1, favorite: false,
    })).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })

    const currentReading = await getReadingProgress('usr_student_xiaoyu', 'read_zoo')
    expect(currentReading.ok).toBe(true)
    const expectedReadingVersion = currentReading.ok ? currentReading.data?.version ?? 0 : 0
    const readingCommand = {
      operationId: 'memory_reading_idempotency_0001', expectedVersion: expectedReadingVersion,
      resourceId: 'read_zoo', chapterId: 'chapter_zoo_1', pageId: 'page_zoo_2', pageNumber: 2, favorite: true,
    }
    const firstReading = await saveReadingProgress('usr_student_xiaoyu', readingCommand)
    expect(firstReading).toMatchObject({ ok: true, data: { pageId: 'page_zoo_2', pageNumber: 2, favorite: true } })
    expect(await saveReadingProgress('usr_student_xiaoyu', readingCommand)).toEqual(firstReading)
    expect(await saveReadingProgress('usr_student_xiaoyu', { ...readingCommand, favorite: false }))
      .toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await saveReadingProgress('usr_student_xiaoyu', {
      ...readingCommand, operationId: 'memory_reading_bad_page_0001', expectedVersion: expectedReadingVersion + 1,
      chapterId: 'chapter_missing',
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })

    const currentVocabulary = await getVocabularyProgress('usr_student_xiaoyu', 'vocab_animals')
    expect(currentVocabulary.ok).toBe(true)
    const expectedVocabularyVersion = currentVocabulary.ok ? currentVocabulary.data?.version ?? 0 : 0
    const vocabularyCommand = {
      operationId: 'memory_vocabulary_idempotency_0001', expectedVersion: expectedVocabularyVersion,
      packId: 'vocab_animals', completedCount: 2, correctCount: 1, wrongWordIds: ['word_animal'],
    }
    const firstVocabulary = await saveVocabularyProgress('usr_student_xiaoyu', vocabularyCommand)
    expect(firstVocabulary).toMatchObject({ ok: true, data: { completedCount: 2, correctCount: 1, wrongWordIds: ['word_animal'] } })
    expect(await saveVocabularyProgress('usr_student_xiaoyu', vocabularyCommand)).toEqual(firstVocabulary)
    expect(await saveVocabularyProgress('usr_student_xiaoyu', {
      ...vocabularyCommand, operationId: 'memory_vocabulary_bad_count_0001',
      expectedVersion: expectedVocabularyVersion + 1, completedCount: 4,
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(await saveVocabularyProgress('usr_student_xiaoyu', {
      ...vocabularyCommand, operationId: 'memory_vocabulary_bad_word_0001',
      expectedVersion: expectedVocabularyVersion + 1, wrongWordIds: ['word_unknown'],
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
  })

  it('allows only one concurrent memory progress write for the same base version', async () => {
    const current = await getReadingProgress('usr_student_xiaoyu', 'read_zoo')
    expect(current.ok).toBe(true)
    const expectedVersion = current.ok ? current.data?.version ?? 0 : 0
    const results = await Promise.all([
      saveReadingProgress('usr_student_xiaoyu', {
        operationId: 'memory_concurrent_reading_0001', expectedVersion, resourceId: 'read_zoo',
        chapterId: 'chapter_zoo_1', pageId: 'page_zoo_1', pageNumber: 1, favorite: false,
      }),
      saveReadingProgress('usr_student_xiaoyu', {
        operationId: 'memory_concurrent_reading_0002', expectedVersion, resourceId: 'read_zoo',
        chapterId: 'chapter_zoo_1', pageId: 'page_zoo_2', pageNumber: 2, favorite: true,
      }),
    ])

    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => !result.ok && result.error.code === 'CONFLICT')).toHaveLength(1)
    const saved = await getReadingProgress('usr_student_xiaoyu', 'read_zoo')
    expect(saved).toMatchObject({ ok: true, data: { version: expectedVersion + 1 } })
  })

  it('maps M1 content queries without sending client identity fields', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success([{ id: 'read_zoo', title: 'A Day at the Zoo', category: 'picture_book', grade: '三年级', difficulty: '入门', contentVersion: 'demo-v1' }]))
    invoker.enqueue(success([{ id: 'vocab_animals', title: 'Unit 3 Animals', grade: '三年级', unit: 'Unit 3', contentVersion: 'demo-v1', words: [] }]))
    configureRepositories({
      mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_student' }),
    })

    expect(await listReadingResources('forged_student')).toMatchObject({ ok: true, data: [{ id: 'read_zoo' }] })
    expect(await listVocabularyPacks('forged_student')).toMatchObject({ ok: true, data: [{ id: 'vocab_animals' }] })
    expect(invoker.calls.map(call => call.request)).toEqual([
      { apiVersion: 'm1.v1', action: 'listReadingResources', payload: {} },
      { apiVersion: 'm1.v1', action: 'listVocabularyPacks', payload: {} },
    ])
    expect(invoker.calls.every(call => call.functionName === 'content-query' && call.context.businessSessionToken === 'ses_student')).toBe(true)
  })

  it('maps learning progress queries and CAS commands without client identity fields', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success(null))
    invoker.enqueue(success({ id: 'reading_progress_1', resourceId: 'read_zoo', chapterId: 'chapter_1', pageId: 'page_2', pageNumber: 2, favorite: true, version: 1, updatedAt: '2026-09-16T06:00:00.000Z' }))
    invoker.enqueue(success({ id: 'vocabulary_progress_1', packId: 'vocab_animals', completedCount: 3, correctCount: 2, correctRate: 66.67, wrongWordIds: ['word_giraffe'], version: 2, updatedAt: '2026-09-16T06:00:00.000Z' }))
    invoker.enqueue(success({ id: 'vocabulary_progress_1', packId: 'vocab_animals', completedCount: 3, correctCount: 2, correctRate: 66.67, wrongWordIds: ['word_giraffe'], version: 3, updatedAt: '2026-09-16T06:01:00.000Z' }))
    configureRepositories({
      mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_student' }),
    })

    expect(await getReadingProgress('forged_student', 'read_zoo')).toMatchObject({ ok: true, data: null })
    expect(await saveReadingProgress('forged_student', {
      operationId: 'reading_operation_0001', expectedVersion: 0, resourceId: 'read_zoo',
      chapterId: 'chapter_1', pageId: 'page_2', pageNumber: 2, favorite: true,
    })).toMatchObject({ ok: true, data: { version: 1 } })
    expect(await getVocabularyProgress('forged_student', 'vocab_animals')).toMatchObject({ ok: true, data: { version: 2 } })
    expect(await saveVocabularyProgress('forged_student', {
      operationId: 'vocabulary_operation_0001', expectedVersion: 2, packId: 'vocab_animals',
      completedCount: 3, correctCount: 2, wrongWordIds: ['word_giraffe'],
    })).toMatchObject({ ok: true, data: { version: 3 } })

    expect(invoker.calls).toEqual([
      {
        functionName: 'learning-progress-query',
        request: { apiVersion: 'm1.v1', action: 'getReadingProgress', payload: { resourceId: 'read_zoo' } },
        context: { businessSessionToken: 'ses_student' },
      },
      {
        functionName: 'learning-progress-command',
        request: {
          apiVersion: 'm1.v1', action: 'saveReadingProgress',
          payload: { resourceId: 'read_zoo', chapterId: 'chapter_1', pageId: 'page_2', pageNumber: 2, favorite: true },
          operationId: 'reading_operation_0001',
        },
        context: { businessSessionToken: 'ses_student' },
      },
      {
        functionName: 'learning-progress-query',
        request: { apiVersion: 'm1.v1', action: 'getVocabularyProgress', payload: { packId: 'vocab_animals' } },
        context: { businessSessionToken: 'ses_student' },
      },
      {
        functionName: 'learning-progress-command',
        request: {
          apiVersion: 'm1.v1', action: 'saveVocabularyProgress',
          payload: { packId: 'vocab_animals', completedCount: 3, correctCount: 2, wrongWordIds: ['word_giraffe'] },
          operationId: 'vocabulary_operation_0001', expectedVersion: 2,
        },
        context: { businessSessionToken: 'ses_student' },
      },
    ])
    expect(JSON.stringify(invoker.calls)).not.toContain('forged_student')
  })

  it('supports the fictional memory password reset flow without account enumeration', async () => {
    expect(await requestPasswordResetCode('13800000001')).toEqual({ ok: true, data: { expiresInMinutes: 10 } })
    expect(await requestPasswordResetCode('13899999999')).toEqual({ ok: true, data: { expiresInMinutes: 10 } })
    expect(await resetPassword('13800000001', '246810', '654321')).toEqual({ ok: true, data: null })
    expect(await login('13800000001', '654321')).toMatchObject({ ok: true, data: { user: { id: 'usr_student_xiaoyu' } } })
    expect(await resetPassword('13800000001', '246810', '123456')).toEqual({ ok: true, data: null })
  })

  it('invalidates the trusted CloudBase business session when logging out', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success(null))
    configureRepositories({
      mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_current' }),
    })

    expect(await logout('forged_user')).toMatchObject({ ok: true, data: null })
    expect(invoker.calls[0]).toMatchObject({
      functionName: 'auth-session',
      request: { apiVersion: 'm1.v1', action: 'logout', payload: {} },
      context: { businessSessionToken: 'ses_current' },
    })
    expect(invoker.calls[0]?.request.operationId).toMatch(/^logout_\d+$/)
  })

  it('does not auto-select the first role for a multi-role CloudBase account', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success({ sessionId: 'ses_multi', userId: 'user_multi', organizationId: 'org_demo', activeRole: null, roles: ['student', 'teacher'], displayName: '多身份演示账号' }))
    invoker.enqueue(success({ sessionId: 'ses_multi', userId: 'user_multi', organizationId: 'org_demo', activeRole: 'teacher', roles: ['student', 'teacher'], displayName: '多身份演示账号' }))
    configureRepositories({
      mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'ses_multi' }),
    })

    const signedIn = await login('13800000002', '123456')
    expect(signedIn).toMatchObject({ ok: true, data: { activeRole: null, availableRoles: ['student', 'teacher'] } })
    expect(invoker.calls).toHaveLength(1)
    const selected = await selectRole('forged_user', 'teacher')
    expect(selected).toMatchObject({ ok: true, data: { activeRole: 'teacher', user: { id: 'user_multi', role: 'teacher' } } })
    expect(invoker.calls[1]?.request).toEqual({ apiVersion: 'm1.v1', action: 'selectRole', payload: { role: 'teacher' } })
  })
})
