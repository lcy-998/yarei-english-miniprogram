import { afterEach, describe, expect, it, vi } from 'vitest'

describe('T-06 scoring weight submission gate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the draft and rejects publication when edited weights do not total 100%', async () => {
    let buildCommand: ((mode: 'publish' | 'draft') => unknown) | null = null
    vi.stubGlobal('Component', (definition: { methods: { buildCommand: (mode: 'publish' | 'draft') => unknown } }) => {
      buildCommand = definition.methods.buildCommand
    })
    vi.stubGlobal('wx', { getStorageSync: () => ({ user: { id: 'teacher_demo' } }) })
    await import('../../miniprogram/pages/teacher/publish-task/publish-task')
    if (buildCommand === null) throw new Error('Publish handler was not registered')
    const context = { data: {
      loading: false, optionsLoading: false, editingStatus: '', requestedStudentId: '',
      targetMode: 'classes', targetClasses: [{ id: 'class_demo', name: '虚构班级', selected: true }],
      targetStudents: [{ studentId: 'student_demo', displayName: '虚构学员',
        classInfo: { id: 'class_demo' }, selected: false }],
      draftOptions: { structuredDraft: { items: [
        { id: 'read', resourceId: 'book_demo', type: 'reading', requiredCount: 1, maxScore: 100, weightPercent: 60 },
        { id: 'quiz', resourceId: 'quiz_demo', type: 'exercise', requiredCount: 1, maxScore: 100, weightPercent: 50 },
      ] } }, weightError: '',
    }, setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    expect(buildCommand.call(context, 'publish')).toBeNull()
    expect(context.data).toHaveProperty('error', '计分权重合计须为 100%，当前为 110%')
    expect(context.data.draftOptions.structuredDraft.items).toHaveLength(2)
  })
})
