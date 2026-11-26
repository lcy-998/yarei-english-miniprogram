import { describe, expect, it } from 'vitest'
import {
  BACKEND_MAX_ATTEMPTS, BACKEND_REQUEST_TIMEOUT_MS,
  backendFailureCode, isRetryableReadPath, isRetryableTransportFailure,
} from '../miniprogram/runtime/backend-transport'

describe('self-hosted backend transport policy', () => {
  it('caps a single request so a stalled connection does not freeze the app', () => {
    expect(BACKEND_REQUEST_TIMEOUT_MS).toBeGreaterThan(5000)
    expect(BACKEND_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30000)
    expect(BACKEND_MAX_ATTEMPTS).toBe(2)
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

  it('only replays read-only query endpoints, never commands or auth calls', () => {
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
