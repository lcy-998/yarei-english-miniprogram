import { describe, expect, it } from 'vitest'
import { previewWeightedReviewScore, reviewEvidenceReady, reviewScoreForConfirmation } from '../../miniprogram/pages/teacher/review-task/review-task-state'
import { requiresIndividualReview } from '../../miniprogram/pages/teacher/completion/completion-state'

describe('teacher review scoring and publish guards', () => {
  const weighted = [
    { itemId: 'reading', weightPercent: 25, automaticScore: 100, teacherScoreRequired: false, complete: true },
    { itemId: 'recording', weightPercent: 75, automaticScore: null, teacherScoreRequired: true, complete: true },
  ]

  it('previews the same weighted total as the server and waits for valid item scores', () => {
    expect(previewWeightedReviewScore(weighted, [{ id: 'recording', score: 60 }])).toBe(70)
    expect(previewWeightedReviewScore(weighted, [{ id: 'recording', score: null }])).toBeNull()
    expect(previewWeightedReviewScore(weighted, [{ id: 'recording', score: 101 }])).toBeNull()
    expect(previewWeightedReviewScore([{ ...weighted[0], weightPercent: 40 }, weighted[1]],
      [{ id: 'recording', score: 60 }])).toBeNull()
  })

  it('blocks publication when either evidence read failed or belongs to another version', () => {
    const ready = { submissionLoading: false, taskItemsLoading: false, submissionError: '',
      taskItemsError: '', selectedSubmissionId: 'submission_current' }
    expect(reviewEvidenceReady(ready, 'submission_current')).toBe(true)
    expect(reviewEvidenceReady({ ...ready, submissionError: '读取失败' }, 'submission_current')).toBe(false)
    expect(reviewEvidenceReady({ ...ready, taskItemsError: '快照缺失' }, 'submission_current')).toBe(false)
    expect(reviewEvidenceReady(ready, 'submission_other')).toBe(false)
  })

  it('summarizes the score that will be confirmed, and never presents an unverified weighted score', () => {
    expect(reviewScoreForConfirmation([{ id: 'recording', score: 60 }], weighted, null, 100)).toBe(70)
    expect(reviewScoreForConfirmation([{ id: 'recording', score: 60 }], [], null, 100)).toBeNull()
    expect(reviewScoreForConfirmation([], [], 84, 90)).toBe(84)
    expect(reviewScoreForConfirmation([], [], null, 90)).toBe(90)
    expect(reviewScoreForConfirmation([], [], null, null)).toBeNull()
  })

  it('requires individual review for recording, subjective or unverified legacy exercise', () => {
    expect(requiresIndividualReview({ taskItems: [{ type: 'recording' }] })).toBe(true)
    expect(requiresIndividualReview({ taskItems: [{ type: 'exercise' }],
      exerciseEvidence: [{ questionType: 'subjective' }] })).toBe(true)
    expect(requiresIndividualReview({ taskItems: [{ type: 'exercise' }] })).toBe(true)
    expect(requiresIndividualReview({ taskItems: [{ type: 'exercise' }],
      exerciseEvidence: [{ questionType: 'single_choice' }] })).toBe(false)
  })
})
