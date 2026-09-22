import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CloudBaseJsSdkAppPort,
  CloudBaseJsSdkPort,
} from '../../miniprogram/repositories/cloudbase/js-sdk-adapter'
import type { CloudClientContextProvider } from '../../miniprogram/repositories/cloudbase/protocol'

function clientSdk(initImplementation?: (configuration: Readonly<{ env: string }>) => CloudBaseJsSdkAppPort): {
  sdk: CloudBaseJsSdkPort
  app: CloudBaseJsSdkAppPort
  init: ReturnType<typeof vi.fn>
  signInWithPassword: ReturnType<typeof vi.fn>
  callFunction: ReturnType<typeof vi.fn>
} {
  const signInWithPassword = vi.fn(async () => ({ data: { user: {}, session: {} }, error: null }))
  const callFunction = vi.fn(async () => ({ result: { ok: true, data: null } }))
  const app: CloudBaseJsSdkAppPort = {
    auth: () => ({
      signInWithPassword,
      getVerification: async () => ({ verification_id: 'ver_test' }),
      verify: async () => ({ verification_token: 'token_test' }),
      resetPassword: async () => undefined,
    }),
    callFunction,
  }
  const init = vi.fn(initImplementation ?? (() => app))
  return { sdk: { init }, app, init, signInWithPassword, callFunction }
}

const context: CloudClientContextProvider = () => ({ sessionId: null })

describe('repository startup activation', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('keeps the committed default on memory without touching CloudBase', async () => {
    const client = clientSdk()
    const { initializeRepositories } = await import('../../miniprogram/repositories/repository-bootstrap')
    const { getRepositoryMode } = await import('../../miniprogram/repositories/repository-factory')

    expect(initializeRepositories({ mode: 'memory' }, { clientSdk: client.sdk, context })).toEqual({
      ok: true, mode: 'memory', alreadyActive: false,
    })
    expect(getRepositoryMode()).toBe('memory')
    expect(client.init).not.toHaveBeenCalled()
    expect(client.signInWithPassword).not.toHaveBeenCalled()
    expect(client.callFunction).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid env id', { envId: '' }, { clientSdk: clientSdk().sdk, context }, 'INVALID_ENV_ID'],
    ['missing client SDK', { envId: 'env-explicit-dev' }, { context }, 'CLIENT_SDK_UNAVAILABLE'],
    ['missing context', { envId: 'env-explicit-dev' }, { clientSdk: clientSdk().sdk }, 'CONTEXT_UNAVAILABLE'],
  ] as const)('blocks cloudbase activation for %s', async (_label, input, dependencies, reason) => {
    const { initializeRepositories } = await import('../../miniprogram/repositories/repository-bootstrap')
    const { getRepositoryMode } = await import('../../miniprogram/repositories/repository-factory')

    expect(initializeRepositories({ mode: 'cloudbase', envId: input.envId }, dependencies)).toEqual({
      ok: false, mode: 'memory', reason,
    })
    expect(getRepositoryMode()).toBe('memory')
  })

  it('initializes the exact explicit environment and one shared JS SDK app before cloud mode', async () => {
    const client = clientSdk()
    const { initializeRepositories } = await import('../../miniprogram/repositories/repository-bootstrap')
    const { getRepositoryMode } = await import('../../miniprogram/repositories/repository-factory')

    expect(initializeRepositories(
      { mode: 'cloudbase', envId: 'env-explicit-dev' },
      { clientSdk: client.sdk, context },
    )).toEqual({ ok: true, mode: 'cloudbase', alreadyActive: false })
    expect(client.init).toHaveBeenCalledOnce()
    expect(client.init).toHaveBeenCalledWith({ env: 'env-explicit-dev' })
    expect(client.signInWithPassword).not.toHaveBeenCalled()
    expect(client.callFunction).not.toHaveBeenCalled()
    expect(getRepositoryMode()).toBe('cloudbase')
  })

  it('keeps memory active and blocks retry when JS SDK initialization fails', async () => {
    const client = clientSdk(() => { throw new Error('init failed') })
    const { initializeRepositories } = await import('../../miniprogram/repositories/repository-bootstrap')
    const { getRepositoryMode } = await import('../../miniprogram/repositories/repository-factory')

    expect(initializeRepositories(
      { mode: 'cloudbase', envId: 'env-explicit-dev' },
      { clientSdk: client.sdk, context },
    )).toEqual({ ok: false, mode: 'memory', reason: 'CLOUD_INITIALIZATION_FAILED' })
    expect(getRepositoryMode()).toBe('memory')
    expect(initializeRepositories({ mode: 'memory' })).toEqual({
      ok: false, mode: 'memory', reason: 'ALREADY_ACTIVATED',
    })
  })

  it('fails closed when the SDK app lacks required v3 capabilities', async () => {
    const client = clientSdk(() => ({}) as CloudBaseJsSdkAppPort)
    const { initializeRepositories } = await import('../../miniprogram/repositories/repository-bootstrap')
    const { getRepositoryMode } = await import('../../miniprogram/repositories/repository-factory')

    expect(initializeRepositories(
      { mode: 'cloudbase', envId: 'env-explicit-dev' },
      { clientSdk: client.sdk, context },
    )).toEqual({ ok: false, mode: 'memory', reason: 'CLOUD_INITIALIZATION_FAILED' })
    expect(getRepositoryMode()).toBe('memory')
  })

  it('allows an idempotent repeat but rejects a runtime mode switch', async () => {
    const { initializeRepositories } = await import('../../miniprogram/repositories/repository-bootstrap')

    expect(initializeRepositories({ mode: 'memory' })).toEqual({ ok: true, mode: 'memory', alreadyActive: false })
    expect(initializeRepositories({ mode: 'memory' })).toEqual({ ok: true, mode: 'memory', alreadyActive: true })
    expect(initializeRepositories(
      { mode: 'cloudbase', envId: 'env-explicit-dev' },
      { clientSdk: clientSdk().sdk, context },
    )).toEqual({ ok: false, mode: 'memory', reason: 'ALREADY_ACTIVATED' })
  })

  it('keeps cloudbase active when a later caller tries to switch back to memory', async () => {
    const client = clientSdk()
    const { initializeRepositories } = await import('../../miniprogram/repositories/repository-bootstrap')
    const { getRepositoryMode } = await import('../../miniprogram/repositories/repository-factory')

    expect(initializeRepositories(
      { mode: 'cloudbase', envId: 'env-explicit-dev' },
      { clientSdk: client.sdk, context },
    )).toMatchObject({ ok: true, mode: 'cloudbase' })
    expect(initializeRepositories({ mode: 'memory' })).toEqual({
      ok: false, mode: 'cloudbase', reason: 'ALREADY_ACTIVATED',
    })
    expect(getRepositoryMode()).toBe('cloudbase')
  })
})
