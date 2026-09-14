import { beforeEach, describe, expect, it } from 'vitest'
import {
  getCompletion,
  getParentHome,
  getParentFeedback,
  getParentTask,
  getTaskDetail,
  getTeacherTasks,
  publishClassroomTask,
  reviewSubmission,
  submitTask,
} from '../../miniprogram/services/app-service'
import { getState, initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'

const STUDENT_ID = 'usr_student_xiaoyu'
const TEACHER_ID = 'usr_teacher_lin'
const PARENT_ID = 'usr_parent_xiaoyu'
const TASK_ID = 'tsk_animals_listening'

async function submitAndReviewTask(): Promise<void> {
  const submission = await submitTask(STUDENT_ID, TASK_ID, '完成作答')
  expect(submission.ok).toBe(true)
  const review = await reviewSubmission(TEACHER_ID, TASK_ID, 'approved', 93, '阅读认真，表达完整。')
  expect(review.ok).toBe(true)
}

describe('M0 service boundaries and shared views', () => {
  beforeEach(() => replaceState(initialState))

  it('rejects role misuse across teacher, student, and parent commands', async () => {
    const studentPublish = await publishClassroomTask(STUDENT_ID, '越权任务', '不应创建')
    const teacherSubmit = await submitTask(TEACHER_ID, TASK_ID, '不应提交')
    const validSubmission = await submitTask(STUDENT_ID, TASK_ID, '完成作答')
    const parentReview = await reviewSubmission(PARENT_ID, TASK_ID, 'approved', 90, '不应点评')

    expect(studentPublish).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(teacherSubmit).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(validSubmission.ok).toBe(true)
    expect(parentReview).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  })

  it('requires a non-blank reason before returning a submission', async () => {
    const submission = await submitTask(STUDENT_ID, TASK_ID, '完成作答')
    expect(submission.ok).toBe(true)

    const result = await reviewSubmission(TEACHER_ID, TASK_ID, 'returned', 0, '   ')
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })

    const detail = await getTaskDetail(STUDENT_ID, TASK_ID)
    expect(detail.ok).toBe(true)
    if (!detail.ok) return
    expect(detail.data.assignment.status).toBe('awaiting_review')
    expect(detail.data.feedback).toBeUndefined()
  })

  it('keeps task lifecycle separate and exposes one review consistently', async () => {
    const submission = await submitTask(STUDENT_ID, TASK_ID, '完成作答')
    expect(submission.ok).toBe(true)

    const submittedDetail = await getTaskDetail(STUDENT_ID, TASK_ID)
    expect(submittedDetail.ok).toBe(true)
    if (!submittedDetail.ok) return
    expect(submittedDetail.data.task.status).toBe('active')
    expect(submittedDetail.data.assignment.status).toBe('awaiting_review')

    const review = await reviewSubmission(TEACHER_ID, TASK_ID, 'approved', 93, '阅读认真，表达完整。')
    expect(review.ok).toBe(true)
    if (!review.ok) return

    const studentDetail = await getTaskDetail(STUDENT_ID, TASK_ID)
    const parentDetail = await getParentTask(PARENT_ID, TASK_ID)
    const parentFeedback = await getParentFeedback(PARENT_ID, TASK_ID)
    expect(studentDetail.ok).toBe(true)
    expect(parentDetail.ok).toBe(true)
    expect(parentFeedback.ok).toBe(true)
    if (!studentDetail.ok || !parentDetail.ok || !parentFeedback.ok) return

    expect(studentDetail.data.task.status).toBe('active')
    expect(studentDetail.data.assignment.status).toBe('completed')
    expect(parentDetail.data.assignment.status).toBe(studentDetail.data.assignment.status)
    expect(parentDetail.data.feedback).toEqual(studentDetail.data.feedback)
    expect(parentFeedback.data).toEqual(review.data)
  })

  it('allows every parent read only while an active child link exists', async () => {
    await submitAndReviewTask()

    const home = await getParentHome(PARENT_ID)
    const task = await getParentTask(PARENT_ID, TASK_ID)
    const feedback = await getParentFeedback(PARENT_ID, TASK_ID)

    expect(home.ok).toBe(true)
    expect(task.ok).toBe(true)
    expect(feedback.ok).toBe(true)
  })

  it('denies every parent read immediately after the child link is revoked', async () => {
    await submitAndReviewTask()
    const state = getState()
    state.parentStudentLinks[0]!.status = 'revoked'
    replaceState(state)

    const home = await getParentHome(PARENT_ID)
    const task = await getParentTask(PARENT_ID, TASK_ID)
    const feedback = await getParentFeedback(PARENT_ID, TASK_ID)

    expect(home).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(task).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(feedback).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('denies every parent read when no child link exists', async () => {
    await submitAndReviewTask()
    const state = getState()
    state.parentStudentLinks = []
    replaceState(state)

    const home = await getParentHome(PARENT_ID)
    const task = await getParentTask(PARENT_ID, TASK_ID)
    const feedback = await getParentFeedback(PARENT_ID, TASK_ID)

    expect(home).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(task).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(feedback).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('allows class-authorized teachers to review and rejects teachers outside the task class', async () => {
    const state = getState()
    state.users.push(
      { id: 'usr_teacher_colleague', displayName: '陈老师', role: 'teacher', classId: 'cls_grade3_2' },
      { id: 'usr_teacher_outside', displayName: '赵老师', role: 'teacher', classId: 'cls_grade4_1' },
    )
    replaceState(state)
    const submission = await submitTask(STUDENT_ID, TASK_ID, '完成作答')
    expect(submission.ok).toBe(true)

    const authorizedTasks = await getTeacherTasks('usr_teacher_colleague')
    const authorizedCompletion = await getCompletion('usr_teacher_colleague', TASK_ID)
    const unauthorizedCompletion = await getCompletion('usr_teacher_outside', TASK_ID)
    const unauthorizedReview = await reviewSubmission('usr_teacher_outside', TASK_ID, 'approved', 90, '不应发布')

    expect(authorizedTasks.ok).toBe(true)
    if (authorizedTasks.ok) expect(authorizedTasks.data.tasks.map(task => task.id)).toContain(TASK_ID)
    expect(authorizedCompletion.ok).toBe(true)
    expect(unauthorizedCompletion).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(unauthorizedReview).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })

    const authorizedReview = await reviewSubmission('usr_teacher_colleague', TASK_ID, 'approved', 91, '按班级授权完成点评。')
    expect(authorizedReview.ok).toBe(true)
  })

  it('does not let callers mutate stored data through a command response', async () => {
    const published = await publishClassroomTask(TEACHER_ID, '不可变任务', '验证返回对象隔离')
    expect(published.ok).toBe(true)
    if (!published.ok) return
    const taskId = published.data.id

    published.data.title = '调用方篡改标题'
    published.data.items[0]!.title = '调用方篡改内容'

    const teacherTasks = await getTeacherTasks(TEACHER_ID)
    expect(teacherTasks.ok).toBe(true)
    if (!teacherTasks.ok) return
    const storedTask = teacherTasks.data.tasks.find((task) => task.id === taskId)
    expect(storedTask?.title).toBe('不可变任务')
    expect(storedTask?.items[0]?.title).toBe('阅读练习')
  })
})
