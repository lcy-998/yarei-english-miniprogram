import { describe, expect, it } from 'vitest'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'

describe('M2 atomic batch comment client', () => {
  it('previews exact submission IDs and publishes once with the returned token', async () => {
    const calls: Array<{ name: string; request: { action: string; payload: object; operationId?: string } }> = []
    const invoker: CloudFunctionInvoker = { async call(name, request) {
      calls.push({ name, request })
      if (request.action === 'previewBatchComment') return { ok: true, data: {
        previewToken: 'batch_token_demo', previewVersion: 3, eligibleCount: 2, excludedCount: 1,
        commentSummary: { length: 4 },
      } }
      if (request.action === 'publishBatchComment') return { ok: true, data: {
        taskId: 'task_demo', reviewedCount: 2, submissionIds: ['submission_1', 'submission_2'],
      } }
      throw new Error(`Unexpected action: ${request.action}`)
    } }
    const session = () => ({ sessionId: 'session_teacher_demo' })
    const service = createCloudAppService(createCloudRepositoryClient(invoker, session),
      { async signIn() {} }, session)
    const preview = await service.previewBatchComment('teacher_demo', 'task_demo',
      ['submission_1', 'submission_2', 'submission_3'], '统一点评')
    expect(preview).toMatchObject({ ok: true, data: { eligibleCount: 2, excludedCount: 1 } })
    const published = await service.publishBatchComment('teacher_demo', 'batch_token_demo', 3,
      '统一点评', 'operation_batch_demo')
    expect(published).toMatchObject({ ok: true, data: { reviewedCount: 2 } })
    expect(calls).toMatchObject([
      { name: 'review-query', request: { action: 'previewBatchComment', payload: {
        taskId: 'task_demo', filter: {}, selection: { mode: 'ids',
          submissionIds: ['submission_1', 'submission_2', 'submission_3'] }, comment: '统一点评',
      } } },
      { name: 'review-command', request: { action: 'publishBatchComment', payload: {
        previewToken: 'batch_token_demo', previewVersion: 3, textComment: '统一点评',
      }, operationId: 'operation_batch_demo' } },
    ])
  })
})
