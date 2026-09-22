import type { CloudBaseJsSdkPort } from './js-sdk-adapter'

declare const require: (moduleName: string) => unknown

/**
 * Loads the pinned CloudBase JS SDK only when an explicitly configured cloud
 * build activates it. The committed application startup remains memory-only.
 */
export function loadInstalledCloudBaseJsSdk(
  load: () => unknown = () => require('@cloudbase/js-sdk'),
): CloudBaseJsSdkPort {
  const candidate = load()
  if (typeof candidate !== 'object' && typeof candidate !== 'function') {
    throw new Error('CLOUDBASE_CLIENT_SDK_UNAVAILABLE')
  }
  if (candidate === null || !('init' in candidate) || typeof candidate.init !== 'function') {
    throw new Error('CLOUDBASE_CLIENT_SDK_UNAVAILABLE')
  }
  return candidate as unknown as CloudBaseJsSdkPort
}
