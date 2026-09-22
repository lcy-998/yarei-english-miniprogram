import {
  CloudClientContextProvider,
} from './cloudbase/protocol'
import {
  CloudBaseJsSdkPort,
  createCloudBaseJsSdkAdapter,
} from './cloudbase/js-sdk-adapter'
import { configureRepositories, getRepositoryMode, RepositoryMode } from './repository-factory'

export type RepositoryStartupConfiguration =
  | Readonly<{ mode: 'memory' }>
  | Readonly<{ mode: 'cloudbase'; envId: string }>

export interface RepositoryStartupDependencies {
  clientSdk?: CloudBaseJsSdkPort
  context?: CloudClientContextProvider
}

export type RepositoryStartupFailureReason =
  | 'ALREADY_ACTIVATED'
  | 'INVALID_ENV_ID'
  | 'CLIENT_SDK_UNAVAILABLE'
  | 'CONTEXT_UNAVAILABLE'
  | 'CLOUD_INITIALIZATION_FAILED'

export type RepositoryStartupResult =
  | Readonly<{ ok: true; mode: RepositoryMode; alreadyActive: boolean }>
  | Readonly<{ ok: false; mode: RepositoryMode; reason: RepositoryStartupFailureReason }>

type StartupState =
  | Readonly<{ status: 'uninitialized' }>
  | Readonly<{ status: 'active'; mode: RepositoryMode; envId?: string }>
  | Readonly<{ status: 'blocked'; reason: RepositoryStartupFailureReason }>

let startupState: StartupState = { status: 'uninitialized' }

/**
 * Selects the repository implementation exactly once during application startup.
 * The committed application configuration remains memory-only. CloudBase must be
 * explicitly requested with every runtime dependency supplied by the caller.
 */
export function initializeRepositories(
  configuration: RepositoryStartupConfiguration,
  dependencies: RepositoryStartupDependencies = {},
): RepositoryStartupResult {
  if (startupState.status !== 'uninitialized') {
    if (startupState.status === 'active' && isSameActivation(startupState, configuration)) {
      return { ok: true, mode: startupState.mode, alreadyActive: true }
    }
    return {
      ok: false,
      mode: startupState.status === 'active' ? startupState.mode : 'memory',
      reason: 'ALREADY_ACTIVATED',
    }
  }

  configureRepositories({ mode: 'memory' })

  if (configuration.mode === 'memory') {
    startupState = { status: 'active', mode: 'memory' }
    return { ok: true, mode: 'memory', alreadyActive: false }
  }

  const envId = configuration.envId
  if (!isValidEnvId(envId)) return blockStartup('INVALID_ENV_ID')
  if (dependencies.clientSdk === undefined) return blockStartup('CLIENT_SDK_UNAVAILABLE')
  if (dependencies.context === undefined) return blockStartup('CONTEXT_UNAVAILABLE')

  try {
    const app = dependencies.clientSdk.init({ env: envId })
    const adapter = createCloudBaseJsSdkAdapter(app)
    configureRepositories({
      mode: 'cloudbase',
      invoker: adapter.invoker,
      authentication: adapter.authentication,
      context: dependencies.context,
    })
  } catch (_error: unknown) {
    configureRepositories({ mode: 'memory' })
    return blockStartup('CLOUD_INITIALIZATION_FAILED')
  }

  startupState = { status: 'active', mode: 'cloudbase', envId }
  return { ok: true, mode: getRepositoryMode(), alreadyActive: false }
}

function blockStartup(reason: RepositoryStartupFailureReason): RepositoryStartupResult {
  startupState = { status: 'blocked', reason }
  return { ok: false, mode: 'memory', reason }
}

function isSameActivation(
  active: Extract<StartupState, { status: 'active' }>,
  requested: RepositoryStartupConfiguration,
): boolean {
  return active.mode === requested.mode
    && (requested.mode === 'memory' || active.envId === requested.envId)
}

function isValidEnvId(envId: string): boolean {
  return envId.length > 0 && envId.length <= 128 && envId === envId.trim() && !/\s/.test(envId)
}
