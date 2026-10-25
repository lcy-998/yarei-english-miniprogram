import type { ActivityOverrideState, ActivityView, TeacherActivityProgressView } from '../../../domain/types'
import { addActivityFutureRestDay, closeActivity, deleteActivityDraft,
  getActivityOverrideForTeacher, getCatalogDraftOptions,
  getSchoolQuestion, getTaskCatalogResource, getTeacherActivityProgress,
  listTeacherActivities, publishActivity, recycleActivity, saveActivityDraft,
  setActivityOverride } from '../services/app-service'
import { activityLifecycleLabel, schoolDate } from '../domain/student-activity-feed'
import { clearTeacherCatalogResultIds, getSession, getTeacherCatalogResultIds, setTeacherCatalogInitialIds } from '../session/session'
import { EMPTY_WRITE_INTENT, clearWriteIntent, createPageOperationId, prepareWriteIntent, type WriteIntentState } from '../shared/write-intent'
import { ACTIVITY_WEEKDAYS, activityDraftFromForm, cycleEndsOn, defaultActivityPeriod, inferRestWeekdays,
  mergeActivityConditions, restDatesForWeekdays, shiftActivityDate, weekdaysInActivityRange,
  type ActivityConditionChoice, type ActivityFormValues } from './activity-form'

type ActivityRow = ActivityView & { statusLabel: string; className: string; effectiveDayCount: number;
  todayLabel: string; todayUpdatedAt: string }
type ClassChoice = { id: string; name: string }
type ProgressRow = TeacherActivityProgressView['rows'][number] & { key: string; stateLabel: string; missingLabel: string }

const PROGRESS_FILTERS = [
  { label: '全部学员', value: 'all' }, { label: '已完成', value: 'complete' },
  { label: '未完成', value: 'incomplete' },
] as const
function conditionLabel(kind: string): string {
  return ({ reading: '阅读', vocabulary: '单词', exercise: '练习', work: '作品' } as Record<string, string>)[kind] ?? kind
}

function effectiveDayCount(activity: ActivityView): number {
  const start = Date.parse(`${activity.schedule.startsOn}T00:00:00.000Z`)
  const end = Date.parse(`${activity.schedule.endsOn}T00:00:00.000Z`)
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, Math.round((end - start) / 86400000) + 1 - activity.schedule.restDates.length) : 0
}

function formFingerprint(form: ActivityFormValues): string {
  return JSON.stringify({ ...form, conditions: form.conditions.map(item => ({ resourceId: item.resourceId,
    kind: item.kind, threshold: item.threshold })) })
}

