import { describe, expect, it } from 'vitest'
import { createCloudAppService } from '../../miniprogram/services/cloudbase-app-service'
import { createCloudRepositoryClient, type CloudFunctionInvoker } from '../../miniprogram/repositories/cloudbase/protocol'

function serviceFor(response: object) {
  const invoker: CloudFunctionInvoker = {
    async call(_functionName, request) {
      if (request.action !== 'getMyTask') throw new Error(`Unexpected ${request.action}`)
      return { ok: true, data: response }
    },
  }
  return createCloudAppService(createCloudRepositoryClient(invoker, () => ({ sessionId: 'session_student_demo' })),
    { async signIn() {} }, () => ({ sessionId: 'session_student_demo' }))
}

describe('M2 student exercise task mapping', () => {
  it('keeps student-visible question text and draft response without an answer key', async () => {
    const response = {
      taskId: 'task_demo', title: '动物主题习题', description: '完成本题', status: 'expired',
      automaticScore: 100,
      startsAt: '2026-09-26T08:00:00+08:00', dueAt: '2026-09-27T08:00:00+08:00',
      latePolicy: { allowLate: false, lateDays: 7 },
      items: [{ id: 'item_quiz', resourceId: 'res_exercise_bird_demo', title: '动物选择题', type: 'exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        exerciseQuestion: { questionId: 'res_exercise_bird_demo', questionType: 'single_choice',
          stem: 'Which animal can fly?', options: ['A. bird', 'B. lion'] } }],
      assignment: { classId: 'cls_grade3_2', status: 'in_progress', submittedAt: null,
        redoCount: 0, redoDueAt: null, version: 1 },
      submission: { id: 'draft_1', version: 1, status: 'draft', answers: [{ itemId: 'item_quiz', value: {
        kind: 'exercise', answeredQuestionCount: 1,
        questionResponses: [{ questionId: 'res_exercise_bird_demo', response: 'B. lion' }],
      } }], submittedAt: null, recordVersion: 1, assignmentVersion: 1 },
      feedback: null,
    }
    const result = await serviceFor(response).getTaskDetail('forged_student', 'task_demo')
    expect(result).toMatchObject({ ok: true, data: { automaticScore: 100,
      assignment: { classId: 'cls_grade3_2' }, task: { status: 'expired', latePolicy: { allowLate: false, lateDays: 7 }, items: [{ exerciseQuestion: {
      stem: 'Which animal can fly?', options: ['A. bird', 'B. lion'],
    } }] }, submission: { answers: [{ structuredValue: { questionResponses: [{ response: 'B. lion' }] } }] } } })
    expect(JSON.stringify(result)).not.toContain('correctAnswer')
    expect(JSON.stringify(result)).not.toContain('Birds can fly.')
  })

  it('passes a teacher override reason to the review command with the trusted session', async () => {
    const calls: Array<{ action: string; payload: object; token: string | null }> = []
    let published = false
    const invoker: CloudFunctionInvoker = {
      async call(_functionName, request, context) {
        calls.push({ action: request.action, payload: request.payload, token: context.businessSessionToken })
        if (request.action === 'getCompletion') return { ok: true, data: { assignments: { items: [{
          assignmentId: 'asn_1', classId: 'cls_grade3_2', studentId: 'usr_student_xiaoyu', status: 'awaiting_review',
          submittedAt: '2026-09-26T08:00:00+08:00', score: 100, latestSubmissionId: 'sub_1', latestSubmissionVersion: 1,
        }], nextCursor: null } } }
        if (request.action === 'listStudents') return { ok: false, error: { code: 'FORBIDDEN', message: '无权查询学员', retryable: false } }
        if (request.action === 'getSubmissionForReview') return { ok: true, data: {
          assignmentVersion: 2,
          feedback: published ? { id: 'feedback_1', decision: 'approved', score: 75, textComment: '已复核', returnReason: null,
            publishedAt: '2026-09-26T09:00:00+08:00' } : null,
        } }
        if (request.action === 'publishReview') { published = true; return { ok: true, data: {
          feedbackId: 'feedback_1', submissionId: 'sub_1', submissionVersion: 1, decision: 'approved', assignmentVersion: 3,
        } } }
        throw new Error(`Unexpected ${request.action}`)
      },
    }
    const service = createCloudAppService(createCloudRepositoryClient(invoker, () => ({ sessionId: 'session_teacher_demo' })),
      { async signIn() {} }, () => ({ sessionId: 'session_teacher_demo' }))
    expect(await service.reviewSubmission('usr_teacher_lin', { operationId: 'operation_override', expectedVersion: 1,
      taskId: 'task_demo', assignmentId: 'asn_1', decision: 'approved', score: 75, comment: '已复核',
      overrideReason: '补充作答已核实' })).toMatchObject({ ok: true, data: { score: 75 } })
    expect(calls.find(call => call.action === 'publishReview')).toMatchObject({
      payload: { submissionId: 'sub_1', score: 75, overrideReason: '补充作答已核实' }, token: 'session_teacher_demo',
    })
  })

  it('maps a zero automatic score for the bound child without offering submission controls', async () => {
    const invoker: CloudFunctionInvoker = { async call(_functionName, request) {
      if (request.action !== 'getChildTask') throw new Error(`Unexpected ${request.action}`)
      return { ok: true, data: {
        taskId: 'task_demo', title: '动物选择题', studentId: 'usr_student_xiaoyu', assignmentStatus: 'awaiting_review',
        automaticScore: 0, submission: { id: 'sub_1', version: 1, submittedAt: '2026-09-26T08:00:00+08:00',
          answers: [{ itemId: 'item_quiz', value: { kind: 'exercise', answeredQuestionCount: 1 } }] }, feedback: null,
      } }
    } }
    const context = () => ({ sessionId: 'session_parent_demo', activeChildId: 'usr_student_xiaoyu' })
    const service = createCloudAppService(createCloudRepositoryClient(invoker, context), { async signIn() {} }, context)
    expect(await service.getParentTask('usr_parent_xiaoyu', 'task_demo')).toMatchObject({
      ok: true, data: { automaticScore: 0, assignment: { status: 'awaiting_review' } },
    })
  })
})
