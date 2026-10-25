import { describe, expect, it, vi } from 'vitest'
import {
  createCloudBaseJsSdkAdapter,
  type CloudBaseJsSdkAppPort,
  type CloudBaseJsSdkAuthPort,
} from '../../miniprogram/repositories/cloudbase/js-sdk-adapter'
import { createCloudRepositoryClient } from '../../miniprogram/repositories/cloudbase/protocol'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { parseFunctionRequest } from '../../m1-cloudbase/src/shared/validation'

describe('@cloudbase/js-sdk v3 client adapter', () => {
  it('uses one app for Auth v2 password login and the following structured function call', async () => {
    let signedInPhone: string | null = null
    const signInWithPassword = vi.fn(async (input: Readonly<{ phone: string; password: string }>) => {
      signedInPhone = input.phone
      return { data: { user: { id: 'uid_teacher' }, session: { access_token: 'sdk-owned' } }, error: null }
    })
    const calls: Array<Readonly<{ name: string; data: object; parse: true; signedInPhone: string | null }>> = []
    const app: CloudBaseJsSdkAppPort = {
      auth: vi.fn((): CloudBaseJsSdkAuthPort => ({
        signInWithPassword,
        getVerification: async () => ({ verification_id: 'ver_test' }),
        verify: async () => ({ verification_token: 'token_test' }),
        resetPassword: async () => undefined,
      })),
      async callFunction(options) {
        calls.push({ ...options, signedInPhone })
        return {
          result: {
            ok: true,
            data: [],
            meta: { requestId: 'req_sdk', serverTime: '2026-09-17T00:00:00.000Z', apiVersion: 'm1.v1' },
          },
        }
      },
    }
    const adapter = createCloudBaseJsSdkAdapter(app)
    const client = createCloudRepositoryClient(adapter.invoker, () => ({ sessionId: 'opaque.session.token' }))

    await expect(adapter.authentication.signIn({ mobile: '+8613800000000', password: 'not-forwarded' })).resolves.toBeUndefined()
    await expect(client.call('content-query', 'listReadingResources', {})).resolves.toMatchObject({ ok: true })

    expect(app.auth).toHaveBeenCalledOnce()
    expect(app.auth).toHaveBeenCalledWith({ persistence: 'local' })
    expect(signInWithPassword).toHaveBeenCalledWith({ phone: '+8613800000000', password: 'not-forwarded' })
    expect(calls).toEqual([{
      name: 'content-query',
      parse: true,
      signedInPhone: '+8613800000000',
      data: {
        apiVersion: 'm1.v1',
        action: 'listReadingResources',
        payload: {},
        businessSessionToken: 'opaque.session.token',
      },
    }])
    expect(JSON.stringify(calls)).not.toContain('not-forwarded')
    expect(JSON.stringify(calls)).not.toContain('actorUserId')
    expect(JSON.stringify(calls)).not.toContain('actorRole')
    expect(JSON.stringify(calls)).not.toContain('organizationId')
    if (calls[0] === undefined) throw new Error('CloudBase JS SDK call was not captured')
    expect(parseFunctionRequest(calls[0].data, ['listReadingResources'] as const).ok).toBe(true)
  })

  it('normalizes a mainland mobile number before sending it to CloudBase Auth', async () => {
    const signInWithPassword = vi.fn(async () => ({ data: { user: {}, session: {} }, error: null }))
    const app: CloudBaseJsSdkAppPort = {
      auth: () => ({
        signInWithPassword,
        getVerification: async () => ({ verification_id: 'ver_test' }),
        verify: async () => ({ verification_token: 'token_test' }),
        resetPassword: async () => undefined,
      }),
      async callFunction() { return { result: { ok: true, data: null } } },
    }
    const adapter = createCloudBaseJsSdkAdapter(app)

    await adapter.authentication.signIn({ mobile: '13800000000', password: 'not-forwarded' })

    expect(signInWithPassword).toHaveBeenCalledWith({ phone: '+8613800000000', password: 'not-forwarded' })
  })

  it('reports a missing verification token as an invalid recovery code', async () => {
    const app: CloudBaseJsSdkAppPort = {
      auth: () => ({
        signInWithPassword: async () => ({ data: { user: {}, session: {} }, error: null }),
        getVerification: async () => ({ verification_id: 'ver_test' }),
        verify: async () => ({}),
        resetPassword: async () => undefined,
      }),
      async callFunction() { return { result: { ok: true, data: null } } },
    }
    const adapter = createCloudBaseJsSdkAdapter(app)
    const requestCode = adapter.authentication.requestPasswordResetCode
    const verifyCode = adapter.authentication.verifyPasswordResetCode
    if (!requestCode || !verifyCode) throw new Error('Password recovery methods are unavailable')
    await requestCode('13800000000')

    await expect(verifyCode('13800000000', '000000')).rejects.toEqual({
      code: 'INVALID_VERIFICATION_CODE',
    })
  })

  it('stores the verification token before password entry and resets with that token', async () => {
    const getVerification = vi.fn(async () => ({ verification_id: 'ver_test' }))
    const verify = vi.fn(async () => ({ verification_token: 'token_test', expires_in: 600 }))
    const resetPassword = vi.fn(async () => undefined)
    const app: CloudBaseJsSdkAppPort = {
      auth: () => ({
        signInWithPassword: async () => ({ data: { user: {}, session: {} }, error: null }),
        getVerification,
        verify,
        resetPassword,
      }),
      async callFunction() { return { result: { ok: true, data: null } } },
    }
    const adapter = createCloudBaseJsSdkAdapter(app)
    const requestCode = adapter.authentication.requestPasswordResetCode
    const verifyCode = adapter.authentication.verifyPasswordResetCode
    const setPassword = adapter.authentication.resetPassword
    if (!requestCode || !verifyCode || !setPassword) throw new Error('Password recovery methods are unavailable')

    await requestCode('13800000000')
    await expect(verifyCode('13800000000', '000000')).resolves.toBe(600)
    await setPassword('13800000000', 'StrongPass123')

    expect(getVerification).toHaveBeenCalledWith({ phone_number: '+86 13800000000', usage: 'recovery', target: 'USER' })
    expect(verify).toHaveBeenCalledWith({ verification_id: 'ver_test', verification_code: '000000' })
    expect(resetPassword).toHaveBeenCalledWith({ phone_number: '+86 13800000000',
      new_password: 'StrongPass123', verification_token: 'token_test' })
  })

  it('shows a verification error when Auth reports an invalid argument during code verification', async () => {
    const repository = createCloudRepositoryClient({
      async call() { return { ok: true, data: null } },
    }, () => ({ sessionId: null }))
    const service = createCloudAppService(repository, {
      async signIn() {},
      async requestPasswordResetCode() {},
      async verifyPasswordResetCode() { throw { code: 'invalid_argument' } },
      async resetPassword() {},
    }, () => ({ sessionId: null }))

    await expect(service.verifyPasswordResetCode('13800000000', '000000')).resolves.toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: '验证码无效或已过期', retryable: false },
    })
  })

  it('stops password recovery when the verified phone has no Auth user', async () => {
    const adapter = createCloudBaseJsSdkAdapter({
      auth: () => ({
        signInWithPassword: async () => ({ data: { user: {}, session: {} }, error: null }),
        getVerification: async () => ({ verification_id: 'ver_test', is_user: false }),
        verify: async () => ({ verification_token: 'unused' }),
        resetPassword: async () => undefined,
      }),
      async callFunction() { return { result: { ok: true, data: null } } },
    })
    const service = createCloudAppService(
      createCloudRepositoryClient(adapter.invoker, () => ({ sessionId: null })),
      adapter.authentication, () => ({ sessionId: null }))

    await expect(service.requestPasswordResetCode('13800000000')).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: '该手机号未对应可找回的账号，请联系学校管理员核对', retryable: false },
    })
  })

  it('does not mislabel a password policy failure as a code expiry', async () => {
    const repository = createCloudRepositoryClient({
      async call() { return { ok: true, data: null } },
    }, () => ({ sessionId: null }))
    const service = createCloudAppService(repository, {
      async signIn() {},
      async requestPasswordResetCode() {},
      async verifyPasswordResetCode() { return 600 },
      async resetPassword() { throw { code: 'INVALID_ARGUMENT' } },
    }, () => ({ sessionId: null }))

    await expect(service.resetPassword('13800000000', 'StrongPass123')).resolves.toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: '新密码不符合要求，请检查密码长度和格式', retryable: false },
    })
  })

  it.each([
    [{ error: 'user_not_found', error_description: 'private account detail' }, 'NOT_FOUND',
      '该手机号未对应可找回的账号，请联系学校管理员核对'],
    [{ error: 'weak_password', error_description: 'private policy detail' }, 'VALIDATION_ERROR',
      '新密码不符合要求，请检查密码长度和格式'],
    [{ error: 'invalid_grant', error_description: 'private token detail' }, 'VALIDATION_ERROR',
      '验证码已过期，请重新验证'],
  ] as const)('maps password reset provider errors without exposing details', async (providerError, code, message) => {
    const app: CloudBaseJsSdkAppPort = {
      auth: () => ({
        signInWithPassword: async () => ({ data: { user: {}, session: {} }, error: null }),
        getVerification: async () => ({ verification_id: 'ver_test' }),
        verify: async () => ({ verification_token: 'token_test', expires_in: 600 }),
        resetPassword: async () => { throw providerError },
      }),
      async callFunction() { return { result: { ok: true, data: null } } },
    }
    const adapter = createCloudBaseJsSdkAdapter(app)
    const repository = createCloudRepositoryClient(adapter.invoker, () => ({ sessionId: null }))
    const service = createCloudAppService(repository, adapter.authentication, () => ({ sessionId: null }))
    await service.requestPasswordResetCode('13800000000')
    await service.verifyPasswordResetCode('13800000000', '000000')

    const result = await service.resetPassword('13800000000', 'StrongPass123')

    expect(result).toEqual({ ok: false, error: { code, message, retryable: false } })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('logs only an unrecognized provider code for follow-up diagnosis', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const adapter = createCloudBaseJsSdkAdapter({
        auth: () => ({
          signInWithPassword: async () => ({ data: { user: {}, session: {} }, error: null }),
          getVerification: async () => ({ verification_id: 'ver_test' }),
          verify: async () => ({ verification_token: 'token_test', expires_in: 600 }),
          resetPassword: async () => { throw { error: 'failed_precondition', error_description: 'private phone and token' } },
        }),
        async callFunction() { return { result: { ok: true, data: null } } },
      })
      const service = createCloudAppService(
        createCloudRepositoryClient(adapter.invoker, () => ({ sessionId: null })),
        adapter.authentication, () => ({ sessionId: null }))
      await service.requestPasswordResetCode('13800000000')
      await service.verifyPasswordResetCode('13800000000', '000000')

      const result = await service.resetPassword('13800000000', 'StrongPass123')

      expect(result).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } })
      expect(warning).toHaveBeenCalledWith('[Auth] password reset provider code:', 'AUTH_PROVIDER_FAILED_PRECONDITION')
      expect(JSON.stringify(warning.mock.calls)).not.toContain('private')
    } finally {
      warning.mockRestore()
    }
  })

  it('omits the business token for bootstrap and rejects malformed structured results', async () => {
    const calls: object[] = []
    const app = fakeApp({ data: { user: {}, session: {} }, error: null }, async options => {
      calls.push(options.data)
      return { result: { unexpected: true } }
    })
    const adapter = createCloudBaseJsSdkAdapter(app)
    const client = createCloudRepositoryClient(adapter.invoker, () => ({ sessionId: null }))

    await expect(client.call('auth-session', 'bootstrap', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    })
    expect(calls).toEqual([{ apiVersion: 'm1.v1', action: 'bootstrap', payload: {} }])
  })

  it('treats an Auth v2 error result as a failed sign-in without exposing provider details', async () => {
    const app = fakeApp({
      data: null,
      error: { code: 'INVALID_PASSWORD', message: 'private provider diagnostic' },
    })
    const adapter = createCloudBaseJsSdkAdapter(app)

    await expect(adapter.authentication.signIn({ mobile: '+8613800000000', password: 'wrong' })).rejects.toEqual({
      code: 'INVALID_PASSWORD',
    })
  })

  it('extracts a known Auth error from a 400 response without forwarding raw diagnostics', async () => {
    const app = fakeApp({ data: null, error: { code: 400, message: 'captcha_required: private provider diagnostic' } })
    const adapter = createCloudBaseJsSdkAdapter(app)
    await expect(adapter.authentication.signIn({ mobile: '13800000000', password: 'wrong' })).rejects.toEqual({ code: 'CAPTCHA_REQUIRED' })
  })

  it.each([
    ['network error', { code: 'NETWORK_ERROR', message: 'connection closed' }, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试'],
    ['timeout', { code: -1, message: 'request timeout' }, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试'],
    ['missing environment', { code: -501000, message: 'Environment not found: private-env-id' }, 'SERVICE_UNAVAILABLE', '服务暂不可用，请稍后重试'],
    ['missing function', { code: 'FUNCTION_NOT_FOUND', message: 'function not found' }, 'SERVICE_UNAVAILABLE', '服务暂不可用，请稍后重试'],
    ['unknown failure', { code: -999999, message: 'sensitive provider detail' }, 'INTERNAL_ERROR', '服务处理失败，请稍后重试'],
  ] as const)('maps %s without exposing the raw SDK error', async (_label, platformError, code, message) => {
    const client = createCloudRepositoryClient({
      async call() {
        throw platformError
      },
    }, () => ({ sessionId: null }))

    const result = await client.call('content-query', 'listReadingResources', {})

    expect(result).toEqual({
      ok: false,
      error: { code, message, retryable: code !== 'INTERNAL_ERROR' },
    })
    expect(JSON.stringify(result)).not.toContain('private-env-id')
    expect(JSON.stringify(result)).not.toContain('sensitive provider detail')
  })

  it('treats the SDK unauthenticated envelope as an expired login and clears the old session', async () => {
    const expired = vi.fn()
    const client = createCloudRepositoryClient({
      async call() { throw { error: 'unauthenticated', error_description: 'private access token detail' } },
    }, () => ({ sessionId: 'old-business-session' }), expired)
    const result = await client.call('notification-query', 'list', { filter: 'all' })
    expect(result).toEqual({ ok: false, error: { code: 'UNAUTHENTICATED',
      message: '登录状态已失效，请重新登录', retryable: false } })
    expect(expired).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('private access token detail')
  })
})

function fakeApp(
  authResponse: Readonly<{ data?: unknown; error?: unknown }>,
  callFunction: CloudBaseJsSdkAppPort['callFunction'] = async () => ({ result: { ok: true, data: null } }),
): CloudBaseJsSdkAppPort {
  return {
    auth: () => ({
      signInWithPassword: async () => authResponse,
      getVerification: async () => ({ verification_id: 'ver_test' }),
      verify: async () => ({ verification_token: 'token_test' }),
      resetPassword: async () => undefined,
    }),
    callFunction,
  }
}
