import { afterEach, describe, expect, it, vi } from 'vitest'
import { teacherReviewManualScoreRequired } from '../../miniprogram/shared/teacher-review-item'
import { updateManualScoreDraft } from '../../miniprogram/shared/review-task-state'

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
    await import('../../miniprogram/subpackages/teacher/review-task/review-task')
    const { setTeacherReviewScoreDraft, getTeacherReviewScoreDraft } = await import('../../miniprogram/subpackages/teacher/session/session')
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

  it('整份习题的逐题评分返回总览后一起恢复', async () => {
    vi.resetModules()
    let definition: PageDefinition | undefined
    vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
    const storage = new Map<string, unknown>([['yarei_session', { sessionId: 'teacher_session' }]])
    vi.stubGlobal('wx', { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) })
    await import('../../miniprogram/subpackages/teacher/review-task/review-task')
    const session = await import('../../miniprogram/subpackages/teacher/session/session')
    const context: PageContext = { data: { selectedSubmissionId: 'submission_2', viewingHistory: false,
      questionScoreDrafts: {}, manualScoreRows: [
        { id: 'item_a', title: '主观题一', input: '', score: null, error: '' },
        { id: 'item_b', title: '主观题二', input: '', score: null, error: '' },
      ], reviewIntents: {} },
    setData(patch, callback) { Object.assign(this.data, patch); callback?.() }, refreshScorePreview: vi.fn() }
    session.setTeacherReviewScoreDraft({ submissionId: 'submission_2', itemId: 'item_b', input: '75',
      inputs: { item_a: '60', item_b: '75' } })
    definition!.methods.restoreTeacherReviewScoreDraft.call(context)
    expect(context.data.manualScoreRows).toMatchObject([
      { id: 'item_a', score: 60 }, { id: 'item_b', score: 75 },
    ])
  })

  it('更新某一项评分不会触及其他任务项', () => {
    const rows = [{ id: 'first', input: '', score: null, error: '' },
      { id: 'second', input: '80', score: 80, error: '' }]
    expect(updateManualScoreDraft(rows, 'first', '0')).toEqual([
      { id: 'first', input: '0', score: 0, error: '' }, rows[1],
    ])
  })

  it('教师总览与学生原作答分包读取同一份评分草稿', async () => {
    vi.resetModules()
    const storage = new Map<string, unknown>([['yarei_session', { sessionId: 'teacher_session' }]])
    vi.stubGlobal('wx', { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) })
    const teacher = await import('../../miniprogram/subpackages/teacher/session/session')
    const exercise = await import('../../miniprogram/subpackages/student/session/session')
    const video = await import('../../miniprogram/subpackages/student-media/session/session')
    teacher.setTeacherReviewScoreDraft({ submissionId: 'submission_2', itemId: 'item_video',
      input: '', questionInputs: { q_open: '80' } })
    expect(video.getTeacherReviewScoreDraft()?.questionInputs).toEqual({ q_open: '80' })
    exercise.setTeacherReviewScoreDraft({ submissionId: 'submission_2', itemId: 'item_exercise',
      input: '75', inputs: { item_exercise: '75' } })
    expect(teacher.takeTeacherReviewScoreDraft()?.inputs).toEqual({ item_exercise: '75' })
    expect(video.getTeacherReviewScoreDraft()).toBeNull()
  })

  it('切换学生或任务、退出登录时清除尚未回传的跨页分数', async () => {
    vi.resetModules()
    let definition: PageDefinition | undefined
    vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
    vi.stubGlobal('wx', { removeStorageSync: vi.fn(),
      showModal: ({ success }: { success: (result: { confirm: boolean }) => void }) => success({ confirm: true }) })
    await import('../../miniprogram/subpackages/teacher/review-task/review-task')
    const session = await import('../../miniprogram/subpackages/teacher/session/session')
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

  it('系统自动分尚未修改时切换作业不提示放弃评分草稿', async () => {
    vi.resetModules()
    let definition: PageDefinition | undefined
    vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
    const showModal = vi.fn()
    vi.stubGlobal('wx', { showModal })
    await import('../../miniprogram/subpackages/teacher/review-task/review-task')
    const next = vi.fn()
    const context: PageContext = { data: { reviewingId: '', comment: '', score: 75,
      automaticScore: 75, scoreInput: '75', overrideReason: '', manualScoreRows: [], voiceState: 'idle' },
    setData(patch) { Object.assign(this.data, patch) } }
    definition!.methods.confirmDraftSwitch.call(context, next)
    expect(showModal).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledOnce()
  })

  it('S-09 教师只读态只记录教师分数草稿，学生态不写入该草稿', async () => {
    vi.resetModules()
    let definition: PageDefinition | undefined
    vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
    await import('../../miniprogram/subpackages/student/task-detail/task-detail')
    const session = await import('../../miniprogram/subpackages/student/session/session')
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
