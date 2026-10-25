import { describe, expect, it } from 'vitest'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'

describe('authorized reading audio client query', () => {
  it('requests one chapter through the business session without raw cloud file IDs', async () => {
    const calls: unknown[] = []
    const invoker: CloudFunctionInvoker = { async call(functionName, request, context) {
      calls.push({ functionName, action: request.action, payload: request.payload,
        token: context.businessSessionToken })
      return { ok: true, data: { resourceId: 'read_demo', sourceVersion: 'v1',
        chapterId: 'chapter_demo', durationMs: null, playback: null, segments: [] } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker,
      () => ({ sessionId: 'session_student_demo' })), { async signIn() {} },
    () => ({ sessionId: 'session_student_demo' }))
    expect(await service.getReadingAudioMap('forged_student', 'read_demo', 'chapter_demo'))
      .toMatchObject({ ok: true, data: { playback: null, segments: [] } })
    expect(calls).toEqual([{ functionName: 'content-query', action: 'getReadingAudioMap',
      payload: { resourceId: 'read_demo', chapterId: 'chapter_demo' },
      token: 'session_student_demo' }])
  })
})
