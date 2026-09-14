import { beforeEach, describe, expect, it } from 'vitest'
import { Clock } from '../../miniprogram/services/clock'
import { getTaskDetail, reviewSubmission, submitTask } from '../../miniprogram/services/app-service'
import { getState, initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'

const STUDENT_ID = 'usr_student_xiaoyu'
const TEACHER_ID = 'usr_teacher_lin'
const TASK_ID = 'tsk_animals_listening'
const ASSIGNMENT_ID = 'asn_xiaoyu_animals'

function clockAt(iso: string): Clock {
  return { now: () => new Date(iso) }
}

async function submitAt(iso: string, answer: string) {
  return submitTask(STUDENT_ID, TASK_ID, answer, clockAt(iso))
}

async function returnAt(iso: string, reason: string) {
  return reviewSubmission(TEACHER_ID, TASK_ID, 'returned', 0, reason, ASSIGNMENT_ID, clockAt(iso))
}

describe('M0 returned-work rules', () => {
  beforeEach(() => replaceState(initialState))

  it('allows the first and second returns, sets a fresh three-day deadline, and preserves version history', async () => {
    const firstSubmission = await submitAt('2026-09-14T01:00:00.000Z', '第一次作答')
    expect(firstSubmission.ok).toBe(true)

    const firstReturn = await returnAt('2026-09-14T02:00:00.000Z', '请补充阅读记录')
    expect(firstReturn.ok).toBe(true)
    let state = getState()
    expect(state.assignments.find(item => item.id === ASSIGNMENT_ID)).toMatchObject({
      status: 'redo_required',
      redoCount: 1,
      redoDueAt: '2026-09-17T02:00:00.000Z',
    })
    if (!firstSubmission.ok) return
    expect(state.submissions.find(item => item.id === firstSubmission.data.id)?.status).toBe('returned')

    const secondSubmission = await submitAt('2026-09-17T01:59:59.000Z', '第二次作答')
    expect(secondSubmission.ok).toBe(true)
    if (!secondSubmission.ok) return
    expect(secondSubmission.data.version).toBe(firstSubmission.data.version + 1)

    const secondReturn = await returnAt('2026-09-17T03:00:00.000Z', '请订正最后一道题')
    expect(secondReturn.ok).toBe(true)
    state = getState()
    expect(state.assignments.find(item => item.id === ASSIGNMENT_ID)).toMatchObject({
      status: 'redo_required',
      redoCount: 2,
      redoDueAt: '2026-09-20T03:00:00.000Z',
    })
    expect(state.submissions.filter(item => item.assignmentId === ASSIGNMENT_ID)).toEqual([
      expect.objectContaining({ id: firstSubmission.data.id, version: 1, status: 'returned', answers: [{ taskItemId: 'tki_reading', value: '第一次作答' }] }),
      expect.objectContaining({ id: secondSubmission.data.id, version: 2, status: 'returned', answers: [{ taskItemId: 'tki_reading', value: '第二次作答' }] }),
    ])
  })

  it('rejects a third return without changing the current submission or assignment', async () => {
    await submitAt('2026-09-14T01:00:00.000Z', '版本一')
    await returnAt('2026-09-14T02:00:00.000Z', '第一次退回')
    await submitAt('2026-09-15T01:00:00.000Z', '版本二')
    await returnAt('2026-09-15T02:00:00.000Z', '第二次退回')
    await submitAt('2026-09-16T01:00:00.000Z', '版本三')
    const before = getState()

    const result = await returnAt('2026-09-16T02:00:00.000Z', '第三次退回')

    expect(result).toMatchObject({ ok: false, error: { code: 'REDO_LIMIT_REACHED' } })
    expect(getState()).toEqual(before)
  })

  it('rejects a blank return reason without changing state', async () => {
    await submitAt('2026-09-14T01:00:00.000Z', '待检查作答')
    const before = getState()

    const result = await returnAt('2026-09-14T02:00:00.000Z', '   ')

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(getState()).toEqual(before)
  })

  it('allows resubmission within the redo period and creates an incremented version', async () => {
    const first = await submitAt('2026-09-14T01:00:00.000Z', '旧版本')
    await returnAt('2026-09-14T02:00:00.000Z', '请重做')

    const result = await submitAt('2026-09-17T02:00:00.000Z', '新版本')

    expect(result.ok).toBe(true)
    if (!first.ok || !result.ok) return
    expect(result.data.version).toBe(first.data.version + 1)
    const detail = await getTaskDetail(STUDENT_ID, TASK_ID)
    expect(detail.ok).toBe(true)
    if (detail.ok) {
      expect(detail.data.assignment.status).toBe('awaiting_review')
      expect(detail.data.assignment.redoDueAt).toBeUndefined()
    }
    const submissions = getState().submissions.filter(item => item.assignmentId === ASSIGNMENT_ID)
    expect(submissions).toHaveLength(2)
    expect(submissions[0]).toMatchObject({ id: first.data.id, status: 'returned', answers: [{ value: '旧版本' }] })
    expect(submissions[1]).toMatchObject({ id: result.data.id, version: 2, status: 'submitted', answers: [{ value: '新版本' }] })
  })

  it('rejects resubmission after the redo deadline without changing state', async () => {
    await submitAt('2026-09-14T01:00:00.000Z', '旧版本')
    await returnAt('2026-09-14T02:00:00.000Z', '请重做')
    const before = getState()

    const result = await submitAt('2026-09-17T02:00:00.001Z', '过期版本')

    expect(result).toMatchObject({ ok: false, error: { code: 'TASK_NOT_SUBMITTABLE' } })
    expect(getState()).toEqual(before)
  })
})
