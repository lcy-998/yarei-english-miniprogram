import { describe, expect, it } from 'vitest'
import type { Task, TaskAssignment, Submission } from '../../miniprogram/subpackages/student/domain/types'
import { firstIncompleteTaskItemId, mediaTaskProgressFraction, studentSubmissionAtVersion, submittedAnswerRows, taskItemStatusLabel, taskWriteAvailability } from '../../miniprogram/shared/task-detail-view'

describe('student media task progress', () => {
  it('does not count absent questions as half of a video task', () => {
    expect(mediaTaskProgressFraction(0, 1, false, false)).toBe(0)
    expect(mediaTaskProgressFraction(0.5, 1, false, false)).toBe(0.5)
    expect(mediaTaskProgressFraction(1, 1, false, true)).toBe(1)
  })

  it('combines playback and required answers for question and dubbing tasks', () => {
    expect(mediaTaskProgressFraction(1, 0, true, false)).toBe(0.5)
    expect(mediaTaskProgressFraction(0.5, 0.5, true, false)).toBe(0.5)
  })
})

describe('student task item status labels', () => {
  it('keeps completion first and uses short labels for the remaining states', () => {
    expect(taskItemStatusLabel('已听 100% · 已作答', true)).toEqual({ label: '已完成', tone: 'complete' })
    expect(taskItemStatusLabel('已听 60% · 已作答', false)).toEqual({ label: '进行中', tone: 'in-progress' })
    expect(taskItemStatusLabel('已听完 · 待作答', false)).toEqual({ label: '待作答', tone: 'in-progress' })
    expect(taskItemStatusLabel('已听完 · 作答中', false)).toEqual({ label: '作答中', tone: 'in-progress' })
    expect(taskItemStatusLabel('已听 0%', false)).toEqual({ label: '未开始', tone: 'pending' })
    expect(taskItemStatusLabel('已播放 0%', false)).toEqual({ label: '未开始', tone: 'pending' })
    expect(taskItemStatusLabel('已播放 0% · 待录制', false)).toEqual({ label: '未开始', tone: 'pending' })
    expect(taskItemStatusLabel('0/3', false)).toEqual({ label: '未开始', tone: 'pending' })
    expect(taskItemStatusLabel('待服务端核对', false)).toEqual({ label: '待核对', tone: 'review' })
    expect(taskItemStatusLabel('媒体进度不可用', false)).toEqual({ label: '资源异常', tone: 'unavailable' })
  })
})

const task: Task = {
  id: 'task_fictional', title: '虚构作业', deliveryType: 'classroom', status: 'active',
  creatorTeacherId: 'teacher_demo', classId: 'class_demo',
  startsAt: '2026-10-01T08:00:00+08:00', dueAt: '2026-10-02T08:00:00+08:00',
  latePolicy: { allowLate: true, lateDays: 2 }, description: '', version: 1,
  items: [{ id: 'item_1', type: 'exercise', title: '选择题', completionRule: '完成 1 题',
    exerciseQuestion: { questionId: 'question_1', questionType: 'multiple_choice', stem: '虚构题干', options: ['A', 'B'] } }],
}
const assignment: TaskAssignment = {
  id: 'assignment_fictional', taskId: task.id, studentId: 'student_demo', classId: task.classId,
  status: 'not_started', progressPercent: 0, redoCount: 0,
}

describe('student task write availability', () => {
  it('respects task start, due time, configured late window and disabled late policy', () => {
    expect(taskWriteAvailability(task, assignment, '2026-10-01T07:59:59+08:00').reason).toContain('尚未开始')
    expect(taskWriteAvailability(task, assignment, '2026-10-02T08:00:00+08:00').editable).toBe(true)
    expect(taskWriteAvailability(task, assignment, '2026-10-04T08:00:00+08:00').timingLabel).toContain('补交期内')
    expect(taskWriteAvailability(task, assignment, '2026-10-04T08:00:01+08:00').reason).toContain('补交期限已过')
    expect(taskWriteAvailability({ ...task, latePolicy: { allowLate: false, lateDays: 7 } }, assignment,
      '2026-10-02T08:00:01+08:00').reason).toContain('未开放补交')
    expect(taskWriteAvailability({ ...task, latePolicy: undefined }, assignment,
      '2026-10-02T08:00:01+08:00').reason).toContain('补交规则暂不可核对')
    expect(taskWriteAvailability({ ...task, latePolicy: undefined }, assignment,
      '2026-10-09T08:00:01+08:00', true)).toMatchObject({ editable: true, timingLabel: '演示任务逾期提交' })
  })

  it('uses the redo deadline even when a saved draft has moved the assignment into progress', () => {
    const redo = { ...assignment, status: 'in_progress' as const, redoDueAt: '2026-10-08T08:00:00+08:00' }
    expect(taskWriteAvailability(task, redo, '2026-10-07T08:00:00+08:00').editable).toBe(true)
    expect(taskWriteAvailability(task, redo, '2026-10-08T08:00:01+08:00').reason).toContain('重做期限已过')
    expect(taskWriteAvailability({ ...task, status: 'closed' }, redo, '2026-10-07T08:00:00+08:00').editable).toBe(false)
  })
})

