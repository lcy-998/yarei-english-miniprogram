import { describe, expect, it } from 'vitest'
import { summarizeAssignments } from '../../miniprogram/shared/dashboard-summary'

describe('summarizeAssignments', () => {
  it('uses the submitted-complete product definition', () => {
    const summary = summarizeAssignments([
      ...Array.from({ length: 6 }, () => ({ status: 'awaiting_review' as const })),
      ...Array.from({ length: 21 }, () => ({ status: 'completed' as const })),
      ...Array.from({ length: 9 }, () => ({ status: 'not_started' as const })),
    ])

    expect(summary).toMatchObject({ completedCount: 27, pendingCount: 9, pendingReviewCount: 6, overdueCount: 0, completionRate: 75 })
  })

  it('reports progress and overdue work for the parent overview', () => {
    expect(summarizeAssignments([
      { status: 'in_progress', progressPercent: 67 },
      { status: 'overdue', progressPercent: 20 },
    ])).toEqual({ completedCount: 0, pendingCount: 2, pendingReviewCount: 0, overdueCount: 1, completionRate: 44 })
  })
})
