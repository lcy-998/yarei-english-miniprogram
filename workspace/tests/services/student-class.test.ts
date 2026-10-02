import { afterEach, describe, expect, it } from 'vitest'
import { getMyClass } from '../../miniprogram/services/app-service'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'

afterEach(() => configureRepositories({ mode: 'memory' }))

describe('S-10 student class service', () => {
  it('uses the shared demo roster and refuses a parent in memory mode', async () => {
    configureRepositories({ mode: 'memory' })
    expect(await getMyClass('usr_student_xiaoyu')).toMatchObject({
      ok: true,
      data: { id: 'cls_grade3_2', name: '三年级 2 班', organizationName: '启航实验学校', studentCount: 36, teacherNames: ['林老师'] },
    })
    expect(await getMyClass('usr_parent_xiaoyu')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('sends only the trusted session token and no client student ID to CloudBase', async () => {
    const calls: Array<{ functionName: string; action: string; payload: object; token: string | null }> = []
    const invoker: CloudFunctionInvoker = {
      async call(functionName, request, context) {
        calls.push({ functionName, action: request.action, payload: request.payload, token: context.businessSessionToken })
        return { ok: true, data: { id: 'cls_grade3_2', name: '三年级 2 班', organizationName: '启航实验学校', grade: '三年级', term: '上学期', studentCount: 36, teacherNames: ['林老师'] } }
      },
    }
    const service = createCloudAppService(
      createCloudRepositoryClient(invoker, () => ({ sessionId: 'session_student_demo' })),
      { async signIn() {} },
      () => ({ sessionId: 'session_student_demo' }),
    )
    expect(await service.getMyClass('forged_other_student')).toMatchObject({ ok: true, data: { id: 'cls_grade3_2' } })
    expect(calls).toEqual([{ functionName: 'content-query', action: 'getMyClass', payload: {}, token: 'session_student_demo' }])
  })
})
