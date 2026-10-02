import { CloudAppService, createCloudAppService } from '../services/cloudbase-app-service'
import { configureM1AppRepository, useMemoryM1AppRepository } from '../services/m1-app-service'
import { createCloudBaseM1AppRepository } from './cloudbase/cloudbase-m1-app-repository'
import { clearSession, getCurrentChildId } from '../session/session'
import {
  CloudAuthenticationPort,
  CloudClientContextProvider,
  CloudFunctionInvoker,
  createCloudRepositoryClient,
} from './cloudbase/protocol'

export type RepositoryMode = 'memory' | 'cloudbase'

export interface CloudBaseRepositoryConfiguration {
  mode: 'cloudbase'
  invoker: CloudFunctionInvoker
  authentication: CloudAuthenticationPort
  context: CloudClientContextProvider
}

export interface MemoryRepositoryConfiguration { mode: 'memory' }

export type RepositoryConfiguration = MemoryRepositoryConfiguration | CloudBaseRepositoryConfiguration

let cloudService: CloudAppService | null = null

export function configureRepositories(configuration: RepositoryConfiguration): void {
  if (configuration.mode === 'memory') {
    cloudService = null
    useMemoryM1AppRepository()
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
}

export function getCloudAppService(): CloudAppService | null {
  return cloudService
}

export function getRepositoryMode(): RepositoryMode {
  return cloudService === null ? 'memory' : 'cloudbase'
}
