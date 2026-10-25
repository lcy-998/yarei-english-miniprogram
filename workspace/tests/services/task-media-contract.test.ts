import { describe, expect, it } from 'vitest'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'

describe('M3 classroom media client contract', () => {
  it('sends three actions through the trusted session with top-level operation IDs', async () => {
    const calls: unknown[] = []
    const invoker: CloudFunctionInvoker = { async call(functionName, request, context) {
      calls.push({ functionName, action: request.action, payload: request.payload,
        operationId: request.operationId, token: context.businessSessionToken })
      if (request.action === 'reportTaskMediaHeartbeat') return { ok: true,
        data: { sessionId: 'media_session_demo', confirmedThroughMs: 1500, completed: false } }
      return { ok: true, data: { status: 'ready', mediaId: 'media_demo', mediaVersion: 2,
        sessionId: 'media_session_demo', temporaryUrl: 'https://example.invalid/audio',
        expiresAt: '2026-10-03T12:01:00+08:00', confirmedThroughMs: 0, seekForwardAllowed: false } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker,
      () => ({ sessionId: 'session_student_demo' })), { async signIn() {} },
    () => ({ sessionId: 'session_student_demo' }))
    await service.beginTaskMediaSession('forged_student', 'task_demo', 'item_demo', 'op_begin')
    await service.reportTaskMediaHeartbeat('forged_student', 'media_session_demo', 0, 1500, 1500, 'op_beat')
    await service.getTaskMediaPlayback('forged_student', 'task_demo', 'item_demo')
    await service.getSubmittedTaskMediaPlayback('forged_student', 'task_demo', 'item_demo', 2)
    await service.beginTaskDubbingWork('forged_student', 'task_demo', 'item_demo', 'op_dubbing_begin')
    await service.sealTaskDubbingWork('forged_student', 'task_work_demo',
      'cloud://staging/audio.mp3', 1, 'op_dubbing_seal')
    await service.listMyTaskDubbingWorks('forged_student', 0, 20)
    await service.getTaskDubbingPlayback('forged_student', 'task_work_demo')
    expect(calls).toEqual([
      { functionName: 'learning-progress-command', action: 'beginTaskMediaSession',
        payload: { taskId: 'task_demo', itemId: 'item_demo' }, operationId: 'op_begin', token: 'session_student_demo' },
      { functionName: 'learning-progress-command', action: 'reportTaskMediaHeartbeat',
        payload: { sessionId: 'media_session_demo', playedFromMs: 0, playedToMs: 1500, positionMs: 1500 },
        operationId: 'op_beat', token: 'session_student_demo' },
      { functionName: 'student-task-query', action: 'getTaskMediaPlayback',
        payload: { taskId: 'task_demo', itemId: 'item_demo' }, operationId: undefined, token: 'session_student_demo' },
      { functionName: 'student-task-query', action: 'getSubmittedTaskMediaPlayback',
        payload: { taskId: 'task_demo', itemId: 'item_demo', submissionVersion: 2 },
        operationId: undefined, token: 'session_student_demo' },
      { functionName: 'student-work-command', action: 'beginTaskDubbingWork',
        payload: { taskId: 'task_demo', itemId: 'item_demo' }, operationId: 'op_dubbing_begin',
        token: 'session_student_demo' },
      { functionName: 'student-work-command', action: 'sealTaskDubbingWork',
        payload: { workId: 'task_work_demo', stagingFileId: 'cloud://staging/audio.mp3' },
        operationId: 'op_dubbing_seal', token: 'session_student_demo' },
      { functionName: 'student-work-query', action: 'listMyTaskDubbingWorks',
        payload: { offset: 0, limit: 20 }, operationId: undefined, token: 'session_student_demo' },
      { functionName: 'student-work-query', action: 'getTaskDubbingPlayback',
        payload: { workId: 'task_work_demo' }, operationId: undefined, token: 'session_student_demo' },
    ])
  })
})
