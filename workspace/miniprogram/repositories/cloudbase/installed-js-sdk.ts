import type { CloudBaseJsSdkPort } from './js-sdk-adapter'

declare const require: (moduleName: string) => unknown

/**
 * Loads the pinned CloudBase JS SDK only when an explicitly configured cloud
 * build activates it. The committed application startup remains memory-only.
 */
export function loadInstalledCloudBaseJsSdk(
  load?: () => unknown,
): CloudBaseJsSdkPort {
  const candidate = load === undefined ? loadModularCloudBaseSdk() : load()
  if (typeof candidate !== 'object' && typeof candidate !== 'function') {
    throw new Error('CLOUDBASE_CLIENT_SDK_UNAVAILABLE')
  }
  if (candidate === null || !('init' in candidate) || typeof candidate.init !== 'function') {
    throw new Error('CLOUDBASE_CLIENT_SDK_UNAVAILABLE')
  }
  return candidate as unknown as CloudBaseJsSdkPort
}

function loadModularCloudBaseSdk(): unknown {
  try {
    const app = require('@cloudbase/js-sdk/app')
    const auth = require('@cloudbase/js-sdk/auth')
    const functions = require('@cloudbase/js-sdk/functions')
    if (!isRecord(app) || !isRecord(auth) || !isRecord(functions)
      || typeof auth.registerAuth !== 'function'
      || typeof functions.registerFunctions !== 'function') {
      throw new Error('CLOUDBASE_CLIENT_SDK_UNAVAILABLE')
    }
    const core = unwrapModularCloudBaseSdk(app)
    auth.registerAuth(core)
    functions.registerFunctions(core)
    return core
  } catch {
    throw new Error('CLOUDBASE_CLIENT_SDK_UNAVAILABLE')
  }
}

export function unwrapModularCloudBaseSdk(app: Record<string, unknown>): Record<string, unknown> {
  const core = isRecord(app.cloudbase) ? app.cloudbase : app
  if (typeof core.init !== 'function' || typeof core.registerComponent !== 'function') {
    throw new Error('CLOUDBASE_CLIENT_SDK_UNAVAILABLE')
  }
  return core
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
