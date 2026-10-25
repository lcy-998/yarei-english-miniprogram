import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initializeRepositories: vi.fn(),
  blockRepositoryStartup: vi.fn(),
  loadInstalledCloudBaseJsSdk: vi.fn(() => ({})),
}))

vi.mock('../../miniprogram/repositories/repository-bootstrap', () => ({
  initializeRepositories: mocks.initializeRepositories,
  blockRepositoryStartup: mocks.blockRepositoryStartup,
}))
vi.mock('../../miniprogram/repositories/cloudbase/installed-js-sdk', () => ({
  loadInstalledCloudBaseJsSdk: mocks.loadInstalledCloudBaseJsSdk,
}))
vi.mock('../../miniprogram/session/session', () => ({ getSession: () => null }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('release startup environment', () => {
  it.each(['release', 'trial'] as const)('binds the %s package to the reviewed environment instead of local storage', async version => {
    let launch: (() => void) | undefined
    const cloudInit = vi.fn()
    vi.stubGlobal('App', (definition: Readonly<{ onLaunch: () => void }>) => { launch = definition.onLaunch })
    vi.stubGlobal('wx', {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: version } }),
      getStorageSync: () => 'other-environment',
      cloud: { init: cloudInit },
      showModal: vi.fn(),
    })
    mocks.initializeRepositories.mockReturnValue({ ok: true, mode: 'cloudbase', alreadyActive: false })

    await import('../../miniprogram/app')
    expect(launch).toBeDefined()
    launch?.()

    expect(cloudInit).toHaveBeenCalledWith({ env: 'cloud1-d8ggzrwwedb786e41' })
    expect(mocks.initializeRepositories).toHaveBeenCalledWith(
      { mode: 'cloudbase', envId: 'cloud1-d8ggzrwwedb786e41' }, expect.any(Object),
    )
  })

  it('blocks repository access when release cloud initialization fails', async () => {
    let launch: (() => void) | undefined
    const showModal = vi.fn()
    vi.stubGlobal('App', (definition: Readonly<{ onLaunch: () => void }>) => { launch = definition.onLaunch })
    vi.stubGlobal('wx', {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
      getStorageSync: () => 'other-environment',
      cloud: { init: () => { throw new Error('unavailable') } },
      showModal,
    })

    await import('../../miniprogram/app')
    launch?.()

    expect(mocks.blockRepositoryStartup).toHaveBeenCalledWith('CLOUD_INITIALIZATION_FAILED')
    expect(mocks.initializeRepositories).not.toHaveBeenCalled()
    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({ title: '服务暂不可用' }))
  })

  it('blocks startup when the account version cannot be verified', async () => {
    let launch: (() => void) | undefined
    vi.stubGlobal('App', (definition: Readonly<{ onLaunch: () => void }>) => { launch = definition.onLaunch })
    vi.stubGlobal('wx', {
      getAccountInfoSync: () => { throw new Error('account unavailable') },
      getStorageSync: vi.fn(),
      cloud: { init: vi.fn() },
      showModal: vi.fn(),
    })

    await import('../../miniprogram/app')
    launch?.()

    expect(mocks.blockRepositoryStartup).toHaveBeenCalledWith('ACCOUNT_VERSION_UNAVAILABLE')
    expect(mocks.initializeRepositories).not.toHaveBeenCalled()
  })

  it('blocks repository access when the CloudBase client SDK cannot load', async () => {
    let launch: (() => void) | undefined
    vi.stubGlobal('App', (definition: Readonly<{ onLaunch: () => void }>) => { launch = definition.onLaunch })
    vi.stubGlobal('wx', {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
      cloud: { init: vi.fn() },
      showModal: vi.fn(),
    })
    mocks.loadInstalledCloudBaseJsSdk.mockImplementationOnce(() => { throw new Error('SDK missing') })

    await import('../../miniprogram/app')
    launch?.()

    expect(mocks.blockRepositoryStartup).toHaveBeenCalledWith('CLIENT_SDK_UNAVAILABLE')
    expect(mocks.initializeRepositories).not.toHaveBeenCalled()
  })
})
