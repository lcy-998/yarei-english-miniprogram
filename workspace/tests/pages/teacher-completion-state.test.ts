import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPLETION_FILTER, filterCompletionRows, isBatchReviewable, isCompletedSubmission, scoreCaption, selectedBatchCounts, toggleCompletionSelection } from '../../miniprogram/pages/teacher/completion/completion-state'

const rows = [
  { assignmentId: 'a1', taskId: 'task', studentName: '小宇', studentNumber: '0321', status: 'awaiting_review', submissionId: 's1', submissionVersion: 1, selected: false },
  { assignmentId: 'a2', taskId: 'task', studentName: '林可', studentNumber: '0318', status: 'completed', selected: false },
  { assignmentId: 'a3', taskId: 'task', studentName: '陈一', studentNumber: '0309', status: 'not_started', selected: false },
  { assignmentId: 'a4', taskId: 'task', studentName: '吴宁', studentNumber: '0306', status: 'redo_required', selected: false },
]

describe('teacher completion filters and selection', () => {
  it('shows every student when the page first opens', () => {
    expect(DEFAULT_COMPLETION_FILTER).toBe('all')
    expect(filterCompletionRows(rows, DEFAULT_COMPLETION_FILTER, '')).toHaveLength(rows.length)
  })

  it('counts submitted work as completed before and after review', () => {
    expect(rows.filter(isCompletedSubmission).map(row => row.assignmentId)).toEqual(['a1', 'a2'])
    expect(filterCompletionRows(rows, 'completed', '').map(row => row.assignmentId)).toEqual(['a1', 'a2'])
    expect(filterCompletionRows(rows, 'incomplete', '').map(row => row.assignmentId)).toEqual(['a3', 'a4'])
    expect(filterCompletionRows(rows, 'awaiting_review', '').map(row => row.assignmentId)).toEqual(['a1'])
  })

  it('lets the teacher select any student while limiting batch review to eligible submissions', () => {
    const selected = toggleCompletionSelection(rows, 'a3')
    expect(selected.find(row => row.assignmentId === 'a3')?.selected).toBe(true)
    expect(selected.find(row => row.assignmentId === 'a1')?.selected).toBe(false)
    expect(selected.filter(row => row.selected && isBatchReviewable(row))).toEqual([])
    expect(rows.filter(isBatchReviewable).map(row => row.assignmentId)).toEqual(['a1'])
    expect(toggleCompletionSelection(selected, 'a3').find(row => row.assignmentId === 'a3')?.selected).toBe(false)
  })

  it('keeps the keyword and status filters together', () => {
    expect(filterCompletionRows(rows, 'all', '0318').map(row => row.assignmentId)).toEqual(['a2'])
    expect(filterCompletionRows(rows, 'incomplete', '小宇')).toEqual([])
  })

  it('distinguishes all selected students from batch candidates', () => {
    const selected = rows.map(row => ({ ...row, selected: row.assignmentId !== 'a2' }))
    expect(selectedBatchCounts(selected)).toEqual({ selected: 3, candidates: 1, excluded: 2 })
  })

  it('labels an unreviewed score as a system reference instead of a teacher grade', () => {
    expect(scoreCaption({ ...rows[0], score: 82 })).toBe('系统参考分')
    expect(scoreCaption({ ...rows[1], score: 82 })).toBe('列表参考分')
    expect(scoreCaption(rows[2])).toBe('暂无分数')
  })
})
