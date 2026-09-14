import { describe, expect, it } from 'vitest'
import { assignmentStatusLabel } from '../../miniprogram/shared/assignment-status'

describe('assignmentStatusLabel', () => {
  it.each([
    ['not_started', '未开始'],
    ['in_progress', '进行中'],
    ['awaiting_review', '待检查'],
    ['completed', '已完成'],
    ['redo_required', '退回重做'],
    ['overdue', '已过期'],
  ] as const)('maps %s to %s', (status, label) => {
    expect(assignmentStatusLabel(status)).toBe(label)
  })

  it('allows a parent-facing awaiting label', () => {
    expect(assignmentStatusLabel('awaiting_review', '待点评')).toBe('待点评')
  })
})
