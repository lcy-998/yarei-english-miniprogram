import { afterEach, describe, expect, it, vi } from 'vitest'

const getTeacherTaskMediaReviewEvidence = vi.fn()
const setTeacherReviewScoreDraft = vi.fn()
vi.mock('../../miniprogram/subpackages/student-media/services/teacher-media-service', () => ({ getTeacherTaskMediaReviewEvidence }))
vi.mock('../../miniprogram/subpackages/student-media/session/session', () => ({
  getSession: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
    user: { id: 'teacher_demo', role: 'teacher' } }),
  getTeacherReviewScoreDraft: () => null,
  setTeacherReviewScoreDraft,
}))

describe('S-07 teacher read-only task dubbing', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); getTeacherTaskMediaReviewEvidence.mockReset() })

  it('opens only the authorized submitted item and fails closed on mismatched evidence', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown>;
      pageLifetimes: { show: (...args: never[]) => unknown } } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{ options: { teacherReview: '1',
      submissionId: 'submission_1', itemId: 'dubbing_1' } }])
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn() }) })
    const evidence = { taskId: 'task_1', assignmentId: 'assignment_1', submissionId: 'submission_1',
      submissionVersion: 1, itemId: 'dubbing_1', title: '虚构任务配音', kind: 'dubbing',
      mediaVersion: 1, durationMs: 10000,
      sourcePlayback: { available: true, temporaryUrl: 'https://example.invalid/video',
        expiresAt: '2099-01-01T00:00:00Z' }, questions: [], verifiedPlayedSegmentIds: [],
      verifiedRanges: [{ startMs: 0, endMs: 10000 }], subtitleCues: [],
      finalWork: { available: true, durationMs: 2200,
        temporaryUrl: 'https://example.invalid/recording', expiresAt: '2099-01-01T00:00:00Z' } }
    getTeacherTaskMediaReviewEvidence.mockResolvedValueOnce({ ok: true, data: evidence })
      .mockResolvedValueOnce({ ok: true, data: { ...evidence, itemId: 'other' } })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    definition.pageLifetimes.show.call(context)
    await vi.waitFor(() => expect(context.data.teacherEvidence).toMatchObject({
      submissionId: 'submission_1', itemId: 'dubbing_1',
    }))
    expect(getTeacherTaskMediaReviewEvidence).toHaveBeenCalledWith('teacher_demo',
      'submission_1', 'dubbing_1')
    expect(context.data).toMatchObject({ teacherReviewMode: true, taskMode: false,
      teacherEvidence: { submissionId: 'submission_1', itemId: 'dubbing_1' } })
    context.onTeacherReviewScore({ detail: { value: '85' } } as never)
    expect(setTeacherReviewScoreDraft).toHaveBeenCalledWith({
      submissionId: 'submission_1', itemId: 'dubbing_1', input: '85',
    })
    await context.loadMaterials()
    expect(context.data.teacherEvidence).toBeNull()
    expect(context.data.error).toContain('不匹配')
  })
})
