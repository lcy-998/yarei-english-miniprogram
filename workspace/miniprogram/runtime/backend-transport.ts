/**
 * Transport policy for the self-hosted Aliyun backend.
 *
 * Deliberately free of wx APIs: the timeout, status-code classification and
 * replay policy are pure so they can be verified with unit tests. The request
 * itself lives in app.ts, where wx.request is available.
 */

/** A single stalled attempt must not look like a frozen app. The old value was 240s. */
export const BACKEND_REQUEST_TIMEOUT_MS = 20000
export const BACKEND_RETRY_DELAY_MS = 350
/** One original attempt plus at most one replay for read-only requests. */
export const BACKEND_MAX_ATTEMPTS = 2

export type BackendFailureCode =
  | 'NETWORK_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'UNAUTHENTICATED'
  | 'INTERNAL_ERROR'

/**
 * A non-2xx response is an answer from the server, not a broken connection.
 * Previously every 5xx/403 was reported as "网络连接失败", which hid the real
 * cause and sent users to check their Wi-Fi instead of retrying or signing in.
 */
export function backendFailureCode(statusCode: number): BackendFailureCode {
  if (!Number.isFinite(statusCode)) return 'INTERNAL_ERROR'
  if (statusCode === 401 || statusCode === 403) return 'UNAUTHENTICATED'
  if (statusCode === 408 || statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
    return 'SERVICE_UNAVAILABLE'
  }
  return 'INTERNAL_ERROR'
}

/**
 * Only read-only query endpoints are safe to replay. Command endpoints carry
 * writes (submissions, saves, commands) and must never be sent twice from the
 * transport layer, even when the response was lost.
 */
export function isRetryableReadPath(path: string): boolean {
  return /^\/api\/functions\/[a-z][a-z-]*-query$/.test(path)
}

/**
 * wx.request "fail" means no HTTP response arrived (DNS, TLS, socket reset or
 * timeout). Replaying such an attempt is useful; an explicit user abort is not.
 */
export function isRetryableTransportFailure(errMsg: unknown): boolean {
  const text = typeof errMsg === 'string' ? errMsg.toUpperCase() : ''
  if (text.includes('ABORT') || text.includes('CANCEL')) return false
  return true
}
