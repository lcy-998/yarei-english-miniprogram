import { TaskTemplateView, TeacherStudentClassOption, TeacherStudentListItem } from '../../../domain/types'
import { PublishClassroomTaskCommand, TaskDraftOptionsView, getCatalogDraftOptions, getSchoolQuestion, getTaskCatalogResource, getTaskTemplate, getTeacherStudent, getTeacherTaskForEdit, listTeacherStudents, publishClassroomTask, saveTaskTemplate, saveTeacherTaskDraft, updatePublishedTeacherTask } from '../../../services/app-service'
import { clearTeacherCatalogResultIds, clearTeacherSelectedResourceIds, getSession, getTeacherCatalogResultIds, getTeacherReadingSelection, getTeacherSelectedResourceIds, setTeacherCatalogInitialIds, takeTeacherReadingSelection, takeTeacherTaskCopy, takeTeacherTaskTargetStudentId, takeTeacherTemplateSeed } from '../../../session/session'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'
import { localDateTimeFields, parseTaskSchedule } from '../../../shared/task-schedule'
import { ClassTarget, StudentTarget, TargetMode, eligibleTargetClasses, filterTargetStudents, initialPublishTarget, publishTargetSummary, selectedPublishTarget, targetCapacityError } from './publish-target'
import { publishErrorMessage } from './publish-error'
import { mergeSelectedQuestionResources } from './selected-question-resources'
import { replaceSelectedCatalogResources } from './selected-catalog-resources'
import { getRecordingPrompt } from '../../../services/task-recording-service'
import { itemWeightError, itemWeightLabels, updateItemWeight } from './score-weights'
import { templateItemRefsFromDraft } from './template-item-refs'
import { copyTaskItems } from './copy-task-items'

const MAX_TARGET_PAGES = 50

function readingPageIds(rule: Record<string, unknown> | undefined): string[] | undefined {
  return Array.isArray(rule?.pageIds) && rule.pageIds.length > 0
    && rule.pageIds.every(id => typeof id === 'string' && !!id.trim())
    ? [...rule.pageIds] as string[] : undefined
}

function selectedContentSummary(items: TaskDraftOptionsView['structuredDraft']['items'],
  resources: TaskDraftOptionsView['resources']): string {
  return items.map(item => `${resources.find(resource => resource.id === item.resourceId)?.title ?? item.resourceId}${item.pageIds ? `（指定 ${item.pageIds.length} 页）` : ''}`).join('、') || '尚未选择内容'
}

function weightRowsFor(options: TaskDraftOptionsView): Array<{ id: string; title: string; value: string }> {
  const items = options.structuredDraft.items
  const labels = itemWeightLabels(items)
  return items.map((item, index) => ({ id: item.id,
    title: options.resources.find(resource => resource.id === item.resourceId)?.title ?? item.resourceId,
    value: labels[index] ?? '' }))
}

function showsWeightEditor(options: TaskDraftOptionsView): boolean {
  return options.structuredDraft.items.length > 1
    || options.structuredDraft.items.some(item => item.weightPercent !== undefined)
}

async function loadResourceCandidate(userId: string, resourceId: string, classIds: string[]): Promise<TaskDraftOptionsView['resources'][number] | null> {
  const scope = classIds.length ? classIds : undefined
  const learning = await getTaskCatalogResource(userId, resourceId, scope)
  if (learning.ok) return { id: resourceId, title: learning.data.title, type: learning.data.type,
    requiredCount: learning.data.requiredCount, ...(scope ? { allowedClassIds: [...scope] } : {}) }
  const recording = await getRecordingPrompt(userId, resourceId, scope)
  if (recording.ok) return { id: resourceId, title: recording.data.title, type: 'recording',
    requiredCount: 1, allowedClassIds: [...recording.data.allowedClassIds] }
  const question = await getSchoolQuestion(userId, resourceId, scope)
  return question.ok ? { id: resourceId, title: question.data.title, type: 'exercise', requiredCount: 1,
    ...(scope ? { allowedClassIds: [...scope] } : {}) } : null
}

