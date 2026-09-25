import { TeacherStudentClassOption, TeacherStudentListItem } from '../../../domain/types'
import { PublishClassroomTaskCommand, TaskDraftOptionsView, getDraftOptions, getTeacherStudent, getTeacherTaskForEdit, listTeacherStudents, publishClassroomTask, saveTeacherTaskDraft, updatePublishedTeacherTask } from '../../../services/app-service'
import { getSession, takeTeacherTaskCopy, takeTeacherTaskTargetStudentId } from '../../../session/session'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'
import { localDateTimeFields, parseTaskSchedule } from '../../../shared/task-schedule'
import { ClassTarget, StudentTarget, TargetMode, eligibleTargetClasses, filterTargetStudents, initialPublishTarget, publishTargetSummary, selectedPublishTarget, targetCapacityError } from './publish-target'
import { publishErrorMessage } from './publish-error'

const MAX_TARGET_PAGES = 50

Component({
  data: {
    title: '',
    description: '',
    teacherNote: '',
    loading: false,
    optionsLoading: true,
    error: '',
    draftOptions: null as TaskDraftOptionsView | null,
    resourceChoices: [] as Array<TaskDraftOptionsView['resources'][number] & { selected: boolean }>,
    resourceSummary: '正在加载已授权资源',
    targetSummary: '正在加载发布对象',
    targetCount: 0,
    targetMode: 'classes' as TargetMode,
    targetEditorOpen: false,
    resourcePickerOpen: false,
    targetKeyword: '',
    targetClasses: [] as ClassTarget[],
    targetStudents: [] as StudentTarget[],
    visibleTargetStudents: [] as StudentTarget[],
    requestedStudentId: '',
    editTaskId: '',
    editingVersion: 0,
    editingStatus: '' as '' | 'draft' | 'scheduled' | 'active' | 'expired' | 'withdrawn' | 'closed' | 'completed',
    originalDueAt: '',
    startsDate: '',
    startsTime: '',
    dueDate: '',
    dueTime: '',
    publishIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    resumePublication: null as { operationId: string; originalVersion: number; completedCount: number; totalCount: number } | null,
  },
  lifetimes: {
    attached() {
      const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
      const requestedStudentId = takeTeacherTaskTargetStudentId() || pages[pages.length - 1]?.options?.studentId || ''
      const editTaskId = pages[pages.length - 1]?.options?.editTaskId ?? ''
      this.setData({ requestedStudentId, editTaskId }, () => this.loadDraftOptions())
    },
  },
  methods: {
    async loadDraftOptions() {
      const session = getSession()
      if (!session) return
      this.setData({ optionsLoading: true, error: '' })
      const result = await getDraftOptions(session.user.id)
      if (!result.ok) {
        this.setData({ optionsLoading: false, error: result.error.message })
        return
      }
      const editResult = this.data.editTaskId ? await getTeacherTaskForEdit(session.user.id, this.data.editTaskId) : null
      if (editResult && !editResult.ok) { this.setData({ optionsLoading: false, error: editResult.error.message }); return }
      const edit = editResult?.ok ? editResult.data : null
      if (edit?.publication) {
        this.setData({ optionsLoading: false, title: edit.title, resumePublication: edit.publication }, () => this.resumePendingPublication())
        return
      }
      const resourceCandidates = [...result.data.resources]
      if (edit && edit.status !== 'draft' && edit.status !== 'scheduled') {
        for (const frozen of edit.items) {
          if (!resourceCandidates.some(item => item.id === frozen.resourceId)) resourceCandidates.push({ id: frozen.resourceId, title: frozen.title, type: frozen.type, requiredCount: 1, allowedClassIds: edit.target.classIds })
        }
      }
      const editItems = edit?.itemRefs.map(item => {
        const resource = resourceCandidates.find(candidate => candidate.id === item.resourceId)
        if (!resource) return null
        const rule = item.completionRule ?? {}
        const requiredCount = typeof rule.requiredPageCount === 'number' ? rule.requiredPageCount
          : typeof rule.requiredWordCount === 'number' ? rule.requiredWordCount
            : typeof rule.requiredQuestionCount === 'number' ? rule.requiredQuestionCount : resource.requiredCount
        const maxScore = typeof item.scoringRule?.maxScore === 'number' ? item.scoringRule.maxScore : 100
        return { id: item.id, resourceId: item.resourceId, type: resource.type, requiredCount, maxScore }
      })
      if (editItems?.some(item => item === null)) { this.setData({ optionsLoading: false, error: '原任务有内容已下架或无权限，无法编辑' }); return }
      const sourceDraft = edit ? {
        ...result.data.structuredDraft,
        items: editItems?.filter((item): item is NonNullable<typeof item> => item !== null) ?? [],
        target: edit.target.type === 'classes' ? { type: 'classes' as const, classIds: edit.target.classIds } : { type: 'students' as const, studentIds: edit.target.studentIds },
        startsAt: edit.startsAt, dueAt: edit.dueAt, latePolicy: edit.latePolicy, teacherNote: edit.teacherNote ?? '',
      } : result.data.structuredDraft
      const authorizedTargets = await loadAuthorizedTargets(session.user.id)
      if ('error' in authorizedTargets) {
        this.setData({ optionsLoading: false, error: authorizedTargets.error })
        return
      }
      let requestedStudent: TeacherStudentListItem | null = null
      if (this.data.requestedStudentId) {
        const student = await getTeacherStudent(session.user.id, this.data.requestedStudentId)
        if (!student.ok) {
          this.setData({ optionsLoading: false, error: '该学员不在当前授权范围，无法发起任务' })
          return
        }
        if (student.data.accountStatus !== 'active') {
          this.setData({ optionsLoading: false, error: '该学员已停用，无法发布任务' })
          return
        }
        requestedStudent = student.data
      }
      const initialTarget = initialPublishTarget(sourceDraft.target, Boolean(edit), this.data.requestedStudentId)
      const initialClassIds = new Set(initialTarget.type === 'classes' ? initialTarget.classIds : [])
      const draftClasses = result.data.availableClasses ?? (initialTarget.type === 'classes'
        ? initialTarget.classIds.map(id => ({ id, name: result.data.selectedClassName }))
        : [])
      const selectedResources = resourceCandidates.filter(resource => sourceDraft.items.some(item => item.resourceId === resource.id))
      const classOptions = eligibleTargetClasses(draftClasses, selectedResources, authorizedTargets.classes)
      const allowedClassIds = new Set(classOptions.map(item => item.id))
      if (requestedStudent && !allowedClassIds.has(requestedStudent.classInfo.id)) {
        this.setData({ optionsLoading: false, error: '当前任务内容不适用于该学员所属班级' })
        return
      }
      const targetClasses: ClassTarget[] = classOptions.map(item => ({ ...item, selected: initialClassIds.has(item.id) }))
      const studentOptions = authorizedTargets.students.filter(item => allowedClassIds.has(item.classInfo.id))
      if (requestedStudent && !studentOptions.some(item => item.studentId === requestedStudent.studentId)) studentOptions.push(requestedStudent)
      const initialStudentIds = new Set(initialTarget.type === 'students' ? initialTarget.studentIds : [])
      const targetStudents: StudentTarget[] = studentOptions.map(item => ({ ...item, selected: initialStudentIds.has(item.studentId) }))
      const targetMode: TargetMode = requestedStudent ? 'students' : initialTarget.type
      const target = selectedPublishTarget(targetMode, targetClasses, targetStudents)
      const targetInfo = publishTargetSummary(targetMode, targetClasses, targetStudents)
      const draftOptions: TaskDraftOptionsView = { ...result.data, resources: resourceCandidates, structuredDraft: { ...sourceDraft, target } }
      const copy = takeTeacherTaskCopy()
      if (copy) {
        const items = copy.items.map((item, index) => {
          const resource = draftOptions.resources.find(candidate => candidate.id === item.resourceId)
          return resource ? { id: `copy_${index}_${resource.id.replace(/[^a-zA-Z0-9_]/g, '_')}`, resourceId: resource.id, type: resource.type, requiredCount: resource.requiredCount, maxScore: 100 } : null
        })
        if (items.some(item => item === null)) {
          this.setData({ optionsLoading: false, error: '原任务有内容已下架或无权限，无法再次布置' })
          return
        }
        draftOptions.structuredDraft.items = items.filter((item): item is NonNullable<typeof item> => item !== null)
      }
      const start = localDateTimeFields(draftOptions.structuredDraft.startsAt)
      const due = localDateTimeFields(draftOptions.structuredDraft.dueAt)
      if (!start || !due) {
        this.setData({ optionsLoading: false, error: '任务时间无法读取，请重试' })
        return
      }
      this.setData({
        optionsLoading: false,
        title: edit?.title ?? copy?.title ?? (this.data.title || `${draftOptions.resources.find(item => item.id === draftOptions.structuredDraft.items[0]?.resourceId)?.title ?? '课堂'}学习任务`),
        description: edit?.description ?? copy?.description ?? this.data.description,
        teacherNote: edit?.teacherNote ?? '',
        editingVersion: edit?.version ?? 0,
        editingStatus: edit?.status ?? '',
        originalDueAt: edit?.dueAt ?? '',
        draftOptions,
        resourceChoices: draftOptions.resources.map(item => ({ ...item, selected: draftOptions.structuredDraft.items.some(selected => selected.resourceId === item.id) })),
        resourceSummary: draftOptions.structuredDraft.items.map(item => draftOptions.resources.find(resource => resource.id === item.resourceId)?.title ?? item.resourceId).join('、'),
        targetSummary: edit && edit.status !== 'draft' && edit.status !== 'scheduled' ? `原任务对象（${edit.target.studentIds.length || targetInfo.count} 人）` : targetInfo.label,
        targetCount: edit && edit.status !== 'draft' && edit.status !== 'scheduled' ? edit.target.studentIds.length || targetInfo.count : targetInfo.count,
        targetMode,
        targetClasses,
        targetStudents,
        visibleTargetStudents: targetStudents,
        startsDate: start.date,
        startsTime: start.time,
        dueDate: due.date,
        dueTime: due.time,
      })
    },
    onTitle(event: WechatMiniprogram.Input) {
      this.setData({ title: event.detail.value, error: '', publishIntent: clearWriteIntent() })
    },
    onDescription(event: WechatMiniprogram.Input) {
      this.setData({ description: event.detail.value, error: '', publishIntent: clearWriteIntent() })
    },
    onTeacherNote(event: WechatMiniprogram.Input) { this.setData({ teacherNote: event.detail.value, error: '', publishIntent: clearWriteIntent() }) },
    toggleResourcePicker() { if (this.data.editingStatus && this.data.editingStatus !== 'draft' && this.data.editingStatus !== 'scheduled') return; this.setData({ resourcePickerOpen: !this.data.resourcePickerOpen }) },
    toggleResource(event: WechatMiniprogram.TouchEvent) {
      const resourceId = event.currentTarget.dataset.id as string
      const options = this.data.draftOptions
      if (!options || (this.data.editingStatus && this.data.editingStatus !== 'draft' && this.data.editingStatus !== 'scheduled')) return
      const resource = options.resources.find(item => item.id === resourceId)
      if (!resource) return
      const existing = options.structuredDraft.items
      if (!existing.some(item => item.resourceId === resourceId) && resource.allowedClassIds) {
        const selectedClasses = this.data.targetMode === 'classes'
          ? this.data.targetClasses.filter(item => item.selected).map(item => item.id)
          : this.data.targetStudents.filter(item => item.selected).map(item => item.classInfo.id)
        if (selectedClasses.some(classId => !resource.allowedClassIds?.includes(classId))) {
          wx.showToast({ title: '该内容不适用于已选对象', icon: 'none' })
          return
        }
      }
      const items = existing.some(item => item.resourceId === resourceId)
        ? existing.filter(item => item.resourceId !== resourceId)
        : [...existing, { id: `item_${resourceId.replace(/[^a-zA-Z0-9_]/g, '_')}`, resourceId, type: resource.type, requiredCount: resource.requiredCount, maxScore: 100 }]
      this.setData({ draftOptions: { ...options, structuredDraft: { ...options.structuredDraft, items } }, resourceChoices: options.resources.map(item => ({ ...item, selected: items.some(selected => selected.resourceId === item.id) })), resourceSummary: items.map(item => options.resources.find(resource => resource.id === item.resourceId)?.title ?? item.resourceId).join('、') || '尚未选择内容', error: '', publishIntent: clearWriteIntent() })
    },
    onStartDate(event: WechatMiniprogram.PickerChange) { this.setData({ startsDate: event.detail.value as string, error: '', publishIntent: clearWriteIntent() }) },
    onStartTime(event: WechatMiniprogram.PickerChange) { this.setData({ startsTime: event.detail.value as string, error: '', publishIntent: clearWriteIntent() }) },
    onDueDate(event: WechatMiniprogram.PickerChange) { this.setData({ dueDate: event.detail.value as string, error: '', publishIntent: clearWriteIntent() }) },
    onDueTime(event: WechatMiniprogram.PickerChange) { this.setData({ dueTime: event.detail.value as string, error: '', publishIntent: clearWriteIntent() }) },
    toggleTargetEditor() { if (!this.data.optionsLoading && !this.data.loading && !this.data.requestedStudentId) this.setData({ targetEditorOpen: !this.data.targetEditorOpen }) },
    chooseTargetMode(event: WechatMiniprogram.TouchEvent) {
      const targetMode = event.currentTarget.dataset.mode as TargetMode
      if (this.data.requestedStudentId) return
      this.setData({ targetMode }, () => this.updateTarget())
    },
    toggleTargetClass(event: WechatMiniprogram.TouchEvent) {
      if (this.data.requestedStudentId) return
      const id = event.currentTarget.dataset.id as string
      const targetClasses = this.data.targetClasses.map(item => item.id === id ? { ...item, selected: !item.selected } : item)
      this.setData({ targetClasses }, () => this.updateTarget())
    },
    toggleTargetStudent(event: WechatMiniprogram.TouchEvent) {
      if (this.data.requestedStudentId) return
      const id = event.currentTarget.dataset.id as string
      const targetStudents = this.data.targetStudents.map(item => item.studentId === id ? { ...item, selected: !item.selected } : item)
      this.setData({ targetStudents, visibleTargetStudents: filterTargetStudents(targetStudents, this.data.targetKeyword) }, () => this.updateTarget())
    },
    onTargetSearch(event: WechatMiniprogram.Input) {
      const targetKeyword = event.detail.value
      this.setData({ targetKeyword, visibleTargetStudents: filterTargetStudents(this.data.targetStudents, targetKeyword) })
    },
    updateTarget() {
      if (!this.data.draftOptions) return
      const target = selectedPublishTarget(this.data.targetMode, this.data.targetClasses, this.data.targetStudents)
      const targetInfo = publishTargetSummary(this.data.targetMode, this.data.targetClasses, this.data.targetStudents)
      this.setData({
        draftOptions: { ...this.data.draftOptions, structuredDraft: { ...this.data.draftOptions.structuredDraft, target } },
        targetSummary: targetInfo.label,
        targetCount: targetInfo.count,
        error: targetCapacityError(targetInfo.count) ?? '',
        publishIntent: clearWriteIntent(),
      })
    },
    buildCommand(mode: 'publish' | 'draft'): PublishClassroomTaskCommand | null {
      const session = getSession()
      if (!session || this.data.loading || this.data.optionsLoading) return null
      if (!this.data.draftOptions) {
        this.setData({ error: '任务资源尚未加载，请重试' })
        return null
      }
      const target = selectedPublishTarget(this.data.targetMode, this.data.targetClasses, this.data.targetStudents)
      const targetInfo = publishTargetSummary(this.data.targetMode, this.data.targetClasses, this.data.targetStudents)
      if (this.data.requestedStudentId && (target.type !== 'students' || target.studentIds.length !== 1 || target.studentIds[0] !== this.data.requestedStudentId)) {
        this.setData({ error: '从学员详情发起的任务只能布置给该学员' })
        return null
      }
      if (targetInfo.count === 0 && (!this.data.editingStatus || this.data.editingStatus === 'draft' || this.data.editingStatus === 'scheduled')) { this.setData({ error: '请至少选择一位可发布的学员' }); return null }
      const capacityError = targetCapacityError(targetInfo.count)
      if (capacityError && (!this.data.editingStatus || this.data.editingStatus === 'draft' || this.data.editingStatus === 'scheduled')) { this.setData({ error: capacityError }); return null }
      if (!this.data.draftOptions.structuredDraft.items.length) { this.setData({ error: '请至少选择一项任务内容' }); return null }
      if (!this.data.title.trim() || this.data.title.trim().length > 50) { this.setData({ error: '任务名称须为 1—50 字' }); return null }
      if (this.data.description.length > 300 || this.data.teacherNote.length > 100) { this.setData({ error: '描述或教师备注超出字数限制' }); return null }
      const schedule = parseTaskSchedule(
        { date: this.data.startsDate, time: this.data.startsTime },
        { date: this.data.dueDate, time: this.data.dueTime },
      )
      if (!schedule.ok) { this.setData({ error: schedule.message }); return null }
      const structuredDraft = { ...this.data.draftOptions.structuredDraft, target, startsAt: schedule.startsAt, dueAt: schedule.dueAt, teacherNote: this.data.teacherNote.trim() }
      const normalizedInput = JSON.stringify({ mode, taskId: this.data.editTaskId, version: this.data.editingVersion, title: this.data.title.trim(), description: this.data.description.trim(), structuredDraft })
      const writeIntent = prepareWriteIntent(this.data.publishIntent, normalizedInput, () => createPageOperationId(mode === 'draft' ? 'save_teacher_draft' : 'publish_task'))
      this.setData({ error: '', publishIntent: writeIntent })
      return {
        ...(this.data.editTaskId ? { taskId: this.data.editTaskId } : {}),
        operationId: writeIntent.operationId,
        expectedVersion: this.data.editingVersion,
        title: this.data.title,
        description: this.data.description,
        structuredDraft,
      }
    },
    async saveDraft() {
      if (this.data.resumePublication) return
      if (this.data.editingStatus && this.data.editingStatus !== 'draft') return
      const command = this.buildCommand('draft')
      const session = getSession()
      if (!command || !session) return
      this.setData({ loading: true })
      const result = await saveTeacherTaskDraft(session.user.id, command)
      this.setData({ loading: false })
      if (!result.ok) { this.setData({ error: publishErrorMessage(result.error), ...(result.error.code === 'VALIDATION_ERROR' ? { publishIntent: clearWriteIntent() } : {}) }); return }
      wx.showToast({ title: '草稿已保存', icon: 'success' })
      setTimeout(() => wx.redirectTo({ url: '/pages/teacher/task-review-list/task-review-list' }), 400)
    },
    publish() {
      if (this.data.resumePublication) { this.resumePendingPublication(); return }
      const command = this.buildCommand('publish')
      if (!command) return
      const editingPublished = this.data.editingStatus && this.data.editingStatus !== 'draft'
      const targetInfo = publishTargetSummary(this.data.targetMode, this.data.targetClasses, this.data.targetStudents)
      const targetLabel = this.data.editingStatus && this.data.editingStatus !== 'draft' && this.data.editingStatus !== 'scheduled'
        ? this.data.targetSummary : `${command.structuredDraft?.target.type === 'students' ? '按学员' : '按班级'}：${targetInfo.label}`
      wx.showModal({ title: editingPublished ? '确认修改任务' : '学生视角预览', content: `${command.title.trim()}\n内容：${this.data.resourceSummary}\n要求：${command.description.trim() || '无额外要求'}\n发布对象：${targetLabel}\n截止 ${this.data.dueDate} ${this.data.dueTime}。`, confirmText: editingPublished ? '保存修改' : '确认发布', success: result => { if (result.confirm) { if (editingPublished) this.commitUpdate(command); else this.commitPublish(command) } } })
    },
    async commitUpdate(command: PublishClassroomTaskCommand) {
      const session = getSession()
      if (!session || this.data.loading || !this.data.editingStatus) return
      this.setData({ loading: true })
      const result = await updatePublishedTeacherTask(session.user.id, command, this.data.editingStatus, this.data.originalDueAt)
      this.setData({ loading: false })
      if (!result.ok) { this.setData({ error: publishErrorMessage(result.error), ...(result.error.code === 'VALIDATION_ERROR' ? { publishIntent: clearWriteIntent() } : {}) }); return }
      wx.showToast({ title: '任务已更新', icon: 'success' })
      setTimeout(() => wx.redirectTo({ url: '/pages/teacher/task-review-list/task-review-list' }), 400)
    },
    async commitPublish(command: PublishClassroomTaskCommand) {
      const session = getSession()
      if (!session || this.data.loading) return
      this.setData({ loading: true })
      const result = await publishClassroomTask(session.user.id, command)
      if (!result.ok) {
        this.setData({ loading: false, error: publishErrorMessage(result.error), ...(result.error.code === 'VALIDATION_ERROR' ? { publishIntent: clearWriteIntent() } : {}) })
        return
      }
      this.setData({ loading: false, publishIntent: clearWriteIntent() })
      wx.showToast({ title: '任务已发布', icon: 'success' })
      setTimeout(() => wx.redirectTo({ url: '/pages/teacher/task-center/task-center' }), 400)
    },
    async resumePendingPublication() {
      const session = getSession()
      const pending = this.data.resumePublication
      if (!session || !pending || !this.data.editTaskId || this.data.loading) return
      this.setData({ loading: true, error: '' })
      const result = await publishClassroomTask(session.user.id, {
        taskId: this.data.editTaskId, operationId: pending.operationId, expectedVersion: pending.originalVersion,
        title: this.data.title, description: '', resumePublication: true,
      })
      this.setData({ loading: false })
      if (!result.ok) { this.setData({ error: publishErrorMessage(result.error) }); return }
      wx.showToast({ title: '任务已发布', icon: 'success' })
      setTimeout(() => wx.redirectTo({ url: '/pages/teacher/task-review-list/task-review-list' }), 400)
    },
  },
})

async function loadAuthorizedTargets(userId: string): Promise<{ classes: TeacherStudentClassOption[]; students: TeacherStudentListItem[] } | { error: string }> {
  const classes = new Map<string, TeacherStudentClassOption>()
  const students = new Map<string, TeacherStudentListItem>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < MAX_TARGET_PAGES; page++) {
    const result = await listTeacherStudents(userId, { status: 'all' }, cursor)
    if (!result.ok) return { error: result.error.message }
    for (const item of result.data.classes) classes.set(item.id, item)
    for (const item of result.data.items) if (item.accountStatus === 'active') students.set(item.studentId, item)
    const nextCursor = result.data.nextCursor
    if (!nextCursor) return { classes: [...classes.values()], students: [...students.values()] }
    if (seenCursors.has(nextCursor)) return { error: '学员列表分页异常，请重试' }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }
  return { error: '授权学员过多，暂无法加载发布对象' }
}
