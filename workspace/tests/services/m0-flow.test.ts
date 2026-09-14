import { beforeEach, describe, expect, it } from 'vitest'
import { getCompletion, getHome, getParentFeedback, getTeacherTasks, publishClassroomTask, reviewSubmission, submitTask } from '../../miniprogram/services/app-service'
import { getState, initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'

const STUDENT_ID = 'usr_student_xiaoyu'
const TEACHER_ID = 'usr_teacher_lin'
const PARENT_ID = 'usr_parent_xiaoyu'

describe('M0 teacher-student-parent flow', () => {
  beforeEach(() => replaceState(initialState))

  it('publishes, submits, reviews, and exposes the same feedback to the parent', async () => {
    const publishResult = await publishClassroomTask(TEACHER_ID, '本周阅读练习', '完成阅读并写下学习记录')
    expect(publishResult.ok).toBe(true)
    if (!publishResult.ok) return
    expect(publishResult.data.items.map((item) => item.type)).toEqual(['reading', 'vocabulary', 'exercise'])
    expect(new Date(publishResult.data.dueAt).getTime()).toBeGreaterThan(new Date(publishResult.data.startsAt).getTime())
    expect(getState().assignments.filter((item) => item.taskId === publishResult.data.id)).toHaveLength(36)

    const homeResult = await getHome(STUDENT_ID)
    expect(homeResult.ok).toBe(true)
    if (!homeResult.ok) return
    expect(homeResult.data.task).toBeTruthy()

    const submitResult = await submitTask(STUDENT_ID, publishResult.data.id, '我完成了阅读和单词练习。')
    expect(submitResult.ok).toBe(true)

    const completionResult = await getCompletion(TEACHER_ID, publishResult.data.id)
    expect(completionResult.ok).toBe(true)
    if (!completionResult.ok) return
    expect(completionResult.data[0]?.status).toBe('awaiting_review')

    const reviewResult = await reviewSubmission(TEACHER_ID, publishResult.data.id, 'approved', 92, '表达清楚，继续保持。')
    expect(reviewResult.ok).toBe(true)

    const feedbackResult = await getParentFeedback(PARENT_ID, publishResult.data.id)
    expect(feedbackResult.ok).toBe(true)
    if (!feedbackResult.ok) return
    expect(feedbackResult.data.score).toBe(92)
    expect(feedbackResult.data.textComment).toBe('表达清楚，继续保持。')
  })

  it('rejects a student attempting to submit another task assignment', async () => {
    const result = await submitTask('usr_parent_xiaoyu', 'tsk_animals_listening', '越权提交')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
  })

  it('reports real task progress independently from pending review count', async () => {
    const result = await getTeacherTasks(TEACHER_ID)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.pendingCount).toBe(6)
    expect(result.data.progressByTask.tsk_animals_listening).toBe(75)
    expect(result.data.pendingByTask.tsk_animals_listening).toBe(6)
  })
})
