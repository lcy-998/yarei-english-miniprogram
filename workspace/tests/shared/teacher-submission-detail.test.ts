import { describe, expect, it } from 'vitest'
import { teacherSubmissionDetails } from '../../miniprogram/shared/teacher-submission-detail'

describe('教师作业详情展示口径', () => {
  it('将当前真实提交按内容项呈现，不编造逐题对错或朗读录音', () => {
    const rows = teacherSubmissionDetails([
      { id: 'read', title: '绘本阅读', type: 'reading', completionRule: { kind: 'reading_pages', requiredPageCount: 3 } },
      { id: 'words', title: '动物单词', type: 'vocabulary', completionRule: { kind: 'vocabulary_words', requiredWordCount: 8 } },
      { id: 'quiz', title: '课后习题', type: 'exercise', completionRule: { kind: 'exercise_questions', requiredQuestionCount: 5 } },
    ], [
      { itemId: 'read', value: { kind: 'reading', completedPageCount: 3 } },
      { itemId: 'words', value: { kind: 'vocabulary', completedWordCount: 8, correctWordCount: 6 } },
      { itemId: 'quiz', value: { kind: 'exercise', answeredQuestionCount: 5 } },
    ])
    expect(rows.map(row => row.result)).toEqual(['已完成 3 页', '已完成 8 词', '已答 5 题'])
    expect(rows[1]?.detail).toContain('首次正确 6/8 词')
    expect(rows[2]?.detail).toContain('没有逐题答案与对错判定')
    expect(rows[0]?.detail).toContain('未附带朗读录音')
  })

  it('缺少内容项答案时不将完成状态推断为正确', () => {
    const rows = teacherSubmissionDetails([{ id: 'quiz', title: '习题', type: 'exercise', completionRule: { requiredQuestionCount: 4 } }], [])
    expect(rows).toMatchObject([{ result: '未提供答题记录', tone: 'neutral' }])
  })
})
