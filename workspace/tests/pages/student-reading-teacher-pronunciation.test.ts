import { afterEach, describe, expect, it, vi } from 'vitest'

const getReviewSubmission = vi.fn()
const getTeacherPronunciationEvidence = vi.fn()
const getSession = vi.fn(() => ({ sessionId: 'session_teacher',
  user: { id: 'teacher_demo', role: 'teacher' }, activeRole: 'teacher' }))
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({ getReviewSubmission }))
vi.mock('../../miniprogram/subpackages/student/services/student-pronunciation-service', () => ({ getTeacherPronunciationEvidence }))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({ getSession }))

interface PageContext {
  data: Record<string, unknown>
  setData(patch: Record<string, unknown>, callback?: () => void): void
  reviewPageSegments(pageNumber: number, segments?: readonly unknown[], evidenceMap?: Record<string, unknown>): unknown[]
  loadTeacherPronunciationEvidence(pageNumber: number): Promise<void>
}

describe('T-08 阅读页显示当前提交的跟读证据', () => {
  afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); getReviewSubmission.mockReset();
    getTeacherPronunciationEvidence.mockReset(); getSession.mockClear() })

  it('按冻结句段读取当前提交评分和试听地址，并显示在原阅读页', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', { createInnerAudioContext: vi.fn(), getStorageSync: vi.fn(), setStorageSync: vi.fn() })
    const segment = { id: 'segment_2', text: 'People at the market are buying fruit.', pageNumber: 2 }
    getReviewSubmission.mockResolvedValue({ ok: true, data: {
      taskId: 'task_demo', assignmentId: 'assignment_demo', submissionId: 'submission_demo',
      submissionVersion: 3, taskTitle: '阅读练习', submittedAt: '2026-10-17T10:00:00.000Z',
      taskItems: [{ id: 'item_reading', title: '绘本', type: 'reading', completionRule: {}, order: 1 }],
      readingPages: [{ itemId: 'item_reading', pageId: 'page_2', pageNumber: 2,
        chapterTitle: '第一章', imageAssetKey: 'https://example.test/page-2',
        thumbnailAssetKey: 'https://example.test/thumb-2' }],
      readingPronunciationSegments: [{ itemId: 'item_reading', segmentId: segment.id,
        text: segment.text, pageNumber: segment.pageNumber }],
      answers: [{ itemId: 'item_reading', value: { verifiedPageEvents: [] } }],
    } })
    getTeacherPronunciationEvidence.mockResolvedValue({ ok: true, data: {
      scoreId: 'score_demo', recordingId: 'recording_demo', status: 'scored', experimental: true,
      score: { total: 88, pronunciation: 90, fluency: 84, completeness: 89 },
      durationMs: 3100, mediaExpired: false,
      playback: { temporaryUrl: 'https://example.test/student-recording.mp3',
        expiresAt: '2026-10-17T10:01:00.000Z' },
    } })
    await import('../../miniprogram/subpackages/student/reading-detail/reading-detail')
    if (!definition) throw new Error('Reading page was not registered')
    const context = { data: { ...definition.data, teacherReviewMode: true,
      teacherReviewRoute: { submissionId: 'submission_demo', itemId: 'item_reading' },
      reading: null, pageSegments: [], reviewPageIndex: 0 },
    setData(patch: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, patch); callback?.() } }
    Object.assign(context, definition.methods)
    await definition.methods.loadTeacherReview.call(context as unknown as PageContext)
    await vi.waitFor(() => expect(getTeacherPronunciationEvidence).toHaveBeenCalledWith('teacher_demo', {
      taskId: 'task_demo', assignmentId: 'assignment_demo', submissionVersion: 3,
      itemId: 'item_reading', segmentId: 'segment_2',
    }))
    await vi.waitFor(() => expect(context.data.pageSegments).toMatchObject([{
      id: 'segment_2', text: segment.text, teacherEvidenceState: 'ready',
      teacherEvidenceStatusLabel: '试验性评分',
      teacherEvidence: { score: { total: 88 }, playback: { temporaryUrl: 'https://example.test/student-recording.mp3' } },
    }]))
  })
})
