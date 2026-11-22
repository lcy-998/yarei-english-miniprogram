import { initializeRepositories } from './repositories/repository-bootstrap'
import { getSession } from './session/session'
import { createSelfhostSdk } from './repositories/selfhost-sdk'
import { backendBaseUrl } from './runtime/backend-config'

App<IAppOption>({
  globalData: {},
  onLaunch() {
    if (!backendBaseUrl.startsWith('https://')) throw new Error('HTTPS backend address required')
    const clientSdk = createSelfhostSdk((path, body, token) => new Promise((resolve, reject) => {
      wx.request({
        url: backendBaseUrl + path, method: 'POST', data: body, timeout: 240000,
        header: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        success(response) {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data)
          else reject({ code: response.statusCode === 401 ? 'INVALID_USERNAME_OR_PASSWORD' : 'NETWORK_ERROR' })
        },
        fail: () => reject({ code: 'NETWORK_ERROR' }),
      })
    }))
    // Retain the established service contracts; transport and credentials are now hosted on Aliyun.
    const result = initializeRepositories({ mode: 'cloudbase', envId: 'aliyun-selfhost' }, {
      clientSdk,
      context: () => ({ sessionId: getSession()?.sessionId ?? null, localDate: new Date().toISOString().slice(0, 10) }),
    })
    if (!result.ok) throw new Error('Aliyun backend initialization failed')
  },
})
