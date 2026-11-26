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
/** One original attempt plus two replays for replay-safe requests. */
export const BACKEND_MAX_ATTEMPTS = 3

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
 * The sign-in endpoint has its own contract: 401 means "wrong phone/password",
 * not "your saved session expired". Mapping it to UNAUTHENTICATED made a bad
 * credential clear the local session and hid server outages behind a password
 * hint. Keep the original sign-in wording for function-wide reuse.
 */
export type LoginFailureCode =
  | 'INVALID_USERNAME_OR_PASSWORD'
  | 'SERVICE_UNAVAILABLE'
  | 'NETWORK_ERROR'
export function loginFailureCode(statusCode: number): LoginFailureCode {
  if (statusCode === 401) return 'INVALID_USERNAME_OR_PASSWORD'
  if (statusCode === 408 || statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
    return 'SERVICE_UNAVAILABLE'
  }
  return 'NETWORK_ERROR'
}

/**
 * Read-only query endpoints are safe to replay. Command endpoints carry writes
 * (submissions, saves, role changes) and must never be sent twice from the
 * transport layer, even when the response was lost.
 */
export function isRetryableReadPath(path: string): boolean {
  return /^\/api\/functions\/[a-z][a-z-]*-query$/.test(path)
}

const REPLAYABLE_SESSION_ACTIONS = new Set(['bootstrap', 'getCurrentSession'])

/**
 * Replay is allowed only when a request cannot create a duplicate write:
 * - read-only -query functions;
 * - the sign-in credential exchange (idempotent: it only trades credentials
 *   for a token, it never creates an account or submits work);
 * - the two read-only session lookups used right after sign-in / on resume.
 *
 * Sign-in and session bootstrap are exactly the requests that decide whether
 * the app opens at all, so leaving them out made a single dropped connection
 * (common through a mobile gateway) look like "网络异常" until the user
 * manually refreshed — the original intermittent-login symptom.
 */
export function isReplayableRequest(path: string, body: object): boolean {
  if (isRetryableReadPath(path)) return true
  if (path === '/api/auth/login') return true
  if (path === '/api/functions/auth-session') {
    const action = (body as Readonly<{ action?: unknown }>).action
    return typeof action === 'string' && REPLAYABLE_SESSION_ACTIONS.has(action)
  }
  return false
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
