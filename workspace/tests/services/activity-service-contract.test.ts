import { afterEach, describe, expect, it } from 'vitest'
import type { ActivityDraftInput } from '../../miniprogram/domain/types'
import { saveActivityDraft } from '../../miniprogram/services/app-service'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'

afterEach(() => configureRepositories({ mode: 'memory' }))

const draft: ActivityDraftInput = { title: '虚构阅读打卡', classId: 'cls_grade3_2',
  startsOn: '2026-09-27', endsOn: '2026-09-30', restDates: ['2026-09-29'],
  conditions: [{ kind: 'reading', resourceId: 'read_demo' }] }

describe('M2 activity client boundary', () => {
  it('sends only activity fields through the bound business session', async () => {
    const calls: Array<{ functionName: string; action: string; payload: object; operationId?: string;
      expectedVersion?: number; token: string | null }> = []
    const invoker: CloudFunctionInvoker = { async call(functionName, request, context) {
      calls.push({ functionName, action: request.action, payload: request.payload,
        operationId: request.operationId, expectedVersion: request.expectedVersion,
        token: context.businessSessionToken })
      return request.action === 'listForTeacher' ? { ok: true, data: [] }
        : { ok: true, data: { id: 'activity_demo', title: '虚构阅读打卡', status: 'draft', version: 1 } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker, () => ({ sessionId: 'session_teacher_demo' })),
      { async signIn() {} }, () => ({ sessionId: 'session_teacher_demo' }))
    await service.saveActivityDraft('forged_teacher', draft, 0, 'operation_activity_client_draft')
    await service.publishActivity('forged_teacher', 'activity_demo', 1, 'operation_activity_client_publish')
    await service.listTeacherActivities('forged_teacher')
    await service.listStudentActivities('forged_student')
    await service.getStudentActivity('forged_student', 'activity_demo')
    await service.getMyActivityDay('forged_student', 'activity_demo', '2026-09-27')
    await service.setActivityOverride('forged_teacher', { activityId: 'activity_demo', studentId: 'student_demo',
      date: '2026-09-27', active: true, reason: '核对线下作品' }, 0, 'operation_activity_client_override')
    await service.getActivityOverrideForTeacher('forged_teacher', 'activity_demo', 'student_demo', '2026-09-27')
    await service.getActivityLeaderboard('forged_student', 'activity_demo')
    expect(calls).toEqual([
      { functionName: 'activity-command', action: 'saveDraft', payload: draft,
        operationId: 'operation_activity_client_draft', expectedVersion: 0, token: 'session_teacher_demo' },
      { functionName: 'activity-command', action: 'publish', payload: { activityId: 'activity_demo' },
        operationId: 'operation_activity_client_publish', expectedVersion: 1, token: 'session_teacher_demo' },
      { functionName: 'activity-query', action: 'listForTeacher', payload: {},
        operationId: undefined, expectedVersion: undefined, token: 'session_teacher_demo' },
      { functionName: 'activity-query', action: 'listForStudent', payload: {},
        operationId: undefined, expectedVersion: undefined, token: 'session_teacher_demo' },
      { functionName: 'activity-query', action: 'getForStudent', payload: { activityId: 'activity_demo' },
        operationId: undefined, expectedVersion: undefined, token: 'session_teacher_demo' },
      { functionName: 'activity-query', action: 'getMyDay', payload: { activityId: 'activity_demo', date: '2026-09-27' },
        operationId: undefined, expectedVersion: undefined, token: 'session_teacher_demo' },
      { functionName: 'activity-command', action: 'setOverride', payload: { activityId: 'activity_demo',
        studentId: 'student_demo', date: '2026-09-27', active: true, reason: '核对线下作品' },
      operationId: 'operation_activity_client_override', expectedVersion: 0, token: 'session_teacher_demo' },
      { functionName: 'activity-query', action: 'getOverrideForTeacher', payload: {
        activityId: 'activity_demo', studentId: 'student_demo', date: '2026-09-27' },
      operationId: undefined, expectedVersion: undefined, token: 'session_teacher_demo' },
      { functionName: 'activity-query', action: 'getLeaderboard', payload: { activityId: 'activity_demo' },
        operationId: undefined, expectedVersion: undefined, token: 'session_teacher_demo' },
    ])
  })

  it('fails closed in memory mode instead of inventing a completed activity', async () => {
    configureRepositories({ mode: 'memory' })
    expect(await saveActivityDraft('usr_teacher_lin', draft, 0, 'operation_activity_memory'))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
  })
})
