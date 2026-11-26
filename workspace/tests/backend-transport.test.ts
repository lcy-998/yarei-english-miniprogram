import { describe, expect, it } from 'vitest'
import {
  BACKEND_MAX_ATTEMPTS, BACKEND_REQUEST_TIMEOUT_MS, BACKEND_RETRY_DELAY_MS,
  backendFailureCode, isReplayableRequest, isRetryableReadPath, isRetryableTransportFailure,
  loginFailureCode,
} from '../miniprogram/runtime/backend-transport'

describe('self-hosted backend transport policy', () => {
  it('caps a single request so a stalled connection does not freeze the app', () => {
    expect(BACKEND_REQUEST_TIMEOUT_MS).toBeGreaterThan(5000)
    expect(BACKEND_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30000)
    expect(BACKEND_MAX_ATTEMPTS).toBe(3)
    expect(BACKEND_RETRY_DELAY_MS).toBeGreaterThan(0)
  })

  it('separates authentication, server and transport failures', () => {
    expect(backendFailureCode(401)).toBe('UNAUTHENTICATED')
    expect(backendFailureCode(403)).toBe('UNAUTHENTICATED')
    expect(backendFailureCode(408)).toBe('SERVICE_UNAVAILABLE')
    expect(backendFailureCode(429)).toBe('SERVICE_UNAVAILABLE')
    expect(backendFailureCode(500)).toBe('SERVICE_UNAVAILABLE')
    expect(backendFailureCode(502)).toBe('SERVICE_UNAVAILABLE')
    expect(backendFailureCode(503)).toBe('SERVICE_UNAVAILABLE')
    expect(backendFailureCode(400)).toBe('INTERNAL_ERROR')
    expect(backendFailureCode(404)).toBe('INTERNAL_ERROR')
    expect(backendFailureCode(Number.NaN)).toBe('INTERNAL_ERROR')
  })

  it('keeps the sign-in contract: 401 is a bad credential, 5xx is an outage', () => {
    expect(loginFailureCode(401)).toBe('INVALID_USERNAME_OR_PASSWORD')
    expect(loginFailureCode(400)).toBe('NETWORK_ERROR')
    expect(loginFailureCode(404)).toBe('NETWORK_ERROR')
    expect(loginFailureCode(408)).toBe('SERVICE_UNAVAILABLE')
    expect(loginFailureCode(429)).toBe('SERVICE_UNAVAILABLE')
    expect(loginFailureCode(500)).toBe('SERVICE_UNAVAILABLE')
    expect(loginFailureCode(502)).toBe('SERVICE_UNAVAILABLE')
    expect(loginFailureCode(503)).toBe('SERVICE_UNAVAILABLE')
  })

  it('replays the sign-in and session bootstrap that decide whether the app opens', () => {
    expect(isReplayableRequest('/api/auth/login', { phone: '13800000000', password: 'x' })).toBe(true)
    expect(isReplayableRequest('/api/functions/auth-session', { action: 'bootstrap' })).toBe(true)
    expect(isReplayableRequest('/api/functions/auth-session', { action: 'getCurrentSession' })).toBe(true)
    expect(isReplayableRequest('/api/functions/task-query', { action: 'list' })).toBe(true)
    // A replay must never duplicate a write or an authenticated mutation.
    expect(isReplayableRequest('/api/functions/auth-session', { action: 'selectRole' })).toBe(false)
    expect(isReplayableRequest('/api/functions/auth-session', { action: 'updateProfile' })).toBe(false)
    expect(isReplayableRequest('/api/functions/auth-session', { action: 'logout' })).toBe(false)
    expect(isReplayableRequest('/api/functions/auth-session', {})).toBe(false)
    expect(isReplayableRequest('/api/functions/task-command', { action: 'submit' })).toBe(false)
    expect(isReplayableRequest('/api/auth/logout', {})).toBe(false)
  })

  it('only replays read-only query endpoints by path, never commands or unknown shapes', () => {
    expect(isRetryableReadPath('/api/functions/task-query')).toBe(true)
    expect(isRetryableReadPath('/api/functions/learning-progress-query')).toBe(true)
    expect(isRetryableReadPath('/api/functions/content-query')).toBe(true)
    expect(isRetryableReadPath('/api/functions/task-command')).toBe(false)
    expect(isRetryableReadPath('/api/functions/learning-progress-command')).toBe(false)
    expect(isRetryableReadPath('/api/auth/login')).toBe(false)
    expect(isRetryableReadPath('/api/functions/task-query?x=1')).toBe(false)
    expect(isRetryableReadPath('/api/functions/task-query/extra')).toBe(false)
    expect(isRetryableReadPath('/api/functions/Task-Query')).toBe(false)
  })

  it('replays connection-level failures but not an explicit abort', () => {
    expect(isRetryableTransportFailure('request:fail')).toBe(true)
    expect(isRetryableTransportFailure('request:fail timeout')).toBe(true)
    expect(isRetryableTransportFailure('request:fail ssl hand shake error')).toBe(true)
    expect(isRetryableTransportFailure(undefined)).toBe(true)
    expect(isRetryableTransportFailure('request:fail abort')).toBe(false)
    expect(isRetryableTransportFailure('request:fail cancelled')).toBe(false)
  })
})
