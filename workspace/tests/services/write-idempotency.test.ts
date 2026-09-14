import { beforeEach, describe, expect, it } from 'vitest'
import { publishClassroomTask, reviewSubmission, saveDraft, submitTask } from '../../miniprogram/services/app-service'
import { getState, initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'

const STUDENT_ID = 'usr_student_xiaoyu'
const TEACHER_ID = 'usr_teacher_lin'
const TASK_ID = 'tsk_animals_listening'
const ASSIGNMENT_ID = 'asn_xiaoyu_animals'

describe('M0 idempotent writes and optimistic versions', () => {
  beforeEach(() => replaceState(initialState))

  it('replays one task publish result without duplicating the task or assignments', async () => {
    const command = { operationId: 'op_publish_same', expectedVersion: 0, title: ' 阅读周任务 ', description: ' 完成学习记录 ' }

    const first = await publishClassroomTask(TEACHER_ID, command)
    const second = await publishClassroomTask(TEACHER_ID, { ...command, title: '阅读周任务', description: '完成学习记录' })

    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
    if (!first.ok) return
    const state = getState()
    expect(state.tasks.filter(item => item.id === first.data.id)).toHaveLength(1)
    expect(state.assignments.filter(item => item.taskId === first.data.id)).toHaveLength(36)
    expect(state.operationReceipts.filter(item => item.operationId === command.operationId)).toHaveLength(1)
  })

  it('keeps the stored idempotency result isolated from caller mutations', async () => {
    const command = { operationId: 'op_publish_isolated', expectedVersion: 0, title: '隔离任务', description: '回执深拷贝' }
    const first = await publishClassroomTask(TEACHER_ID, command)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    first.data.title = '调用方改写'
    first.data.items[0]!.title = '调用方改写内容'

    const replay = await publishClassroomTask(TEACHER_ID, command)

    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.data.title).toBe('隔离任务')
    expect(replay.data.items[0]?.title).toBe('阅读练习')
    expect(getState().tasks.find(item => item.id === replay.data.id)?.title).toBe('隔离任务')
  })

  it('rejects the same task operation key with different normalized input and leaves state unchanged', async () => {
    const first = await publishClassroomTask(TEACHER_ID, { operationId: 'op_publish_conflict', expectedVersion: 0, title: '原任务', description: '原描述' })
    expect(first.ok).toBe(true)
    const before = getState()

    const conflict = await publishClassroomTask(TEACHER_ID, { operationId: 'op_publish_conflict', expectedVersion: 0, title: '另一任务', description: '原描述' })

    expect(conflict).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(getState()).toEqual(before)
  })

  it('allows different operation keys to represent distinct publish intentions', async () => {
    const first = await publishClassroomTask(TEACHER_ID, { operationId: 'op_publish_a', expectedVersion: 0, title: '相同任务', description: '相同描述' })
    const second = await publishClassroomTask(TEACHER_ID, { operationId: 'op_publish_b', expectedVersion: 0, title: '相同任务', description: '相同描述' })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.data.id).not.toBe(first.data.id)
    expect(getState().tasks.filter(item => item.title === '相同任务')).toHaveLength(2)
  })

  it('rejects an obsolete task create version without changing state', async () => {
    const before = getState()
    const result = await publishClassroomTask(TEACHER_ID, { operationId: 'op_publish_stale', expectedVersion: 1, title: '旧页面任务', description: '' })

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(getState()).toEqual(before)
  })

  it('requires caller-provided operation metadata on command-object writes', async () => {
    const before = getState()
    const result = await publishClassroomTask(TEACHER_ID, { operationId: '   ', expectedVersion: 0, title: '无操作标识', description: '' })

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(getState()).toEqual(before)
  })

  it('replays a draft save and rejects stale or changed commands without modifying the draft', async () => {
    const command = { operationId: 'op_draft_same', expectedVersion: 0, taskId: TASK_ID, answer: ' 第一版草稿 ' }
    const first = await saveDraft(STUDENT_ID, command)
    const replay = await saveDraft(STUDENT_ID, { ...command, answer: '第一版草稿' })

    expect(first.ok).toBe(true)
    expect(replay).toEqual(first)
    if (!first.ok) return
    expect(getState().submissions.filter(item => item.assignmentId === ASSIGNMENT_ID)).toHaveLength(1)

    const beforeChangedKey = getState()
    const changedKey = await saveDraft(STUDENT_ID, { ...command, answer: '不同草稿' })
    expect(changedKey).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(getState()).toEqual(beforeChangedKey)

    const stale = await saveDraft(STUDENT_ID, { operationId: 'op_draft_stale', expectedVersion: 0, taskId: TASK_ID, answer: '旧页面覆盖' })
    expect(stale).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(getState()).toEqual(beforeChangedKey)
  })

  it('replays one submission receipt and protects the current submission version', async () => {
    const draft = await saveDraft(STUDENT_ID, { operationId: 'op_before_submit', expectedVersion: 0, taskId: TASK_ID, answer: '草稿' })
    expect(draft.ok).toBe(true)
    if (!draft.ok) return
    const beforeStale = getState()

    const stale = await submitTask(STUDENT_ID, { operationId: 'op_submit_stale', expectedVersion: 0, taskId: TASK_ID, answer: '正式作答' })
    expect(stale).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(getState()).toEqual(beforeStale)

    const command = { operationId: 'op_submit_same', expectedVersion: draft.data.version, taskId: TASK_ID, answer: ' 正式作答 ' }
    const first = await submitTask(STUDENT_ID, command)
    const replay = await submitTask(STUDENT_ID, { ...command, answer: '正式作答' })
    expect(first.ok).toBe(true)
    expect(replay).toEqual(first)
    expect(getState().submissions.filter(item => item.assignmentId === ASSIGNMENT_ID)).toHaveLength(2)
  })

  it('replays the same review and rejects changed or stale review targets without mutation', async () => {
    const pendingSubmission = getState().submissions.find(item => item.id === 'sub_demo_02')!
    const beforeStale = getState()
    const stale = await reviewSubmission(TEACHER_ID, {
      operationId: 'op_review_stale', expectedVersion: 0, taskId: TASK_ID, assignmentId: 'asn_demo_02', decision: 'approved', score: 91, comment: '很好',
    })
    expect(stale).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(getState()).toEqual(beforeStale)

    const command = {
      operationId: 'op_review_same', expectedVersion: pendingSubmission.version, taskId: TASK_ID, assignmentId: 'asn_demo_02', decision: 'approved' as const, score: 91, comment: ' 很好 ',
    }
    const first = await reviewSubmission(TEACHER_ID, command)
    const replay = await reviewSubmission(TEACHER_ID, { ...command, comment: '很好' })
    expect(first.ok).toBe(true)
    expect(replay).toEqual(first)
    expect(getState().feedback.filter(item => item.assignmentId === 'asn_demo_02')).toHaveLength(1)

    const beforeChangedKey = getState()
    const changedKey = await reviewSubmission(TEACHER_ID, { ...command, score: 70 })
    expect(changedKey).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(getState()).toEqual(beforeChangedKey)
  })
})
