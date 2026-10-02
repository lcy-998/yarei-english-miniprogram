import { describe, expect, it } from 'vitest'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'

describe('M2 weighted manual review client', () => {
  it('sends only manual item scores and displays the server-computed final total', async () => {
    const calls: Array<{ action: string; payload: object }> = []
    let reviewed = false
    const invoker: CloudFunctionInvoker = { async call(_name, request) {
      calls.push({ action: request.action, payload: request.payload })
      if (request.action === 'getCompletion') return { ok: true, data: { assignments: { items: [{
        assignmentId: 'assignment_demo', classId: 'class_demo', studentId: 'student_demo',
        status: 'awaiting_review', submittedAt: '2026-09-27T09:00:00+08:00', score: null,
        latestSubmissionId: 'submission_demo', latestSubmissionVersion: 1,
      }], nextCursor: null } } }
      if (request.action === 'listStudents') return { ok: false, error: {
        code: 'FORBIDDEN', message: '无权查询学员', retryable: false } }
      if (request.action === 'getSubmissionForReview') return { ok: true, data: {
        assignmentVersion: 2, feedback: reviewed ? { id: 'feedback_demo', decision: 'approved',
          score: 70, itemScores: [{ itemId: 'item_record', score: 60 }], textComment: '已核对',
          returnReason: null, publishedAt: '2026-09-27T10:00:00+08:00' } : null,
      } }
      if (request.action === 'publishReview') { reviewed = true; return { ok: true, data: {
        feedbackId: 'feedback_demo', submissionId: 'submission_demo', submissionVersion: 1,
        decision: 'approved', assignmentVersion: 3,
      } } }
      throw new Error(`Unexpected ${request.action}`)
    } }
    const session = () => ({ sessionId: 'session_teacher_demo' })
    const service = createCloudAppService(createCloudRepositoryClient(invoker, session),
      { async signIn() {} }, session)
    expect(await service.reviewSubmission('teacher_demo', { operationId: 'operation_item_review',
      expectedVersion: 1, taskId: 'task_demo', assignmentId: 'assignment_demo', decision: 'approved',
      itemScores: [{ itemId: 'item_record', score: 60 }], comment: '已核对' }))
      .toMatchObject({ ok: true, data: { score: 70,
        itemScores: [{ itemId: 'item_record', score: 60 }] } })
    expect(calls.find(call => call.action === 'publishReview')).toMatchObject({ payload: {
      itemScores: [{ itemId: 'item_record', score: 60 }],
    } })
    expect(Object.hasOwn(calls.find(call => call.action === 'publishReview')?.payload ?? {}, 'score')).toBe(false)
  })
})
