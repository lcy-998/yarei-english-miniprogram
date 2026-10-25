import { afterEach, describe, expect, it, vi } from 'vitest'

const loadTeacherReviewItem = vi.fn()
const getTeacherTaskMediaReviewEvidence = vi.fn()
vi.mock('../../miniprogram/subpackages/student/shared/teacher-review-item', async importOriginal => ({
  ...await importOriginal<typeof import('../../miniprogram/subpackages/student/shared/teacher-review-item')>(),
  loadTeacherReviewItem,
}))
vi.mock('../../miniprogram/subpackages/student/services/teacher-media-service', () => ({ getTeacherTaskMediaReviewEvidence }))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
    user: { id: 'teacher_demo', role: 'teacher' } }),
  getTeacherReviewScoreDraft: () => null,
}))

describe('S-09 teacher read-only listening and video evidence', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('renders the current submitted item and rejects mismatched media evidence', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    loadTeacherReviewItem.mockResolvedValue({ ok: true,
      submission: { submissionVersion: 2, answers: [{ itemId: 'media_item', value: { kind: 'listening' } }] },
      item: { id: 'media_item', type: 'listening', title: '虚构听力' } })
    const evidence = { taskId: 'task_demo', assignmentId: 'assignment_demo',
      submissionId: 'submission_demo', submissionVersion: 2, itemId: 'media_item',
      title: '虚构听力', kind: 'listening', mediaVersion: 1, durationMs: 10000,
      sourcePlayback: { available: false, temporaryUrl: null, expiresAt: null },
      questions: [{ questionId: 'q1', questionType: 'single_choice', stem: 'Select one',
        options: ['cat', 'dog'], studentResponse: 'dog', correctAnswer: 'cat', explanation: '',
        isCorrect: false, recorded: true, clip: { segmentId: 'segment_1', startMs: 0, endMs: 5000 } }],
      verifiedPlayedSegmentIds: ['segment_1'], verifiedRanges: [], subtitleCues: [], finalWork: null }
    getTeacherTaskMediaReviewEvidence.mockResolvedValueOnce({ ok: true, data: evidence })
      .mockResolvedValueOnce({ ok: true, data: { ...evidence, itemId: 'another_item' } })
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    if (!definition) throw new Error('S-09 task detail page was not registered')
    const context = { data: { ...definition.data, teacherReviewMode: true,
      teacherReviewRoute: { submissionId: 'submission_demo', itemId: 'media_item' } },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadTeacherReview()
    expect(getTeacherTaskMediaReviewEvidence).toHaveBeenCalledWith('teacher_demo',
      'submission_demo', 'media_item')
    expect(context.data).toMatchObject({ teacherMediaEvidence: { itemId: 'media_item' },
      teacherMediaQuestions: [{ responseLabel: 'dog', correctLabel: 'cat', verdict: '错误' }],
      teacherMediaProgress: '已核对 1 段音频；共 1 题' })
    await context.refreshTeacherMediaEvidence()
    expect(context.data.error).toContain('不一致')
  })
})
