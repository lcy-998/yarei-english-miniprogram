import { CloudAppService, createCloudAppService } from '../services/cloudbase-app-service'
import { getCurrentChildId } from '../session/session'
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
    return
  }
  const context: CloudClientContextProvider = () => {
    const configured = configuration.context()
    const selectedChildId = configured.activeChildId ?? getCurrentChildId()
    return { ...configured, ...(selectedChildId ? { activeChildId: selectedChildId } : {}) }
  }
  cloudService = createCloudAppService(
    createCloudRepositoryClient(configuration.invoker, context),
    configuration.authentication,
    context,
  )
}

export function getCloudAppService(): CloudAppService | null {
  return cloudService
}

export function getRepositoryMode(): RepositoryMode {
  return cloudService === null ? 'memory' : 'cloudbase'
}
