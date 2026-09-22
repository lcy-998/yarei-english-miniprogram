import { describe, expect, it } from 'vitest'

import { loadInstalledCloudBaseJsSdk } from '../../miniprogram/repositories/cloudbase/installed-js-sdk'

describe('installed CloudBase JS SDK client boundary', () => {
  it('loads the pinned package through the narrow client port without initializing a cloud environment', () => {
    const sdk = loadInstalledCloudBaseJsSdk()
    expect(typeof sdk.init).toBe('function')
  })

  it('fails closed when a configured build cannot load the required SDK capability', () => {
    expect(() => loadInstalledCloudBaseJsSdk(() => ({})))
      .toThrow('CLOUDBASE_CLIENT_SDK_UNAVAILABLE')
  })
})
