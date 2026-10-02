import { describe, expect, it } from 'vitest'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'

describe('M2 task snapshot copy client', () => {
  it('asks the server to copy by source ID without accepting client-authored snapshot content', async () => {
    const calls: Array<{ name: string; action: string; payload: object; expectedVersion?: number; operationId?: string }> = []
    const invoker: CloudFunctionInvoker = { async call(name, request) {
      calls.push({ name, action: request.action, payload: request.payload,
        expectedVersion: request.expectedVersion, operationId: request.operationId })
      return { ok: true, data: { taskId: 'task_copied_demo', status: 'draft', version: 1 } }
    } }
    const session = () => ({ sessionId: 'session_teacher_demo' })
    const service = createCloudAppService(createCloudRepositoryClient(invoker, session),
      { async signIn() {} }, session)

    expect(await service.copyTeacherTaskSnapshot('teacher_demo', 'task_source_demo', 7,
      'operation_copy_snapshot_demo')).toMatchObject({ ok: true,
        data: { taskId: 'task_copied_demo', version: 1 } })
    expect(calls).toEqual([{ name: 'task-command', action: 'copyTaskSnapshot',
      payload: { sourceTaskId: 'task_source_demo' }, expectedVersion: 7,
      operationId: 'operation_copy_snapshot_demo' }])
  })

  it('saves the copied draft with its current version and unchanged M2 page and scoring rules', async () => {
    const calls: Array<{ payload: object; expectedVersion?: number }> = []
    const invoker: CloudFunctionInvoker = { async call(_name, request) {
      calls.push({ payload: request.payload, expectedVersion: request.expectedVersion })
      return { ok: true, data: { taskId: 'task_copied_demo', status: 'draft', version: 2 } }
    } }
    const session = () => ({ sessionId: 'session_teacher_demo' })
    const service = createCloudAppService(createCloudRepositoryClient(invoker, session),
      { async signIn() {} }, session)
    expect(await service.saveTeacherTaskDraft('teacher_demo', {
      taskId: 'task_copied_demo', expectedVersion: 1, operationId: 'operation_fill_copied_demo',
      title: '原阅读任务', description: '原说明', structuredDraft: {
        items: [{ id: 'item_reading', resourceId: 'resource_reading_demo', type: 'reading',
          requiredCount: 1, pageIds: ['page_demo_03'], maxScore: 100, scoringKind: 'automatic', weightPercent: 100 }],
        target: { type: 'classes', classIds: ['class_demo'] },
        startsAt: '2026-09-27T08:00:00+08:00', dueAt: '2026-09-28T08:00:00+08:00',
        latePolicy: { allowLate: true, lateDays: 7 },
      },
    })).toMatchObject({ ok: true, data: { id: 'task_copied_demo', version: 2 } })
    expect(calls).toEqual([{ expectedVersion: 1, payload: {
      taskId: 'task_copied_demo', title: '原阅读任务', description: '原说明',
      itemRefs: [{ id: 'item_reading', resourceId: 'resource_reading_demo', order: 1,
        completionRule: { kind: 'reading_pages', requiredPageCount: 1, pageIds: ['page_demo_03'] },
        scoringRule: { kind: 'automatic', maxScore: 100, weightPercent: 100 } }],
      target: { type: 'classes', classIds: ['class_demo'] },
      startsAt: '2026-09-27T08:00:00+08:00', dueAt: '2026-09-28T08:00:00+08:00',
      latePolicy: { allowLate: true, lateDays: 7 },
    } }])
  })
})
