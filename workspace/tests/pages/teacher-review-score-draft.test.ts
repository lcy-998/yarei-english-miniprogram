import { afterEach, describe, expect, it, vi } from 'vitest'
import { teacherReviewManualScoreRequired } from '../../miniprogram/shared/teacher-review-item'
import { updateManualScoreDraft } from '../../miniprogram/pages/teacher/review-task/review-task-state'

interface PageDefinition {
  methods: Record<string, (this: PageContext, argument?: unknown) => unknown>
}
interface PageContext {
  data: Record<string, unknown>
  setData(patch: Record<string, unknown>, callback?: () => void): void
  refreshScorePreview?(): void
}

describe('教师在学生原作答页记录逐项评分草稿', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('仅对已作答且需要人工评分的任务项显示输入', () => {
    const submission = { answers: [{ itemId: 'recording' }, { itemId: 'subjective' }],
      scoringItems: [{ itemId: 'recording', teacherScoreRequired: true },
        { itemId: 'subjective', teacherScoreRequired: true }] } as unknown as Parameters<typeof teacherReviewManualScoreRequired>[0]
    const recording = { id: 'recording', type: 'recording' } as Parameters<typeof teacherReviewManualScoreRequired>[1]
    const subjective = { id: 'subjective', type: 'exercise' } as Parameters<typeof teacherReviewManualScoreRequired>[1]
    const unsubmitted = { id: 'other', type: 'recording' } as Parameters<typeof teacherReviewManualScoreRequired>[1]
    expect(teacherReviewManualScoreRequired(submission, recording)).toBe(true)
    expect(teacherReviewManualScoreRequired(submission, subjective)).toBe(true)
    expect(teacherReviewManualScoreRequired(submission, unsubmitted)).toBe(false)
    expect(teacherReviewManualScoreRequired({ ...submission, scoringItems: [{ itemId: 'subjective', teacherScoreRequired: false }] }, subjective)).toBe(false)
  })

  it('返回 T-08 时只恢复当前提交对应项目，并保留非法输入供教师改正', async () => {
    vi.resetModules()
    let definition: PageDefinition | undefined
    vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
    await import('../../miniprogram/pages/teacher/review-task/review-task')
    const { setTeacherReviewScoreDraft, getTeacherReviewScoreDraft } = await import('../../miniprogram/session/session')
    const rows = [{ id: 'recording', title: '朗读', input: '', score: null, error: '' }]
    const context: PageContext = { data: { selectedSubmissionId: 'submission_2', viewingHistory: false,
      manualScoreRows: rows, reviewIntents: { old: 'pending' } },
    setData(patch, callback) { Object.assign(this.data, patch); callback?.() }, refreshScorePreview: vi.fn() }
    setTeacherReviewScoreDraft({ submissionId: 'submission_1', itemId: 'recording', input: '75' })
    definition!.methods.restoreTeacherReviewScoreDraft.call(context)
    expect(context.data.manualScoreRows).toEqual(rows)
    expect(getTeacherReviewScoreDraft()?.submissionId).toBe('submission_1')
    setTeacherReviewScoreDraft({ submissionId: 'submission_2', itemId: 'recording', input: '101' })
    definition!.methods.restoreTeacherReviewScoreDraft.call(context)
    expect(context.data.manualScoreRows).toEqual([{ ...rows[0], input: '101', score: null,
      error: '请输入 0 到 100 的整数分数' }])
    expect(context.refreshScorePreview).toHaveBeenCalledOnce()
    expect(getTeacherReviewScoreDraft()).toBeNull()
    expect(context.data.reviewIntents).toEqual({})
  })

  it('更新某一项评分不会触及其他任务项', () => {
    const rows = [{ id: 'first', input: '', score: null, error: '' },
      { id: 'second', input: '80', score: 80, error: '' }]
    expect(updateManualScoreDraft(rows, 'first', '0')).toEqual([
      { id: 'first', input: '0', score: 0, error: '' }, rows[1],
    ])
  })

  it('切换学生或任务、退出登录时清除尚未回传的跨页分数', async () => {
    vi.resetModules()
    let definition: PageDefinition | undefined
    vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
    vi.stubGlobal('wx', { removeStorageSync: vi.fn() })
    await import('../../miniprogram/pages/teacher/review-task/review-task')
    const session = await import('../../miniprogram/session/session')
    session.setTeacherReviewScoreDraft({ submissionId: 'submission_A', itemId: 'recording', input: '73' })
    const next = vi.fn()
    const context: PageContext = { data: { reviewingId: '', comment: '', scoreInput: '', overrideReason: '',
      manualScoreRows: [] }, setData(patch) { Object.assign(this.data, patch) } }
    definition!.methods.confirmDraftSwitch.call(context, next)
    expect(next).toHaveBeenCalledOnce()
    expect(session.getTeacherReviewScoreDraft()).toBeNull()
    session.setTeacherReviewScoreDraft({ submissionId: 'submission_B', itemId: 'recording', input: '66' })
    session.clearSession()
    expect(session.getTeacherReviewScoreDraft()).toBeNull()
  })

  it('S-09 教师只读态只记录教师分数草稿，学生态不写入该草稿', async () => {
    vi.resetModules()
    let definition: PageDefinition | undefined
    vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
    await import('../../miniprogram/pages/student/task-detail/task-detail')
    const session = await import('../../miniprogram/session/session')
    const context: PageContext = { data: { teacherReviewMode: true, teacherManualScoreRequired: true,
      teacherReviewRoute: { submissionId: 'submission_A', itemId: 'recording' } },
    setData(patch) { Object.assign(this.data, patch) } }
    definition!.methods.onTeacherReviewScore.call(context, { detail: { value: '82' } })
    expect(session.getTeacherReviewScoreDraft()).toEqual({ submissionId: 'submission_A', itemId: 'recording', input: '82' })
    expect(context.data).toMatchObject({ teacherScoreInput: '82', teacherScoreError: '' })
    context.data.teacherReviewMode = false
    definition!.methods.onTeacherReviewScore.call(context, { detail: { value: '47' } })
    expect(session.getTeacherReviewScoreDraft()?.input).toBe('82')
  })
})
