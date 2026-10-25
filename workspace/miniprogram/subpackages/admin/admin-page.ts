import type { NativeAdminAccessView, NativeAdminClassPageView, NativeAdminGrantPageView,
  NativeAdminGrantCandidatePageView,
  NativeAdminGrantInput, NativeAdminOverviewView, NativeAdminPermission, NativeAdminRecordKind,
  NativeAdminRecordFilter, NativeAdminAuditPageView,
  NativeAdminRecordPageView, NativeAdminUserPageView, NativeAdminTeacherClassPermission,
  NativeAdminSelectionKind, NativeAdminSelectionPageView,
  SetNativeQuestionBatchStatusInput, NativeAdminQuestionPreviewView, NativeAdminUserBindingsView,
  CreateNativeAdminClassInput, UpdateNativeAdminUserInput,
  NativeAdminMediaReviewSummaryView,
  NativeAdminOrganizationView, NativeAdminUserRoleFilter,
  NativeAdminMediaPreviewView, NativeAdminMediaAuditPageView,
  CreateNativeAdminUserInput } from '../../domain/native-admin'
import { getNativeAdminAccess, getNativeAdminOverview, listNativeAdminClasses,
  getNativeAdminOrganization, updateNativeAdminOrganization, bindNativeAdminParentLink,
  createNativeAdminUser,
  listNativeAdminGrants, listNativeAdminGrantCandidates,
  listNativeAdminAudit, listNativeAdminRecords, listNativeAdminUsers, setNativeAdminGrant,
  listNativeAdminSelectionOptions,
  createNativeAdminClass, updateNativeAdminClass, archiveNativeAdminClass, assignNativeAdminTeacher,
  revokeNativeAdminTeacher,
  updateNativeAdminUser, disableNativeAdminUser, unbindNativeAdminUser,
  getNativeAdminUserBindings,
  saveNativeTextbookConfig, setNativeTextbookConfigStatus, setNativeQuestionStatus,
  setNativeQuestionBatchStatus, stopNativeManaged,
  exportNativeAdminRecords, getNativeAdminMediaReview,
  getNativeAdminQuestionPreview,
  unpublishNativeAdminMedia,
  getNativeAdminMediaPreview, listNativeAdminMediaAudit,
  reportNativeAdminMediaIssue } from './services/native-admin-service'
import { getSession } from './session/session'
import { EMPTY_WRITE_INTENT, createPageOperationId, prepareWriteIntent,
  type WriteIntentState } from './shared/write-intent'

let adminMediaAudio: ReturnType<typeof wx.createInnerAudioContext> | null = null
let adminMediaClipEndMs = 0
let adminMediaClipStartMs: number | null = null

function stopAdminMediaAudio(): void {
  if (!adminMediaAudio) return
  adminMediaAudio.stop()
  adminMediaAudio.destroy()
  adminMediaAudio = null
  adminMediaClipEndMs = 0
  adminMediaClipStartMs = null
}

const GRANT_PERMISSION_OPTIONS: Array<{ value: NativeAdminPermission; label: string }> = [
  { value: 'dashboard.read', label: '工作台' }, { value: 'organization.manage', label: '学校班级' },
  { value: 'user.manage', label: '用户' }, { value: 'authorization.manage', label: '权限' },
  { value: 'question.manage', label: '习题' }, { value: 'media.review', label: '音视频素材' },
]
const TEACHER_CLASS_OPTIONS: Array<{ value: NativeAdminTeacherClassPermission; label: string }> = [
  { value: 'class.read', label: '查看班级' }, { value: 'student.read', label: '查看学员' },
  { value: 'student.manage', label: '管理学员' }, { value: 'content.read', label: '查看内容' },
  { value: 'task.read', label: '查看任务' }, { value: 'task.publish', label: '发布任务' },
  { value: 'submission.review', label: '检查作业' }, { value: 'student.import', label: '批量导入' },
  { value: 'media.upload', label: '上传媒体' },
]

function grantPermissionOptions(access: NativeAdminAccessView | null,
  selected: readonly NativeAdminPermission[]) {
  return GRANT_PERMISSION_OPTIONS.map(option => ({ ...option,
    selected: selected.includes(option.value), enabled: access?.permissions.includes(option.value) ?? false }))
}

function grantChangeCount(draft: NativeAdminGrantInput | null,
  original: NativeAdminGrantInput | null): number {
  if (!draft || !original) return 0
  const changedPermissions = new Set([...draft.permissions, ...original.permissions])
  let count = [...changedPermissions].filter(permission =>
    draft.permissions.includes(permission) !== original.permissions.includes(permission)).length
  if (draft.scope.organizationWide !== original.scope.organizationWide) count += 1
  const changedClasses = new Set([...draft.scope.classIds, ...original.scope.classIds])
  count += [...changedClasses].filter(classId =>
    draft.scope.classIds.includes(classId) !== original.scope.classIds.includes(classId)).length
  return count
}

function auditActionLabel(action: string): string {
  const labels: Readonly<Record<string, string>> = {
    'native_admin.granted': '授予管理权限',
    'native_admin.revoked': '撤销管理权限',
    'native_admin.teacher.assigned': '分配班级教师',
    'native_admin.teacher.assignment_revoked': '撤销班级教师',
    'native_admin.teacher.granted': '授予班级权限',
  }
  return labels[action] ?? '权限变更'
}

function adminReadErrorMessage(error: { code: string; message: string }, defaultQuery: boolean): string {
  return error.code === 'VALIDATION_ERROR' && defaultQuery
    ? '管理服务与当前页面尚未同步，暂时无法读取；请联系维护人员。'
    : error.message
}

function defaultOverviewRange(): Readonly<{ from: string; to: string }> {
  const to = new Date()
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 6)
  const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { from: format(from), to: format(to) }
}

export function buildNativeAdminRecordFilter(input: Readonly<{
  kind: NativeAdminRecordKind | undefined; query: string; status: string;
  taskType: 'all' | 'classroom' | 'activity';
  mediaKind: '' | 'listening' | 'video' | 'dubbing'; from: string; to: string;
}>): NativeAdminRecordFilter {
  const query = input.query.trim()
  return {
    ...(query ? { query } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.kind === 'tasks' && input.taskType !== 'all' ? { taskType: input.taskType } : {}),
    ...(input.kind === 'media' && input.mediaKind ? { mediaKind: input.mediaKind } : {}),
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
  }
}

export interface NativeAdminModule {
  id: string
  title: string
  description: string
  route?: string
  permission?: NativeAdminPermission
}

export interface NativeAdminPageConfig {
  id: string
  title: string
  subtitle: string
  permission: NativeAdminPermission
  filterPlaceholder: string
  modules: NativeAdminModule[]
  dataKind?: 'overview' | 'classes' | 'users' | 'grants' | 'records'
  recordKind?: NativeAdminRecordKind
}

