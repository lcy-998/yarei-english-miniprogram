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

  it('对新习题显示发布快照中的逐题答案与服务端判定，旧提交仍标记未记录', () => {
    const items = [{ id: 'quiz', title: '动物选择题', type: 'exercise' as const,
      completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 } }]
    const answers = [{ itemId: 'quiz', value: { kind: 'exercise', answeredQuestionCount: 1,
      questionResponses: [{ questionId: 'q_1', response: 'B. lion', isCorrect: false }] } }]
    const evidence = { itemId: 'quiz', questionId: 'q_1', stem: 'Which animal can fly?', options: ['A. bird', 'B. lion'],
      studentResponse: 'B. lion', correctAnswer: 'A. bird', explanation: 'Birds can fly.', isCorrect: false, recorded: true }
    expect(teacherSubmissionDetails(items, answers, [evidence])).toMatchObject([{ result: '已答　客观题错误', tone: 'neutral' }])
    expect(teacherSubmissionDetails(items, answers, [evidence])[0]?.detail).toContain('学生答案：B. lion')
    expect(teacherSubmissionDetails(items, answers, [evidence])[0]?.exercise).toMatchObject({
      stem: 'Which animal can fly?', options: ['A. bird', 'B. lion'], studentAnswer: 'B. lion',
      correctAnswer: 'A. bird', verdict: '错误', recorded: true,
    })
    expect(teacherSubmissionDetails(items, [], [{ ...evidence, studentResponse: null, isCorrect: null, recorded: false }])[0]?.detail)
      .toContain('旧提交没有逐题作答记录')
  })

  it('按词展示首次错误及后续正确，未作答词明确标记未记录', () => {
    const rows = teacherSubmissionDetails([{ id: 'words', title: '动物单词', type: 'vocabulary',
      completionRule: { kind: 'vocabulary_words', requiredWordCount: 1 } }],
    [{ itemId: 'words', value: { kind: 'vocabulary', completedWordCount: 1, correctWordCount: 0 } }], [], [
      { itemId: 'words', wordId: 'word_tiger', targetWord: 'tiger', firstCorrect: false, attempts: [
        { studentInput: 'lion', isCorrect: false, firstAttempt: true, attemptNumber: 1, attemptedAt: '2026-09-16T00:00:00.000Z' },
        { studentInput: 'tiger', isCorrect: true, firstAttempt: false, attemptNumber: 2, attemptedAt: '2026-09-16T00:01:00.000Z' },
      ] },
      { itemId: 'words', wordId: 'word_bear', targetWord: 'bear', firstCorrect: null, attempts: [] },
    ])
    expect(rows[0]?.detail).toContain('首次：lion（错误）')
    expect(rows[0]?.detail).toContain('第 2 次：tiger（正确）')
    expect(rows[0]?.detail).toContain('目标词：bear；本次提交未作答')
    expect(rows[0]?.words?.[0]).toMatchObject({ targetWord: 'tiger', attempts: [
      { studentInput: 'lion', firstAttempt: true }, { studentInput: 'tiger', firstAttempt: false },
    ] })
  })

  it('shows the frozen reading range and only labels stored page visits as verified', () => {
    const items = [{ id: 'read', title: '绘本指定页', type: 'reading' as const,
      completionRule: { kind: 'reading_pages', requiredPageCount: 2, pageIds: ['page_2', 'page_3'] } }]
    expect(teacherSubmissionDetails(items, [{ itemId: 'read', value: { kind: 'reading', completedPageCount: 2 } }]))
      .toMatchObject([{ result: '逐页证据未记录', tone: 'neutral' }])
    const rows = teacherSubmissionDetails(items, [{ itemId: 'read', value: { kind: 'reading',
      completedPageCount: 2, verifiedPageEvents: [
        { pageId: 'page_2', pageNumber: 2, visitedAt: '2026-09-26T09:00:00+08:00' },
        { pageId: 'page_3', pageNumber: 3, visitedAt: '2026-09-26T09:02:00+08:00' },
      ] } }])
    expect(rows).toMatchObject([{ requirement: '需完成指定 2 页', result: '已核验 2 页', tone: 'success' }])
    expect(rows[0]?.detail).toContain('第 3 页')
  })

  it('录音项仅根据当前提交的受控引用显示试听入口，旧提交标记缺失', () => {
    const items = [{ id: 'recording_item', title: '虚构朗读', type: 'recording' as const,
      completionRule: { kind: 'recording_upload' } }]
    expect(teacherSubmissionDetails(items, [])).toMatchObject([{ result: '本次提交没有录音证据', tone: 'neutral' }])
    const rows = teacherSubmissionDetails(items, [{ itemId: 'recording_item',
      value: { kind: 'recording', recordingId: 'task_recording_demo_1', durationMs: 3200 } }])
    expect(rows).toMatchObject([{ typeLabel: '录音', recordingId: 'task_recording_demo_1',
      result: '已提交录音', tone: 'success' }])
    expect(rows[0]?.detail).toContain('3 秒')
  })
})
