import { afterEach, describe, expect, it, vi } from 'vitest'

const previewTeacherAssetCall = vi.fn()
vi.mock('../../miniprogram/repositories/repository-factory', () => ({
  getCloudAppService: () => ({ previewTeacherAsset: previewTeacherAssetCall }),
}))

describe('teacher media preview request', () => {
  afterEach(() => { vi.useRealTimers(); vi.resetModules(); previewTeacherAssetCall.mockReset() })

  it('returns a retryable error when the cloud request never settles', async () => {
    vi.useFakeTimers()
    previewTeacherAssetCall.mockReturnValue(new Promise(() => {}))
    const { previewTeacherAsset } = await import('../../miniprogram/services/teacher-media-service')
    const resultPromise = previewTeacherAsset('teacher_demo', 'listening_demo')
    await vi.advanceTimersByTimeAsync(20000)
    const result = await resultPromise
    expect(result).toMatchObject({ ok: false, error: { code: 'NETWORK_ERROR', retryable: true } })
  })
})
