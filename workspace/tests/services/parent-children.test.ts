import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppState, ServiceResult } from '../../miniprogram/domain/types'
import { CloudCallContext, CloudFunctionInvoker, FunctionName, FunctionRequest } from '../../miniprogram/repositories/cloudbase/protocol'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'
import { getState, initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'
import { bindChild, getParentHome, listParentChildren, unbindChild } from '../../miniprogram/services/app-service'
import { setCurrentChildId } from '../../miniprogram/session/session'

interface RecordedCall {
  functionName: FunctionName
  request: FunctionRequest<string, object>
  context: CloudCallContext
}

class FakeInvoker implements CloudFunctionInvoker {
  public readonly calls: RecordedCall[] = []
  private readonly responses: ServiceResult<unknown>[] = []

  public enqueue<T>(response: ServiceResult<T>): void { this.responses.push(response) }

  public async call<TAction extends string, TPayload extends object, TResult>(
    functionName: FunctionName,
    request: FunctionRequest<TAction, TPayload>,
    context: CloudCallContext,
  ): Promise<ServiceResult<TResult>> {
    this.calls.push({ functionName, request: request as FunctionRequest<string, object>, context })
    const response = this.responses.shift()
    if (response === undefined) throw new Error('missing fake response')
    return response as ServiceResult<TResult>
  }
}

const success = <T>(data: T): ServiceResult<T> => ({ ok: true, data, meta: { requestId: 'req_parent_children' } })

describe('G-02 孩子管理 service', () => {
  beforeEach(() => {
    configureRepositories({ mode: 'memory' })
    replaceState(initialState)
    setCurrentChildId('')
  })

  afterEach(() => configureRepositories({ mode: 'memory' }))

  it('内存回退可列表、幂等解绑并用统一虚构绑定码重新绑定', async () => {
    expect(await listParentChildren('usr_parent_xiaoyu')).toMatchObject({
      ok: true,
      data: [{ childId: 'usr_student_xiaoyu', studentNumber: 'STU-DEMO-0032', className: '三年级 2 班' }],
    })

    const unbound = await unbindChild('usr_parent_xiaoyu', {
      operationId: 'operation_unbind_demo', expectedVersion: 1, childId: 'usr_student_xiaoyu', reason: '家长主动解除绑定',
    })
    expect(unbound).toMatchObject({ ok: true, data: null })
    expect(await unbindChild('usr_parent_xiaoyu', {
      operationId: 'operation_unbind_demo', expectedVersion: 1, childId: 'usr_student_xiaoyu', reason: '家长主动解除绑定',
    })).toMatchObject({ ok: true, data: null })
    expect(await listParentChildren('usr_parent_xiaoyu')).toMatchObject({ ok: true, data: [] })
    expect(await getParentHome('usr_parent_xiaoyu')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(getState().assignments.some(item => item.studentId === 'usr_student_xiaoyu')).toBe(true)

    const bound = await bindChild('usr_parent_xiaoyu', {
      operationId: 'operation_bind_demo', studentNumber: 'STU-DEMO-0032', code: '482731',
    })
    expect(bound).toMatchObject({ ok: true, data: { childId: 'usr_student_xiaoyu', linkVersion: 1 } })
    expect(await bindChild('usr_parent_xiaoyu', {
      operationId: 'operation_bind_demo', studentNumber: 'STU-DEMO-0032', code: '482731',
    })).toEqual(bound)
  })

  it('内存回退与后端一致限制家长最多 5 个孩子', async () => {
    const state = getState()
    const extraStudentIds = ['usr_student_demo_02', 'usr_student_demo_03', 'usr_student_demo_04', 'usr_student_demo_05']
    state.parentStudentLinks.push(...extraStudentIds.map((studentId, index) => ({
      id: `rel_extra_${index}`, parentId: 'usr_parent_xiaoyu', studentId, status: 'active' as const,
      version: 1, confirmedAt: '2026-09-16T00:00:00.000Z',
    })))
    state.bindingCodes.push({
      id: 'bind_limit_target', studentId: 'usr_student_demo_06', code: '482731', status: 'active', attemptCount: 0,
      expiresAt: '2099-09-16T00:00:00.000Z',
    })
    replaceState(state as AppState)
    expect(await bindChild('usr_parent_xiaoyu', {
      operationId: 'operation_parent_limit', studentNumber: 'STU-DEMO-0037', code: '482731',
    })).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: '最多可绑定 5 个孩子' } })
  })

  it('内存回退限制每个学生最多 3 个家长，错误绑定码连续 5 次后锁定', async () => {
    const state = getState()
    const childId = 'usr_student_demo_02'
    state.users.push(...['parent_extra_1', 'parent_extra_2', 'parent_extra_3'].map((id, index) => ({
      id, displayName: `虚构家长${index + 1}`, role: 'parent' as const,
    })))
    state.parentStudentLinks.push(...['parent_extra_1', 'parent_extra_2', 'parent_extra_3'].map((parentId, index) => ({
      id: `rel_student_limit_${index}`, parentId, studentId: childId, status: 'active' as const,
      version: 1, confirmedAt: '2026-09-16T00:00:00.000Z',
    })))
    state.bindingCodes.push({
      id: 'bind_student_limit', studentId: childId, code: '482731', status: 'active', attemptCount: 0,
      expiresAt: '2099-09-16T00:00:00.000Z',
    })
    replaceState(state)
    expect(await bindChild('usr_parent_xiaoyu', {
      operationId: 'operation_student_limit', studentNumber: 'STU-DEMO-0033', code: '482731',
    })).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: '该学生已达 3 个家长的绑定上限' } })

    const retryState = getState()
    retryState.parentStudentLinks = retryState.parentStudentLinks.filter(link => link.studentId !== childId)
    replaceState(retryState)
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(await bindChild('usr_parent_xiaoyu', {
        operationId: `operation_wrong_code_${attempt}`, studentNumber: 'STU-DEMO-0033', code: '000000',
      })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    }
    expect(getState().bindingCodes.find(item => item.id === 'bind_student_limit')).toMatchObject({ status: 'locked', attemptCount: 5 })
    expect(await bindChild('usr_parent_xiaoyu', {
      operationId: 'operation_after_lock', studentNumber: 'STU-DEMO-0033', code: '482731',
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
  })

  it('云端请求不传客户端身份，绑定带 operationId，解绑同时带 expectedVersion', async () => {
    const invoker = new FakeInvoker()
    invoker.enqueue(success([{
      linkId: 'link_demo', linkVersion: 3, childId: 'student_demo', displayName: '小宇', displayNameMasked: '小*',
      studentNumber: 'STU-DEMO-0032', classId: 'class_demo', className: '三年级 2 班', confirmedAt: '2026-09-16T00:00:00.000Z',
    }]))
    invoker.enqueue(success({
      id: 'link_bound', version: 1, confirmedAt: '2026-09-16T00:00:00.000Z',
      child: { id: 'student_demo', displayName: '小宇', displayNameMasked: '小*', studentNumber: 'STU-DEMO-0032' },
    }))
    invoker.enqueue(success(null))
    configureRepositories({
      mode: 'cloudbase', invoker,
      authentication: { signIn: async () => undefined },
      context: () => ({ sessionId: 'session_parent' }),
    })

    await listParentChildren('forged-client-parent')
    await bindChild('forged-client-parent', { operationId: 'operation_bind_cloud', studentNumber: 'STU-DEMO-0032', code: '482731' })
    await unbindChild('forged-client-parent', {
      operationId: 'operation_unbind_cloud', expectedVersion: 3, childId: 'student_demo', reason: '家长主动解除绑定',
    })

    expect(invoker.calls).toEqual([
      {
        functionName: 'parent-query',
        request: { apiVersion: 'm1.v1', action: 'listChildren', payload: {} },
        context: { businessSessionToken: 'session_parent' },
      },
      {
        functionName: 'relationship-command',
        request: {
          apiVersion: 'm1.v1', action: 'bindChild', payload: { studentNumber: 'STU-DEMO-0032', code: '482731' }, operationId: 'operation_bind_cloud',
        },
        context: { businessSessionToken: 'session_parent' },
      },
      {
        functionName: 'relationship-command',
        request: {
          apiVersion: 'm1.v1', action: 'unbindChild', payload: { childId: 'student_demo', reason: '家长主动解除绑定' },
          operationId: 'operation_unbind_cloud', expectedVersion: 3,
        },
        context: { businessSessionToken: 'session_parent' },
      },
    ])
    expect(JSON.stringify(invoker.calls)).not.toContain('forged-client-parent')
  })
})