/** Each page checks the current server grant again, including after a return from another page. */
export function createNativeAdminPage(config: NativeAdminPageConfig): void {
  Component({
    data: {
      pageId: config.id, title: config.title, subtitle: config.subtitle,
      filterPlaceholder: config.filterPlaceholder, modules: config.modules,
      filteredModules: config.modules, keyword: '',
      access: null as NativeAdminAccessView | null,
      status: 'loading' as 'loading' | 'ready' | 'forbidden' | 'error',
      error: '', scopeLabel: '', dataLoading: false, dataError: '',
      overview: null as NativeAdminOverviewView | null,
      overviewFromDate: config.id === 'A-01' ? defaultOverviewRange().from : '',
      overviewToDate: config.id === 'A-01' ? defaultOverviewRange().to : '',
      classRows: [] as NativeAdminClassPageView['items'],
      organization: null as NativeAdminOrganizationView | null,
      organizationDraft: null as { name: string; reason: string } | null,
      organizationBusy: false, organizationError: '', organizationIntent: EMPTY_WRITE_INTENT as WriteIntentState,
      userRows: [] as NativeAdminUserPageView['items'],
      userRoleFilter: '' as NativeAdminUserRoleFilter,
      bindingCreateDraft: null as { parentId: string; studentId: string; reason: string } | null,
      bindingCreateBusy: false, bindingCreateError: '',
      bindingCreateIntent: EMPTY_WRITE_INTENT as WriteIntentState,
      grantRows: [] as NativeAdminGrantPageView['items'],
      grantCandidateRows: [] as NativeAdminGrantCandidatePageView['items'],
      grantCandidateLoading: false, grantCandidateError: '',
      grantCandidateNextOffset: null as number | null,
      grantCandidateRequestVersion: 0,
      recordRows: [] as Array<NativeAdminRecordPageView['items'][number] & { selected?: boolean }>,
      selectedQuestionIds: [] as string[],
      questionBatchDraft: null as { status: 'published' | 'offline'; reason: string } | null,
      questionBatchBusy: false, questionBatchError: '', questionBatchIntent: EMPTY_WRITE_INTENT as WriteIntentState,
      auditRows: [] as Array<NativeAdminAuditPageView['items'][number] & { actionLabel: string }>,
      auditNextOffset: null as number | null,
      auditLoading: false, auditError: '',
      statusFilter: '', taskTypeFilter: 'all' as 'all' | 'classroom' | 'activity',
      mediaKindFilter: '' as '' | 'listening' | 'video' | 'dubbing',
      fromDate: '', toDate: '',
      nextOffset: null as number | null, selectedClassId: '',
      requestVersion: 0,
      adminReturnScrollTop: 0,
      optionPickerKind: '' as '' | NativeAdminSelectionKind,
      optionPickerTarget: '' as '' | 'assignmentTeacher' | 'createUserClass'
        | 'bindingParent' | 'bindingStudent' | 'grantClass',
      optionPickerClassId: '', optionPickerQuery: '',
      optionPickerRows: [] as NativeAdminSelectionPageView['items'],
      optionPickerNextOffset: null as number | null,
      optionPickerLoading: false, optionPickerError: '', optionPickerRequestVersion: 0,
      selectionOptionsUnavailable: false,
      selectionLabels: { assignmentTeacher: '', createUserClass: '',
        bindingParent: '', bindingStudent: '' },
      grantPermissionOptions: grantPermissionOptions(null, []),
      grantDraft: null as NativeAdminGrantInput | null,
      grantOriginal: null as NativeAdminGrantInput | null,
      grantChangeCount: 0,
      grantExpectedVersion: 0, grantScopeText: '', grantError: '', grantBusy: false,
      grantIntent: EMPTY_WRITE_INTENT as WriteIntentState,
      classDraft: null as { classId: string; name: string; gradeText: string; term: string;
        reason: string; expectedVersion: number } | null,
      classBusy: false, classError: '', classIntent: EMPTY_WRITE_INTENT as WriteIntentState,
      classArchiveDraft: null as { classId: string; name: string; expectedVersion: number;
        studentCount: number | null; destinationClassId: string; destinationVersion: number | null; reason: string } | null,
      classArchiveBusy: false, classArchiveError: '', classArchiveIntent: EMPTY_WRITE_INTENT as WriteIntentState,
      assignmentDraft: null as { classId: string; teacherId: string;
        permissions: NativeAdminTeacherClassPermission[]; expectedVersion: number;
        status: 'new' | 'active' | 'revoked'; reason: string } | null,
      assignmentBusy: false, assignmentError: '', assignmentIntent: EMPTY_WRITE_INTENT as WriteIntentState,
      teacherClassOptions: TEACHER_CLASS_OPTIONS.map(item => ({ ...item, selected: false })),
      userDraft: null as { userId: string; displayName: string; reason: string;
        expectedVersion: number; status: 'active' | 'disabled' } | null,
      userBusy: false, userError: '', userIntent: EMPTY_WRITE_INTENT as WriteIntentState,
      createUserDraft: null as CreateNativeAdminUserInput | null,
      createUserBusy: false, createUserError: '', createUserIntent: EMPTY_WRITE_INTENT as WriteIntentState,
      bindingUserId: '', bindingRows: [] as NativeAdminUserBindingsView['items'],
      bindingBusy: false, bindingError: '',
      unbindDraft: null as { linkId: string; version: number; parentName: string;
        studentName: string; reason: string } | null,
      unbindBusy: false, unbindError: '', unbindIntent: EMPTY_WRITE_INTENT as WriteIntentState,
      operationDraft: null as { id: string; kind: 'textbook' | 'question' | 'classroom' | 'activity';
        title: string; status: string; version: number; classIdsText: string;
        organizationWide: boolean; reason: string } | null,
      operationBusy: false, operationError: '', operationIntent: EMPTY_WRITE_INTENT as WriteIntentState,
      questionPreview: null as NativeAdminQuestionPreviewView | null,
      questionPreviewLoading: false, questionPreviewError: '',
      exportBusy: false, exportError: '',
      mediaSummary: null as NativeAdminMediaReviewSummaryView | null,
      mediaLoading: false, mediaError: '', mediaReason: '', mediaBusy: false,
      mediaCanApprove: false, mediaIntent: EMPTY_WRITE_INTENT as WriteIntentState,
      mediaPreview: null as NativeAdminMediaPreviewView | null,
      mediaPreviewLoading: false, mediaPreviewError: '',
      mediaAuditRows: [] as NativeAdminMediaAuditPageView['items'],
      mediaAuditNextOffset: null as number | null,
      mediaAuditLoading: false, mediaAuditError: '',
    },
    lifetimes: { attached() { this.reload() }, detached() { stopAdminMediaAudio() } },
    pageLifetimes: { show() { this.reload() }, hide() { this.stopMediaPreview() } },
    methods: {
      rememberAdminScroll() {
        wx.createSelectorQuery().selectViewport().scrollOffset(position => {
          if (position && Number.isFinite(position.scrollTop)) {
            this.setData({ adminReturnScrollTop: position.scrollTop })
          }
        }).exec()
      },
      focusAdminPanel(id: string) {
        wx.nextTick(() => {
          wx.createSelectorQuery().in(this).select(`#${id}`).boundingClientRect(rect => {
            if (!rect) return
            wx.createSelectorQuery().selectViewport().scrollOffset(position => {
              if (!position) return
              wx.pageScrollTo({ scrollTop: Math.max(0, position.scrollTop + rect.top - 72),
                duration: 180 })
            }).exec()
          }).exec()
        })
      },
      restoreAdminScroll() {
        const scrollTop = this.data.adminReturnScrollTop
        wx.nextTick(() => wx.pageScrollTo({ scrollTop, duration: 180 }))
      },
      openAdminOptionPicker(event: WechatMiniprogram.TouchEvent) {
        const kind = event.currentTarget.dataset.kind as NativeAdminSelectionKind
        const target = event.currentTarget.dataset.target as typeof this.data.optionPickerTarget
        const allowed = [
          ['A-02', 'teacher_for_class', 'assignmentTeacher', Boolean(this.data.assignmentDraft)
            && this.data.assignmentDraft?.expectedVersion === 0],
          ['A-03', 'class_for_user', 'createUserClass', Boolean(this.data.createUserDraft)
            && this.data.createUserDraft?.role === 'student'],
          ['A-03', 'parent_for_binding', 'bindingParent', Boolean(this.data.bindingCreateDraft)],
          ['A-03', 'student_for_binding', 'bindingStudent', Boolean(this.data.bindingCreateDraft)],
          ['A-04', 'class_for_grant', 'grantClass', Boolean(this.data.grantDraft)
            && !this.data.grantDraft?.scope.organizationWide],
        ].some(([pageId, allowedKind, allowedTarget, enabled]) => pageId === config.id
          && allowedKind === kind && allowedTarget === target && enabled)
        if (!allowed) return
        const classId = kind === 'teacher_for_class' ? this.data.assignmentDraft?.classId ?? ''
          : kind === 'parent_for_binding' || kind === 'student_for_binding'
            ? this.data.selectedClassId : ''
        this.setData({ optionPickerKind: kind, optionPickerTarget: target,
          optionPickerClassId: classId, optionPickerQuery: '', optionPickerRows: [],
          optionPickerNextOffset: null, optionPickerError: '' },
        () => this.loadAdminOptionPicker(false))
      },
      closeAdminOptionPicker() {
        this.setData({ optionPickerKind: '', optionPickerTarget: '', optionPickerRows: [],
          optionPickerNextOffset: null, optionPickerError: '',
          optionPickerRequestVersion: this.data.optionPickerRequestVersion + 1 })
      },
      onAdminOptionQuery(event: WechatMiniprogram.Input) {
        this.setData({ optionPickerQuery: event.detail.value })
      },
      applyAdminOptionSearch() {
        if (!this.data.optionPickerKind) return
        this.setData({ optionPickerRows: [], optionPickerNextOffset: null },
          () => this.loadAdminOptionPicker(false))
      },
      loadMoreAdminOptions() { this.loadAdminOptionPicker(true) },
      async loadAdminOptionPicker(append = false) {
        const kind = this.data.optionPickerKind
        const session = getSession()
        if (!kind || !session || session.user.role !== 'teacher'
          || append && (this.data.optionPickerLoading || this.data.optionPickerNextOffset === null)) return
        const requestVersion = this.data.optionPickerRequestVersion + 1
        const offset = append ? this.data.optionPickerNextOffset ?? 0 : 0
        this.setData({ optionPickerLoading: true, optionPickerError: '',
          optionPickerRequestVersion: requestVersion })
        const result = await listNativeAdminSelectionOptions(session.user.id, kind,
          this.data.optionPickerClassId, 20, offset, this.data.optionPickerQuery.trim())
        if (getSession()?.user.id !== session.user.id || this.data.optionPickerKind !== kind
          || this.data.optionPickerRequestVersion !== requestVersion) return
        if (!result.ok) {
          const unavailable = result.error.code === 'VALIDATION_ERROR'
            || result.error.code === 'SERVICE_UNAVAILABLE'
          this.setData({ optionPickerLoading: false,
            optionPickerError: unavailable
              ? '候选名单暂不可用；可暂时输入编号。' : result.error.message,
            selectionOptionsUnavailable: this.data.selectionOptionsUnavailable || unavailable },
            () => this.focusAdminPanel('admin-option-picker'))
          return
        }
        const rows = result.data.items.map(item => ({ ...item,
          selected: this.data.optionPickerTarget === 'grantClass'
            && (this.data.grantDraft?.scope.classIds.includes(item.id) ?? false) }))
        this.setData({ optionPickerLoading: false,
          optionPickerRows: append ? [...this.data.optionPickerRows, ...rows] : rows,
          optionPickerNextOffset: result.data.nextOffset },
        () => { if (!append) this.focusAdminPanel('admin-option-picker') })
      },
      chooseAdminOption(event: WechatMiniprogram.TouchEvent) {
        const selected = this.data.optionPickerRows.find(item => item.id === event.currentTarget.dataset.id)
        if (!selected) return
        const target = this.data.optionPickerTarget
        if (target === 'assignmentTeacher' && this.data.assignmentDraft && !this.data.assignmentBusy) {
          this.setData({ assignmentDraft: { ...this.data.assignmentDraft, teacherId: selected.id },
            selectionLabels: { ...this.data.selectionLabels, assignmentTeacher: selected.label },
            assignmentIntent: EMPTY_WRITE_INTENT })
        } else if (target === 'createUserClass' && this.data.createUserDraft && !this.data.createUserBusy) {
          this.setData({ createUserDraft: { ...this.data.createUserDraft, classId: selected.id },
            selectionLabels: { ...this.data.selectionLabels, createUserClass: selected.label },
            createUserIntent: EMPTY_WRITE_INTENT })
        } else if (target === 'bindingParent' && this.data.bindingCreateDraft && !this.data.bindingCreateBusy) {
          this.setData({ bindingCreateDraft: { ...this.data.bindingCreateDraft, parentId: selected.id },
            selectionLabels: { ...this.data.selectionLabels, bindingParent: selected.label },
            bindingCreateIntent: EMPTY_WRITE_INTENT })
        } else if (target === 'bindingStudent' && this.data.bindingCreateDraft && !this.data.bindingCreateBusy) {
          this.setData({ bindingCreateDraft: { ...this.data.bindingCreateDraft, studentId: selected.id },
            selectionLabels: { ...this.data.selectionLabels, bindingStudent: selected.label },
            bindingCreateIntent: EMPTY_WRITE_INTENT })
        } else if (target === 'grantClass' && this.data.grantDraft && !this.data.grantBusy) {
          const classIds = new Set(this.data.grantDraft.scope.classIds)
          if (classIds.has(selected.id)) classIds.delete(selected.id)
          else classIds.add(selected.id)
          const draft = { ...this.data.grantDraft, scope: {
            organizationWide: false, classIds: [...classIds] } }
          this.setData({ grantDraft: draft, grantScopeText: [...classIds].join('、'),
            grantChangeCount: grantChangeCount(draft, this.data.grantOriginal),
            grantIntent: EMPTY_WRITE_INTENT,
            optionPickerRows: this.data.optionPickerRows.map(item => ({ ...item,
              selected: classIds.has(item.id) })) })
          return
        } else return
        this.closeAdminOptionPicker()
      },
      canOpenAdminPanel() {
        if (this.data.organizationDraft || this.data.classDraft || this.data.classArchiveDraft
          || this.data.assignmentDraft || this.data.userDraft || this.data.createUserDraft
          || this.data.bindingCreateDraft || this.data.bindingUserId || this.data.grantDraft
          || this.data.operationDraft || this.data.questionBatchDraft || this.data.mediaSummary) {
          wx.showToast({ title: '请先关闭当前操作', icon: 'none' })
          return false
        }
        return true
      },
      async reload() {
        const requestVersion = this.data.requestVersion + 1
        const session = getSession()
        if (!session || session.user.role !== 'teacher') {
          this.setData({ status: 'forbidden', access: null, error: '', overview: null,
            classRows: [], userRows: [], grantRows: [], recordRows: [], requestVersion })
          return
        }
        this.setData({ status: 'loading', error: '', requestVersion })
        const result = await getNativeAdminAccess(session.user.id)
        if (this.data.requestVersion !== requestVersion) return
        if (!result.ok) {
          this.setData({ status: result.error.code === 'FORBIDDEN' ? 'forbidden' : 'error',
            access: null, error: result.error.message,
            overview: null, classRows: [], userRows: [],
            grantRows: [], recordRows: [] })
          return
        }
        if (!result.data.permissions.includes(config.permission)) {
          this.setData({ status: 'forbidden', access: null,
            error: '', overview: null,
            classRows: [], userRows: [], grantRows: [], recordRows: [] })
          return
        }
        const scopeLabel = result.data.scope.organizationWide ? '当前组织全部授权班级'
          : `已授权 ${result.data.scope.classIds.length} 个班级`
        this.setData({ status: 'ready', access: result.data, scopeLabel,
          selectionOptionsUnavailable: false,
          filteredModules: config.modules.filter(module => !module.permission
            || result.data.permissions.includes(module.permission)),
          selectedClassId: result.data.scope.organizationWide ? ''
            : this.data.selectedClassId && result.data.scope.classIds.includes(this.data.selectedClassId)
              ? this.data.selectedClassId : result.data.scope.classIds[0] ?? '' },
        () => {
          this.loadData(false)
          if (config.id === 'A-02') this.loadOrganization()
          if (config.id === 'A-04') {
            this.loadGrantCandidates(false)
            this.loadAudit(false)
          }
        })
      },
      async loadGrantCandidates(append = false) {
        const session = getSession()
        if (config.id !== 'A-04' || this.data.status !== 'ready'
          || !session || session.user.role !== 'teacher' || append && this.data.grantCandidateLoading
          || append && this.data.grantCandidateNextOffset === null) return
        const requestVersion = this.data.grantCandidateRequestVersion + 1
        this.setData({ grantCandidateLoading: true, grantCandidateError: '',
          grantCandidateRequestVersion: requestVersion })
        const offset = append ? this.data.grantCandidateNextOffset ?? 0 : 0
        const result = await listNativeAdminGrantCandidates(session.user.id, 20, offset,
          this.data.keyword.trim())
        if (getSession()?.user.id !== session.user.id || this.data.status !== 'ready'
          || this.data.grantCandidateRequestVersion !== requestVersion) return
        if (!result.ok) {
          this.setData({ grantCandidateLoading: false,
            grantCandidateError: adminReadErrorMessage(result.error, !this.data.keyword.trim()) }); return
        }
        this.setData({ grantCandidateLoading: false,
          grantCandidateRows: append ? [...this.data.grantCandidateRows, ...result.data.items] : result.data.items,
          grantCandidateNextOffset: result.data.nextOffset })
      },
      loadMoreGrantCandidates() { this.loadGrantCandidates(true) },
      async loadOrganization() {
        const session = getSession()
        if (config.id !== 'A-02' || !session || session.user.role !== 'teacher'
          || this.data.status !== 'ready') return
        this.setData({ organizationError: '' })
        const result = await getNativeAdminOrganization(session.user.id)
        if (getSession()?.user.id !== session.user.id || this.data.status !== 'ready') return
        if (!result.ok) {
          this.setData({ organization: null,
            organizationError: adminReadErrorMessage(result.error, true) }); return
        }
        this.setData({ organization: result.data, organizationError: '' })
      },
      openOrganizationEdit() {
        if (config.id !== 'A-02' || !this.data.organization
          || !this.data.access?.scope.organizationWide || !this.canOpenAdminPanel()) return
        this.rememberAdminScroll()
        this.setData({ organizationDraft: { name: this.data.organization.name, reason: '' },
          organizationError: '', organizationIntent: EMPTY_WRITE_INTENT },
        () => this.focusAdminPanel('admin-organization-form'))
      },
      onOrganizationField(event: WechatMiniprogram.Input) {
        const draft = this.data.organizationDraft
        const field = event.currentTarget.dataset.field as 'name' | 'reason'
        if (!draft || this.data.organizationBusy || field !== 'name' && field !== 'reason') return
        this.setData({ organizationDraft: { ...draft, [field]: event.detail.value },
          organizationIntent: EMPTY_WRITE_INTENT })
      },
      closeOrganizationDraft() {
        if (!this.data.organizationBusy) this.setData({ organizationDraft: null, organizationError: '' },
          () => this.restoreAdminScroll())
      },
      requestOrganizationSave() {
        const draft = this.data.organizationDraft
        if (!draft || this.data.organizationBusy) return
        if (!draft.name.trim() || draft.name.trim().length > 50
          || !draft.reason.trim() || draft.reason.trim().length > 200) {
          this.setData({ organizationError: '请填写学校名称和 1—200 字修改原因' }); return
        }
        wx.showModal({ title: '确认修改学校名称？', content: `${draft.name.trim()}\n原因：${draft.reason.trim()}`,
          success: result => { if (result.confirm) this.commitOrganizationSave() } })
      },
      async commitOrganizationSave() {
        const session = getSession()
        const draft = this.data.organizationDraft
        const current = this.data.organization
        if (!session || session.user.role !== 'teacher' || !draft || !current
          || this.data.organizationBusy) return
        const input = { name: draft.name.trim(), reason: draft.reason.trim() }
        const intent = prepareWriteIntent(this.data.organizationIntent,
          JSON.stringify([input, current.version]), () => createPageOperationId('native_organization'))
        this.setData({ organizationBusy: true, organizationError: '', organizationIntent: intent })
        const result = await updateNativeAdminOrganization(session.user.id, input,
          current.version, intent.operationId)
        if (getSession()?.user.id !== session.user.id) return
        if (!result.ok) {
          this.setData({ organizationBusy: false, organizationError: result.error.message }); return
        }
        this.setData({ organizationBusy: false, organization: result.data,
          organizationDraft: null, organizationIntent: EMPTY_WRITE_INTENT },
        () => this.restoreAdminScroll())
      },
      async loadData(append = false) {
        const session = getSession()
        if (this.data.status !== 'ready' || !this.data.access || !session
          || session.user.role !== 'teacher' || !config.dataKind) return
        if (append && this.data.nextOffset === null) return
        const requestVersion = this.data.requestVersion + 1
        this.setData({ dataLoading: true, dataError: '', requestVersion })
        const offset = append ? this.data.nextOffset ?? 0 : 0
        const filter = buildNativeAdminRecordFilter({ kind: config.recordKind,
          query: this.data.keyword, status: this.data.statusFilter,
          taskType: this.data.taskTypeFilter, mediaKind: this.data.mediaKindFilter,
          from: this.data.fromDate, to: this.data.toDate })
        const result = config.dataKind === 'overview'
          ? await getNativeAdminOverview(session.user.id, {
            from: this.data.overviewFromDate, to: this.data.overviewToDate })
          : config.dataKind === 'classes'
            ? await listNativeAdminClasses(session.user.id, 20, offset, this.data.keyword.trim())
            : config.dataKind === 'grants'
              ? await listNativeAdminGrants(session.user.id, 20, offset, this.data.keyword.trim())
              : config.dataKind === 'records' && config.recordKind
                ? await listNativeAdminRecords(session.user.id, config.recordKind, 20, offset, filter)
                : await listNativeAdminUsers(session.user.id, this.data.selectedClassId, 20, offset,
                  this.data.keyword.trim(), this.data.userRoleFilter,
                  this.data.statusFilter as '' | 'active' | 'disabled')
        if (this.data.requestVersion !== requestVersion || getSession()?.user.id !== session.user.id) return
        if (!result.ok) {
          this.setData({ dataLoading: false, dataError: adminReadErrorMessage(result.error,
              !this.data.keyword.trim() && !this.data.statusFilter && !this.data.mediaKindFilter
                && !this.data.userRoleFilter),
            ...(result.error.code === 'FORBIDDEN' ? { status: 'forbidden', access: null,
              overview: null, classRows: [], userRows: [], grantRows: [], recordRows: [] } : {}) })
          return
        }
        if (config.dataKind === 'overview') {
          this.setData({ dataLoading: false, overview: result.data as NativeAdminOverviewView })
        } else if (config.dataKind === 'classes') {
          const page = result.data as NativeAdminClassPageView
          this.setData({ dataLoading: false, classRows: append ? [...this.data.classRows, ...page.items] : page.items,
            nextOffset: page.nextOffset })
        } else if (config.dataKind === 'users') {
          const page = result.data as NativeAdminUserPageView
          this.setData({ dataLoading: false, userRows: append ? [...this.data.userRows, ...page.items] : page.items,
            nextOffset: page.nextOffset })
        } else if (config.dataKind === 'grants') {
          const page = result.data as NativeAdminGrantPageView
          this.setData({ dataLoading: false, grantRows: append ? [...this.data.grantRows, ...page.items] : page.items,
            nextOffset: page.nextOffset })
          if (config.id === 'A-04') this.loadAudit(false)
        } else {
          const page = result.data as NativeAdminRecordPageView
          this.setData({ dataLoading: false, recordRows: append ? [...this.data.recordRows, ...page.items] : page.items,
            nextOffset: page.nextOffset })
        }
      },
      loadMore() { this.loadData(true) },
      async loadAudit(append = false) {
        const session = getSession()
        if (config.id !== 'A-04' || !session || session.user.role !== 'teacher'
          || this.data.status !== 'ready' || this.data.auditLoading
          || append && this.data.auditNextOffset === null) return
        const offset = append ? this.data.auditNextOffset ?? 0 : 0
        this.setData({ auditLoading: true, auditError: '' })
        const result = await listNativeAdminAudit(session.user.id, 20, offset)
        if (getSession()?.user.id !== session.user.id) return
        if (!result.ok) { this.setData({ auditLoading: false, auditError: result.error.message }); return }
        const page = result.data as NativeAdminAuditPageView
        const items = page.items.map(item => ({ ...item, actionLabel: auditActionLabel(item.action) }))
        this.setData({ auditLoading: false,
          auditRows: append ? [...this.data.auditRows, ...items] : items,
          auditNextOffset: page.nextOffset })
      },
      loadMoreAudit() { this.loadAudit(true) },
      chooseClass(event: WechatMiniprogram.TouchEvent) {
        const classId = event.currentTarget.dataset.id as string
        if (!this.data.access || !this.data.access.scope.classIds.includes(classId)) return
        this.setData({ selectedClassId: classId, userRows: [], nextOffset: null },
          () => this.loadData(false))
      },
      onUserRoleFilter(event: WechatMiniprogram.TouchEvent) {
        if (config.id !== 'A-03') return
        const role = event.currentTarget.dataset.role as NativeAdminUserRoleFilter
        if (!['', 'student', 'parent', 'teacher', 'admin'].includes(role)) return
        this.setData({ userRoleFilter: role, userRows: [], nextOffset: null },
          () => this.loadData(false))
      },
      openCreateBinding() {
        if (config.id !== 'A-03' || this.data.status !== 'ready' || !this.canOpenAdminPanel()) return
        if (this.data.dataLoading || this.data.dataError) {
          wx.showToast({ title: '请先读取账号列表', icon: 'none' }); return
        }
        this.rememberAdminScroll()
        this.setData({ bindingCreateDraft: { parentId: '', studentId: '', reason: '' },
          bindingCreateError: '', bindingCreateIntent: EMPTY_WRITE_INTENT,
          selectionLabels: { ...this.data.selectionLabels, bindingParent: '', bindingStudent: '' } },
        () => this.focusAdminPanel('admin-create-binding-form'))
      },
      onBindingCreateField(event: WechatMiniprogram.Input) {
        const draft = this.data.bindingCreateDraft
        const field = event.currentTarget.dataset.field as 'parentId' | 'studentId' | 'reason'
        if (!draft || this.data.bindingCreateBusy
          || !['parentId', 'studentId', 'reason'].includes(field)) return
        this.setData({ bindingCreateDraft: { ...draft, [field]: event.detail.value },
          ...(field === 'parentId' ? { selectionLabels: { ...this.data.selectionLabels,
            bindingParent: '' } } : field === 'studentId' ? { selectionLabels: {
            ...this.data.selectionLabels, bindingStudent: '' } } : {}),
          bindingCreateIntent: EMPTY_WRITE_INTENT })
      },
      closeCreateBinding() {
        if (!this.data.bindingCreateBusy) {
          this.closeAdminOptionPicker()
          this.setData({ bindingCreateDraft: null, bindingCreateError: '' },
            () => this.restoreAdminScroll())
        }
      },
      requestCreateBinding() {
        const draft = this.data.bindingCreateDraft
        if (!draft || this.data.bindingCreateBusy) return
        if (!draft.parentId.trim() || !draft.studentId.trim()
          || !draft.reason.trim() || draft.reason.trim().length > 200) {
          this.setData({ bindingCreateError: '请填写家长、学生账号编号和绑定原因' }); return
        }
        wx.showModal({ title: '确认新增家长绑定？',
          content: `${draft.parentId.trim()} ↔ ${draft.studentId.trim()}\n原因：${draft.reason.trim()}`,
          success: result => { if (result.confirm) this.commitCreateBinding() } })
      },
      async commitCreateBinding() {
        const session = getSession()
        const draft = this.data.bindingCreateDraft
        if (!session || session.user.role !== 'teacher' || !draft || this.data.bindingCreateBusy) return
        const input = { parentId: draft.parentId.trim(), studentId: draft.studentId.trim(),
          reason: draft.reason.trim() }
        const intent = prepareWriteIntent(this.data.bindingCreateIntent, JSON.stringify(input),
          () => createPageOperationId('native_parent_binding'))
        this.setData({ bindingCreateBusy: true, bindingCreateError: '', bindingCreateIntent: intent })
        const result = await bindNativeAdminParentLink(session.user.id, input, intent.operationId)
        if (getSession()?.user.id !== session.user.id) return
        if (!result.ok) {
          this.setData({ bindingCreateBusy: false, bindingCreateError: result.error.message }); return
        }
        this.setData({ bindingCreateBusy: false, bindingCreateDraft: null,
          bindingCreateIntent: EMPTY_WRITE_INTENT }, () => this.restoreAdminScroll())
        this.closeAdminOptionPicker()
        this.loadData(false)
      },
      openGrant(event: WechatMiniprogram.TouchEvent) {
        if (config.id !== 'A-04' || this.data.status !== 'ready' || !this.data.access
          || !this.canOpenAdminPanel()) return
        const teacherId = event.currentTarget.dataset.id as string
        const row = this.data.grantRows.find(item => item.teacherId === teacherId)
        const session = getSession()
        if (!row || row.userVersion < 1 || teacherId === session?.user.id) {
          wx.showToast({ title: '不能修改本人授权或失效账号', icon: 'none' }); return
        }
        const permissions = row.permissions.filter(permission =>
          GRANT_PERMISSION_OPTIONS.some(option => option.value === permission))
        const draft: NativeAdminGrantInput = { teacherId, status: row.status,
          permissions, scope: { organizationWide: row.organizationWide,
            classIds: [...row.classIds] }, expectedUserVersion: row.userVersion, reason: '' }
        this.rememberAdminScroll()
        this.setData({ grantDraft: draft, grantOriginal: { ...draft,
          permissions: [...draft.permissions], scope: { ...draft.scope, classIds: [...draft.scope.classIds] } },
        grantChangeCount: 0,
        grantExpectedVersion: row.version, grantScopeText: row.classIds.join('、'),
        grantPermissionOptions: grantPermissionOptions(this.data.access, permissions),
        grantError: '', grantIntent: EMPTY_WRITE_INTENT },
        () => this.focusAdminPanel('admin-grant-form'))
      },
      openGrantCandidate(event: WechatMiniprogram.TouchEvent) {
        if (config.id !== 'A-04' || this.data.status !== 'ready' || !this.data.access
          || !this.canOpenAdminPanel()) return
        const teacherId = event.currentTarget.dataset.id as string
        const candidate = this.data.grantCandidateRows.find(item => item.teacherId === teacherId)
        const session = getSession()
        if (!candidate || teacherId === session?.user.id) return
        const permissions = candidate.permissions.filter(permission =>
          GRANT_PERMISSION_OPTIONS.some(option => option.value === permission))
        if (candidate.grantStatus === 'none' && this.data.access.permissions.includes('dashboard.read'))
          permissions.push('dashboard.read')
        const draft: NativeAdminGrantInput = { teacherId, status: 'active', permissions,
          scope: { organizationWide: candidate.scope.organizationWide,
            classIds: [...candidate.scope.classIds] },
          expectedUserVersion: candidate.userVersion, reason: '' }
        const original: NativeAdminGrantInput = { ...draft,
          permissions: candidate.grantStatus === 'none' ? [] : [...candidate.permissions],
          scope: { ...draft.scope, classIds: [...draft.scope.classIds] } }
        this.rememberAdminScroll()
        this.setData({ grantDraft: draft, grantOriginal: original,
          grantExpectedVersion: candidate.grantVersion,
          grantScopeText: candidate.scope.classIds.join('、'),
          grantChangeCount: grantChangeCount(draft, original),
          grantPermissionOptions: grantPermissionOptions(this.data.access, permissions),
          grantError: '', grantIntent: EMPTY_WRITE_INTENT },
        () => this.focusAdminPanel('admin-grant-form'))
      },
      closeGrant() {
        if (!this.data.grantBusy) {
          this.closeAdminOptionPicker()
          this.setData({ grantDraft: null, grantOriginal: null,
            grantChangeCount: 0, grantError: '' }, () => this.restoreAdminScroll())
        }
      },
      resetGrantDraft() {
        const original = this.data.grantOriginal
        if (!original || this.data.grantBusy) return
        const draft: NativeAdminGrantInput = { ...original, permissions: [...original.permissions],
          scope: { ...original.scope, classIds: [...original.scope.classIds] }, reason: '' }
        this.setData({ grantDraft: draft, grantScopeText: draft.scope.classIds.join('、'),
          grantPermissionOptions: grantPermissionOptions(this.data.access, draft.permissions),
          grantChangeCount: 0, grantError: '', grantIntent: EMPTY_WRITE_INTENT })
      },
      onGrantReason(event: WechatMiniprogram.Input) {
        if (!this.data.grantDraft) return
        this.setData({ grantDraft: { ...this.data.grantDraft, reason: event.detail.value },
          grantIntent: EMPTY_WRITE_INTENT })
      },
      onGrantScope(event: WechatMiniprogram.Input) {
        if (!this.data.grantDraft) return
        const classIds = event.detail.value.split(/[、,，\s]+/).map(item => item.trim()).filter(Boolean)
        const draft = { ...this.data.grantDraft,
          scope: { ...this.data.grantDraft.scope, classIds } }
        this.setData({ grantScopeText: event.detail.value, grantDraft: draft,
          grantChangeCount: grantChangeCount(draft, this.data.grantOriginal),
          grantIntent: EMPTY_WRITE_INTENT })
      },
      toggleGrantWide() {
        if (!this.data.grantDraft || !this.data.access?.scope.organizationWide) return
        const organizationWide = !this.data.grantDraft.scope.organizationWide
        const draft = { ...this.data.grantDraft, scope: {
          organizationWide, classIds: organizationWide ? [] : this.data.grantDraft.scope.classIds } }
        if (organizationWide) this.closeAdminOptionPicker()
        this.setData({ grantDraft: draft, grantScopeText: draft.scope.classIds.join('、'),
          grantChangeCount: grantChangeCount(draft, this.data.grantOriginal),
          grantIntent: EMPTY_WRITE_INTENT })
      },
      toggleGrantPermission(event: WechatMiniprogram.TouchEvent) {
        if (!this.data.grantDraft || !this.data.access) return
        const permission = event.currentTarget.dataset.permission as NativeAdminPermission
        if (!this.data.access.permissions.includes(permission)) return
        const selected = new Set(this.data.grantDraft.permissions)
        if (selected.has(permission)) selected.delete(permission)
        else selected.add(permission)
        const draft = { ...this.data.grantDraft, permissions: [...selected] }
        this.setData({ grantDraft: draft,
          grantChangeCount: grantChangeCount(draft, this.data.grantOriginal),
          grantPermissionOptions: grantPermissionOptions(this.data.access, [...selected]),
          grantIntent: EMPTY_WRITE_INTENT })
      },
      requestGrantUpdate(event: WechatMiniprogram.TouchEvent) {
        const draft = this.data.grantDraft
        if (!draft || this.data.grantBusy) return
        const status = event.currentTarget.dataset.status as 'active' | 'revoked'
        if (status !== 'active' && status !== 'revoked') return
        if (!draft.reason.trim() || draft.reason.trim().length > 200) {
          this.setData({ grantError: '请填写 1—200 字的变更原因' }); return
        }
        if (status === 'active' && (!draft.permissions.length
          || !draft.scope.organizationWide && !draft.scope.classIds.length)) {
          this.setData({ grantError: '请选择权限和管理范围' }); return
        }
        if (status === 'active' && !draft.permissions.includes('dashboard.read')) {
          this.setData({ grantError: '请保留管理工作区入口权限' }); return
        }
        wx.showModal({ title: status === 'revoked' ? '确认撤销管理授权？' : '确认保存管理授权？',
          content: `${draft.teacherId}\n${status === 'revoked' ? '撤销后旧管理会话立即失效。' : `${draft.permissions.length} 项权限，${draft.scope.organizationWide ? '组织范围' : `${draft.scope.classIds.length} 个班级`}`}\n原因：${draft.reason.trim()}`,
          confirmText: status === 'revoked' ? '确认撤销' : '确认保存',
          success: result => { if (result.confirm) this.commitGrant(status) } })
      },
      async commitGrant(status: 'active' | 'revoked') {
        const session = getSession()
        const draft = this.data.grantDraft
        if (!session || session.user.role !== 'teacher' || !draft || this.data.grantBusy) return
        const input: NativeAdminGrantInput = status === 'revoked'
          ? { ...draft, status: 'revoked', permissions: [],
            scope: { organizationWide: false, classIds: [] }, reason: draft.reason.trim() }
          : { ...draft, status: 'active', reason: draft.reason.trim() }
        const fingerprint = JSON.stringify([input, this.data.grantExpectedVersion])
        const intent = prepareWriteIntent(this.data.grantIntent, fingerprint,
          () => createPageOperationId('native_grant'))
        this.setData({ grantBusy: true, grantError: '', grantIntent: intent })
        const result = await setNativeAdminGrant(session.user.id, input,
          this.data.grantExpectedVersion, intent.operationId)
        if (!result.ok) {
          this.setData({ grantBusy: false, grantError: result.error.message }); return
        }
        this.setData({ grantBusy: false, grantDraft: null, grantOriginal: null,
          grantChangeCount: 0, grantIntent: EMPTY_WRITE_INTENT },
        () => this.restoreAdminScroll())
        this.closeAdminOptionPicker()
        this.loadData(false)
        this.loadGrantCandidates(false)
        this.loadAudit(false)
      },
      openCreateClass() {
        if (config.id !== 'A-02' || !this.data.access?.scope.organizationWide) {
          wx.showToast({ title: '新建班级需要组织范围授权', icon: 'none' }); return
        }
        if (this.data.dataLoading || this.data.dataError) {
          wx.showToast({ title: '请先读取班级列表', icon: 'none' }); return
        }
        if (!this.canOpenAdminPanel()) return
        this.rememberAdminScroll()
        this.setData({ classDraft: { classId: '', name: '', gradeText: '', term: '',
          reason: '', expectedVersion: 0 }, classError: '', classIntent: EMPTY_WRITE_INTENT },
        () => this.focusAdminPanel('admin-class-form'))
      },
      openEditClass(event: WechatMiniprogram.TouchEvent) {
        if (config.id !== 'A-02' || this.data.status !== 'ready' || !this.canOpenAdminPanel()) return
        const row = this.data.classRows.find(item => item.id === event.currentTarget.dataset.id)
        if (!row) return
        this.rememberAdminScroll()
        this.setData({ classDraft: { classId: row.id, name: row.name,
          gradeText: String(Number.parseInt(row.grade, 10) || ''), term: row.term,
          reason: '', expectedVersion: row.version }, classError: '', classIntent: EMPTY_WRITE_INTENT },
        () => this.focusAdminPanel('admin-class-form'))
      },
      openClassArchive(event: WechatMiniprogram.TouchEvent) {
        if (config.id !== 'A-02' || this.data.status !== 'ready' || !this.canOpenAdminPanel()) return
        const row = this.data.classRows.find(item => item.id === event.currentTarget.dataset.id)
        if (!row || row.status !== 'active') return
        this.rememberAdminScroll()
        this.setData({ classArchiveDraft: { classId: row.id, name: row.name,
          expectedVersion: row.version, studentCount: row.studentCount,
          destinationClassId: '', destinationVersion: null, reason: '' },
          classArchiveError: '', classArchiveIntent: EMPTY_WRITE_INTENT },
        () => this.focusAdminPanel('admin-class-archive-form'))
      },
      chooseArchiveDestination(event: WechatMiniprogram.TouchEvent) {
        const draft = this.data.classArchiveDraft
        if (!draft) return
        const destinationClassId = event.currentTarget.dataset.id as string
        const destination = this.data.classRows.find(row => row.id === destinationClassId)
        if (!destination || destination.status !== 'active' || destination.id === draft.classId) return
        this.setData({ classArchiveDraft: { ...draft, destinationClassId: destination.id,
          destinationVersion: destination.version }, classArchiveIntent: EMPTY_WRITE_INTENT })
      },
      onClassArchiveReason(event: WechatMiniprogram.Input) {
        if (!this.data.classArchiveDraft) return
        this.setData({ classArchiveDraft: { ...this.data.classArchiveDraft, reason: event.detail.value },
          classArchiveIntent: EMPTY_WRITE_INTENT })
      },
      closeClassArchive() {
        if (!this.data.classArchiveBusy) this.setData({ classArchiveDraft: null, classArchiveError: '' },
          () => this.restoreAdminScroll())
      },
      requestClassArchive() {
        const draft = this.data.classArchiveDraft
        if (!draft || this.data.classArchiveBusy) return
        if (!draft.reason.trim() || draft.reason.length > 200
          || (draft.studentCount === null || draft.studentCount > 0)
            && (!draft.destinationClassId || draft.destinationVersion === null)) {
          this.setData({ classArchiveError: draft.studentCount === null || draft.studentCount > 0
            ? '请先选择目标班级并填写停用原因' : '请填写停用原因' }); return
        }
        wx.showModal({ title: '确认迁移学员并停用班级？',
          content: `${draft.name} · ${draft.studentCount === null ? '人数未记录' : `${draft.studentCount} 名学员`}${draft.destinationClassId
            ? `迁移到 ${draft.destinationClassId}` : ''}\n教师分配会一并撤销。\n原因：${draft.reason.trim()}`,
          confirmText: '迁移并停用', success: result => { if (result.confirm) this.commitClassArchive() } })
      },
      async commitClassArchive() {
        const session = getSession()
        const draft = this.data.classArchiveDraft
        if (!session || session.user.role !== 'teacher' || !draft || this.data.classArchiveBusy) return
        const input = { classId: draft.classId, destinationClassId: draft.destinationClassId || null,
          reason: draft.reason.trim() }
        const fingerprint = JSON.stringify([input, draft.expectedVersion, draft.destinationVersion])
        const intent = prepareWriteIntent(this.data.classArchiveIntent, fingerprint,
          () => createPageOperationId('native_class_archive'))
        this.setData({ classArchiveBusy: true, classArchiveError: '', classArchiveIntent: intent })
        const result = await archiveNativeAdminClass(session.user.id, input,
          draft.expectedVersion, draft.destinationVersion, intent.operationId)
        if (!result.ok) { this.setData({ classArchiveBusy: false, classArchiveError: result.error.message }); return }
        this.setData({ classArchiveBusy: false, classArchiveDraft: null,
          classArchiveIntent: EMPTY_WRITE_INTENT }, () => this.restoreAdminScroll())
        this.loadData(false)
      },
      onClassField(event: WechatMiniprogram.Input) {
        if (!this.data.classDraft) return
        const field = event.currentTarget.dataset.field as 'name' | 'gradeText' | 'term' | 'reason'
        if (!['name', 'gradeText', 'term', 'reason'].includes(field)) return
        this.setData({ classDraft: { ...this.data.classDraft, [field]: event.detail.value },
          classIntent: EMPTY_WRITE_INTENT })
      },
      closeClassDraft() {
        if (!this.data.classBusy) this.setData({ classDraft: null, classError: '' },
          () => this.restoreAdminScroll())
      },
      requestClassSave() {
        const draft = this.data.classDraft
        if (!draft || this.data.classBusy) return
        const grade = Number(draft.gradeText)
        if (!draft.name.trim() || !Number.isSafeInteger(grade) || grade < 1 || grade > 12
          || !draft.term.trim() || !draft.reason.trim()) {
          this.setData({ classError: '请填写名称、1—12 年级、学期和操作原因' }); return
        }
        wx.showModal({ title: draft.classId ? '确认修改班级？' : '确认新建班级？',
          content: `${draft.name.trim()} · ${grade} 年级 · ${draft.term.trim()}\n原因：${draft.reason.trim()}`,
          confirmText: '确认保存', success: result => { if (result.confirm) this.commitClass(grade) } })
      },
      async commitClass(grade: number) {
        const session = getSession()
        const draft = this.data.classDraft
        if (!session || session.user.role !== 'teacher' || !draft || this.data.classBusy) return
        const input: CreateNativeAdminClassInput = { name: draft.name.trim(), grade,
          term: draft.term.trim(), reason: draft.reason.trim() }
        const fingerprint = JSON.stringify([draft.classId, input, draft.expectedVersion])
        const intent = prepareWriteIntent(this.data.classIntent, fingerprint,
          () => createPageOperationId('native_class'))
        this.setData({ classBusy: true, classError: '', classIntent: intent })
        const result = draft.classId
          ? await updateNativeAdminClass(session.user.id, { ...input, classId: draft.classId },
            draft.expectedVersion, intent.operationId)
          : await createNativeAdminClass(session.user.id, input, intent.operationId)
        if (!result.ok) { this.setData({ classBusy: false, classError: result.error.message }); return }
        this.setData({ classBusy: false, classDraft: null, classIntent: EMPTY_WRITE_INTENT },
          () => this.restoreAdminScroll())
        this.loadData(false)
      },
      openAssignTeacher(event: WechatMiniprogram.TouchEvent) {
        if (config.id !== 'A-02' || this.data.status !== 'ready' || !this.canOpenAdminPanel()) return
        const row = this.data.classRows.find(item => item.id === event.currentTarget.dataset.id)
        if (!row) return
        const teacherId = String(event.currentTarget.dataset.teacherId ?? '')
        const existing = teacherId ? row.teacherAssignments.find(item => item.teacherId === teacherId) : undefined
        const permissions = existing ? [...existing.permissions] : []
        this.rememberAdminScroll()
        this.setData({ assignmentDraft: { classId: row.id, teacherId,
          permissions, expectedVersion: existing?.version ?? 0,
          status: existing?.status ?? 'new', reason: '' }, assignmentError: '', assignmentIntent: EMPTY_WRITE_INTENT,
        selectionLabels: { ...this.data.selectionLabels, assignmentTeacher: '' },
        teacherClassOptions: TEACHER_CLASS_OPTIONS.map(item => ({ ...item, selected: permissions.includes(item.value) })) },
        () => this.focusAdminPanel('admin-assignment-form'))
      },
      onAssignmentField(event: WechatMiniprogram.Input) {
        if (!this.data.assignmentDraft) return
        const field = event.currentTarget.dataset.field as 'teacherId' | 'reason'
        if (field !== 'teacherId' && field !== 'reason') return
        this.setData({ assignmentDraft: { ...this.data.assignmentDraft, [field]: event.detail.value },
          ...(field === 'teacherId' ? { selectionLabels: { ...this.data.selectionLabels,
            assignmentTeacher: '' } } : {}),
          assignmentIntent: EMPTY_WRITE_INTENT })
      },
      toggleTeacherClassPermission(event: WechatMiniprogram.TouchEvent) {
        if (!this.data.assignmentDraft) return
        const permission = event.currentTarget.dataset.permission as NativeAdminTeacherClassPermission
        if (!TEACHER_CLASS_OPTIONS.some(item => item.value === permission)) return
        const selected = new Set(this.data.assignmentDraft.permissions)
        if (selected.has(permission)) selected.delete(permission)
        else selected.add(permission)
        this.setData({ assignmentDraft: { ...this.data.assignmentDraft, permissions: [...selected] },
          teacherClassOptions: TEACHER_CLASS_OPTIONS.map(item => ({ ...item,
            selected: selected.has(item.value) })), assignmentIntent: EMPTY_WRITE_INTENT })
      },
      closeAssignmentDraft() {
        if (!this.data.assignmentBusy) {
          this.closeAdminOptionPicker()
          this.setData({ assignmentDraft: null, assignmentError: '' },
            () => this.restoreAdminScroll())
        }
      },
      requestTeacherAssignment() {
        const draft = this.data.assignmentDraft
        if (!draft || this.data.assignmentBusy) return
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(draft.teacherId.trim())
          || !draft.permissions.length || !draft.reason.trim()) {
          this.setData({ assignmentError: '请选择教师、权限并填写原因' }); return
        }
        wx.showModal({ title: draft.expectedVersion > 0 ? '确认调整教师权限？' : '确认分配教师？',
          content: `${draft.teacherId.trim()} · ${draft.classId}\n${draft.permissions.length} 项权限\n原因：${draft.reason.trim()}`,
          confirmText: '确认分配', success: result => { if (result.confirm) this.commitTeacherAssignment() } })
      },
      async commitTeacherAssignment() {
        const session = getSession()
        const draft = this.data.assignmentDraft
        if (!session || session.user.role !== 'teacher' || !draft || this.data.assignmentBusy) return
        const input = { classId: draft.classId, teacherId: draft.teacherId.trim(),
          permissions: [...draft.permissions], reason: draft.reason.trim() }
        const fingerprint = JSON.stringify([input, draft.expectedVersion])
        const intent = prepareWriteIntent(this.data.assignmentIntent, fingerprint,
          () => createPageOperationId('native_teacher_assign'))
        this.setData({ assignmentBusy: true, assignmentError: '', assignmentIntent: intent })
        const result = await assignNativeAdminTeacher(session.user.id, input, draft.expectedVersion, intent.operationId)
        if (!result.ok) {
          this.setData({ assignmentBusy: false, assignmentError: result.error.message }); return
        }
        this.setData({ assignmentBusy: false, assignmentDraft: null,
          assignmentIntent: EMPTY_WRITE_INTENT }, () => this.restoreAdminScroll())
        this.closeAdminOptionPicker()
        this.loadData(false)
      },
      requestTeacherRevocation() {
        const draft = this.data.assignmentDraft
        if (!draft || draft.expectedVersion < 1 || this.data.assignmentBusy) return
        if (!draft.reason.trim()) { this.setData({ assignmentError: '请填写撤销原因' }); return }
        wx.showModal({ title: '确认撤销该班级教师权限？',
          content: `${draft.teacherId} · ${draft.classId}\n撤销后，该教师在此班级的教学权限立即失效。\n原因：${draft.reason.trim()}`,
          confirmText: '确认撤销', success: result => { if (result.confirm) this.commitTeacherRevocation() } })
      },
      async commitTeacherRevocation() {
        const session = getSession()
        const draft = this.data.assignmentDraft
        if (!session || session.user.role !== 'teacher' || !draft || this.data.assignmentBusy) return
        const input = { classId: draft.classId, teacherId: draft.teacherId.trim(), reason: draft.reason.trim() }
        const intent = prepareWriteIntent(this.data.assignmentIntent,
          JSON.stringify([input, draft.expectedVersion]), () => createPageOperationId('native_teacher_revoke'))
        this.setData({ assignmentBusy: true, assignmentError: '', assignmentIntent: intent })
        const result = await revokeNativeAdminTeacher(session.user.id, input, draft.expectedVersion, intent.operationId)
        if (!result.ok) { this.setData({ assignmentBusy: false, assignmentError: result.error.message }); return }
        this.setData({ assignmentBusy: false, assignmentDraft: null, assignmentIntent: EMPTY_WRITE_INTENT },
          () => this.restoreAdminScroll())
        this.closeAdminOptionPicker()
        this.loadData(false)
      },
      openUserEdit(event: WechatMiniprogram.TouchEvent) {
        if (config.id !== 'A-03' || this.data.status !== 'ready' || !this.canOpenAdminPanel()) return
        const row = this.data.userRows.find(item => item.id === event.currentTarget.dataset.id)
        if (!row) return
        this.rememberAdminScroll()
        this.setData({ userDraft: { userId: row.id, displayName: row.displayName,
          reason: '', expectedVersion: row.version, status: row.status }, userError: '', userIntent: EMPTY_WRITE_INTENT },
        () => this.focusAdminPanel('admin-user-form'))
      },
      openCreateUser() {
        if (config.id !== 'A-03' || this.data.status !== 'ready' || !this.canOpenAdminPanel()) return
        if (this.data.dataLoading || this.data.dataError) {
          wx.showToast({ title: '请先读取账号列表', icon: 'none' }); return
        }
        this.rememberAdminScroll()
        this.setData({ createUserDraft: { displayName: '', mobile: '', role: 'student',
          classId: this.data.selectedClassId, reason: '' }, createUserError: '',
          createUserIntent: EMPTY_WRITE_INTENT,
          selectionLabels: { ...this.data.selectionLabels, createUserClass: '' } },
        () => this.focusAdminPanel('admin-create-user-form'))
      },
      onCreateUserField(event: WechatMiniprogram.Input) {
        const draft = this.data.createUserDraft
        const field = event.currentTarget.dataset.field as keyof CreateNativeAdminUserInput
        if (!draft || this.data.createUserBusy || !['displayName', 'mobile', 'role', 'classId', 'reason'].includes(field)) return
        const value = event.detail.value
        if (field === 'role' && !['student', 'parent', 'teacher', 'admin'].includes(value)) return
        this.setData({ createUserDraft: { ...draft, [field]: value,
          ...(field === 'role' && value !== 'student' ? { classId: '' } : {}) },
          ...(field === 'classId' || field === 'role' ? { selectionLabels: {
            ...this.data.selectionLabels, createUserClass: '' } } : {}),
          createUserIntent: EMPTY_WRITE_INTENT })
        if (field === 'role' && value !== 'student') this.closeAdminOptionPicker()
      },
      closeCreateUser() {
        if (!this.data.createUserBusy) {
          this.closeAdminOptionPicker()
          this.setData({ createUserDraft: null, createUserError: '' },
            () => this.restoreAdminScroll())
        }
      },
      requestCreateUser() {
        const draft = this.data.createUserDraft
        if (!draft || this.data.createUserBusy) return
        if (!/^1\d{10}$/.test(draft.mobile) || !draft.reason.trim()
          || draft.reason.trim().length > 200
          || draft.role === 'student' && !draft.classId) {
          this.setData({ createUserError: '请核对手机号、学生班级和创建原因' }); return
        }
        wx.showModal({ title: '确认创建账号？',
          content: `${draft.mobile}\n身份：${draft.role}\n创建后请通知本人在登录页验证手机号并设置密码。`,
          success: result => { if (result.confirm) this.commitCreateUser() } })
      },
      async commitCreateUser() {
        const session = getSession()
        const draft = this.data.createUserDraft
        if (!session || session.user.role !== 'teacher' || !draft || this.data.createUserBusy) return
        const input: CreateNativeAdminUserInput = { ...draft, displayName: draft.displayName.trim(),
          mobile: draft.mobile.trim(), reason: draft.reason.trim() }
        const intent = prepareWriteIntent(this.data.createUserIntent, JSON.stringify(input),
          () => createPageOperationId('native_create_user'))
        this.setData({ createUserBusy: true, createUserError: '', createUserIntent: intent })
        const result = await createNativeAdminUser(session.user.id, input, intent.operationId)
        if (getSession()?.user.id !== session.user.id) return
        if (!result.ok) {
          const message = result.error.code === 'SERVICE_UNAVAILABLE'
            ? '账号开户服务暂不可用，当前创建结果未确认。输入已保留，可重试核对。'
            : result.error.code === 'CONFLICT'
              ? '手机号已注册或开户请求存在冲突，请先搜索现有账号并核对信息。'
              : result.error.message
          this.setData({ createUserBusy: false, createUserError: message }); return
        }
        if (result.data.setupStatus !== 'self_service_required') {
          this.setData({ createUserBusy: false,
            createUserError: '账号创建结果未确认，请勿重复提交；请联系管理员核对' }); return
        }
        this.setData({ createUserBusy: false, createUserDraft: null,
          createUserIntent: EMPTY_WRITE_INTENT }, () => this.restoreAdminScroll())
        this.closeAdminOptionPicker()
        wx.showToast({ title: '账号已创建，请通知本人设密', icon: 'success' })
        this.loadData(false)
      },
      async openUserBindings(event: WechatMiniprogram.TouchEvent) {
        if (config.id !== 'A-03' || this.data.status !== 'ready' || !this.canOpenAdminPanel()) return
        const userId = event.currentTarget.dataset.id as string
        if (!this.data.userRows.some(row => row.id === userId)) return
        const session = getSession()
        if (!session || session.user.role !== 'teacher') return
        this.rememberAdminScroll()
        this.setData({ bindingUserId: userId, bindingRows: [], bindingBusy: true,
          bindingError: '', unbindDraft: null })
        const result = await getNativeAdminUserBindings(session.user.id, userId)
        if (getSession()?.user.id !== session.user.id || this.data.bindingUserId !== userId) return
        if (!result.ok) {
          this.setData({ bindingBusy: false, bindingError: result.error.message },
            () => this.focusAdminPanel('admin-bindings-panel'))
          return
        }
        this.setData({ bindingBusy: false, bindingRows: result.data.items },
          () => this.focusAdminPanel('admin-bindings-panel'))
      },
      closeUserBindings() {
        if (!this.data.unbindBusy) this.setData({ bindingUserId: '', bindingRows: [], unbindDraft: null,
          bindingError: '', unbindError: '' }, () => this.restoreAdminScroll())
      },
      openUnbindDraft(event: WechatMiniprogram.TouchEvent) {
        const link = this.data.bindingRows.find(row => row.id === event.currentTarget.dataset.id)
        if (!link || link.status !== 'active') return
        this.setData({ unbindDraft: { linkId: link.id, version: link.version,
          parentName: link.parentName, studentName: link.studentName, reason: '' },
          unbindError: '', unbindIntent: EMPTY_WRITE_INTENT },
        () => this.focusAdminPanel('admin-unbind-form'))
      },
      onUnbindReason(event: WechatMiniprogram.Input) {
        if (!this.data.unbindDraft) return
        this.setData({ unbindDraft: { ...this.data.unbindDraft, reason: event.detail.value },
          unbindIntent: EMPTY_WRITE_INTENT })
      },
      requestUnbind() {
        const draft = this.data.unbindDraft
        if (!draft || this.data.unbindBusy) return
        if (!draft.reason.trim() || draft.reason.length > 200) {
          this.setData({ unbindError: '请填写解绑原因' }); return
        }
        wx.showModal({ title: '确认解除家长绑定？',
          content: `${draft.parentName} · ${draft.studentName}\n学习记录会保留，家长将失去孩子数据访问权。\n原因：${draft.reason.trim()}`,
          confirmText: '确认解绑', success: result => { if (result.confirm) this.commitUnbind() } })
      },
      async commitUnbind() {
        const session = getSession()
        const draft = this.data.unbindDraft
        if (!session || session.user.role !== 'teacher' || !draft || this.data.unbindBusy) return
        const input = { linkId: draft.linkId, reason: draft.reason.trim() }
        const intent = prepareWriteIntent(this.data.unbindIntent,
          JSON.stringify([input, draft.version]), () => createPageOperationId('native_parent_unbind'))
        this.setData({ unbindBusy: true, unbindError: '', unbindIntent: intent })
        const result = await unbindNativeAdminUser(session.user.id, input, draft.version, intent.operationId)
        if (!result.ok) { this.setData({ unbindBusy: false, unbindError: result.error.message }); return }
        const bindingUserId = this.data.bindingUserId
        this.setData({ unbindBusy: false, unbindDraft: null, unbindIntent: EMPTY_WRITE_INTENT,
          bindingBusy: true, bindingError: '' })
        const refreshed = await getNativeAdminUserBindings(session.user.id, bindingUserId)
        if (getSession()?.user.id !== session.user.id || this.data.bindingUserId !== bindingUserId) return
        if (!refreshed.ok) { this.setData({ bindingBusy: false, bindingError: refreshed.error.message }); return }
        this.setData({ bindingBusy: false, bindingRows: refreshed.data.items })
      },
      onUserField(event: WechatMiniprogram.Input) {
        if (!this.data.userDraft) return
        const field = event.currentTarget.dataset.field as 'displayName' | 'reason'
        if (field !== 'displayName' && field !== 'reason') return
        this.setData({ userDraft: { ...this.data.userDraft, [field]: event.detail.value },
          userIntent: EMPTY_WRITE_INTENT })
      },
      closeUserDraft() {
        if (!this.data.userBusy) this.setData({ userDraft: null, userError: '' },
          () => this.restoreAdminScroll())
      },
      requestUserUpdate() {
        const draft = this.data.userDraft
        if (!draft || this.data.userBusy) return
        if (!draft.displayName.trim() || draft.displayName.trim().length > 50 || !draft.reason.trim()) {
          this.setData({ userError: '请填写有效姓名与修改原因' }); return
        }
        wx.showModal({ title: '确认修改用户？',
          content: `${draft.userId}\n显示姓名：${draft.displayName.trim()}\n原因：${draft.reason.trim()}`,
          confirmText: '确认保存', success: result => { if (result.confirm) this.commitUserUpdate() } })
      },
      async commitUserUpdate() {
        const session = getSession()
        const draft = this.data.userDraft
        if (!session || session.user.role !== 'teacher' || !draft || this.data.userBusy) return
        const input: UpdateNativeAdminUserInput = { userId: draft.userId,
          displayName: draft.displayName.trim(), reason: draft.reason.trim() }
        const fingerprint = JSON.stringify([input, draft.expectedVersion])
        const intent = prepareWriteIntent(this.data.userIntent, fingerprint,
          () => createPageOperationId('native_user_update'))
        this.setData({ userBusy: true, userError: '', userIntent: intent })
        const result = await updateNativeAdminUser(session.user.id, input,
          draft.expectedVersion, intent.operationId)
        if (!result.ok) { this.setData({ userBusy: false, userError: result.error.message }); return }
        this.setData({ userBusy: false, userDraft: null, userIntent: EMPTY_WRITE_INTENT },
          () => this.restoreAdminScroll())
        this.loadData(false)
      },
      requestUserDisable() {
        const draft = this.data.userDraft
        if (!draft || draft.status !== 'active' || this.data.userBusy) return
        if (!draft.reason.trim() || draft.reason.length > 200) {
          this.setData({ userError: '停用账号需要填写原因' }); return
        }
        wx.showModal({ title: '确认停用该账号？',
          content: `${draft.userId}\n停用后当前会话和已有权限将立即失效。\n原因：${draft.reason.trim()}`,
          confirmText: '确认停用', success: result => { if (result.confirm) this.commitUserDisable() } })
      },
      async commitUserDisable() {
        const session = getSession()
        const draft = this.data.userDraft
        if (!session || session.user.role !== 'teacher' || !draft || draft.status !== 'active' || this.data.userBusy) return
        const input = { userId: draft.userId, reason: draft.reason.trim() }
        const fingerprint = JSON.stringify([input, draft.expectedVersion])
        const intent = prepareWriteIntent(this.data.userIntent, fingerprint,
          () => createPageOperationId('native_user_disable'))
        this.setData({ userBusy: true, userError: '', userIntent: intent })
        const result = await disableNativeAdminUser(session.user.id, input,
          draft.expectedVersion, intent.operationId)
        if (!result.ok) { this.setData({ userBusy: false, userError: result.error.message }); return }
        this.setData({ userBusy: false, userDraft: null, userIntent: EMPTY_WRITE_INTENT },
          () => this.restoreAdminScroll())
        this.loadData(false)
      },
      openRecordOperation(event: WechatMiniprogram.TouchEvent) {
        if (this.data.status !== 'ready' || !this.data.access
          || config.id === 'A-08' || !this.canOpenAdminPanel()) return
        const row = this.data.recordRows.find(item => item.id === event.currentTarget.dataset.id)
        if (!row || row.kind === 'media') return
        const classIds = row.classIds?.length ? row.classIds
          : this.data.access.scope.organizationWide ? [] : this.data.access.scope.classIds
        this.rememberAdminScroll()
        this.setData({ operationDraft: { id: row.id, kind: row.kind, title: row.title, status: row.status,
          version: row.version, classIdsText: classIds.join('、'),
          organizationWide: row.kind === 'question' && row.organizationWide === true, reason: '' },
        operationError: '', operationIntent: EMPTY_WRITE_INTENT,
        questionPreview: null, questionPreviewError: '', questionPreviewLoading: row.kind === 'question' },
        () => this.focusAdminPanel('admin-question-detail'))
        if (row.kind === 'question') this.loadQuestionPreview(row.id)
      },
      async loadQuestionPreview(questionId: string) {
        const session = getSession()
        if (!session || session.user.role !== 'teacher' || config.id !== 'A-06') return
        const result = await getNativeAdminQuestionPreview(session.user.id, questionId)
        if (!this.data.operationDraft || this.data.operationDraft.id !== questionId
          || getSession()?.user.id !== session.user.id) return
        if (!result.ok) {
          this.setData({ questionPreviewLoading: false,
            questionPreviewError: adminReadErrorMessage(result.error, true) }); return
        }
        this.setData({ questionPreviewLoading: false,
          questionPreview: result.data as NativeAdminQuestionPreviewView, questionPreviewError: '' })
      },
      retryQuestionPreview() {
        const draft = this.data.operationDraft
        if (!draft || draft.kind !== 'question' || this.data.questionPreviewLoading) return
        this.setData({ questionPreviewLoading: true, questionPreviewError: '' })
        this.loadQuestionPreview(draft.id)
      },
      closeRecordOperation() {
        if (!this.data.operationBusy) this.setData({ operationDraft: null, operationError: '',
          questionPreview: null, questionPreviewError: '', questionPreviewLoading: false },
        () => this.restoreAdminScroll())
      },
      openTextbookPreview() {
        const draft = this.data.operationDraft
        if (config.id !== 'A-05' || !draft || draft.kind !== 'textbook' || draft.status !== 'published') {
          wx.showToast({ title: '请先发布教材配置，再查看教师预览', icon: 'none' }); return
        }
        wx.navigateTo({ url: `/subpackages/teacher/synchronized-textbooks/synchronized-textbooks?previewId=${encodeURIComponent(draft.id)}` })
      },
      onOperationReason(event: WechatMiniprogram.Input) {
        if (!this.data.operationDraft) return
        this.setData({ operationDraft: { ...this.data.operationDraft, reason: event.detail.value },
          operationIntent: EMPTY_WRITE_INTENT })
      },
      onOperationClassIds(event: WechatMiniprogram.Input) {
        if (!this.data.operationDraft) return
        this.setData({ operationDraft: { ...this.data.operationDraft, classIdsText: event.detail.value },
          operationIntent: EMPTY_WRITE_INTENT })
      },
      requestRecordOperation(event: WechatMiniprogram.TouchEvent) {
        const draft = this.data.operationDraft
        if (!draft || this.data.operationBusy) return
        const action = event.currentTarget.dataset.action as 'save' | 'publish' | 'offline' | 'stop'
        if (!draft.reason.trim() || draft.reason.trim().length > 200) {
          this.setData({ operationError: '请填写 1—200 字操作原因' }); return
        }
        if (draft.kind === 'textbook' && ['save', 'publish', 'offline'].includes(action)) {
          const classIds = draft.classIdsText.split(/[、,，\s]+/).map(id => id.trim()).filter(Boolean)
          if (!classIds.length || new Set(classIds).size !== classIds.length) {
            this.setData({ operationError: '请填写至少一个不重复的班级 ID' }); return
          }
        } else if (draft.kind === 'question' && action !== 'publish' && action !== 'offline') return
        else if ((draft.kind === 'classroom' || draft.kind === 'activity') && action !== 'stop') return
        else if (draft.kind === 'textbook') return
        const title = draft.kind === 'textbook' && action === 'publish' ? '确认发布教材配置？'
          : draft.kind === 'textbook' && action === 'offline' ? '确认停用教材配置？'
            : action === 'save' ? '确认保存教材配置草稿？'
              : action === 'publish' ? '确认上架习题？'
                : action === 'offline' ? '确认下架习题？' : '确认停用任务或活动？'
        wx.showModal({ title, content: `${draft.title}\n原因：${draft.reason.trim()}\n已发布历史记录将保留。`,
          confirmText: '确认操作', success: result => { if (result.confirm) this.commitRecordOperation(action) } })
      },
      async commitRecordOperation(action: 'save' | 'publish' | 'offline' | 'stop') {
        const session = getSession()
        const draft = this.data.operationDraft
        if (!session || session.user.role !== 'teacher' || !draft || this.data.operationBusy) return
        const classIds = draft.classIdsText.split(/[、,，\s]+/).map(id => id.trim()).filter(Boolean)
        const fingerprint = JSON.stringify([draft.id, draft.kind, draft.version,
          draft.reason.trim(), classIds, action])
        const intent = prepareWriteIntent(this.data.operationIntent, fingerprint,
          () => createPageOperationId('native_record_operation'))
        this.setData({ operationBusy: true, operationError: '', operationIntent: intent })
        const result = draft.kind === 'textbook' && action === 'save'
          ? await saveNativeTextbookConfig(session.user.id, { resourceId: draft.id,
            classIds, reason: draft.reason.trim() }, draft.version, intent.operationId)
          : draft.kind === 'textbook' && (action === 'publish' || action === 'offline')
            ? await setNativeTextbookConfigStatus(session.user.id, { resourceId: draft.id,
              status: action === 'publish' ? 'published' : 'disabled', reason: draft.reason.trim() },
              draft.version, intent.operationId)
          : draft.kind === 'question' && (action === 'publish' || action === 'offline')
            ? await setNativeQuestionStatus(session.user.id, { questionId: draft.id,
              status: action === 'publish' ? 'published' : 'offline',
              reason: draft.reason.trim() }, draft.version, intent.operationId)
            : (draft.kind === 'classroom' || draft.kind === 'activity') && action === 'stop'
              ? await stopNativeManaged(session.user.id, { kind: draft.kind,
                id: draft.id, reason: draft.reason.trim() }, draft.version, intent.operationId)
              : null
        if (!result) { this.setData({ operationBusy: false, operationError: '操作类型无效' }); return }
        if (!result.ok) {
          this.setData({ operationBusy: false, operationError: result.error.message }); return
        }
        this.setData({ operationBusy: false, operationDraft: null,
          operationIntent: EMPTY_WRITE_INTENT }, () => this.restoreAdminScroll())
        this.loadData(false)
      },
      async exportAuthorizedTasks() {
        const session = getSession()
        if (config.id !== 'A-07' || !session || session.user.role !== 'teacher'
          || this.data.status !== 'ready' || this.data.exportBusy) return
        this.setData({ exportBusy: true, exportError: '' })
        const result = await exportNativeAdminRecords(session.user.id, 'tasks', {
          query: this.data.keyword.trim(), status: this.data.statusFilter,
          taskType: this.data.taskTypeFilter, from: this.data.fromDate, to: this.data.toDate,
        })
        if (!result.ok) {
          this.setData({ exportBusy: false, exportError: result.error.message }); return
        }
        wx.setClipboardData({ data: result.data.csv,
          success: () => this.setData({ exportBusy: false }),
          fail: () => this.setData({ exportBusy: false, exportError: '导出复制失败，请重试' }) })
      },
      async openMediaReview(event: WechatMiniprogram.TouchEvent) {
        if (!this.canOpenAdminPanel()) return
        const mediaId = event.currentTarget.dataset.id as string
        this.rememberAdminScroll()
        this.loadMediaSummary(mediaId)
      },
      async loadMediaSummary(mediaId: string) {
        const session = getSession()
        if (config.id !== 'A-08' || !session || session.user.role !== 'teacher'
          || this.data.status !== 'ready') return
        if (!this.data.recordRows.some(row => row.id === mediaId && row.kind === 'media')) return
        this.stopMediaPreview()
        this.setData({ mediaSummary: null, mediaLoading: true, mediaError: '', mediaReason: '',
          mediaPreview: null, mediaPreviewError: '', mediaAuditRows: [],
          mediaAuditNextOffset: null, mediaAuditError: '', mediaIntent: EMPTY_WRITE_INTENT })
        const result = await getNativeAdminMediaReview(session.user.id, mediaId)
        if (getSession()?.user.id !== session.user.id) return
        if (!result.ok) {
          this.setData({ mediaLoading: false, mediaError: result.error.message }); return
        }
        const media = result.data
        this.setData({ mediaSummary: media, mediaLoading: false, mediaCanApprove: false },
          () => this.focusAdminPanel('adminMediaDetailAnchor'))
        this.loadMediaAudit(false)
      },
      closeMediaReview() {
        if (!this.data.mediaBusy) {
          this.stopMediaPreview()
          this.setData({ mediaSummary: null, mediaPreview: null, mediaAuditRows: [],
            mediaError: '', mediaReason: '', mediaIntent: EMPTY_WRITE_INTENT },
          () => this.restoreAdminScroll())
        }
      },
      retryMediaAudit() { this.loadMediaAudit(false) },
      stopMediaPreview() {
        stopAdminMediaAudio()
        if (config.id === 'A-08') wx.createVideoContext('adminMediaVideo', this).pause()
      },
      async loadMediaPreview(mediaId: string) {
        const session = getSession()
        if (config.id !== 'A-08' || !session || session.user.role !== 'teacher'
          || this.data.mediaPreviewLoading) return
        this.stopMediaPreview()
        this.setData({ mediaPreview: null, mediaPreviewLoading: true, mediaPreviewError: '' })
        const result = await getNativeAdminMediaPreview(session.user.id, mediaId)
        if (getSession()?.user.id !== session.user.id || this.data.mediaSummary?.id !== mediaId) return
        if (!result.ok) {
          this.setData({ mediaPreviewLoading: false, mediaPreviewError: result.error.message }); return
        }
        this.setData({ mediaPreview: result.data, mediaPreviewLoading: false })
      },
      openMediaPreview() {
        const mediaId = this.data.mediaSummary?.id
        if (mediaId) this.loadMediaPreview(mediaId)
      },
      playMediaClip(event: WechatMiniprogram.TouchEvent) {
        const preview = this.data.mediaPreview
        const startMs = Number(event.currentTarget.dataset.startMs)
        const endMs = Number(event.currentTarget.dataset.endMs)
        if (!preview || preview.kind !== 'listening'
          || !preview.clips.some(clip => clip.startMs === startMs && clip.endMs === endMs)) {
          this.setData({ mediaPreviewError: '本题片段不可用，请刷新素材预览' }); return
        }
        if (!Number.isFinite(Date.parse(preview.expiresAt))
          || Date.parse(preview.expiresAt) <= Date.now() + 5000) {
          this.setData({ mediaPreviewError: '试听地址已过期，请刷新素材预览' }); return
        }
        stopAdminMediaAudio()
        const audio = wx.createInnerAudioContext()
        adminMediaAudio = audio
        adminMediaClipStartMs = startMs
        adminMediaClipEndMs = endMs
        audio.src = preview.temporaryUrl
        audio.onCanplay(() => {
          if (adminMediaAudio === audio && adminMediaClipStartMs !== null)
            audio.seek(adminMediaClipStartMs / 1000)
        })
        audio.onSeeked(() => {
          if (adminMediaAudio !== audio || adminMediaClipStartMs === null) return
          adminMediaClipStartMs = null
          audio.play()
        })
        audio.onTimeUpdate(() => {
          if (adminMediaAudio === audio && audio.currentTime * 1000 >= adminMediaClipEndMs)
            stopAdminMediaAudio()
        })
        audio.onEnded(() => { if (adminMediaAudio === audio) stopAdminMediaAudio() })
        audio.onError(() => {
          if (adminMediaAudio === audio) stopAdminMediaAudio()
          this.setData({ mediaPreviewError: '试听失败，请刷新素材预览后重试' })
        })
        this.setData({ mediaPreviewError: '' })
      },
      async loadMediaAudit(append = false) {
        const mediaId = this.data.mediaSummary?.id
        const session = getSession()
        if (config.id !== 'A-08' || !mediaId || !session || session.user.role !== 'teacher'
          || this.data.mediaAuditLoading || append && this.data.mediaAuditNextOffset === null) return
        this.setData({ mediaAuditLoading: true, mediaAuditError: '' })
        const result = await listNativeAdminMediaAudit(session.user.id, mediaId, 20,
          append ? this.data.mediaAuditNextOffset ?? 0 : 0)
        if (getSession()?.user.id !== session.user.id || this.data.mediaSummary?.id !== mediaId) return
        if (!result.ok) {
          this.setData({ mediaAuditLoading: false, mediaAuditError: result.error.message }); return
        }
        this.setData({ mediaAuditLoading: false,
          mediaAuditRows: append ? [...this.data.mediaAuditRows, ...result.data.items] : result.data.items,
          mediaAuditNextOffset: result.data.nextOffset })
      },
      loadMoreMediaAudit() { this.loadMediaAudit(true) },
      onMediaReason(event: WechatMiniprogram.Input) {
        this.setData({ mediaReason: event.detail.value, mediaIntent: EMPTY_WRITE_INTENT })
      },
      requestMediaAction(event: WechatMiniprogram.TouchEvent) {
        const media = this.data.mediaSummary
        if (!media || this.data.mediaBusy) return
        if (event.currentTarget.dataset.action !== 'unpublish') return
        if (!this.data.mediaReason.trim()) {
          this.setData({ mediaError: '下架必须填写原因' }); return
        }
        if (media.status !== 'published') return
        wx.showModal({ title: '确认下架素材？',
          content: `${media.title}\n当前版本 ${media.recordVersion}\n原因：${this.data.mediaReason.trim()}`,
          confirmText: '确认下架', success: result => { if (result.confirm) this.commitMediaAction('unpublish') } })
      },
      async commitMediaAction(action: 'unpublish') {
        const session = getSession()
        const media = this.data.mediaSummary
        if (!session || session.user.role !== 'teacher' || !media || this.data.mediaBusy) return
        const fingerprint = JSON.stringify([media.id, media.recordVersion, action,
          this.data.mediaReason.trim()])
        const intent = prepareWriteIntent(this.data.mediaIntent, fingerprint,
          () => createPageOperationId('native_media_review'))
        this.setData({ mediaBusy: true, mediaError: '', mediaIntent: intent })
        const result = await unpublishNativeAdminMedia(session.user.id, media.id,
          this.data.mediaReason.trim(), media.recordVersion, intent.operationId)
        if (!result.ok) {
          this.setData({ mediaBusy: false, mediaError: result.error.message }); return
        }
        this.setData({ mediaBusy: false, mediaIntent: EMPTY_WRITE_INTENT,
          mediaReason: '' })
        this.loadData(false)
        this.loadMediaSummary(media.id)
      },
      async reportMediaIssue() {
        const session = getSession()
        const media = this.data.mediaSummary
        const reason = this.data.mediaReason.trim()
        if (config.id !== 'A-08' || !session || session.user.role !== 'teacher'
          || !media || this.data.mediaBusy) return
        if (!reason || reason.length > 300) {
          this.setData({ mediaError: '请填写 1—300 字的问题说明' }); return
        }
        const intent = prepareWriteIntent(this.data.mediaIntent,
          JSON.stringify([media.id, media.recordVersion, reason, 'report']),
          () => createPageOperationId('native_media_issue'))
        this.setData({ mediaBusy: true, mediaError: '', mediaIntent: intent })
        const result = await reportNativeAdminMediaIssue(session.user.id, media.id,
          reason, media.recordVersion, intent.operationId)
        if (getSession()?.user.id !== session.user.id) return
        if (!result.ok) {
          this.setData({ mediaBusy: false, mediaError: result.error.message }); return
        }
        this.setData({ mediaBusy: false, mediaReason: '', mediaIntent: EMPTY_WRITE_INTENT })
        this.loadMediaAudit(false)
        this.loadMediaSummary(media.id)
      },
      onKeyword(event: WechatMiniprogram.Input) {
        if (config.id !== 'A-01') { this.setData({ keyword: event.detail.value }); return }
        const keyword = event.detail.value.trim().toLocaleLowerCase()
        const permissions = this.data.access?.permissions ?? []
        this.setData({ keyword: event.detail.value, filteredModules: config.modules.filter(module =>
          (!module.permission || permissions.includes(module.permission))
          && `${module.title} ${module.description}`.toLocaleLowerCase().includes(keyword)) })
      },
      applyFilters() {
        this.setData({ nextOffset: null, classRows: [], userRows: [], grantRows: [], recordRows: [],
          selectedQuestionIds: [], questionBatchDraft: null },
          () => {
            this.loadData(false)
            if (config.id === 'A-04') this.loadGrantCandidates(false)
          })
      },
      onStatusFilter(event: WechatMiniprogram.TouchEvent) {
        const status = event.currentTarget.dataset.status as string
        this.setData({ statusFilter: status === 'all' ? '' : status }, () => this.applyFilters())
      },
      onTaskTypeFilter(event: WechatMiniprogram.TouchEvent) {
        const taskType = event.currentTarget.dataset.type as 'all' | 'classroom' | 'activity'
        if (!['all', 'classroom', 'activity'].includes(taskType)) return
        this.setData({ taskTypeFilter: taskType }, () => this.applyFilters())
      },
      onMediaKindFilter(event: WechatMiniprogram.TouchEvent) {
        if (config.id !== 'A-08') return
        const kind = event.currentTarget.dataset.kind as 'all' | '' | 'listening' | 'video' | 'dubbing'
        const normalized = kind === 'all' ? '' : kind
        if (!['', 'listening', 'video', 'dubbing'].includes(normalized)) return
        this.setData({ mediaKindFilter: normalized }, () => this.applyFilters())
      },
      onRecordDate(event: WechatMiniprogram.Input) {
        const field = event.currentTarget.dataset.field as 'fromDate' | 'toDate'
        if (field !== 'fromDate' && field !== 'toDate') return
        const value = event.detail.value
        this.setData(field === 'fromDate' ? { fromDate: value } : { toDate: value },
          () => this.applyFilters())
      },
      onOverviewDate(event: WechatMiniprogram.Input) {
        const field = event.currentTarget.dataset.field as 'overviewFromDate' | 'overviewToDate'
        if (field !== 'overviewFromDate' && field !== 'overviewToDate') return
        const value = event.detail.value
        this.setData(field === 'overviewFromDate' ? { overviewFromDate: value } : { overviewToDate: value })
      },
      applyOverviewRange() {
        if (!this.data.overviewFromDate || !this.data.overviewToDate
          || this.data.overviewFromDate > this.data.overviewToDate) {
          this.setData({ dataError: '请选择有效的统计日期范围' }); return
        }
        this.loadData(false)
      },
      toggleQuestionSelection(event: WechatMiniprogram.TouchEvent) {
        if (config.id !== 'A-06' || this.data.status !== 'ready') return
        if (this.data.questionBatchDraft) {
          wx.showToast({ title: '请先关闭批量操作', icon: 'none' })
          return
        }
        const questionId = event.currentTarget.dataset.id as string
        if (!this.data.recordRows.some(row => row.id === questionId && row.kind === 'question')) return
        const selected = new Set(this.data.selectedQuestionIds)
        if (selected.has(questionId)) selected.delete(questionId)
        else selected.add(questionId)
        if (selected.size > 50) { wx.showToast({ title: '一次最多选择 50 道题', icon: 'none' }); return }
        this.setData({ selectedQuestionIds: [...selected],
          recordRows: this.data.recordRows.map(row => row.id === questionId
            ? { ...row, selected: selected.has(questionId) } : row), questionBatchDraft: null,
          questionBatchError: '', questionBatchIntent: EMPTY_WRITE_INTENT })
      },
      openQuestionBatch(event: WechatMiniprogram.TouchEvent) {
        if (config.id !== 'A-06' || !this.data.selectedQuestionIds.length
          || !this.canOpenAdminPanel()) return
        const status = event.currentTarget.dataset.status as 'published' | 'offline'
        if (status !== 'published' && status !== 'offline') return
        this.rememberAdminScroll()
        this.setData({ questionBatchDraft: { status, reason: '' }, questionBatchError: '',
          questionBatchIntent: EMPTY_WRITE_INTENT },
        () => this.focusAdminPanel('admin-question-batch'))
      },
      onQuestionBatchReason(event: WechatMiniprogram.Input) {
        if (!this.data.questionBatchDraft) return
        this.setData({ questionBatchDraft: { ...this.data.questionBatchDraft, reason: event.detail.value },
          questionBatchIntent: EMPTY_WRITE_INTENT })
      },
      closeQuestionBatch() {
        if (!this.data.questionBatchBusy) this.setData({ questionBatchDraft: null, questionBatchError: '' },
          () => this.restoreAdminScroll())
      },
      requestQuestionBatch() {
        const draft = this.data.questionBatchDraft
        if (!draft || this.data.questionBatchBusy) return
        if (!draft.reason.trim() || draft.reason.length > 200) {
          this.setData({ questionBatchError: '请填写批量操作原因' }); return
        }
        wx.showModal({ title: draft.status === 'published' ? '确认批量上架题目？' : '确认批量下架题目？',
          content: `已选择 ${this.data.selectedQuestionIds.length} 道题。服务端逐项校验版本和范围；任一冲突则整批不变。\n原因：${draft.reason.trim()}`,
          confirmText: '确认批量操作', success: result => { if (result.confirm) this.commitQuestionBatch() } })
      },
      async commitQuestionBatch() {
        const session = getSession()
        const draft = this.data.questionBatchDraft
        if (!session || session.user.role !== 'teacher' || !draft || this.data.questionBatchBusy) return
        const selected = new Set(this.data.selectedQuestionIds)
        const rows = this.data.recordRows.filter(row => selected.has(row.id) && row.kind === 'question')
        if (!rows.length || rows.length !== selected.size) {
          this.setData({ questionBatchError: '所选题目已不在当前列表，请重新筛选后选择' }); return
        }
        const input: SetNativeQuestionBatchStatusInput = { status: draft.status,
          questions: rows.map(row => ({ questionId: row.id, expectedVersion: row.version })),
          reason: draft.reason.trim() }
        const intent = prepareWriteIntent(this.data.questionBatchIntent, JSON.stringify(input),
          () => createPageOperationId('native_question_batch'))
        this.setData({ questionBatchBusy: true, questionBatchError: '', questionBatchIntent: intent })
        const result = await setNativeQuestionBatchStatus(session.user.id, input, intent.operationId)
        if (!result.ok) { this.setData({ questionBatchBusy: false, questionBatchError: result.error.message }); return }
        this.setData({ questionBatchBusy: false, questionBatchDraft: null,
          selectedQuestionIds: [], questionBatchIntent: EMPTY_WRITE_INTENT },
        () => this.restoreAdminScroll())
        this.loadData(false)
      },
      openModule(event: WechatMiniprogram.TouchEvent) {
        if (this.data.status !== 'ready' || !this.data.access) return
        const id = event.currentTarget.dataset.id as string
        const module = config.modules.find(item => item.id === id)
        if (!module?.route) {
          wx.showToast({ title: '受保护业务服务尚未接入', icon: 'none' })
          return
        }
        if (module.permission && !this.data.access.permissions.includes(module.permission)) {
          wx.showToast({ title: '当前没有该模块权限', icon: 'none' })
          return
        }
        wx.navigateTo({ url: module.route })
      },
    },
  })
}
