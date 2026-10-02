import { describe, expect, it } from 'vitest'
import { currentReviewTaskFirst, filterReviewRowsByClass, parseReviewScoreInput, reviewClassOptions, reviewQueueOverview, reviewTaskOptions, selectReviewRows, selectedReviewTaskId } from '../../miniprogram/pages/teacher/review-task/review-task-state'
import type { ReviewAssignmentView } from '../../miniprogram/services/app-service'

const rows: ReviewAssignmentView[] = [
  { studentName: '小宇', assignmentId: 'a_pending', taskId: 'task', status: 'awaiting_review', submissionId: 's_pending', submissionVersion: 1 },
  { studentName: '林可', assignmentId: 'a_reviewed', taskId: 'task', status: 'completed', submissionId: 's_reviewed', submissionVersion: 1, score: 90 },
  { studentName: '陈一', assignmentId: 'a_empty', taskId: 'task', status: 'not_started' },
]

describe('教师逐人检查与只读详情入口', () => {
  it('从完成情况打开已点评学生时只显示该份作业且禁用点评', () => {
    expect(selectReviewRows(rows, 'a_reviewed')).toMatchObject({ rows: [{ assignmentId: 'a_reviewed' }], activeIndex: 0, readOnlyMode: true })
  })

  it('快速点评入口仍只展示待点评队列', () => {
    expect(selectReviewRows(rows, '')).toMatchObject({ rows: [{ assignmentId: 'a_pending' }], readOnlyMode: false })
    expect(reviewQueueOverview(rows)).toEqual({ assignedCount: 3, pendingCount: 1,
      reviewedCount: 1, withoutPendingCount: 1 })
  })
})

describe('教师作业评分输入', () => {
  it('保留空值为未评分，允许 0 至 100 的整数', () => {
    expect(parseReviewScoreInput('')).toMatchObject({ score: null, error: '' })
    expect(parseReviewScoreInput('0')).toMatchObject({ score: 0, error: '' })
    expect(parseReviewScoreInput('85')).toMatchObject({ score: 85, error: '' })
    expect(parseReviewScoreInput('100')).toMatchObject({ score: 100, error: '' })
  })

  it.each(['-1', '101', '80.5', 'abc'])('拒绝无效分数 %s', value => {
    expect(parseReviewScoreInput(value)).toMatchObject({ score: null, error: '请输入 0 到 100 的整数分数' })
  })
})

describe('待点评队列班级筛选', () => {
  const pending: ReviewAssignmentView[] = [
    { studentName: '小宇', className: '三年级 2 班', assignmentId: 'a1', taskId: 'task', status: 'awaiting_review', submissionId: 's1', submissionVersion: 1 },
    { studentName: '林可', className: '三年级 2 班', assignmentId: 'a2', taskId: 'task', status: 'awaiting_review', submissionId: 's2', submissionVersion: 1 },
    { studentName: '小宁', className: '四年级 1 班', assignmentId: 'a3', taskId: 'task', status: 'awaiting_review', submissionId: 's3', submissionVersion: 1 },
  ]

  it('只在多个班级时提供筛选，并按当前班级更新队列', () => {
    expect(reviewClassOptions(pending)).toEqual([
      { id: 'all', label: '全部班级', count: 3 },
      { id: '三年级 2 班', label: '三年级 2 班', count: 2 },
      { id: '四年级 1 班', label: '四年级 1 班', count: 1 },
    ])
    expect(filterReviewRowsByClass(pending, '四年级 1 班').map(item => item.assignmentId)).toEqual(['a3'])
    expect(reviewClassOptions(pending.slice(0, 2))).toHaveLength(2)
  })

  it('同名班级使用班级标识筛选，避免混入其他班级', () => {
    const sameName = [
      { ...pending[0], classId: 'class_a', className: '三年级 2 班' },
      { ...pending[1], classId: 'class_b', className: '三年级 2 班' },
    ]
    expect(reviewClassOptions(sameName).map(item => item.id)).toEqual(['all', 'class_a', 'class_b'])
    expect(filterReviewRowsByClass(sameName, 'class_b').map(item => item.assignmentId)).toEqual(['a2'])
  })
})

describe('快速点评任务选择', () => {
  it('列出所有可查看的已发布任务，优先展示待点评项并保留入口指定任务', () => {
    const options = reviewTaskOptions([
      { id: 'task_a', title: '阅读任务', status: 'active' },
      { id: 'task_b', title: '单词任务', status: 'completed' },
      { id: 'task_c', title: '习题任务', status: 'active' },
      { id: 'task_draft', title: '草稿', status: 'draft' },
      { id: 'task_withdrawn', title: '已撤回', status: 'withdrawn' },
    ], { task_a: 3, task_c: 1, task_draft: 2 })
    expect(options).toEqual([
      { id: 'task_a', title: '阅读任务', pendingCount: 3 },
      { id: 'task_c', title: '习题任务', pendingCount: 1 },
      { id: 'task_b', title: '单词任务', pendingCount: 0 },
    ])
    expect(selectedReviewTaskId(options, 'task_b')).toBe('task_b')
    expect(selectedReviewTaskId(options, 'old_task')).toBe('task_a')
    expect(selectedReviewTaskId([], 'old_task')).toBe('')
    expect(currentReviewTaskFirst(options, 'task_b').map(option => option.id)).toEqual(['task_b', 'task_a', 'task_c'])
    expect(options.map(option => option.id)).toEqual(['task_a', 'task_c', 'task_b'])
  })
})