Component({
  data: {
    loading: true,
    saving: false,
    savingAction: '' as '' | 'draft' | 'publish',
    publishingId: '',
    error: '',
    formError: '',
    rows: [] as ActivityRow[],
    classes: [] as ClassChoice[],
    classNames: [] as string[],
    formOpen: false,
    overrideOpen: false,
    restChangeOpen: false,
    restChangeActivityId: '',
    restChangeTitle: '',
    restChangeDate: '',
    restChangeReason: '',
    restChangeError: '',
    restChangeSaving: false,
    restChangeIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    restChangeHistory: [] as NonNullable<ActivityView['restDayChanges']>,
    progressOpen: false, progressActivityId: '', progressTitle: '', progressDate: '',
    progressStartsOn: '', progressEndsOn: '', progressSchoolToday: '',
    progressLoading: false, progressLoadingMore: false, progressError: '',
    progressView: null as TeacherActivityProgressView | null,
    progressRows: [] as ProgressRow[], progressNextOffset: null as number | null,
    progressKeyword: '', progressFilterIndex: 0, progressFilterNames: PROGRESS_FILTERS.map(item => item.label),
    progressQueryVersion: 0, progressCloseReason: '', progressClosing: false,
    progressCanClose: false,
    progressCanRecycle: false, progressRecycleReason: '', progressRecycling: false,
    progressRecycleIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    progressCloseIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    cardProgressVersion: 0,
    progressRouteOpened: false,
    overrideActivityId: '',
    overrideActivityTitle: '',
    overrideStudents: [] as Array<{ studentId: string; displayNameMasked: string }>,
    overrideStudentNames: [] as string[],
    overrideStudentId: '',
    overrideStudentIndex: 0,
    overrideStudentName: '选择学员',
    overrideDate: '',
    overrideStartsOn: '',
    overrideEndsOn: '',
    overrideReason: '',
    overrideState: null as ActivityOverrideState | null,
    overrideLoading: false,
    overrideSaving: false,
    overrideError: '',
    overrideIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    activityId: '',
    version: 0,
    title: '',
    description: '',
    classId: '',
    className: '选择班级',
    startsOn: '',
    endsOn: '',
    maxStartDate: '',
    minEndDate: '',
    restWeekdayOptions: ACTIVITY_WEEKDAYS,
    restWeekdays: [] as number[],
    restWeekdayLookup: {} as Record<number, boolean>,
    availableWeekdays: [] as number[],
    availableWeekdayLookup: {} as Record<number, boolean>,
    legacyRestDates: false,
    restDates: [] as string[],
    conditions: [] as ActivityConditionChoice[],
    originalFingerprint: '',
    saveIntent: EMPTY_WRITE_INTENT as WriteIntentState,
    publishIntents: {} as Record<string, WriteIntentState>,
    deleteIntents: {} as Record<string, WriteIntentState>,
    deleteReasons: {} as Record<string, string>,
  },
  lifetimes: { attached() { this.loadPage() } },
  pageLifetimes: { show() {
    if (getTeacherCatalogResultIds() !== null && this.data.formOpen) this.applyCatalogSelection()
    else if (this.data.progressOpen) this.loadProgress(true)
    else if (!this.data.formOpen && !this.data.overrideOpen && !this.data.restChangeOpen && this.data.classes.length) this.loadActivities()
  } },
  methods: {
    onNavigateBack() {
      if (this.data.saving || this.data.overrideSaving || this.data.restChangeSaving
        || this.data.progressClosing || this.data.progressRecycling) return
      if (this.data.formOpen) { this.closeForm(); return }
      if (this.data.overrideOpen) { this.closeOverridePanel(); return }
      if (this.data.restChangeOpen) { this.closeRestChangePanel(); return }
      if (this.data.progressOpen) { this.closeProgressPanel(); return }
      if (getCurrentPages().length > 1) wx.navigateBack()
      else wx.reLaunch({ url: '/subpackages/teacher/task-center/task-center' })
    },
    async loadPage() {
      const session = getSession()
      if (!session) { wx.reLaunch({ url: '/pages/auth/login/login' }); return }
      if ((session.activeRole ?? session.user.role) !== 'teacher') {
        this.setData({ loading: false, error: '仅授权教师可管理打卡活动' }); return
      }
      this.setData({ loading: true, error: '' })
      const [classesResult, activitiesResult] = await Promise.all([
        getCatalogDraftOptions(session.user.id), listTeacherActivities(session.user.id),
      ])
      if (!classesResult.ok) { this.setData({ loading: false, error: classesResult.error.message }); return }
      const classes = classesResult.data.availableClasses ?? []
      if (!activitiesResult.ok) {
        this.setData({ loading: false, classes, classNames: classes.map(item => item.name), error: activitiesResult.error.message }); return
      }
      this.setData({ loading: false, classes, classNames: classes.map(item => item.name),
        rows: this.toRows(activitiesResult.data, classes) })
      this.refreshTodayProgress()
      const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
      const activityId = pages[pages.length - 1]?.options?.activityId
      if (activityId && !this.data.progressRouteOpened) {
        this.setData({ progressRouteOpened: true }, () => this.openProgressById(decodeURIComponent(activityId)))
      }
    },
    async loadActivities() {
      const session = getSession()
      if (!session) return
      this.setData({ loading: true, error: '' })
      const result = await listTeacherActivities(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, rows: this.toRows(result.data, this.data.classes) })
      this.refreshTodayProgress()
    },
    toRows(activities: ActivityView[], classes: ClassChoice[]): ActivityRow[] {
      return activities.map(activity => ({ ...activity, statusLabel: activityLifecycleLabel(activity),
        className: classes.find(item => item.id === activity.schedule.classId)?.name ?? '授权班级',
        effectiveDayCount: effectiveDayCount(activity),
        todayLabel: activity.status === 'draft' ? '发布后可核对'
          : activity.status === 'closed' ? '已关闭，历史记录可查'
            : activity.schedule.restDates.includes(schoolDate(activity.schedule.schoolTimeZone)) ? '今日休息'
              : '正在核对', todayUpdatedAt: '' }))
    },
    async refreshTodayProgress() {
      const session = getSession()
      if (!session) return
      const version = this.data.cardProgressVersion + 1
      this.setData({ cardProgressVersion: version })
      const eligible = this.data.rows.filter(row => row.status === 'published')
      for (let offset = 0; offset < eligible.length; offset += 4) {
        const batch = eligible.slice(offset, offset + 4)
        const results = await Promise.all(batch.map(async row => {
          const date = schoolDate(row.schedule.schoolTimeZone)
          if (date < row.schedule.startsOn || date > row.schedule.endsOn) {
            return { id: row.id, label: '今日不在活动期', updatedAt: '' }
          }
          if (row.schedule.restDates.includes(date)) return { id: row.id, label: '今日休息', updatedAt: '' }
          const result = await getTeacherActivityProgress(session.user.id, row.id, date, 1, 0)
          return result.ok ? { id: row.id, label: result.data.evidenceStatus === 'available'
            ? `今日完成 ${result.data.completedCount ?? 0}/${result.data.participantCount}` : '今日证据暂不可核对',
          updatedAt: result.data.updatedAt }
            : { id: row.id, label: '今日核对失败，点击重试', updatedAt: '' }
        }))
        if (version !== this.data.cardProgressVersion) return
        const updates = new Map(results.map(item => [item.id, item]))
        this.setData({ rows: this.data.rows.map(row => updates.has(row.id) ? { ...row,
          todayLabel: updates.get(row.id)!.label, todayUpdatedAt: updates.get(row.id)!.updatedAt } : row) })
      }
    },
    formValues(): ActivityFormValues {
      return { ...(this.data.activityId ? { activityId: this.data.activityId } : {}),
        title: this.data.title, description: this.data.description, classId: this.data.classId,
        startsOn: this.data.startsOn, endsOn: this.data.endsOn,
        restDates: [...this.data.restDates], conditions: [...this.data.conditions] }
    },
    startNew() {
      const period = defaultActivityPeriod()
      const form: ActivityFormValues = { title: '', description: '', classId: '', ...period,
        restDates: [], conditions: [] }
      this.setData({ formOpen: true, activityId: '', version: 0, title: '', description: '', classId: '',
        className: '选择班级', ...period, maxStartDate: shiftActivityDate(period.endsOn, -1) ?? '',
        minEndDate: shiftActivityDate(period.startsOn, 1) ?? '',
        restWeekdays: [], restWeekdayLookup: {}, availableWeekdays: weekdaysInActivityRange(period.startsOn, period.endsOn),
        availableWeekdayLookup: Object.fromEntries(weekdaysInActivityRange(period.startsOn, period.endsOn)
          .map(day => [day, true])),
        legacyRestDates: false, restDates: [], conditions: [],
        originalFingerprint: formFingerprint(form), saveIntent: clearWriteIntent(), formError: '', error: '' })
    },
    async editDraft(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const activity = this.data.rows.find(item => item.id === id && item.status === 'draft')
      if (!activity) return
      const conditions: ActivityConditionChoice[] = activity.schedule.conditions.map(condition => ({
        resourceId: condition.resourceId,
        title: condition.kind === 'reading' ? '阅读内容' : condition.kind === 'vocabulary' ? '词包' : condition.kind === 'exercise' ? '习题' : '作品',
        kind: condition.kind,
        threshold: condition.kind === 'vocabulary' ? String(condition.requiredWordCount)
          : condition.kind === 'exercise' ? String(condition.minimumScore) : '',
      }))
      const form: ActivityFormValues = { activityId: activity.id, title: activity.title, description: activity.description,
        classId: activity.schedule.classId, startsOn: activity.schedule.startsOn, endsOn: activity.schedule.endsOn,
        restDates: [...activity.schedule.restDates], conditions }
      const inferredWeekdays = inferRestWeekdays(activity.schedule.startsOn, activity.schedule.endsOn,
        activity.schedule.restDates)
      const restWeekdays = inferredWeekdays ?? []
      this.setData({ formOpen: true, activityId: activity.id, version: activity.version, title: activity.title,
        description: activity.description, classId: activity.schedule.classId, className: activity.className,
        startsOn: activity.schedule.startsOn, endsOn: activity.schedule.endsOn,
        maxStartDate: shiftActivityDate(activity.schedule.endsOn, -1) ?? '',
        minEndDate: shiftActivityDate(activity.schedule.startsOn, 1) ?? '', restDates: [...activity.schedule.restDates],
        restWeekdays, restWeekdayLookup: Object.fromEntries(restWeekdays.map(day => [day, true])),
        availableWeekdays: weekdaysInActivityRange(activity.schedule.startsOn, activity.schedule.endsOn),
        availableWeekdayLookup: Object.fromEntries(weekdaysInActivityRange(activity.schedule.startsOn, activity.schedule.endsOn)
          .map(day => [day, true])),
        legacyRestDates: inferredWeekdays === null, conditions,
        formError: '', originalFingerprint: formFingerprint(form), saveIntent: clearWriteIntent() })
      await this.refreshConditionTitles(conditions)
    },
    deleteDraft(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const activity = this.data.rows.find(item => item.id === id && item.status === 'draft')
      const session = getSession()
      if (!activity || !session) return
      wx.showModal({ title: '彻底删除活动草稿？', editable: true,
        placeholderText: '填写删除原因', content: this.data.deleteReasons[id] ?? '',
        confirmText: '确认删除', confirmColor: '#D9342B', success: async answer => {
          if (!answer.confirm) return
          const reason = answer.content.trim()
          if (!reason || reason.length > 200) {
            wx.showToast({ title: '请填写 1—200 字删除原因', icon: 'none' }); return
          }
          const fingerprint = JSON.stringify({ id, version: activity.version, reason })
          const intent = prepareWriteIntent(this.data.deleteIntents[id] ?? EMPTY_WRITE_INTENT,
            fingerprint, () => createPageOperationId('activity_delete_draft'))
          this.setData({ deleteIntents: { ...this.data.deleteIntents, [id]: intent },
            deleteReasons: { ...this.data.deleteReasons, [id]: reason } })
          const result = await deleteActivityDraft(session.user.id, id, activity.version,
            reason, intent.operationId)
          if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
          const intents = { ...this.data.deleteIntents }
          const reasons = { ...this.data.deleteReasons }
          delete intents[id]
          delete reasons[id]
          this.setData({ rows: this.data.rows.filter(row => row.id !== id),
            deleteIntents: intents, deleteReasons: reasons })
          wx.showToast({ title: '草稿已彻底删除', icon: 'none' })
        } })
    },
    async refreshConditionTitles(conditions: ActivityConditionChoice[]) {
      const session = getSession()
      if (!session) return
      const named: ActivityConditionChoice[] = []
      for (const condition of conditions) {
        const learning = await getTaskCatalogResource(session.user.id, condition.resourceId, [this.data.classId])
        if (learning.ok) { named.push({ ...condition, title: learning.data.title }); continue }
        const question = await getSchoolQuestion(session.user.id, condition.resourceId, [this.data.classId])
        named.push({ ...condition, title: question.ok ? question.data.title : '已失效内容' })
      }
      if (this.data.formOpen) this.setData({ conditions: named })
    },
    closeForm() {
      if (this.data.saving) return
      if (formFingerprint(this.formValues()) === this.data.originalFingerprint) {
        this.setData({ formOpen: false, formError: '' }); return
      }
      wx.showModal({ title: '放弃未保存的修改？', content: '当前填写内容尚未保存。', success: result => {
        if (result.confirm) this.setData({ formOpen: false, formError: '' })
      } })
    },
    onTitle(event: WechatMiniprogram.Input) { this.setData({ title: event.detail.value, formError: '' }) },
    onDescription(event: WechatMiniprogram.Input) { this.setData({ description: event.detail.value, formError: '' }) },
    chooseClass(event: WechatMiniprogram.PickerChange) {
      const index = Number(event.detail.value)
      const choice = this.data.classes[index]
      if (!choice) return
      this.setData({ classId: choice.id, className: choice.name, conditions: [], formError: '班级已变更，请重新选择每日内容' })
    },
    restSelectionForRange(startsOn: string, endsOn: string) {
      const availableWeekdays = weekdaysInActivityRange(startsOn, endsOn)
      const restWeekdays = this.data.restWeekdays.filter(day => availableWeekdays.includes(day))
      return { availableWeekdays, restWeekdays,
        availableWeekdayLookup: Object.fromEntries(availableWeekdays.map(day => [day, true])),
        restWeekdayLookup: Object.fromEntries(restWeekdays.map(day => [day, true])),
        restDates: this.data.legacyRestDates ? this.data.restDates
          : restDatesForWeekdays(startsOn, endsOn, restWeekdays) ?? [] }
    },
    chooseStartDate(event: WechatMiniprogram.PickerChange) {
      const startsOn = String(event.detail.value)
      if (!shiftActivityDate(startsOn, 1) || (this.data.endsOn && startsOn >= this.data.endsOn)) {
        this.setData({ formError: '开始日期必须早于结束日期' }); return
      }
      const selection = this.restSelectionForRange(startsOn, this.data.endsOn)
      this.setData({ startsOn, minEndDate: shiftActivityDate(startsOn, 1) ?? '', ...selection,
        formError: this.data.legacyRestDates && selection.restDates.some(date => date < startsOn || date > this.data.endsOn)
          ? '旧休息日已超出新日期范围，请选择每周休息日' : '' })
    },
    chooseEndDate(event: WechatMiniprogram.PickerChange) {
      const endsOn = String(event.detail.value)
      if (!shiftActivityDate(endsOn, -1) || (this.data.startsOn && endsOn <= this.data.startsOn)) {
        this.setData({ formError: '结束日期必须晚于开始日期' }); return
      }
      const selection = this.restSelectionForRange(this.data.startsOn, endsOn)
      this.setData({ endsOn, maxStartDate: shiftActivityDate(endsOn, -1) ?? '', ...selection,
        formError: this.data.legacyRestDates && selection.restDates.some(date => date < this.data.startsOn || date > endsOn)
          ? '旧休息日已超出新日期范围，请选择每周休息日' : '' })
    },
    chooseCycle(event: WechatMiniprogram.TouchEvent) {
      const days = Number(event.currentTarget.dataset.days) as 7 | 14 | 21 | 30
      if (![7, 14, 21, 30].includes(days)) return
      const endsOn = cycleEndsOn(this.data.startsOn, days)
      if (!endsOn) { this.setData({ formError: '请先选择开始日期' }); return }
      const selection = this.restSelectionForRange(this.data.startsOn, endsOn)
      this.setData({ endsOn, maxStartDate: shiftActivityDate(endsOn, -1) ?? '', ...selection,
        formError: this.data.legacyRestDates && selection.restDates.some(date => date < this.data.startsOn || date > endsOn)
          ? '旧休息日已超出新日期范围，请选择每周休息日' : '' })
    },
    toggleRestWeekday(event: WechatMiniprogram.TouchEvent) {
      const day = Number(event.currentTarget.dataset.day)
      if (!this.data.availableWeekdays.includes(day)) return
      const chosen = new Set(this.data.restWeekdays)
      if (chosen.has(day)) chosen.delete(day)
      else chosen.add(day)
      const restWeekdays = ACTIVITY_WEEKDAYS.map(item => item.day).filter(value => chosen.has(value))
      const restDates = restDatesForWeekdays(this.data.startsOn, this.data.endsOn, restWeekdays)
      if (restDates === null) { this.setData({ formError: '请先设置有效的活动日期范围' }); return }
      this.setData({ restWeekdays, restWeekdayLookup: Object.fromEntries(restWeekdays.map(value => [value, true])),
        restDates, legacyRestDates: false, formError: '' })
    },
    openCatalog() {
      if (!this.data.classId) { this.setData({ formError: '请先选择参与班级' }); return }
      setTeacherCatalogInitialIds(this.data.conditions.map(item => item.resourceId))
      wx.navigateTo({ url: `/subpackages/teacher/content-selector/content-selector?targetClassIds=${encodeURIComponent(this.data.classId)}` })
    },
    async applyCatalogSelection() {
      const ids = getTeacherCatalogResultIds()
      const session = getSession()
      if (ids === null || !session || !this.data.classId) return
      const selected: Array<{ resourceId: string; title: string; kind: ActivityConditionChoice['kind'] }> = []
      for (const resourceId of ids) {
        const learning = await getTaskCatalogResource(session.user.id, resourceId, [this.data.classId])
        if (learning.ok) { selected.push({ resourceId, title: learning.data.title, kind: learning.data.type }); continue }
        const question = await getSchoolQuestion(session.user.id, resourceId, [this.data.classId])
        if (!question.ok) { this.setData({ formError: '内容已失效，已保留当前选择，请重新进入选择器' }); return }
        selected.push({ resourceId, title: question.data.title, kind: 'exercise' })
      }
      clearTeacherCatalogResultIds()
      this.setData({ conditions: mergeActivityConditions(this.data.conditions, selected), formError: '' })
    },
    removeCondition(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      this.setData({ conditions: this.data.conditions.filter(item => item.resourceId !== id), formError: '' })
    },
    onThreshold(event: WechatMiniprogram.Input) {
      const id = event.currentTarget.dataset.id as string
      this.setData({ conditions: this.data.conditions.map(item => item.resourceId === id
        ? { ...item, threshold: event.detail.value } : item), formError: '' })
    },
    async saveDraft() {
      const session = getSession()
      if (!session || this.data.saving) return
      const parsed = activityDraftFromForm(this.formValues())
      if (!parsed.ok) { this.setData({ formError: parsed.message }); return }
      const existing = this.data.rows.find(item => item.id === this.data.activityId && item.status === 'draft')
      if (existing && formFingerprint(this.formValues()) === this.data.originalFingerprint) {
        this.setData({ formOpen: false, formError: '' })
        return
      }
      const fingerprint = JSON.stringify({ draft: parsed.draft, version: this.data.version })
      const intent = prepareWriteIntent(this.data.saveIntent, fingerprint, () => createPageOperationId('activity_draft'))
      this.setData({ saving: true, savingAction: 'draft', saveIntent: intent, formError: '' })
      const result = await saveActivityDraft(session.user.id, parsed.draft, this.data.version, intent.operationId)
      if (!result.ok) { this.setData({ saving: false, savingAction: '', formError: result.error.message }); return }
      const savedRow = this.toRows([result.data], this.data.classes)[0]
      const rows = savedRow ? [savedRow, ...this.data.rows.filter(item => item.id !== result.data.id)] : this.data.rows
      this.setData({ saving: false, savingAction: '', formOpen: false,
        saveIntent: clearWriteIntent(), formError: '', rows })
      await this.loadActivities()
    },
    publishForm() {
      if (this.data.saving) return
      const parsed = activityDraftFromForm(this.formValues())
      if (!parsed.ok) { this.setData({ formError: parsed.message }); return }
      wx.showModal({ title: '发布打卡活动', content: '将按当前有效学员名单发布，发布后固定参与对象。',
        success: result => { if (result.confirm) this.performFormPublish() } })
    },
    async performFormPublish() {
      const session = getSession()
      if (!session || this.data.saving) return
      const parsed = activityDraftFromForm(this.formValues())
      if (!parsed.ok) { this.setData({ formError: parsed.message }); return }
      this.setData({ saving: true, savingAction: 'publish', formError: '' })
      let activity = this.data.rows.find(item => item.id === this.data.activityId && item.status === 'draft')
      if (!activity || formFingerprint(this.formValues()) !== this.data.originalFingerprint) {
        const fingerprint = JSON.stringify({ draft: parsed.draft, version: this.data.version })
        const intent = prepareWriteIntent(this.data.saveIntent, fingerprint, () => createPageOperationId('activity_draft'))
        this.setData({ saveIntent: intent })
        const saved = await saveActivityDraft(session.user.id, parsed.draft, this.data.version, intent.operationId)
        if (!saved.ok) { this.setData({ saving: false, savingAction: '', formError: saved.error.message }); return }
        activity = this.toRows([saved.data], this.data.classes)[0]
        if (!activity) { this.setData({ saving: false, savingAction: '', formError: '活动保存失败，请重试' }); return }
        const savedActivity = activity
        const rows = [savedActivity, ...this.data.rows.filter(item => item.id !== savedActivity.id)]
        const form = { ...this.formValues(), activityId: savedActivity.id }
        this.setData({ activityId: savedActivity.id, version: savedActivity.version, rows,
          originalFingerprint: formFingerprint(form), saveIntent: clearWriteIntent() })
      }
      const fingerprint = JSON.stringify({ id: activity.id, version: activity.version })
      const current = this.data.publishIntents[activity.id] ?? EMPTY_WRITE_INTENT
      const intent = prepareWriteIntent(current, fingerprint, () => createPageOperationId('activity_publish'))
      this.setData({ publishIntents: { ...this.data.publishIntents, [activity.id]: intent } })
      const published = await publishActivity(session.user.id, activity.id, activity.version, intent.operationId)
      if (!published.ok) { this.setData({ saving: false, savingAction: '',
        formError: published.error.code === 'RESOURCE_OFFLINE'
          ? '素材或关联课堂习题任务不足，无法让全班完成每个有效打卡日' : published.error.message }); return }
      const publishIntents = { ...this.data.publishIntents }
      delete publishIntents[activity.id]
      this.setData({ saving: false, savingAction: '', formOpen: false, formError: '', publishIntents })
      await this.loadActivities()
    },
    publishDraft(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const activity = this.data.rows.find(item => item.id === id && item.status === 'draft')
      if (!activity || this.data.publishingId) return
      wx.showModal({ title: '发布打卡活动', content: '将按当前有效学员名单发布，发布后固定参与对象。',
        success: result => { if (result.confirm) this.performPublish(activity) } })
    },
    async performPublish(activity: ActivityRow) {
      const session = getSession()
      if (!session) return
      const fingerprint = JSON.stringify({ id: activity.id, version: activity.version })
      const current = this.data.publishIntents[activity.id] ?? EMPTY_WRITE_INTENT
      const intent = prepareWriteIntent(current, fingerprint, () => createPageOperationId('activity_publish'))
      this.setData({ publishingId: activity.id, publishIntents: { ...this.data.publishIntents, [activity.id]: intent }, error: '' })
      const result = await publishActivity(session.user.id, activity.id, activity.version, intent.operationId)
      if (!result.ok) { this.setData({ publishingId: '', error: result.error.code === 'RESOURCE_OFFLINE'
        ? '素材或关联课堂习题任务不足，无法让全班完成每个有效打卡日' : result.error.message }); return }
      const publishIntents = { ...this.data.publishIntents }
      delete publishIntents[activity.id]
      const publishedRow = this.toRows([result.data], this.data.classes)[0]
      this.setData({ publishingId: '', publishIntents, rows: this.data.rows.map(item =>
        item.id === activity.id && publishedRow ? publishedRow : item) })
      await this.loadActivities()
    },
    openRestChangePanel(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const activity = this.data.rows.find(item => item.id === id && item.status === 'published')
      if (!activity) return
      this.setData({ restChangeOpen: true, restChangeActivityId: id, restChangeTitle: activity.title,
        restChangeDate: '', restChangeReason: '', restChangeError: '', restChangeSaving: false,
        restChangeIntent: clearWriteIntent(), restChangeHistory: [...(activity.restDayChanges ?? [])] })
    },
    closeRestChangePanel() {
      if (this.data.restChangeSaving) return
      this.setData({ restChangeOpen: false, restChangeError: '' })
    },
    chooseRestChangeDate(event: WechatMiniprogram.PickerChange) {
      this.setData({ restChangeDate: String(event.detail.value), restChangeError: '' })
    },
    onRestChangeReason(event: WechatMiniprogram.Input) {
      this.setData({ restChangeReason: event.detail.value, restChangeError: '' })
    },
    async submitRestChange() {
      const session = getSession()
      const activity = this.data.rows.find(item => item.id === this.data.restChangeActivityId)
      if (!session || !activity || this.data.restChangeSaving) return
      const date = this.data.restChangeDate
      const reason = this.data.restChangeReason.trim()
      if (!date || date < activity.schedule.startsOn || date > activity.schedule.endsOn
        || activity.schedule.restDates.includes(date)) {
        this.setData({ restChangeError: '请选择活动范围内尚未设置的休息日' }); return
      }
      if (!reason || reason.length > 300) { this.setData({ restChangeError: '请填写 1—300 字变更原因' }); return }
      const fingerprint = JSON.stringify({ activityId: activity.id, date, reason, version: activity.version })
      const intent = prepareWriteIntent(this.data.restChangeIntent, fingerprint,
        () => createPageOperationId('activity_future_rest'))
      this.setData({ restChangeSaving: true, restChangeIntent: intent, restChangeError: '' })
      const result = await addActivityFutureRestDay(session.user.id, activity.id, date, reason,
        activity.version, intent.operationId)
      if (!result.ok) { this.setData({ restChangeSaving: false, restChangeError: result.error.message }); return }
      const updated = this.toRows([result.data], this.data.classes)[0]
      this.setData({ restChangeSaving: false, restChangeDate: '', restChangeReason: '', restChangeError: '',
        restChangeIntent: clearWriteIntent(), restChangeHistory: [...(result.data.restDayChanges ?? [])],
        rows: this.data.rows.map(item => item.id === activity.id && updated ? updated : item) })
      wx.showToast({ title: '休息日已添加', icon: 'none' })
    },
    openOverridePanel(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const activity = this.data.rows.find(item => item.id === id && item.status === 'published')
      if (!activity) return
      this.setData({ overrideOpen: true, overrideActivityId: id, overrideActivityTitle: activity.title,
        overrideStudents: [...activity.participants], overrideStudentNames: activity.participants.map(item => item.displayNameMasked),
        overrideStudentId: '', overrideStudentIndex: 0, overrideStudentName: '选择学员', overrideDate: '',
        overrideStartsOn: activity.schedule.startsOn, overrideEndsOn: activity.schedule.endsOn, overrideReason: '',
        overrideState: null, overrideError: '', overrideIntent: clearWriteIntent() })
    },
    openLeaderboard(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      if (!this.data.rows.some(item => item.id === id && item.status !== 'draft')) return
      wx.navigateTo({ url: `/subpackages/student/checkin-leaderboard/checkin-leaderboard?activityId=${encodeURIComponent(id)}` })
    },
    openProgressPanel(event: WechatMiniprogram.TouchEvent) {
      this.openProgressById(event.currentTarget.dataset.id as string)
    },
    openProgressById(id: string) {
      const activity = this.data.rows.find(item => item.id === id && item.status !== 'draft')
      if (!activity) return
      const today = schoolDate(activity.schedule.schoolTimeZone)
      const date = today < activity.schedule.startsOn ? activity.schedule.startsOn
        : today > activity.schedule.endsOn ? activity.schedule.endsOn : today
      this.setData({ progressOpen: true, progressActivityId: id, progressTitle: activity.title,
        progressCanClose: activity.status === 'published',
        progressCanRecycle: activity.status === 'closed',
        progressDate: date, progressStartsOn: activity.schedule.startsOn,
        progressEndsOn: activity.schedule.endsOn, progressSchoolToday: today,
        progressKeyword: '', progressFilterIndex: 0, progressRows: [], progressNextOffset: null,
        progressView: null, progressError: '', progressCloseReason: '', progressCloseIntent: clearWriteIntent(),
        progressRecycleReason: '', progressRecycleIntent: clearWriteIntent() },
      () => this.loadProgress(true))
    },
    closeProgressPanel() {
      if (this.data.progressClosing || this.data.progressRecycling) return
      this.setData({ progressOpen: false, progressError: '', progressRows: [], progressView: null })
      this.loadActivities()
    },
    chooseProgressDate(event: WechatMiniprogram.PickerChange) {
      this.setData({ progressDate: String(event.detail.value) }, () => this.loadProgress(true))
    },
    chooseProgressFilter(event: WechatMiniprogram.PickerChange) {
      const index = Number(event.detail.value)
      if (!PROGRESS_FILTERS[index]) return
      this.setData({ progressFilterIndex: index }, () => this.loadProgress(true))
    },
    onProgressKeyword(event: WechatMiniprogram.Input) {
      this.setData({ progressKeyword: event.detail.value })
    },
    searchProgress() { this.loadProgress(true) },
    onProgressCloseReason(event: WechatMiniprogram.Input) {
      this.setData({ progressCloseReason: event.detail.value, progressError: '' })
    },
    onProgressRecycleReason(event: WechatMiniprogram.Input) {
      this.setData({ progressRecycleReason: event.detail.value, progressError: '' })
    },
    async loadProgress(reset = false) {
      const session = getSession()
      const activityId = this.data.progressActivityId
      if (!session || !activityId || !this.data.progressOpen) return
      const date = this.data.progressDate
      if (date > this.data.progressSchoolToday) {
        this.setData({ progressLoading: false, progressError: '活动尚未开始，当前没有可核对的每日记录',
          progressRows: [], progressNextOffset: null }); return
      }
      const offset = reset ? 0 : this.data.progressNextOffset
      if (offset === null || (!reset && this.data.progressLoadingMore)) return
      const queryVersion = this.data.progressQueryVersion + 1
      this.setData({ progressQueryVersion: queryVersion,
        ...(reset ? { progressLoading: true, progressRows: [], progressNextOffset: null }
          : { progressLoadingMore: true }), progressError: '' })
      const completion = PROGRESS_FILTERS[this.data.progressFilterIndex]?.value ?? 'all'
      const result = await getTeacherActivityProgress(session.user.id, activityId, date,
        20, offset, this.data.progressKeyword.trim(), completion)
      if (queryVersion !== this.data.progressQueryVersion || !this.data.progressOpen) return
      if (!result.ok) {
        this.setData({ progressLoading: false, progressLoadingMore: false, progressError: result.error.message }); return
      }
      const rows = result.data.rows.map(item => ({ ...item,
        key: `${activityId}|${date}|${item.studentId}`,
        stateLabel: item.complete === null ? '休息日' : item.complete
          ? item.supplemented ? '教师补记完成' : '已完成' : '未完成',
        missingLabel: item.complete === false && item.missingConditions.length
          ? `未满足：${item.missingConditions.map(conditionLabel).join('、')}`
          : item.complete === false && !item.evidenceDetailAvailable ? '旧榜单未保存逐项原因' : '' }))
      this.setData({ progressLoading: false, progressLoadingMore: false,
        progressView: result.data, progressNextOffset: result.data.nextOffset,
        progressRows: reset ? rows : [...this.data.progressRows, ...rows] })
    },
    loadMoreProgress() { if (this.data.progressNextOffset !== null) this.loadProgress(false) },
    requestCloseActivity() {
      const activity = this.data.rows.find(item => item.id === this.data.progressActivityId)
      if (!activity || activity.status !== 'published' || this.data.progressClosing) return
      const reason = this.data.progressCloseReason.trim()
      if (!reason || reason.length > 200) {
        this.setData({ progressError: '请填写 1—200 字关闭原因' }); return
      }
      wx.showModal({ title: '确认关闭活动？', content: '关闭后不再生成未来打卡，已有记录与榜单会保留。',
        confirmText: '确认关闭', success: result => { if (result.confirm) this.performCloseActivity(reason) } })
    },
    async performCloseActivity(reason: string) {
      const session = getSession()
      const activity = this.data.rows.find(item => item.id === this.data.progressActivityId)
      if (!session || !activity || activity.status !== 'published' || this.data.progressClosing) return
      const fingerprint = JSON.stringify({ id: activity.id, version: activity.version, reason })
      const intent = prepareWriteIntent(this.data.progressCloseIntent, fingerprint,
        () => createPageOperationId('activity_close'))
      this.setData({ progressClosing: true, progressCloseIntent: intent, progressError: '' })
      const result = await closeActivity(session.user.id, activity.id, activity.version, reason, intent.operationId)
      if (!result.ok) { this.setData({ progressClosing: false, progressError: result.error.message }); return }
      const updated = this.toRows([result.data], this.data.classes)[0]
      this.setData({ progressClosing: false, progressCloseIntent: clearWriteIntent(),
        progressCloseReason: '', progressCanClose: false, progressCanRecycle: true,
        rows: this.data.rows.map(row => row.id === activity.id && updated ? updated : row) })
      await this.loadProgress(true)
      wx.showToast({ title: '活动已关闭', icon: 'none' })
    },
    requestRecycleActivity() {
      const activity = this.data.rows.find(item => item.id === this.data.progressActivityId)
      if (!activity || activity.status !== 'closed' || this.data.progressRecycling) return
      const reason = this.data.progressRecycleReason.trim()
      if (!reason || reason.length > 200) {
        this.setData({ progressError: '请填写 1—200 字回收原因' }); return
      }
      wx.showModal({ title: '确认回收活动？', content: '回收后从日常列表隐藏，历史记录和已锁榜单保留。',
        confirmText: '确认回收', success: result => { if (result.confirm) this.performRecycleActivity(reason) } })
    },
    async performRecycleActivity(reason: string) {
      const session = getSession()
      const activity = this.data.rows.find(item => item.id === this.data.progressActivityId)
      if (!session || !activity || activity.status !== 'closed' || this.data.progressRecycling) return
      const fingerprint = JSON.stringify({ id: activity.id, version: activity.version, reason })
      const intent = prepareWriteIntent(this.data.progressRecycleIntent, fingerprint,
        () => createPageOperationId('activity_recycle'))
      this.setData({ progressRecycling: true, progressRecycleIntent: intent, progressError: '' })
      const result = await recycleActivity(session.user.id, activity.id, activity.version,
        reason, intent.operationId)
      if (!result.ok) { this.setData({ progressRecycling: false, progressError: result.error.message }); return }
      this.setData({ progressRecycling: false, progressRecycleIntent: clearWriteIntent(),
        progressOpen: false, progressCanRecycle: false,
        rows: this.data.rows.filter(item => item.id !== activity.id) })
      wx.showToast({ title: '活动已回收', icon: 'none' })
    },
    closeOverridePanel() { this.setData({ overrideOpen: false, overrideError: '' }) },
    chooseOverrideStudent(event: WechatMiniprogram.PickerChange) {
      const overrideStudentIndex = Number(event.detail.value)
      const selected = this.data.overrideStudents[overrideStudentIndex]
      if (!selected) return
      this.setData({ overrideStudentId: selected.studentId, overrideStudentIndex, overrideStudentName: selected.displayNameMasked,
        overrideState: null, overrideIntent: clearWriteIntent(), overrideError: '' }, () => this.loadOverrideState())
    },
    chooseOverrideDate(event: WechatMiniprogram.PickerChange) {
      const overrideDate = String(event.detail.value)
      const activity = this.data.rows.find(item => item.id === this.data.overrideActivityId)
      if (!activity || overrideDate < activity.schedule.startsOn || overrideDate > activity.schedule.endsOn
        || activity.schedule.restDates.includes(overrideDate)) {
        this.setData({ overrideError: '补记日期须在活动有效任务日内' }); return
      }
      this.setData({ overrideDate, overrideState: null, overrideIntent: clearWriteIntent(), overrideError: '' },
        () => this.loadOverrideState())
    },
    async loadOverrideState() {
      const session = getSession()
      const { overrideActivityId, overrideStudentId, overrideDate } = this.data
      if (!session || !overrideActivityId || !overrideStudentId || !overrideDate) return
      this.setData({ overrideLoading: true, overrideError: '' })
      const result = await getActivityOverrideForTeacher(session.user.id, overrideActivityId, overrideStudentId, overrideDate)
      if (!result.ok) { this.setData({ overrideLoading: false, overrideError: result.error.message }); return }
      if (this.data.overrideActivityId !== overrideActivityId || this.data.overrideStudentId !== overrideStudentId
        || this.data.overrideDate !== overrideDate) return
      this.setData({ overrideLoading: false, overrideState: result.data,
        overrideReason: result.data.reason ?? '', overrideError: '' })
    },
    onOverrideReason(event: WechatMiniprogram.Input) {
      this.setData({ overrideReason: event.detail.value, overrideError: '' })
    },
    async submitOverride(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const state = this.data.overrideState
      const active = event.currentTarget.dataset.active === 'true'
      if (!session || !state || this.data.overrideSaving || this.data.overrideLoading) return
      const reason = this.data.overrideReason.trim()
      if (!reason || reason.length > 300) { this.setData({ overrideError: '请填写 1—300 字补记或撤销原因' }); return }
      if (!active && !state.active) { this.setData({ overrideError: '当前没有可撤销的补记' }); return }
      const input = { activityId: state.activityId, studentId: state.studentId, date: state.date, active, reason }
      const fingerprint = JSON.stringify({ input, version: state.version })
      const intent = prepareWriteIntent(this.data.overrideIntent, fingerprint, () => createPageOperationId('activity_override'))
      this.setData({ overrideSaving: true, overrideIntent: intent, overrideError: '' })
      const result = await setActivityOverride(session.user.id, input, state.version, intent.operationId)
      if (!result.ok) { this.setData({ overrideSaving: false, overrideError: result.error.message }); return }
      this.setData({ overrideSaving: false, overrideState: { activityId: result.data.activityId,
        studentId: result.data.studentId, date: result.data.date, version: result.data.version,
        active: result.data.active, reason: result.data.reason, changedAt: result.data.changedAt },
      overrideIntent: clearWriteIntent(), overrideError: '' })
      wx.showToast({ title: active ? '已补记' : '已撤销补记', icon: 'none' })
    },
  },
})
