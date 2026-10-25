import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildNativeAdminRecordFilter } from '../../miniprogram/subpackages/admin/admin-page'

interface AdminPageDefinition {
  data: Record<string, unknown>
  methods: Record<string, (this: AdminPageContext, ...args: never[]) => unknown>
}

interface AdminPageContext {
  data: Record<string, unknown>
  setData(value: Record<string, unknown>, done?: () => void): void
  [key: string]: unknown
}

async function makePage(config: { id: string; permission: string; recordKind: string }) {
  let definition: AdminPageDefinition | null = null
  vi.stubGlobal('Component', (value: AdminPageDefinition) => { definition = value })
  vi.stubGlobal('wx', { showToast: vi.fn() })
  const { createNativeAdminPage } = await import('../../miniprogram/subpackages/admin/admin-page')
  createNativeAdminPage({ title: '管理', subtitle: '', filterPlaceholder: '', modules: [],
    dataKind: 'records', ...config } as Parameters<typeof createNativeAdminPage>[0])
  if (!definition) throw new Error('Admin page was not registered')
  const selected = definition as AdminPageDefinition
  const context: AdminPageContext = { data: { ...selected.data, status: 'ready' },
    setData(value, done) { Object.assign(this.data, value); done?.() } }
  Object.assign(context, selected.methods)
  context.loadData = vi.fn()
  context.rememberAdminScroll = vi.fn()
  context.focusAdminPanel = vi.fn()
  return context
}

