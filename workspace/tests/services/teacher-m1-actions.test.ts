import { beforeEach, describe, expect, it } from 'vitest'
import { getCompletion, getDraftOptions, getReviewSubmission, reviewSubmission, saveTeacherTaskDraft } from '../../miniprogram/services/app-service'
import { getState, initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'

const TEACHER_ID = 'usr_teacher_lin'

describe('M1 教师页面写入语义', () => {
  beforeEach(() => replaceState(initialState))

  it('保存任务草稿不创建学生任务，重复意图不重复写入', async () => {
    const options = await getDraftOptions(TEACHER_ID)
    expect(options.ok).toBe(true)
    if (!options.ok) return
    const command = {
      operationId: 'save_teacher_draft_once', expectedVersion: 0, title: '虚构阅读草稿', description: '阅读演示内容',
      structuredDraft: options.data.structuredDraft,
    }
    const before = getState().assignments.length
    const first = await saveTeacherTaskDraft(TEACHER_ID, command)
    const retry = await saveTeacherTaskDraft(TEACHER_ID, command)
    expect(first).toMatchObject({ ok: true, data: { status: 'draft' } })
    expect(retry).toMatchObject({ ok: true, data: { id: first.ok ? first.data.id : '' } })
    expect(getState().assignments).toHaveLength(before)
    if (!first.ok) return
    const updated = await saveTeacherTaskDraft(TEACHER_ID, { ...command, taskId: first.data.id, expectedVersion: first.data.version, operationId: 'save_teacher_draft_update', title: '虚构阅读草稿修改' })
    expect(updated).toMatchObject({ ok: true, data: { id: first.data.id, title: '虚构阅读草稿修改', version: first.data.version + 1 } })
    expect(getState().assignments).toHaveLength(before)
  })

  it('仅发布统一评语时保留未评分状态', async () => {
    const completion = await getCompletion(TEACHER_ID, 'tsk_animals_listening')
    expect(completion.ok).toBe(true)
    if (!completion.ok) return
    const row = completion.data.find(item => item.status === 'awaiting_review' && item.submissionVersion !== undefined)
    expect(row).toBeDefined()
    if (!row) return
    const result = await reviewSubmission(TEACHER_ID, {
      operationId: 'batch_comment_no_score', expectedVersion: row.submissionVersion!, taskId: row.taskId,
      assignmentId: row.assignmentId, decision: 'approved', comment: '完成认真，继续保持。',
    })
    expect(result).toMatchObject({ ok: true, data: { textComment: '完成认真，继续保持。' } })
    if (result.ok) expect(result.data.score).toBeUndefined()
  })

  it('只填写 0 分也可发布并写入当前学生的正式反馈', async () => {
    const completion = await getCompletion(TEACHER_ID, 'tsk_animals_listening')
    if (!completion.ok) throw new Error('completion unavailable')
    const row = completion.data.find(item => item.status === 'awaiting_review' && item.submissionId && item.submissionVersion !== undefined)
    if (!row?.submissionId || row.submissionVersion === undefined) throw new Error('pending submission unavailable')
    const result = await reviewSubmission(TEACHER_ID, {
      operationId: 'score_zero_review', expectedVersion: row.submissionVersion, taskId: row.taskId,
      assignmentId: row.assignmentId, decision: 'approved', score: 0, comment: '',
    })
    expect(result).toMatchObject({ ok: true, data: { score: 0 } })
    const detail = await getReviewSubmission(TEACHER_ID, row.submissionId)
    expect(detail).toMatchObject({ ok: true, data: { feedback: { decision: 'approved', score: 0 } } })
  })

  it('已点评提交仍可授权读取原作答和正式反馈', async () => {
    const completion = await getCompletion(TEACHER_ID, 'tsk_animals_listening')
    if (!completion.ok) throw new Error('completion unavailable')
    const reviewed = completion.data.find(item => item.status === 'completed' && item.submissionId)
    if (!reviewed?.submissionId) throw new Error('reviewed submission unavailable')
    const detail = await getReviewSubmission(TEACHER_ID, reviewed.submissionId)
    expect(detail).toMatchObject({ ok: true, data: { feedback: { decision: 'approved', score: 90 }, answers: [{ itemId: 'tki_reading' }] } })
  })
})
