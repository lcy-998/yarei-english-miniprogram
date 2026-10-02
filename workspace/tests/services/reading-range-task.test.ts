import { describe, expect, it } from 'vitest'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'
import { publishClassroomTask, saveTeacherTaskDraft } from '../../miniprogram/services/app-service'

describe('M2 selected reading task range', () => {
  it('sends frozen selected page IDs with a teacher task draft', async () => {
    const calls: Array<{ action: string; payload: object }> = []
    const invoker: CloudFunctionInvoker = { async call(_name, request) {
      calls.push({ action: request.action, payload: request.payload })
      return { ok: true, data: { taskId: 'task_reading_demo', version: 1 } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker,
      () => ({ sessionId: 'session_teacher_demo' })), { async signIn() {} },
    () => ({ sessionId: 'session_teacher_demo' }))
    const result = await service.saveTeacherTaskDraft('teacher_demo', {
      operationId: 'operation_reading_range', expectedVersion: 0, title: '指定页阅读', description: '',
      structuredDraft: { items: [{ id: 'item_reading', resourceId: 'book_demo', type: 'reading',
        requiredCount: 2, maxScore: 100, pageIds: ['page_2', 'page_3'] }],
      target: { type: 'classes', classIds: ['class_demo'] }, startsAt: '2026-09-26T08:00:00+08:00',
      dueAt: '2026-09-27T08:00:00+08:00', latePolicy: { allowLate: true, lateDays: 7 } },
    })
    expect(result.ok).toBe(true)
    expect(calls).toMatchObject([{ action: 'saveDraft', payload: { itemRefs: [{ completionRule: {
      kind: 'reading_pages', requiredPageCount: 2, pageIds: ['page_2', 'page_3'],
    } }] } }])
  })

  it('shows selected page IDs from the published task rule', async () => {
    const invoker: CloudFunctionInvoker = { async call(_name, request) {
      if (request.action !== 'getMyTask') throw new Error('Unexpected action')
      return { ok: true, data: { taskId: 'task_reading_demo', title: '指定页阅读', description: '',
        startsAt: '2026-09-26T08:00:00+08:00', dueAt: '2026-09-27T08:00:00+08:00',
        items: [{ id: 'item_reading', resourceId: 'book_demo', title: '虚构绘本', type: 'reading',
          completionRule: { kind: 'reading_pages', requiredPageCount: 2, pageIds: ['page_2', 'page_3'] },
          readingPageNumbers: [2, 3] }],
        assignment: { status: 'in_progress', submittedAt: null, redoCount: 0, redoDueAt: null, version: 1 },
        submission: null, feedback: null, automaticScore: null,
        readingPageProgress: [{ itemId: 'item_reading', completedPageCount: 1 }] } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker,
      () => ({ sessionId: 'session_student_demo' })), { async signIn() {} },
    () => ({ sessionId: 'session_student_demo' }))
    expect(await service.getTaskDetail('student_demo', 'task_reading_demo')).toMatchObject({ ok: true,
      data: { task: { items: [{ completionRuleData: { pageIds: ['page_2', 'page_3'] },
        readingPageNumbers: [2, 3] }] },
      readingPageProgress: [{ itemId: 'item_reading', completedPageCount: 1 }] } })
  })

  it('blocks ranged reading writes in the legacy memory fallback that lacks page evidence', async () => {
    configureRepositories({ mode: 'memory' })
    const command = { operationId: 'operation_memory_reading_range', expectedVersion: 0,
      title: '指定页阅读', description: '', structuredDraft: {
        items: [{ id: 'item_reading', resourceId: 'book_zoo', type: 'reading' as const,
          requiredCount: 2, maxScore: 100, pageIds: ['page_1', 'page_2'] }],
        target: { type: 'classes' as const, classIds: ['cls_grade3_2'] },
        startsAt: '2026-09-26T08:00:00+08:00', dueAt: '2026-09-27T08:00:00+08:00',
        latePolicy: { allowLate: true, lateDays: 7 },
      } }
    expect(await publishClassroomTask('usr_teacher_lin', command)).toMatchObject({
      ok: false, error: { code: 'SERVICE_UNAVAILABLE' },
    })
    expect(await saveTeacherTaskDraft('usr_teacher_lin', command)).toMatchObject({
      ok: false, error: { code: 'SERVICE_UNAVAILABLE' },
    })
  })
})
