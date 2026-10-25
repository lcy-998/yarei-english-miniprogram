import { afterEach, describe, expect, it, vi } from 'vitest'
import { exerciseReviewGroups } from '../../miniprogram/shared/exercise-review-groups'

describe('T-08 exercise review grouping', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('keeps one pack in one entry across big questions and leaves other content separate', () => {
    const rows = exerciseReviewGroups([
      { id: 'q1', type: 'exercise', title: '校园花园｜大题一：语言｜第 1 小题' },
      { id: 'q2', type: 'exercise', title: '校园花园｜大题二：阅读｜第 1 小题' },
      { id: 'read', type: 'reading', title: '绘本阅读' },
      { id: 'q3', type: 'exercise', title: '另一份习题｜第 1 题' },
      { id: 'legacy', type: 'exercise', title: '旧单题' },
    ])
    expect(rows.map(row => ({ title: row.title, itemIds: row.itemIds }))).toEqual([
      { title: '校园花园', itemIds: ['q1', 'q2'] },
      { title: '绘本阅读', itemIds: ['read'] },
      { title: '另一份习题', itemIds: ['q3'] },
      { title: '旧单题', itemIds: ['legacy'] },
    ])
  })

  it('keeps per-question score rows while showing a single clickable pack card', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }), navigateTo })
    await import('../../miniprogram/subpackages/teacher/review-task/review-task')
    if (!definition) throw new Error('Review page not registered')
    const items = [
      { id: 'q1', type: 'exercise', title: '校园花园｜大题一：语言｜第 1 小题', completionRule: {} },
      { id: 'q2', type: 'exercise', title: '校园花园｜大题二：阅读｜第 1 小题', completionRule: {} },
    ]
    const context = { data: { ...definition.data, taskItems: items,
      activeAnswers: [{ itemId: 'q1', value: { kind: 'exercise', answeredQuestionCount: 1 } },
        { itemId: 'q2', value: { kind: 'exercise', answeredQuestionCount: 1 } }],
      activeExerciseEvidence: [
        { itemId: 'q1', questionId: 'question1', stem: '选词', options: ['A', 'B'],
          studentResponse: 'A', correctAnswer: 'A', explanation: '', isCorrect: true, recorded: true },
        { itemId: 'q2', questionId: 'question2', questionType: 'subjective', stem: '说明理由', options: [],
          studentResponse: '原因', correctAnswer: '', explanation: '', isCorrect: null, recorded: true },
      ], scoringItems: [{ itemId: 'q1', weightPercent: 50, automaticScore: 100,
        teacherScoreRequired: false, complete: true },
      { itemId: 'q2', weightPercent: 50, automaticScore: null,
        teacherScoreRequired: true, complete: true }],
      manualScoreRows: [], readingPages: [], recordingMediaStates: {}, publishedFeedback: null,
      activeRow: { assignmentId: 'assignment_demo' }, selectedSubmissionId: 'submission_demo',
      submissionLoading: false, taskItemsLoading: false, submissionError: '', taskItemsError: '',
      activeVocabularyEvidence: [] },
    setData(change: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, change); callback?.() } }
    Object.assign(context, definition.methods)
    definition.methods.refreshDetailRows.call(context)
    expect(context.data.detailRows).toMatchObject([{ id: 'q1', title: '校园花园',
      exerciseGroupItemIds: ['q1', 'q2'] }])
    expect(context.data.manualScoreRows).toMatchObject([{ id: 'q2' }])
    definition.methods.openReviewItem.call(context, { currentTarget: { dataset: { id: 'q1' } } })
    expect(navigateTo).toHaveBeenCalledWith({ url: '/subpackages/student/exercise-task/exercise-task?teacherReview=1&submissionId=submission_demo&itemId=q1&group=1' })
  })
})
