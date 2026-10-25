import { describe, expect, it } from 'vitest'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'

describe('T-08 private voice comment client contract', () => {
  it('uses top-level operation IDs and transports only a sealed recording ID at publication', async () => {
    const calls: unknown[] = []
    const invoker: CloudFunctionInvoker = { async call(functionName, request, context) {
      calls.push({ functionName, action: request.action, payload: request.payload,
        operationId: request.operationId, expectedVersion: request.expectedVersion,
        token: context.businessSessionToken })
      if (request.action === 'getCompletion') return { ok: true, data: { task: {}, counts: {},
        assignments: { items: [{ assignmentId: 'assignment_demo', studentId: 'student_demo',
          classId: 'class_demo', latestSubmissionId: 'submission_demo', latestSubmissionVersion: 1,
          submittedAt: '2026-10-03T08:00:00+08:00', score: null,
          status: 'awaiting_review' }], nextCursor: null } } }
      if (request.action === 'listStudents') return { ok: true, data: { items: [], nextCursor: null } }
      if (request.action === 'getSubmissionForReview') return { ok: true,
        data: { assignmentVersion: 2, feedback: null } }
      if (request.action === 'publishReview') return { ok: true,
        data: { feedbackId: 'feedback_demo', submissionId: 'submission_demo',
          submissionVersion: 1, decision: 'approved', assignmentVersion: 3 } }
      return { ok: true, data: { recordingId: 'review_voice_demo', submissionId: 'submission_demo',
        submissionVersion: 1, stagingPath: 'review-voice/staging/demo', status: 'draft',
        durationMs: null, version: 1, expiresAt: '2026-10-04T08:00:00+08:00' } }
    } }
    const service = createCloudAppService(createCloudRepositoryClient(invoker,
      () => ({ sessionId: 'session_teacher_demo' })), { async signIn() {} },
    () => ({ sessionId: 'session_teacher_demo' }))
    await service.beginReviewVoiceRecording('forged_teacher', 'submission_demo', 'op_voice_begin')
    await service.sealReviewVoiceRecording('forged_teacher', 'review_voice_demo',
      'cloud://private/staging.mp3', 1, 'op_voice_seal')
    await service.reviewSubmission('forged_teacher', { operationId: 'op_review', expectedVersion: 1,
      taskId: 'task_demo', assignmentId: 'assignment_demo', decision: 'approved', score: 80,
      comment: '加油', voiceRecordingId: 'review_voice_demo' })
    expect(calls).toContainEqual({ functionName: 'review-command', action: 'beginReviewVoiceRecording',
      payload: { submissionId: 'submission_demo' }, operationId: 'op_voice_begin',
      expectedVersion: undefined, token: 'session_teacher_demo' })
    expect(calls).toContainEqual({ functionName: 'review-command', action: 'sealReviewVoiceRecording',
      payload: { recordingId: 'review_voice_demo', stagingFileId: 'cloud://private/staging.mp3' },
      operationId: 'op_voice_seal', expectedVersion: 1, token: 'session_teacher_demo' })
    const publish = calls.find(item => typeof item === 'object' && item !== null
      && 'action' in item && item.action === 'publishReview') as { payload: Record<string, unknown> }
    expect(publish.payload.voiceRecordingId).toBe('review_voice_demo')
    expect(JSON.stringify(publish.payload)).not.toContain('cloud://')
  })
})