Component({
  data: {
    title: '',
    initialized: false,
    description: '',
    teacherNote: '',
    loading: false,
    optionsLoading: true,
    error: '',
    draftOptions: null as TaskDraftOptionsView | null,
    resourceChoices: [] as Array<TaskDraftOptionsView['resources'][number] & { selected: boolean }>,
    resourceSummary: '正在加载已授权资源',
    weightRows: [] as Array<{ id: string; title: string; value: string }>,
    showWeightEditor: false,
    weightError: '',
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
    templateSaveIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    templateSeed: null as TaskTemplateView | null,
    templateId: '',
    editingTemplate: false,
    resumePublication: null as { operationId: string; originalVersion: number; completedCount: number; totalCount: number } | null,
  },
  pageLifetimes: { show() {
    if (!this.data.initialized) {
      const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
      const requestedStudentId = takeTeacherTaskTargetStudentId() || pages[pages.length - 1]?.options?.studentId || ''
      const editTaskId = pages[pages.length - 1]?.options?.editTaskId ?? ''
      const options = pages[pages.length - 1]?.options
      const templateId = options?.editTemplateId || ''
      const templateSeed = templateId ? takeTeacherTemplateSeed() : null
      this.setData({ initialized: true, requestedStudentId, editTaskId, templateId,
        editingTemplate: Boolean(templateId), templateSeed: templateId ? templateSeed : null }, () => this.loadDraftOptions())
      return
    }
    if (this.data.draftOptions && !this.data.optionsLoading) {
      if (getTeacherCatalogResultIds() !== null) this.applySelectedCatalogResources()
      else this.applySelectedQuestionResources()
    }
  } },
  methods: {
    async loadDraftOptions() {
      const session = getSession()
      if (!session) return
      this.setData({ optionsLoading: true, error: '' })
      const result = await getCatalogDraftOptions(session.user.id)
      if (!result.ok) {
        this.setData({ optionsLoading: false, error: result.error.message })
        return
      }
      const editResult = this.data.editTaskId ? await getTeacherTaskForEdit(session.user.id, this.data.editTaskId) : null
      if (editResult && !editResult.ok) { this.setData({ optionsLoading: false, error: editResult.error.message }); return }
      const edit = editResult?.ok ? editResult.data : null
      const copiedDraft = Boolean(edit?.copiedFromTaskId || edit?.copiedFromTemplateId)
      if (edit?.publication) {
        this.setData({ optionsLoading: false, title: edit.title, resumePublication: edit.publication }, () => this.resumePendingPublication())
        return
      }
      const authorizedTargets = await loadAuthorizedTargets(session.user.id)
      if ('error' in authorizedTargets) {
        this.setData({ optionsLoading: false, error: authorizedTargets.error })
        return
      }
      const resourceCandidates = [...result.data.resources]
      if (edit && (edit.status === 'draft' || edit.status === 'scheduled')) {
        for (const reference of edit.itemRefs) {
          if (copiedDraft) {
            const allowedClassIds: string[] = []
            let candidate: TaskDraftOptionsView['resources'][number] | null = null
            for (const classId of authorizedTargets.classes.map(item => item.id)) {
              const scoped = await loadResourceCandidate(session.user.id, reference.resourceId, [classId])
              if (scoped) { allowedClassIds.push(classId); candidate ??= scoped }
            }
            if (!candidate) { this.setData({ optionsLoading: false, error: '原任务有内容已下架或无权限，无法再次布置' }); return }
            const resource = { ...candidate, allowedClassIds }
            const existing = resourceCandidates.findIndex(item => item.id === reference.resourceId)
            if (existing < 0) resourceCandidates.push(resource)
            else resourceCandidates[existing] = resource
          } else if (!resourceCandidates.some(item => item.id === reference.resourceId)) {
            const resource = await loadResourceCandidate(session.user.id, reference.resourceId, edit.target.classIds)
            if (resource) resourceCandidates.push(resource)
          }
        }
      }
      if (edit && edit.status !== 'draft' && edit.status !== 'scheduled') {
        for (const frozen of edit.items) {
          if (!resourceCandidates.some(item => item.id === frozen.resourceId)) resourceCandidates.push({ id: frozen.resourceId, title: frozen.title, type: frozen.type, requiredCount: 1, allowedClassIds: edit.target.classIds })
        }
      }
      const editItems = edit?.itemRefs.map((item): TaskDraftOptionsView['structuredDraft']['items'][number] | null => {
        const resource = resourceCandidates.find(candidate => candidate.id === item.resourceId)
        if (!resource) return null
        const rule = item.completionRule ?? {}
        const requiredCount = typeof rule.requiredPageCount === 'number' ? rule.requiredPageCount
          : typeof rule.requiredWordCount === 'number' ? rule.requiredWordCount
            : typeof rule.requiredQuestionCount === 'number' ? rule.requiredQuestionCount : resource.requiredCount
        const maxScore = typeof item.scoringRule?.maxScore === 'number' ? item.scoringRule.maxScore : 100
        return { id: item.id, resourceId: item.resourceId, type: resource.type, requiredCount, maxScore,
          ...(resource.type === 'reading' && readingPageIds(rule) ? { pageIds: readingPageIds(rule) } : {}),
          ...(item.scoringRule?.kind === 'automatic' || item.scoringRule?.kind === 'manual'
            ? { scoringKind: item.scoringRule.kind } : {}),
          ...(typeof item.scoringRule?.weightPercent === 'number'
            ? { weightPercent: item.scoringRule.weightPercent } : {}) }
      })
      if (editItems?.some(item => item === null)) { this.setData({ optionsLoading: false, error: '原任务有内容已下架或无权限，无法编辑' }); return }
      let sourceDraft = edit ? {
        ...result.data.structuredDraft,
        items: editItems?.filter((item): item is NonNullable<typeof item> => item !== null) ?? [],
        target: edit.target.type === 'classes' ? { type: 'classes' as const, classIds: edit.target.classIds } : { type: 'students' as const, studentIds: edit.target.studentIds },
        startsAt: copiedDraft && !edit.startsAt ? result.data.structuredDraft.startsAt : edit.startsAt,
        dueAt: copiedDraft && !edit.dueAt ? result.data.structuredDraft.dueAt : edit.dueAt,
        latePolicy: edit.latePolicy, teacherNote: edit.teacherNote ?? '',
      } : result.data.structuredDraft
      let templateSeed = this.data.templateSeed
      if (!edit && this.data.templateId && !templateSeed) {
        const loaded = await getTaskTemplate(session.user.id, this.data.templateId)
        if (!loaded.ok) { this.setData({ optionsLoading: false, error: loaded.error.message }); return }
        templateSeed = loaded.data
        this.setData({ templateSeed })
      }
      if (!edit && templateSeed) {
        if (this.data.templateId && templateSeed.id !== this.data.templateId) {
          this.setData({ optionsLoading: false, error: '模板来源不一致，请返回模板列表重试' }); return
        }
        const allClassIds = authorizedTargets.classes.map(item => item.id)
        const templateItems: TaskDraftOptionsView['structuredDraft']['items'] = []
        for (const reference of templateSeed.itemRefs) {
          let resource = resourceCandidates.find(item => item.id === reference.resourceId)
          const allowedClassIds: string[] = []
          for (const classId of allClassIds) {
            const candidate = await loadResourceCandidate(session.user.id, reference.resourceId, [classId])
            if (candidate) { allowedClassIds.push(classId); resource ??= candidate }
          }
          if (!resource || !allowedClassIds.length) {
            this.setData({ optionsLoading: false, error: '模板中有内容已下架或无权限，请编辑模板后重试' }); return
          }
          const existing = resourceCandidates.findIndex(item => item.id === reference.resourceId)
          const authorizedResource = { ...resource, allowedClassIds }
          if (existing < 0) resourceCandidates.push(authorizedResource)
          else resourceCandidates[existing] = authorizedResource
          const rule = reference.completionRule
          const requiredCount = typeof rule.requiredPageCount === 'number' ? rule.requiredPageCount
            : typeof rule.requiredWordCount === 'number' ? rule.requiredWordCount
              : typeof rule.requiredQuestionCount === 'number' ? rule.requiredQuestionCount : resource.requiredCount
          const maxScore = typeof reference.scoringRule.maxScore === 'number' ? reference.scoringRule.maxScore : 100
          templateItems.push({ id: reference.id, resourceId: reference.resourceId,
            type: resource.type, requiredCount, maxScore,
            ...(resource.type === 'reading' && readingPageIds(rule) ? { pageIds: readingPageIds(rule) } : {}),
            ...(reference.scoringRule.kind === 'automatic' || reference.scoringRule.kind === 'manual'
              ? { scoringKind: reference.scoringRule.kind } : {}),
            ...(typeof reference.scoringRule.weightPercent === 'number'
              ? { weightPercent: reference.scoringRule.weightPercent } : {}) })
        }
        const commonClasses = allClassIds.filter(id => templateItems.every(item =>
          resourceCandidates.find(resource => resource.id === item.resourceId)?.allowedClassIds?.includes(id)))
        if (!commonClasses.length) {
          this.setData({ optionsLoading: false, error: '模板内容没有共同的授权班级，无法布置' }); return
        }
        sourceDraft = { ...sourceDraft, items: templateItems,
          target: { type: 'classes', classIds: [commonClasses[0]!] } }
      }
      const copy = !edit && !templateSeed ? takeTeacherTaskCopy() : null
      if (copy) {
        const classIds = authorizedTargets.classes.map(item => item.id)
        for (const resourceId of new Set(copy.items.map(item => item.resourceId))) {
          const allowedClassIds: string[] = []
          let candidate: TaskDraftOptionsView['resources'][number] | null = null
          for (const classId of classIds) {
            const scoped = await loadResourceCandidate(session.user.id, resourceId, [classId])
            if (scoped) { allowedClassIds.push(classId); candidate ??= scoped }
          }
          if (!candidate) {
            this.setData({ optionsLoading: false, error: '原任务有内容已下架或无权限，无法再次布置' }); return
          }
          const resource = { ...candidate, allowedClassIds }
          const existing = resourceCandidates.findIndex(item => item.id === resourceId)
          if (existing < 0) resourceCandidates.push(resource)
          else resourceCandidates[existing] = resource
        }
        const copied = copyTaskItems(copy, resourceCandidates)
        if (!copied.ok) { this.setData({ optionsLoading: false, error: copied.message }); return }
        sourceDraft = { ...sourceDraft, items: copied.items }
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
      const pendingReadingSelection = getTeacherReadingSelection()
      const selectedFromCatalog = getTeacherCatalogResultIds()
      const requestedClassId = !edit && !templateSeed && pendingReadingSelection?.targetClassId
        && selectedFromCatalog?.includes(pendingReadingSelection.resourceId)
        && authorizedTargets.classes.some(item => item.id === pendingReadingSelection.targetClassId)
        ? pendingReadingSelection.targetClassId : ''
      if (requestedClassId) sourceDraft = { ...sourceDraft,
        target: { type: 'classes', classIds: [requestedClassId] } }
      const initialTarget = initialPublishTarget(sourceDraft.target, Boolean(edit) || Boolean(requestedClassId), this.data.requestedStudentId)
      const initialClassIds = new Set(initialTarget.type === 'classes' ? initialTarget.classIds : [])
      const draftClasses = copy || copiedDraft ? authorizedTargets.classes : result.data.availableClasses ?? (initialTarget.type === 'classes'
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
      const start = localDateTimeFields(draftOptions.structuredDraft.startsAt)
      const due = localDateTimeFields(draftOptions.structuredDraft.dueAt)
      if (!start || !due) {
        this.setData({ optionsLoading: false, error: '任务时间无法读取，请重试' })
        return
      }
      this.setData({
        optionsLoading: false,
        title: edit?.title ?? templateSeed?.title ?? copy?.title ?? (this.data.title || `${draftOptions.resources.find(item => item.id === draftOptions.structuredDraft.items[0]?.resourceId)?.title ?? '课堂'}学习任务`),
        description: edit?.description ?? templateSeed?.description ?? copy?.description ?? this.data.description,
        teacherNote: edit?.teacherNote ?? '',
        editingVersion: edit?.version ?? 0,
        editingStatus: edit?.status ?? '',
        originalDueAt: edit?.dueAt ?? '',
        draftOptions,
        resourceChoices: draftOptions.resources.map(item => ({ ...item, selected: draftOptions.structuredDraft.items.some(selected => selected.resourceId === item.id) })),
        resourceSummary: selectedContentSummary(draftOptions.structuredDraft.items, draftOptions.resources),
        weightRows: weightRowsFor(draftOptions), showWeightEditor: showsWeightEditor(draftOptions),
        weightError: itemWeightError(draftOptions.structuredDraft.items) ?? '',
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
      }, () => {
        if (getTeacherCatalogResultIds() !== null) this.applySelectedCatalogResources()
        else this.applySelectedQuestionResources()
      })
    },
    async applySelectedCatalogResources() {
      const selectedIds = getTeacherCatalogResultIds()
      const options = this.data.draftOptions
      if (selectedIds === null || !options || this.data.loading || this.data.optionsLoading) return
      if (this.data.editingStatus && this.data.editingStatus !== 'draft' && this.data.editingStatus !== 'scheduled') {
        this.setData({ error: '当前任务阶段不可调整内容' }); return
      }
      const selectedClasses = this.data.targetMode === 'classes'
        ? this.data.targetClasses.filter(item => item.selected).map(item => item.id)
        : [...new Set(this.data.targetStudents.filter(item => item.selected).map(item => item.classInfo.id))]
      const effectiveClasses = selectedClasses
      const session = getSession()
      if (!session) return
      this.setData({ optionsLoading: true, error: '' })
      const resources = [...options.resources]
      for (const id of selectedIds) {
        const existingIndex = resources.findIndex(resource => resource.id === id)
        if (existingIndex >= 0 && effectiveClasses.every(classId => resources[existingIndex].allowedClassIds?.includes(classId) !== false)) continue
        const resource = await loadResourceCandidate(session.user.id, id, effectiveClasses)
        if (!resource) { this.setData({ optionsLoading: false, error: '内容已下架或不在当前授权范围，请重新选择' }); return }
        if (existingIndex < 0) resources.push(resource)
        else resources[existingIndex] = resource
      }
      const replaced = replaceSelectedCatalogResources({ ...options, resources }, selectedIds, effectiveClasses)
      if (!replaced.ok) { this.setData({ optionsLoading: false, error: replaced.message }); return }
      const readingSelection = takeTeacherReadingSelection()
      if (readingSelection) {
        replaced.options.structuredDraft.items = replaced.options.structuredDraft.items.map(item =>
          item.resourceId === readingSelection.resourceId && item.type === 'reading'
            ? { ...item, ...(readingSelection.pageIds === undefined
              ? { pageIds: undefined, requiredCount: replaced.options.resources.find(resource => resource.id === item.resourceId)?.requiredCount ?? item.requiredCount }
              : { pageIds: [...readingSelection.pageIds], requiredCount: readingSelection.pageIds.length }) }
            : item)
      }
      clearTeacherCatalogResultIds()
      const items = replaced.options.structuredDraft.items
      this.setData({ optionsLoading: false, draftOptions: replaced.options,
        resourceChoices: replaced.options.resources.map(resource => ({ ...resource, selected: items.some(item => item.resourceId === resource.id) })),
        resourceSummary: selectedContentSummary(items, replaced.options.resources),
        weightRows: weightRowsFor(replaced.options), showWeightEditor: showsWeightEditor(replaced.options),
        weightError: itemWeightError(items) ?? '',
        error: '', publishIntent: clearWriteIntent() })
    },
    async applySelectedQuestionResources() {
      const selectedIds = getTeacherSelectedResourceIds()
      const options = this.data.draftOptions
      if (!selectedIds.length || !options || this.data.loading || this.data.optionsLoading) return
      if (this.data.editingStatus && this.data.editingStatus !== 'draft' && this.data.editingStatus !== 'scheduled') {
        this.setData({ error: '当前任务阶段不可新增内容' }); return
      }
      const selectedClasses = this.data.targetMode === 'classes'
        ? this.data.targetClasses.filter(item => item.selected).map(item => item.id)
        : this.data.targetStudents.filter(item => item.selected).map(item => item.classInfo.id)
      if (!selectedClasses.length) { this.setData({ error: '请先选择布置对象，再引用习题' }); return }
      const session = getSession()
      if (!session) return
      const addedResources: TaskDraftOptionsView['resources'] = []
      for (const id of selectedIds) {
        if (options.resources.some(resource => resource.id === id)) continue
        const result = await getSchoolQuestion(session.user.id, id, selectedClasses)
        if (!result.ok) { this.setData({ error: '题目已下架或不在当前授权内容中，请重新选择' }); return }
        addedResources.push({ id, title: result.data.title, type: 'exercise', requiredCount: 1, allowedClassIds: [...selectedClasses] })
      }
      const availableOptions = { ...options, resources: [...options.resources, ...addedResources] }
      const merged = mergeSelectedQuestionResources(availableOptions, selectedIds, selectedClasses)
      if (!merged.ok) { this.setData({ error: merged.message }); return }
      const items = merged.options.structuredDraft.items
      clearTeacherSelectedResourceIds()
      this.setData({
        draftOptions: merged.options,
        resourceChoices: merged.options.resources.map(item => ({ ...item, selected: items.some(selected => selected.resourceId === item.id) })),
        resourceSummary: items.map(item => merged.options.resources.find(resource => resource.id === item.resourceId)?.title ?? item.resourceId).join('、'),
        weightRows: weightRowsFor(merged.options), showWeightEditor: showsWeightEditor(merged.options),
        weightError: itemWeightError(items) ?? '',
        error: '', publishIntent: clearWriteIntent(),
      })
    },
    openSchoolQuestions() {
      const classIds = this.data.targetMode === 'classes'
        ? this.data.targetClasses.filter(item => item.selected).map(item => item.id)
        : [...new Set(this.data.targetStudents.filter(item => item.selected).map(item => item.classInfo.id))]
      const target = classIds.length ? `&targetClassIds=${encodeURIComponent(classIds.join(','))}` : ''
      wx.navigateTo({ url: `/pages/teacher/school-questions/school-questions?source=publish${target}` })
    },
    openContentCatalog() {
      const options = this.data.draftOptions
      if (this.data.loading || this.data.optionsLoading) return
      if (!options) {
        this.setData({ error: '任务资源尚未加载，请重试' })
        wx.showToast({ title: '任务资源尚未加载', icon: 'none' })
        return
      }
      const classIds = this.data.targetMode === 'classes'
        ? this.data.targetClasses.filter(item => item.selected).map(item => item.id)
        : [...new Set(this.data.targetStudents.filter(item => item.selected).map(item => item.classInfo.id))]
      setTeacherCatalogInitialIds(options.structuredDraft.items.map(item => item.resourceId))
      const scope = classIds.length ? '?targetClassIds=' + encodeURIComponent(classIds.join(',')) : ''
      wx.navigateTo({ url: '/pages/teacher/content-selector/content-selector' + scope })
    },
    openReadingSelector() {
      if (!this.data.draftOptions || this.data.optionsLoading || this.data.loading) return
      setTeacherCatalogInitialIds(this.data.draftOptions.structuredDraft.items.map(item => item.resourceId))
      wx.navigateTo({ url: '/pages/teacher/reading-selector/reading-selector?source=publish' })
    },
    openSynchronizedTextbooks() {
      if (!this.data.draftOptions || this.data.optionsLoading || this.data.loading) return
      setTeacherCatalogInitialIds(this.data.draftOptions.structuredDraft.items.map(item => item.resourceId))
      wx.navigateTo({ url: '/pages/teacher/synchronized-textbooks/synchronized-textbooks?source=publish' })
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
      const draftOptions = { ...options, structuredDraft: { ...options.structuredDraft, items } }
      this.setData({ draftOptions, resourceChoices: options.resources.map(item => ({ ...item, selected: items.some(selected => selected.resourceId === item.id) })),
        resourceSummary: selectedContentSummary(items, options.resources), weightRows: weightRowsFor(draftOptions),
        showWeightEditor: showsWeightEditor(draftOptions), weightError: itemWeightError(items) ?? '',
        error: '', publishIntent: clearWriteIntent() })
    },
    onWeightInput(event: WechatMiniprogram.Input) {
      const itemId = event.currentTarget.dataset.id as string
      const raw = event.detail.value
      const options = this.data.draftOptions
      if (!options || this.data.loading || this.data.optionsLoading || (this.data.editingStatus
        && this.data.editingStatus !== 'draft' && this.data.editingStatus !== 'scheduled')) return
      const weightRows = this.data.weightRows.map(row => row.id === itemId ? { ...row, value: raw } : row)
      const items = updateItemWeight(options.structuredDraft.items, itemId, raw)
      if (items === null) {
        this.setData({ weightRows, weightError: '请输入 0—100 的权重，最多两位小数',
          publishIntent: clearWriteIntent() })
        return
      }
      const draftOptions = { ...options, structuredDraft: { ...options.structuredDraft, items } }
      this.setData({ draftOptions, weightRows: weightRowsFor(draftOptions),
        weightError: itemWeightError(items) ?? '', error: '', publishIntent: clearWriteIntent() })
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
      const weightError = this.data.weightError || itemWeightError(this.data.draftOptions.structuredDraft.items)
      if (weightError) { this.setData({ error: weightError }); return null }
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
    async saveAsTemplate() {
      const session = getSession()
      const options = this.data.draftOptions
      if (!session || !options || this.data.loading || this.data.optionsLoading || this.data.resumePublication) return
      const title = this.data.title.trim()
      if (!title || title.length > 50 || this.data.description.length > 300 || !options.structuredDraft.items.length) {
        this.setData({ error: '模板名称须为 1—50 字，且至少包含一项内容' }); return
      }
      const weightError = this.data.weightError || itemWeightError(options.structuredDraft.items)
      if (weightError) { this.setData({ error: weightError }); return }
      const itemRefs = templateItemRefsFromDraft(options.structuredDraft.items)
      const wasEditing = this.data.editingTemplate
      const templateId = wasEditing ? this.data.templateSeed?.id : undefined
      const expectedVersion = wasEditing ? this.data.templateSeed?.version ?? 0 : 0
      const fingerprint = JSON.stringify({ templateId, title, description: this.data.description.trim(), itemRefs,
        expectedVersion })
      const intent = prepareWriteIntent(this.data.templateSaveIntent, fingerprint,
        () => createPageOperationId('save_task_template'))
      this.setData({ loading: true, error: '', templateSaveIntent: intent })
      const result = await saveTaskTemplate(session.user.id, { ...(templateId ? { templateId } : {}),
        title, description: this.data.description.trim(), itemRefs }, expectedVersion, intent.operationId)
      this.setData({ loading: false })
      if (!result.ok) { this.setData({ error: result.error.message }); return }
      this.setData({ templateSeed: result.data, editingTemplate: true, templateSaveIntent: clearWriteIntent() })
      wx.showToast({ title: wasEditing ? '模板已更新' : '模板已保存', icon: 'success' })
      if (wasEditing) setTimeout(() => wx.redirectTo({ url: '/pages/teacher/task-templates/task-templates' }), 400)
    },
    publish() {
      if (this.data.resumePublication) { this.resumePendingPublication(); return }
      const command = this.buildCommand('publish')
      if (!command) return
      const editingPublished = this.data.editingStatus && this.data.editingStatus !== 'draft'
      const targetInfo = publishTargetSummary(this.data.targetMode, this.data.targetClasses, this.data.targetStudents)
      const targetLabel = this.data.editingStatus && this.data.editingStatus !== 'draft' && this.data.editingStatus !== 'scheduled'
        ? this.data.targetSummary : `${command.structuredDraft?.target.type === 'students' ? '按学员' : '按班级'}：${targetInfo.label}`
      wx.showModal({ title: editingPublished ? '确认修改任务' : '学生视角预览', content: `${command.title.trim()}\n内容：${this.data.resourceSummary}\n计分权重：${this.data.weightRows.map(row => `${row.title} ${row.value}%`).join('、')}\n要求：${command.description.trim() || '无额外要求'}\n发布对象：${targetLabel}\n截止 ${this.data.dueDate} ${this.data.dueTime}。`, confirmText: editingPublished ? '保存修改' : '确认发布', success: result => { if (result.confirm) { if (editingPublished) this.commitUpdate(command); else this.commitPublish(command) } } })
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
    const result = await listTeacherStudents(userId, { status: 'active' }, cursor)
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
