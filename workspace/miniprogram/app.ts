import { blockRepositoryStartup, initializeRepositories } from './repositories/repository-bootstrap'
import { loadInstalledCloudBaseJsSdk } from './repositories/cloudbase/installed-js-sdk'
import { getSession } from './session/session'

const DEVELOPMENT_CLOUDBASE_ENV_STORAGE_KEY = 'yarei_development_cloudbase_env_id'
const VERIFIED_NONPRODUCTION_CLOUDBASE_ENV_ID = 'cloud1-d8ggzrwwedb786e41'
declare const require: (moduleName: string) => unknown

App<IAppOption>({
  globalData: {},
  onLaunch() {
    const accountVersion = currentAccountVersion()
    if (accountVersion === 'unknown') {
      blockCloudStartup(true, 'ACCOUNT_VERSION_UNAVAILABLE')
      return
    }
    const isDeployedBuild = accountVersion === 'release' || accountVersion === 'trial'
    const envId = isDeployedBuild ? VERIFIED_NONPRODUCTION_CLOUDBASE_ENV_ID
      : developmentCloudBaseEnvId()
    if (typeof envId !== 'string' || envId.trim().length === 0) {
      initializeRepositories({ mode: 'memory' })
      return
    }

    try { wx.cloud.init({ env: envId.trim() }) }
    catch (_error: unknown) {
      blockCloudStartup(isDeployedBuild, 'CLOUD_INITIALIZATION_FAILED')
      return
    }

    let clientSdk: ReturnType<typeof loadInstalledCloudBaseJsSdk>
    try { clientSdk = loadInstalledCloudBaseJsSdk() }
    catch (_error: unknown) {
      blockRepositoryStartup('CLIENT_SDK_UNAVAILABLE')
      console.warn('[M1] CloudBase client SDK unavailable.')
      if (isDeployedBuild) showReleaseStartupError()
      return
    }

    const startup = initializeRepositories(
      { mode: 'cloudbase', envId: envId.trim() },
      {
        clientSdk,
        context: () => ({
          sessionId: getSession()?.sessionId ?? null,
          localDate: new Date().toISOString().slice(0, 10),
        }),
      },
    )
    if (startup.ok) {
      console.info('[M1] CloudBase repository active')
    } else {
      console.warn('[M1] CloudBase startup blocked.', startup.reason)
      if (isDeployedBuild) showReleaseStartupError()
    }
  },
})

function currentAccountVersion(): 'release' | 'trial' | 'development' | 'unknown' {
  try {
    const version = wx.getAccountInfoSync().miniProgram.envVersion
    return version === 'release' ? 'release'
      : version === 'trial' ? 'trial'
        : version === 'develop' ? 'development' : 'unknown'
  } catch (_error: unknown) { return 'unknown' }
}

function blockCloudStartup(isRelease: boolean,
  reason: 'ACCOUNT_VERSION_UNAVAILABLE' | 'CLOUD_INITIALIZATION_FAILED'): void {
  blockRepositoryStartup(reason)
  console.warn('[M1] Cloud storage startup blocked.')
  if (isRelease) showReleaseStartupError()
}

function showReleaseStartupError(): void {
  wx.showModal({ title: '服务暂不可用', content: '请稍后重新打开小程序', showCancel: false })
}

function localDevelopmentEnvId(): string | null {
  try {
    const candidate = require('./runtime/cloudbase.local') as Readonly<{ cloudBaseDevelopmentEnvId?: unknown }>
    const envId = candidate.cloudBaseDevelopmentEnvId
    return typeof envId === 'string' && envId.trim().length > 0 ? envId.trim() : null
  } catch (_error: unknown) {
    return null
  }
}

function developmentCloudBaseEnvId(): string {
  const configured = localDevelopmentEnvId()
  if (configured !== null) return configured
  try {
    const stored = wx.getStorageSync(DEVELOPMENT_CLOUDBASE_ENV_STORAGE_KEY)
    if (typeof stored === 'string' && stored.trim().length > 0) return stored.trim()
  } catch (_error: unknown) { /* Use the verified non-production environment below. */ }
  return VERIFIED_NONPRODUCTION_CLOUDBASE_ENV_ID
}

