import { describe, expect, it } from 'vitest'
import { Submission } from '../../miniprogram/domain/types'
import { activeDraftRecordVersion } from '../../miniprogram/shared/submission-draft'

function submission(status: Submission['status'], recordVersion?: number): Submission {
  return {
    id: 'submission_1', assignmentId: 'assignment_1', studentId: 'student_1', version: 1,
    status, answers: [], recordVersion,
  }
}

describe('activeDraftRecordVersion', () => {
  it('only retains a record version for an editable draft', () => {
    expect(activeDraftRecordVersion(submission('draft', 3))).toBe(3)
    expect(activeDraftRecordVersion(submission('returned', 3))).toBeUndefined()
    expect(activeDraftRecordVersion(submission('submitted', 3))).toBeUndefined()
    expect(activeDraftRecordVersion(undefined)).toBeUndefined()
  })
})