describe('native admin operation flow', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('does not send blank dates or unrelated filters to record queries', () => {
    const defaults = { query: ' ', status: '', taskType: 'all' as const,
      mediaKind: '' as const, from: '', to: '' }
    expect(buildNativeAdminRecordFilter({ ...defaults, kind: 'questions' })).toEqual({})
    expect(buildNativeAdminRecordFilter({ ...defaults, kind: 'media',
      query: ' video ', mediaKind: 'video' })).toEqual({ query: 'video', mediaKind: 'video' })
  })

  it('restores the complete media list when tapping 全部类型', async () => {
    const page = await makePage({ id: 'A-08', permission: 'media.review', recordKind: 'media' })
    page.data.mediaKindFilter = 'video'
    page.onMediaKindFilter({ currentTarget: { dataset: { kind: 'all' } } })
    expect(page.data.mediaKindFilter).toBe('')
    expect(page.loadData).toHaveBeenCalledWith(false)
  })

  it('keeps a question detail open instead of replacing it with a batch form', async () => {
    const page = await makePage({ id: 'A-06', permission: 'question.manage', recordKind: 'questions' })
    page.data.access = { scope: { organizationWide: true, classIds: [] } }
    page.data.recordRows = [{ id: 'question_demo', kind: 'question', title: '测试题',
      status: 'published', version: 1 }]
    page.data.selectedQuestionIds = ['question_demo']
    page.loadQuestionPreview = vi.fn()
    page.openRecordOperation({ currentTarget: { dataset: { id: 'question_demo' } } })
    expect(page.data.operationDraft).toMatchObject({ id: 'question_demo' })
    page.openQuestionBatch({ currentTarget: { dataset: { status: 'offline' } } })
    expect(page.data.questionBatchDraft).toBeNull()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '请先关闭当前操作', icon: 'none' })
  })

  it('retries media audit without reopening and clearing the current detail', async () => {
    const page = await makePage({ id: 'A-08', permission: 'media.review', recordKind: 'media' })
    page.data.mediaSummary = { id: 'media_demo' }
    page.loadMediaAudit = vi.fn()
    page.retryMediaAudit()
    expect(page.loadMediaAudit).toHaveBeenCalledWith(false)
    expect(page.data.mediaSummary).toMatchObject({ id: 'media_demo' })
  })

  it('blocks blind account creation while the account list cannot load', async () => {
    const page = await makePage({ id: 'A-03', permission: 'user.manage', recordKind: 'users' })
    page.data.dataError = '管理服务与当前页面尚未同步'
    page.openCreateUser()
    expect(page.data.createUserDraft).toBeNull()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '请先读取账号列表', icon: 'none' })
  })

  it('keeps the account draft and names the unavailable onboarding service', async () => {
    const service = await import('../../miniprogram/subpackages/admin/services/native-admin-service')
    const createUser = vi.spyOn(service, 'createNativeAdminUser').mockResolvedValue({
      ok: false, error: { code: 'SERVICE_UNAVAILABLE',
        message: '服务暂不可用，请稍后重试。', retryable: true },
    })
    const page = await makePage({ id: 'A-03', permission: 'user.manage', recordKind: 'users' })
    const draft = { displayName: '虚构验收教师', mobile: '13800000009', role: 'teacher',
      classId: '', reason: '验收开户服务不可用时的输入保留' }
    page.data.createUserDraft = draft
    vi.stubGlobal('wx', { showToast: vi.fn(), getStorageSync: vi.fn(() => ({
      sessionId: 'session_demo_teacher', user: { id: 'teacher_demo', role: 'teacher' },
    })) })

    await page.commitCreateUser()

    expect(createUser).toHaveBeenCalledWith('teacher_demo', draft, expect.any(String))
    expect(page.data.createUserDraft).toEqual(draft)
    expect(page.data.createUserBusy).toBe(false)
    expect(page.data.createUserError).toContain('账号开户服务暂不可用')
    expect(page.data.createUserError).toContain('当前创建结果未确认')
  })

  it('explains duplicate-phone conflicts without clearing the account draft', async () => {
    const service = await import('../../miniprogram/subpackages/admin/services/native-admin-service')
    const createUser = vi.spyOn(service, 'createNativeAdminUser').mockResolvedValue({
      ok: false, error: { code: 'CONFLICT', message: '内容已发生变化，请刷新后重试。', retryable: false },
    })
    const page = await makePage({ id: 'A-03', permission: 'user.manage', recordKind: 'users' })
    const draft = { displayName: '虚构验收教师', mobile: '13800138001', role: 'teacher',
      classId: '', reason: '验收手机号去重提示' }
    page.data.createUserDraft = draft
    vi.stubGlobal('wx', { showToast: vi.fn(), getStorageSync: vi.fn(() => ({
      sessionId: 'session_demo_teacher', user: { id: 'teacher_demo', role: 'teacher' },
    })) })

    await page.commitCreateUser()

    expect(createUser).toHaveBeenCalledOnce()
    expect(page.data.createUserDraft).toEqual(draft)
    expect(page.data.createUserBusy).toBe(false)
    expect(page.data.createUserError).toContain('手机号已注册')
    expect(page.data.createUserError).toContain('搜索现有账号')
  })

  it('uses selected teacher and parent accounts without typing identifiers', async () => {
    const organization = await makePage({ id: 'A-02', permission: 'organization.manage', recordKind: 'questions' })
    organization.data.assignmentDraft = { classId: 'class_demo', teacherId: '',
      permissions: [], expectedVersion: 0, status: 'new', reason: '' }
    organization.data.optionPickerTarget = 'assignmentTeacher'
    organization.data.optionPickerRows = [{ id: 'teacher_demo', label: '虚构教师', detail: 'teacher_demo' }]
    organization.chooseAdminOption({ currentTarget: { dataset: { id: 'teacher_demo' } } })
    expect(organization.data.assignmentDraft).toMatchObject({ teacherId: 'teacher_demo' })
    expect(organization.data.selectionLabels).toMatchObject({ assignmentTeacher: '虚构教师' })

    const users = await makePage({ id: 'A-03', permission: 'user.manage', recordKind: 'questions' })
    users.data.bindingCreateDraft = { parentId: '', studentId: '', reason: '' }
    users.data.optionPickerTarget = 'bindingParent'
    users.data.optionPickerRows = [{ id: 'parent_demo', label: '虚构家长', detail: 'parent_demo' }]
    users.chooseAdminOption({ currentTarget: { dataset: { id: 'parent_demo' } } })
    expect(users.data.bindingCreateDraft).toMatchObject({ parentId: 'parent_demo' })
    expect(users.data.optionPickerTarget).toBe('')
  })

  it('toggles scoped grant classes from a candidate list', async () => {
    const page = await makePage({ id: 'A-04', permission: 'authorization.manage', recordKind: 'questions' })
    const grantDraft = { teacherId: 'other_teacher', status: 'active', permissions: ['dashboard.read'],
      scope: { organizationWide: false, classIds: [] }, expectedUserVersion: 1, reason: '' }
    page.data.grantDraft = grantDraft
    page.data.grantOriginal = grantDraft
    page.data.optionPickerTarget = 'grantClass'
    page.data.optionPickerRows = [{ id: 'class_demo', label: '虚构一班', detail: '3 年级' }]
    page.chooseAdminOption({ currentTarget: { dataset: { id: 'class_demo' } } })
    expect(page.data.grantDraft).toMatchObject({ scope: { classIds: ['class_demo'] } })
    expect(page.data.grantChangeCount).toBe(1)
    page.chooseAdminOption({ currentTarget: { dataset: { id: 'class_demo' } } })
    expect(page.data.grantDraft).toMatchObject({ scope: { classIds: [] } })
  })
})