describe('student submitted answer review', () => {
  const submission: Submission = { id: 'submission_fictional', assignmentId: assignment.id,
    studentId: assignment.studentId, version: 1, status: 'returned', answers: [{
      taskItemId: 'item_1', value: '', structuredValue: { kind: 'exercise', answeredQuestionCount: 1,
        questionResponses: [{ questionId: 'question_1', response: ['A', 'B'], isCorrect: false }] },
    }] }

  it('shows only the submitted response and its saved judgment, without an answer key', () => {
    const rows = submittedAnswerRows(task, submission)
    expect(rows).toMatchObject([{ question: '虚构题干', answer: 'A、B', result: '系统判定：需订正' }])
    expect(JSON.stringify(rows)).not.toContain('correctAnswer')
    expect(submittedAnswerRows(task, { ...submission, status: 'draft' })).toEqual([])
  })

  it('uses immutable submitted versions for read-only review and never uses the active redo draft', () => {
    const history = { task, assignment: { ...assignment, status: 'redo_required' as const },
      submission: { ...submission, version: 2, status: 'draft' as const, answers: [] },
      submissionHistory: [{ version: 1, status: 'returned' as const, submittedAt: '2026-10-01T09:00:00+08:00',
        answers: submission.answers }] }
    expect(studentSubmissionAtVersion(history, 1)?.answers).toEqual(submission.answers)
    expect(studentSubmissionAtVersion(history, 2)).toBeUndefined()
    expect(studentSubmissionAtVersion({ ...history, submissionHistory: [{ version: 1, status: 'returned' as const,
      submittedAt: '2026-10-01T09:00:00+08:00' }] }, 1)).toBeUndefined()
  })

  it('locates the first incomplete item in published order', () => {
    const multi = { ...task, items: [...task.items, { ...task.items[0], id: 'item_2', title: '第二题' }] }
    expect(firstIncompleteTaskItemId(multi, [{ itemId: 'item_1' }, { itemId: 'item_2' }],
      { item_1: { complete: true }, item_2: { complete: false } })).toBe('item_2')
  })

  it('labels historical media evidence by its actual type without inventing playback completion', () => {
    const mediaTask: Task = { ...task, items: [
      { id: 'listening_1', type: 'listening', title: '听力', completionRule: '播放并作答',
        mediaSnapshot: { kind: 'listening', mediaId: 'media_1', mediaVersion: 1, reviewVersion: 1,
          durationMs: 10000, questionIds: ['q1'],
          questions: [{ questionId: 'q1', questionType: 'single_choice', stem: '虚构听力题', options: ['A', 'B'] }],
          clips: [{ questionId: 'q1', segmentId: 'clip_1', startMs: 0, endMs: 2000 }],
          subtitleAvailable: false, continuousPlaybackEnforced: true } },
      { id: 'video_1', type: 'video', title: '视频', completionRule: '有效观看' },
      { id: 'dubbing_1', type: 'dubbing', title: '任务配音', completionRule: '提交最终作品' },
    ] }
    const submitted: Submission = { ...submission, status: 'submitted', answers: [
      { taskItemId: 'listening_1', value: '', structuredValue: { kind: 'listening',
        mediaSessionId: 'session_1', questionResponses: [{ questionId: 'q1', response: 'A' }] } },
      { taskItemId: 'video_1', value: '', structuredValue: { kind: 'video', mediaSessionId: 'session_2' } },
      { taskItemId: 'dubbing_1', value: '', structuredValue: { kind: 'dubbing',
        mediaSessionId: 'session_3', finalWorkId: 'work_1' } },
    ] }
    expect(submittedAnswerRows(mediaTask, submitted).map(row => row.answer)).toEqual([
      '本次已提交 1 道听力题；播放证据由服务端核对',
      '本次已提交视频学习；有效观看由服务端核对',
      '本次最终配音作品已提交；播放证据由服务端核对',
    ])
    expect(submittedAnswerRows(mediaTask, submitted)[0]?.mediaResponses).toEqual([
      { questionId: 'q1', stem: '虚构听力题', answer: 'A' },
    ])
  })
})
