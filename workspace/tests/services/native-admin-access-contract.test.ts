import { describe, expect, it } from 'vitest'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'

describe('native management entry client contract', () => {
  it('rehydrates the current profile from the active server session after app restart', async () => {
    const calls: unknown[] = []
    const invoker: CloudFunctionInvoker = { async call(functionName, request, context) {
      calls.push({ functionName, action: request.action, payload: request.payload,
        token: context.businessSessionToken })
      return { ok: true, data: { sessionId: 'token_teacher', userId: 'usr_teacher_demo_01',
        organizationId: 'org_demo', activeRole: 'teacher', roles: ['teacher'],
        displayName: '林老师', profileVersion: 4 } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker,
      () => ({ sessionId: 'token_teacher' })), { async signIn() {} },
    () => ({ sessionId: 'token_teacher' }))

    expect(await service.getUser('usr_teacher_demo_01')).toMatchObject({ ok: true,
      data: { id: 'usr_teacher_demo_01', displayName: '林老师', role: 'teacher' } })
    expect(await service.getUser('usr_other')).toMatchObject({ ok: false,
      error: { code: 'NOT_FOUND' } })
    expect(calls).toEqual([
      { functionName: 'auth-session', action: 'getCurrentSession', payload: {}, token: 'token_teacher' },
      { functionName: 'auth-session', action: 'getCurrentSession', payload: {}, token: 'token_teacher' },
    ])
  })

  it('asks the server for independent management access through the teacher session', async () => {
    const calls: unknown[] = []
    const invoker: CloudFunctionInvoker = { async call(functionName, request, context) {
      calls.push({ functionName, action: request.action, payload: request.payload,
        token: context.businessSessionToken })
      return { ok: true, data: { grantVersion: 2, permissions: ['dashboard.read'],
        scope: { organizationWide: false, classIds: ['class_demo'] } } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker,
      () => ({ sessionId: 'session_teacher_demo' })), { async signIn() {} },
    () => ({ sessionId: 'session_teacher_demo' }))
    expect(await service.getNativeAdminAccess('forged_teacher'))
      .toMatchObject({ ok: true, data: { grantVersion: 2 } })
    expect(calls).toEqual([{ functionName: 'native-admin-query', action: 'getAccess',
      payload: {}, token: 'session_teacher_demo' }])
  })

  it('keeps scope and identity off dashboard, class and user list requests', async () => {
    const calls: unknown[] = []
    const invoker: CloudFunctionInvoker = { async call(functionName, request, context) {
      calls.push({ functionName, action: request.action, payload: request.payload,
        token: context.businessSessionToken })
      return { ok: true, data: { items: [], nextOffset: null } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker,
      () => ({ sessionId: 'session_teacher_demo' })), { async signIn() {} },
    () => ({ sessionId: 'session_teacher_demo' }))
    await service.listNativeAdminClasses('forged_teacher', 20, 0)
    await service.listNativeAdminSelectionOptions('forged_teacher', 'teacher_for_class',
      'class_demo', 20, 0, '老师')
    await service.listNativeAdminUsers('forged_teacher', 'class_demo', 20, 0)
    await service.listNativeAdminGrants('forged_teacher', 20, 0)
    await service.listNativeAdminRecords('forged_teacher', 'media', 20, 0)
    expect(calls).toEqual([
      { functionName: 'native-admin-query', action: 'listClasses', payload: { query: '', page: { limit: 20, offset: 0 } }, token: 'session_teacher_demo' },
      { functionName: 'native-admin-query', action: 'listSelectionOptions', payload: {
        kind: 'teacher_for_class', classId: 'class_demo', query: '老师',
        page: { limit: 20, offset: 0 } }, token: 'session_teacher_demo' },
      { functionName: 'native-admin-query', action: 'listUsers', payload: { classId: 'class_demo', page: { limit: 20, offset: 0 } }, token: 'session_teacher_demo' },
      { functionName: 'native-admin-query', action: 'listGrants', payload: { query: '', page: { limit: 20, offset: 0 } }, token: 'session_teacher_demo' },
      { functionName: 'native-admin-query', action: 'listRecords', payload: { kind: 'media', filter: {}, page: { limit: 20, offset: 0 } }, token: 'session_teacher_demo' },
    ])
    expect(JSON.stringify(calls)).not.toContain('forged_teacher')
  })

  it('omits empty user filters but preserves the parent role filter for older strict query functions', async () => {
    const calls: unknown[] = []
    const invoker: CloudFunctionInvoker = { async call(functionName, request, context) {
      calls.push({ functionName, action: request.action, payload: request.payload,
        token: context.businessSessionToken })
      return { ok: true, data: { items: [], nextOffset: null } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker,
      () => ({ sessionId: 'session_teacher_demo' })), { async signIn() {} },
    () => ({ sessionId: 'session_teacher_demo' }))
    await service.listNativeAdminUsers('teacher', '', 20, 0, '', 'parent')
    expect(calls).toEqual([{ functionName: 'native-admin-query', action: 'listUsers',
      payload: { classId: '', role: 'parent', page: { limit: 20, offset: 0 } },
      token: 'session_teacher_demo' }])
  })
})
