import { describe, expect, it } from 'vitest'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'
import { listTeacherCheckItems } from '../../miniprogram/services/teacher-check-service'

describe('T-07 unified list client boundary', () => {
  it('keeps the M0 classroom list available when memory activities are unavailable', async () => {
    configureRepositories({ mode: 'memory' })
    const result = await listTeacherCheckItems('usr_teacher_lin', {}, 20, 0)
    expect(result).toMatchObject({ ok: true, data: { items: [{ kind: 'classroom' }] } })
  })
  it('sends filters and pagination to the trusted task query with the current session', async () => {
    const calls: unknown[] = []
    const invoker: CloudFunctionInvoker = { async call(functionName, request, context) {
      calls.push({ functionName, action: request.action, payload: request.payload,
        operationId: request.operationId, expectedVersion: request.expectedVersion,
        token: context.businessSessionToken })
      return { ok: true, data: { classes: [{ id: 'class_demo', name: '虚构班级' }],
        items: [], total: 0, nextOffset: null } }
    } }
    const repository = createCloudRepositoryClient(invoker, () => ({ sessionId: 'session_teacher_demo' }))
    const service = createCloudAppService(repository, { async signIn() {} },
      () => ({ sessionId: 'session_teacher_demo' }))
    const result = await service.listTeacherCheckItems('forged_teacher',
      { type: 'checkin', classId: 'class_demo', status: 'active',
        startsOn: '2026-10-01', keyword: '动物' }, 20, 40)
    expect(result).toMatchObject({ ok: true, data: { total: 0 } })
    await service.deleteTeacherDraftTask('forged_teacher', 'task_draft_demo', 3,
      '清理未发布草稿', 'operation_delete_draft_demo')
    expect(calls).toEqual([{ functionName: 'task-query', action: 'listTeacherCheckItems',
      payload: { filters: { type: 'checkin', classId: 'class_demo', status: 'active',
        startsOn: '2026-10-01', keyword: '动物' }, page: { limit: 20, offset: 40 } },
      operationId: undefined, expectedVersion: undefined, token: 'session_teacher_demo' },
    { functionName: 'task-command', action: 'deleteDraftTask',
      payload: { taskId: 'task_draft_demo', reason: '清理未发布草稿' },
      operationId: 'operation_delete_draft_demo', expectedVersion: 3,
      token: 'session_teacher_demo' }])
  })
})
