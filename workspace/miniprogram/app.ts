import { initializeRepositories } from './repositories/repository-bootstrap'
import { getSession } from './session/session'
import { createSelfhostSdk } from './repositories/selfhost-sdk'
import { backendBaseUrl } from './runtime/backend-config'
import {
  BACKEND_MAX_ATTEMPTS, BACKEND_REQUEST_TIMEOUT_MS, BACKEND_RETRY_DELAY_MS,
  backendFailureCode, isRetryableReadPath, isRetryableTransportFailure,
} from './runtime/backend-transport'

App<IAppOption>({
  globalData: {},
  onLaunch() {
    if (!backendBaseUrl.startsWith('https://')) throw new Error('HTTPS backend address required')
    const requestBackend = (path: string, body: object, token: string | null): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const canRetry = isRetryableReadPath(path)
        let attempt = 0
        const dispatch = (): void => {
          attempt += 1
          wx.request({
            url: backendBaseUrl + path, method: 'POST', data: body,
            timeout: BACKEND_REQUEST_TIMEOUT_MS,
            header: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            success(response) {
              if (response.statusCode >= 200 && response.statusCode < 300) {
                resolve(response.data)
              } else {
                reject({ code: backendFailureCode(response.statusCode), statusCode: response.statusCode })
              }
            },
            fail(error) {
              if (canRetry && attempt < BACKEND_MAX_ATTEMPTS
                && isRetryableTransportFailure(error?.errMsg)) {
                setTimeout(dispatch, BACKEND_RETRY_DELAY_MS)
              } else {
                reject({ code: 'NETWORK_ERROR' })
              }
            },
          })
        }
        dispatch()
      })
    const clientSdk = createSelfhostSdk(requestBackend)
    // Retain the established service contracts; transport and credentials are now hosted on Aliyun.
    const result = initializeRepositories({ mode: 'cloudbase', envId: 'aliyun-selfhost' }, {
      clientSdk,
      context: () => ({ sessionId: getSession()?.sessionId ?? null, localDate: new Date().toISOString().slice(0, 10) }),
    })
    if (!result.ok) throw new Error('Aliyun backend initialization failed')
  },
})
