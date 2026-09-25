import { initializeRepositories } from './repositories/repository-bootstrap'
import { loadInstalledCloudBaseJsSdk } from './repositories/cloudbase/installed-js-sdk'
import { getSession } from './session/session'

const DEVELOPMENT_CLOUDBASE_ENV_STORAGE_KEY = 'yarei_development_cloudbase_env_id'
declare const require: (moduleName: string) => unknown

App<IAppOption>({
  globalData: {},
  onLaunch() {
    const envId = localDevelopmentEnvId() ?? wx.getStorageSync(DEVELOPMENT_CLOUDBASE_ENV_STORAGE_KEY)
    if (typeof envId !== 'string' || envId.trim().length === 0) {
      initializeRepositories({ mode: 'memory' })
      return
    }

    const startup = initializeRepositories(
      { mode: 'cloudbase', envId: envId.trim() },
      {
        clientSdk: loadInstalledCloudBaseJsSdk(),
        context: () => ({
          sessionId: getSession()?.sessionId ?? null,
          localDate: new Date().toISOString().slice(0, 10),
        }),
      },
    )
    if (startup.ok) {
      console.info('[M1] CloudBase repository active')
    } else {
      console.warn('[M1] CloudBase startup failed; using memory repository.', startup.reason)
    }
  },
})

function localDevelopmentEnvId(): string | null {
  try {
    const candidate = require('./runtime/cloudbase.local') as Readonly<{ cloudBaseDevelopmentEnvId?: unknown }>
    const envId = candidate.cloudBaseDevelopmentEnvId
    return typeof envId === 'string' && envId.trim().length > 0 ? envId.trim() : null
  } catch (_error: unknown) {
    return null
  }
}
