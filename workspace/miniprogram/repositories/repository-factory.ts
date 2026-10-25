import { CloudAppService, createCloudAppService } from '../services/cloudbase-app-service'
import { configureM1AppRepository, useMemoryM1AppRepository } from '../services/m1-app-service'
import { createCloudBaseM1AppRepository } from './cloudbase/cloudbase-m1-app-repository'
import { clearSession, getCurrentChildId } from '../session/session'
import type { M1AppRepository } from './m1-app-repository'
import type { ServiceResult } from '../domain/types'
import {
  CloudAuthenticationPort,
  CloudClientContextProvider,
  CloudFunctionInvoker,
  createCloudRepositoryClient,
} from './cloudbase/protocol'

export type RepositoryMode = 'memory' | 'cloudbase' | 'blocked'

export interface CloudBaseRepositoryConfiguration {
  mode: 'cloudbase'
  invoker: CloudFunctionInvoker
  authentication: CloudAuthenticationPort
  context: CloudClientContextProvider
}

export interface MemoryRepositoryConfiguration { mode: 'memory' }
export interface BlockedRepositoryConfiguration { mode: 'blocked' }

export type RepositoryConfiguration = MemoryRepositoryConfiguration | CloudBaseRepositoryConfiguration | BlockedRepositoryConfiguration

let cloudService: CloudAppService | null = null
let repositoryMode: RepositoryMode = 'memory'

function unavailable<T>(): Promise<ServiceResult<T>> {
  return Promise.resolve({ ok: false, error: {
    code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用，请稍后重试', retryable: true,
  } })
}

function blockedMethods<T extends object>(): T {
  return new Proxy({} as T, { get: () => unavailable })
}

export function configureRepositories(configuration: RepositoryConfiguration): void {
  if (configuration.mode === 'memory') {
    cloudService = null
    repositoryMode = 'memory'
    useMemoryM1AppRepository()
    return
  }
  if (configuration.mode === 'blocked') {
    cloudService = blockedMethods<CloudAppService>()
    repositoryMode = 'blocked'
    configureM1AppRepository(blockedMethods<M1AppRepository>())
    return
  }
  const context: CloudClientContextProvider = () => {
    const configured = configuration.context()
    const selectedChildId = configured.activeChildId ?? getCurrentChildId()
    return { ...configured, ...(selectedChildId ? { activeChildId: selectedChildId } : {}) }
  }
  cloudService = createCloudAppService(
    createCloudRepositoryClient(configuration.invoker, context,
      () => { if (context().sessionId !== null) clearSession() }),
    configuration.authentication,
    context,
  )
  configureM1AppRepository(createCloudBaseM1AppRepository({
    invoker: {
      invoke: (functionName, request) => configuration.invoker.call(functionName, request, {
        businessSessionToken: context().sessionId,
      }),
    },
  }))
  repositoryMode = 'cloudbase'
}

export function getCloudAppService(): CloudAppService | null {
  return cloudService
}

export function getRepositoryMode(): RepositoryMode {
  return repositoryMode
}
