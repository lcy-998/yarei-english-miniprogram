import { describe, expect, it } from 'vitest'
import { previewVideoQuestionScore, withQuestionScoreDraft } from '../../miniprogram/shared/teacher-question-score'
import { previewWeightedReviewScore } from '../../miniprogram/shared/review-task-state'

describe('视频客观题与主观题合分', () => {
  const questions = [
    { questionId: 'objective_a', verdict: '正确' },
    { questionId: 'objective_b', verdict: '错误' },
    { questionId: 'subjective', verdict: '待教师评分' },
  ]

  it('逐题打分后与客观题和其他任务项一起形成作业预计总分', () => {
    expect(previewVideoQuestionScore(withQuestionScoreDraft(questions, {}))).toBeNull()
    const scored = withQuestionScoreDraft(questions, { subjective: '80' })
    expect(previewVideoQuestionScore(scored)).toBe(60)
    expect(previewWeightedReviewScore([
      { itemId: 'video', weightPercent: 40, automaticScore: null,
        teacherScoreRequired: true, complete: true },
      { itemId: 'vocabulary', weightPercent: 60, automaticScore: 90,
        teacherScoreRequired: false, complete: true },
    ], [{ id: 'video', score: 60 }])).toBe(78)
  })

  it('拒绝空分、越界分和缺失的客观核对结果', () => {
    expect(previewVideoQuestionScore(withQuestionScoreDraft(questions, { subjective: '101' }))).toBeNull()
    expect(previewVideoQuestionScore(withQuestionScoreDraft([
      { questionId: 'unknown', verdict: '本次提交未记录本题作答' },
    ], {}))).toBeNull()
  })
})
