import { canPublishReview, canSubmitAssignment, getRedoDueAt, getTodayTask, hasReachedRedoLimit, nextAssignmentStatusAfterSubmit } from '../domain/task-rules'
import { getState, mutateState } from '../repositories/memory/mock-state'
import { addOperationReceipt, findOperation } from '../repositories/memory/write-operations'
import { AppState, HomeView, ParentChildLinkView, ReadingListItem, ReadingProgress, ReadingResource, ReviewFeedback, Role, ServiceError, ServiceResult, Session, Submission, Task, TaskCompletionValue, TaskDetailView, TeacherStudentDetail, TeacherStudentPage, TeacherStudentStatusFilter, UserAccount, VocabularyPack, VocabularyProgress } from '../domain/types'
import { getCloudAppService } from '../repositories/repository-factory'
import { Clock, systemClock } from './clock'

const id = (prefix: string): string => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
let demoStudentPassword = '123456'

function ok<T>(data: T): ServiceResult<T> { return { ok: true, data } }
function fail<T>(code: ServiceError['code'], message: string, retryable = false): ServiceResult<T> { return { ok: false, error: { code, message, retryable } } }

function normalizedText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

function fingerprint(value: object): string {
  return JSON.stringify(value)
}

function operationConflict<T>(): ServiceResult<T> {
  return fail('CONFLICT', '该操作已使用不同内容，请刷新后重试')
}

function versionConflict<T>(): ServiceResult<T> {
  return fail('CONFLICT', '页面数据已更新，请刷新后重试')
}

function hasValidOperation(operationId: string, expectedVersion: number): boolean {
  return Boolean(operationId.trim()) && Number.isInteger(expectedVersion) && expectedVersion >= 0
}

export interface PublishClassroomTaskCommand {
  operationId: string
  expectedVersion: number
  title: string
  description: string
  structuredDraft?: StructuredTaskDraft
}

export interface StructuredTaskDraft {
  items: Array<{ id: string; resourceId: string; type: 'reading' | 'vocabulary' | 'exercise'; requiredCount: number; maxScore: number }>
  target: { type: 'classes'; classIds: string[] } | { type: 'students'; studentIds: string[] }
  startsAt: string
  dueAt: string
  latePolicy: { allowLate: boolean; lateDays: number }
  teacherNote?: string
}

export interface TaskDraftOptionsView {
  selectedClassName: string
  resources: Array<{ id: string; title: string; type: 'reading' | 'vocabulary' | 'exercise'; requiredCount: number }>
  structuredDraft: StructuredTaskDraft
}

export interface StructuredSubmissionAnswer { itemId: string; value: TaskCompletionValue }

export interface SaveSubmissionDraftCommand {
  operationId: string
  expectedVersion: number
  taskId: string
  answer: string
  assignmentVersion?: number
  draftVersion?: number
  structuredAnswers?: StructuredSubmissionAnswer[]
}

export interface SubmitTaskCommand {
  operationId: string
  expectedVersion: number
  taskId: string
  answer: string
  assignmentVersion?: number
  draftVersion?: number
  structuredAnswers?: StructuredSubmissionAnswer[]
}

export interface BindChildCommand { operationId: string; studentNumber: string; code: string }
export interface UnbindChildCommand { operationId: string; expectedVersion: number; childId: string; reason: string }
export interface SaveReadingProgressCommand { operationId: string; expectedVersion: number; resourceId: string; chapterId: string; pageId: string; pageNumber: number; favorite: boolean }
export interface SaveVocabularyProgressCommand { operationId: string; expectedVersion: number; packId: string; completedCount: number; correctCount: number; wrongWordIds: string[] }

export interface PublishReviewCommand {
  operationId: string
  expectedVersion: number
  taskId: string
  assignmentId?: string
  decision: 'approved' | 'returned'
  score: number
  comment: string
}

function canTeacherManageTask(teacher: UserAccount, task: Task): boolean {
  return teacher.role === 'teacher' && (task.creatorTeacherId === teacher.id || teacher.classId === task.classId)
}

function hasActiveParentStudentLink(state: AppState, parentId: string, studentId: string): boolean {
  return state.parentStudentLinks.some(link => link.parentId === parentId && link.studentId === studentId && link.status === 'active')
}

function buildTaskDetail(state: AppState, assignment: AppState['assignments'][number]): TaskDetailView | null {
  const task = state.tasks.find(item => item.id === assignment.taskId)
  if (!task) return null
  const submission = state.submissions.filter(item => item.assignmentId === assignment.id).sort((a, b) => b.version - a.version)[0]
  const feedback = submission ? state.feedback.find(item => item.submissionId === submission.id) : undefined
  const view: TaskDetailView = { task, assignment }
  if (submission) view.submission = submission
  if (feedback) view.feedback = feedback
  return view
}

export async function login(mobile: string, password: string): Promise<ServiceResult<Session>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.login(mobile, password)
  if (!mobile || !password) return fail('VALIDATION_ERROR', '请输入手机号和密码')
  const state = getState()
  const userId = mobile === '13800000001' ? 'usr_student_xiaoyu' : mobile === '13800000002' ? 'usr_teacher_lin' : mobile === '13800000003' ? 'usr_parent_xiaoyu' : ''
  const user = state.users.find(item => item.id === userId)
  const expectedPassword = mobile === '13800000001' ? demoStudentPassword : '123456'
  if (!user || password !== expectedPassword) return fail('UNAUTHENTICATED', '手机号或密码不正确')
  return ok({ sessionId: `ses_${user.id}`, user })
}

export async function requestPasswordResetCode(mobile: string): Promise<ServiceResult<{ expiresInMinutes: number }>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.requestPasswordResetCode(mobile)
  if (!/^1\d{10}$/.test(mobile)) return fail('VALIDATION_ERROR', '请输入正确的手机号')
  return ok({ expiresInMinutes: 10 })
}

export async function resetPassword(mobile: string, code: string, newPassword: string): Promise<ServiceResult<null>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.resetPassword(mobile, code, newPassword)
  if (!/^1\d{10}$/.test(mobile) || !/^\d{6}$/.test(code) || newPassword.length < 6 || newPassword.length > 32) return fail('VALIDATION_ERROR', '手机号、验证码或新密码格式不正确')
  if (mobile === '13800000001' && code === '246810') demoStudentPassword = newPassword
  return ok(null)
}

export async function listRoles(userId: string): Promise<ServiceResult<Role[]>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.listRoles(userId)
  const user = getState().users.find(item => item.id === userId)
  if (!user) return fail('NOT_FOUND', '身份不存在')
  return ok([user.role])
}

export async function selectRole(userId: string, role: Role): Promise<ServiceResult<Session>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.selectRole(userId, role)
  const user = getState().users.find(item => item.id === userId && item.role === role)
  return user ? ok({ sessionId: `ses_${user.id}`, user, availableRoles: [role], activeRole: role }) : fail('FORBIDDEN', '身份不可用')
}

export async function getUser(userId: string): Promise<ServiceResult<UserAccount>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.getUser(userId)
  const user = getState().users.find(item => item.id === userId)
  return user ? ok(user) : fail('NOT_FOUND', '用户不存在')
}

export async function getHome(userId: string): Promise<ServiceResult<HomeView>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.getHome(userId)
  const state = getState()
  const user = state.users.find(item => item.id === userId)
  if (!user) return fail('UNAUTHENTICATED', '登录状态已失效')
  if (user.role !== 'student') return ok({ user, task: null, assignment: null, completedCount: 0, totalCount: 0 })
  const today = getTodayTask(state.tasks, state.assignments, user.id)
  const totalCount = today.task?.items.length ?? 0
  const completedCount = today.assignment && totalCount > 0 ? Math.min(totalCount, Math.floor(today.assignment.progressPercent * totalCount / 100)) : 0
  return ok({ user, task: today.task, assignment: today.assignment, completedCount, totalCount })
}

export async function getTaskDetail(userId: string, taskId: string): Promise<ServiceResult<TaskDetailView>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.getTaskDetail(userId, taskId)
  const state = getState()
  const task = state.tasks.find(item => item.id === taskId)
  const assignment = state.assignments.find(item => item.taskId === taskId && item.studentId === userId)
  if (!task || !assignment) return fail('FORBIDDEN', '无权查看该任务')
  const submission = state.submissions.filter(item => item.assignmentId === assignment.id).sort((a, b) => b.version - a.version)[0]
  const feedback = submission ? state.feedback.find(item => item.submissionId === submission.id) : undefined
  return ok({ task, assignment, submission, feedback })
}

export async function listStudentTasks(userId: string): Promise<ServiceResult<TaskDetailView[]>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.listStudentTasks(userId)
  const state = getState()
  const user = state.users.find(item => item.id === userId)
  if (!user || user.role !== 'student') return fail('FORBIDDEN', '仅学生可查看任务')
  const items: TaskDetailView[] = []
  state.assignments.filter(item => item.studentId === userId).forEach(assignment => {
    const task = state.tasks.find(item => item.id === assignment.taskId)
    if (!task) return
    const submission = state.submissions.filter(item => item.assignmentId === assignment.id).sort((a, b) => b.version - a.version)[0]
    const feedback = submission ? state.feedback.find(item => item.submissionId === submission.id) : undefined
    const view: TaskDetailView = { task, assignment }
    if (submission) view.submission = submission
    if (feedback) view.feedback = feedback
    items.push(view)
  })
  return ok(items)
}

export function saveDraft(userId: string, taskId: string, answer: string): Promise<ServiceResult<Submission>>
export function saveDraft(userId: string, command: SaveSubmissionDraftCommand): Promise<ServiceResult<Submission>>
export async function saveDraft(userId: string, taskIdOrCommand: string | SaveSubmissionDraftCommand, legacyAnswer = ''): Promise<ServiceResult<Submission>> {
  const command = typeof taskIdOrCommand === 'string' ? undefined : taskIdOrCommand
  const cloud = getCloudAppService()
  if (cloud) {
    if (!command) return fail('VALIDATION_ERROR', '云端保存需要完整操作参数')
    return cloud.saveDraft(userId, command)
  }
  const taskId = command?.taskId ?? taskIdOrCommand as string
  const answer = normalizedText(command?.answer ?? legacyAnswer)
  const state = getState()
  const assignment = state.assignments.find(item => item.taskId === taskId && item.studentId === userId)
  if (!assignment) return fail('FORBIDDEN', '无权提交该任务')
  const existing = state.submissions.filter(item => item.assignmentId === assignment.id).sort((a, b) => b.version - a.version)[0]
  const commandFingerprint = command ? fingerprint({ taskId, answer, expectedVersion: command.expectedVersion }) : ''
  if (command) {
    if (!hasValidOperation(command.operationId, command.expectedVersion)) return fail('VALIDATION_ERROR', '操作标识或版本无效')
    const operation = findOperation<Submission>(state, 'save_submission_draft', userId, command.operationId.trim(), commandFingerprint)
    if (operation.status === 'conflict') return operationConflict()
    if (operation.status === 'replay') return ok(operation.result!)
    if (command.expectedVersion !== (existing?.version ?? 0)) return versionConflict()
  }
  let savedId = ''
  const nextState = mutateState(draft => {
    const target = draft.submissions.find(item => item.id === existing?.id)
    if (target && target.status === 'draft') {
      target.version += 1
      target.answers = [{ taskItemId: 'tki_reading', value: answer }]
      savedId = target.id
    } else {
      const next: Submission = { id: id('sub'), assignmentId: assignment.id, studentId: userId, version: (existing?.version ?? 0) + 1, status: 'draft', answers: [{ taskItemId: 'tki_reading', value: answer }] }
      draft.submissions.push(next)
      savedId = next.id
    }
    const saved = draft.submissions.find(item => item.id === savedId)!
    if (command) addOperationReceipt(draft, { kind: 'save_submission_draft', actorUserId: userId, operationId: command.operationId.trim(), fingerprint: commandFingerprint, result: saved })
  })
  const saved = nextState.submissions.find(item => item.id === savedId)
  return saved ? ok(saved) : fail('CONFLICT', '草稿保存失败，请重试', true)
}

export function submitTask(userId: string, taskId: string, answer: string, clock?: Clock): Promise<ServiceResult<Submission>>
export function submitTask(userId: string, command: SubmitTaskCommand, clock?: Clock): Promise<ServiceResult<Submission>>
export async function submitTask(userId: string, taskIdOrCommand: string | SubmitTaskCommand, answerOrClock: string | Clock = '', legacyClock: Clock = systemClock): Promise<ServiceResult<Submission>> {
  const command = typeof taskIdOrCommand === 'string' ? undefined : taskIdOrCommand
  const cloud = getCloudAppService()
  if (cloud) {
    if (!command) return fail('VALIDATION_ERROR', '云端提交需要完整操作参数')
    return cloud.submitTask(userId, command)
  }
  const taskId = command?.taskId ?? taskIdOrCommand as string
  const answer = normalizedText(command?.answer ?? (typeof answerOrClock === 'string' ? answerOrClock : ''))
  const clock = command ? (typeof answerOrClock === 'string' ? legacyClock : answerOrClock) : legacyClock
  const state = getState()
  const assignment = state.assignments.find(item => item.taskId === taskId && item.studentId === userId)
  if (!assignment) return fail('FORBIDDEN', '当前任务不可提交')
  const existing = state.submissions.filter(item => item.assignmentId === assignment.id).sort((a, b) => b.version - a.version)[0]
  const commandFingerprint = command ? fingerprint({ taskId, answer, expectedVersion: command.expectedVersion }) : ''
  if (command) {
    if (!hasValidOperation(command.operationId, command.expectedVersion)) return fail('VALIDATION_ERROR', '操作标识或版本无效')
    const operation = findOperation<Submission>(state, 'submit_task', userId, command.operationId.trim(), commandFingerprint)
    if (operation.status === 'conflict') return operationConflict()
    if (operation.status === 'replay') return ok(operation.result!)
    if (command.expectedVersion !== (existing?.version ?? 0)) return versionConflict()
  }
  const now = clock.now()
  if (!canSubmitAssignment(assignment, now.toISOString())) return fail('TASK_NOT_SUBMITTABLE', '当前任务不可提交')
  let submissionId = ''
  const next = mutateState(draft => {
    const submission: Submission = { id: id('sub'), assignmentId: assignment.id, studentId: userId, version: (existing?.version ?? 0) + 1, status: 'submitted', answers: [{ taskItemId: 'tki_reading', value: answer }], submittedAt: now.toISOString() }
    draft.submissions.push(submission)
    submissionId = submission.id
    const item = draft.assignments.find(current => current.id === assignment.id)
    if (item) {
      item.status = nextAssignmentStatusAfterSubmit()
      item.progressPercent = 100
      item.latestSubmissionId = submission.id
      item.redoDueAt = undefined
      item.submittedAt = submission.submittedAt
    }
    if (command) addOperationReceipt(draft, { kind: 'submit_task', actorUserId: userId, operationId: command.operationId.trim(), fingerprint: commandFingerprint, result: submission })
  })
  return ok(next.submissions.find(item => item.id === submissionId)!)
}

export async function getTeacherTasks(userId: string): Promise<ServiceResult<{ tasks: AppState['tasks']; pendingCount: number; progressByTask: Record<string, number>; pendingByTask: Record<string, number> }>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.getTeacherTasks(userId)
  const state = getState()
  const user = state.users.find(item => item.id === userId)
  if (!user || user.role !== 'teacher') return fail('FORBIDDEN', '仅教师可查看')
  const manageableTasks = state.tasks.filter(item => canTeacherManageTask(user, item))
  const taskIds = manageableTasks.map(item => item.id)
  const pendingCount = state.assignments.filter(item => taskIds.includes(item.taskId) && item.status === 'awaiting_review').length
  const progressByTask: Record<string, number> = {}
  const pendingByTask: Record<string, number> = {}
  for (const taskId of taskIds) {
    const assignments = state.assignments.filter(item => item.taskId === taskId)
    const submittedCount = assignments.filter(item => item.status === 'awaiting_review' || item.status === 'completed').length
    progressByTask[taskId] = assignments.length ? Math.round(submittedCount * 100 / assignments.length) : 0
    pendingByTask[taskId] = assignments.filter(item => item.status === 'awaiting_review').length
  }
  return ok({ tasks: manageableTasks, pendingCount, progressByTask, pendingByTask })
}

export interface ReviewAssignmentView {
  studentName: string
  className?: string
  studentNumber?: string
  submittedAt?: string
  assignmentId: string
  taskId: string
  status: string
  submissionId?: string
  submissionVersion?: number
  score?: number
  comment?: string
}

export async function getCompletion(userId: string, taskId: string): Promise<ServiceResult<ReviewAssignmentView[]>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.getCompletion(userId, taskId)
  const state = getState()
  const teacher = state.users.find(item => item.id === userId)
  const task = state.tasks.find(item => item.id === taskId)
  if (!teacher || !task || !canTeacherManageTask(teacher, task)) return fail('FORBIDDEN', '无权检查该任务')
  const rows = state.assignments.filter(item => item.taskId === taskId).map(assignment => {
    const student = state.users.find(item => item.id === assignment.studentId)
    const submission = assignment.latestSubmissionId ? state.submissions.find(item => item.id === assignment.latestSubmissionId) : undefined
    const feedback = submission ? state.feedback.find(item => item.submissionId === submission.id) : undefined
    return { studentName: student?.displayName ?? '学生', className: '三年级 2 班', studentNumber: student?.id === 'usr_student_xiaoyu' ? '0321' : student?.id.replace(/\D/g, '').slice(-4).padStart(4, '0'), submittedAt: assignment.submittedAt, assignmentId: assignment.id, taskId, status: assignment.status, submissionId: submission?.id, submissionVersion: submission?.version, score: feedback?.score, comment: feedback?.textComment }
  })
  return ok(rows)
}

export function publishClassroomTask(userId: string, title: string, description: string): Promise<ServiceResult<Task>>
export function publishClassroomTask(userId: string, command: PublishClassroomTaskCommand, clock?: Clock): Promise<ServiceResult<Task>>
export async function publishClassroomTask(userId: string, titleOrCommand: string | PublishClassroomTaskCommand, descriptionOrClock: string | Clock = ''): Promise<ServiceResult<Task>> {
  const command = typeof titleOrCommand === 'string' ? undefined : titleOrCommand
  const cloud = getCloudAppService()
  if (cloud) {
    if (!command) return fail('VALIDATION_ERROR', '云端发布需要完整操作参数')
    return cloud.publishClassroomTask(userId, command)
  }
  const title = normalizedText(command?.title ?? titleOrCommand as string)
  const description = normalizedText(command?.description ?? (typeof descriptionOrClock === 'string' ? descriptionOrClock : ''))
  const clock = command && typeof descriptionOrClock !== 'string' ? descriptionOrClock : systemClock
  const state = getState()
  const user = state.users.find(item => item.id === userId)
  if (!user || user.role !== 'teacher') return fail('FORBIDDEN', '仅教师可布置任务')
  const commandFingerprint = command ? fingerprint({ title, description, expectedVersion: command.expectedVersion }) : ''
  if (command) {
    if (!hasValidOperation(command.operationId, command.expectedVersion)) return fail('VALIDATION_ERROR', '操作标识或版本无效')
    const operation = findOperation<Task>(state, 'publish_task', userId, command.operationId.trim(), commandFingerprint)
    if (operation.status === 'conflict') return operationConflict()
    if (operation.status === 'replay') return ok(operation.result!)
    if (command.expectedVersion !== 0) return versionConflict()
  }
  if (!title) return fail('VALIDATION_ERROR', '请输入任务名称')
  let taskId = ''
  const nextState = mutateState(draft => {
    const startsAt = clock.now()
    const dueAt = new Date(startsAt)
    dueAt.setHours(20, 0, 0, 0)
    if (dueAt <= startsAt) dueAt.setDate(dueAt.getDate() + 1)
    const nextTask: Task = {
      id: id('tsk'),
      title,
      deliveryType: 'classroom',
      status: 'active',
      creatorTeacherId: user.id,
      classId: 'cls_grade3_2',
      startsAt: startsAt.toISOString(),
      dueAt: dueAt.toISOString(),
      description,
      items: [
        { id: id('tki_reading'), type: 'reading', title: '阅读练习', completionRule: '完成指定阅读内容' },
        { id: id('tki_vocabulary'), type: 'vocabulary', title: '单词练习', completionRule: '完成指定词量' },
        { id: id('tki_exercise'), type: 'exercise', title: '习题练习', completionRule: '完成全部题目' },
      ],
      version: 1,
    }
    taskId = nextTask.id
    draft.tasks.push(nextTask)
    const students = draft.users.filter(item => item.role === 'student' && item.classId === nextTask.classId)
    draft.assignments.push(...students.map(student => ({ id: id('asn'), taskId: nextTask.id, studentId: student.id, classId: nextTask.classId, status: 'not_started' as const, progressPercent: 0, redoCount: 0 })))
    if (command) addOperationReceipt(draft, { kind: 'publish_task', actorUserId: userId, operationId: command.operationId.trim(), fingerprint: commandFingerprint, result: nextTask })
  })
  return ok(nextState.tasks.find(item => item.id === taskId)!)
}

export function reviewSubmission(userId: string, taskId: string, decision: 'approved' | 'returned', score: number, comment: string, assignmentId?: string, clock?: Clock): Promise<ServiceResult<ReviewFeedback>>
export function reviewSubmission(userId: string, command: PublishReviewCommand, clock?: Clock): Promise<ServiceResult<ReviewFeedback>>
export async function reviewSubmission(
  userId: string,
  taskIdOrCommand: string | PublishReviewCommand,
  decisionOrClock: 'approved' | 'returned' | Clock = 'approved',
  legacyScore = 0,
  legacyComment = '',
  legacyAssignmentId?: string,
  legacyClock: Clock = systemClock,
): Promise<ServiceResult<ReviewFeedback>> {
  const command = typeof taskIdOrCommand === 'string' ? undefined : taskIdOrCommand
  const cloud = getCloudAppService()
  if (cloud) {
    if (!command) return fail('VALIDATION_ERROR', '云端点评需要完整操作参数')
    return cloud.reviewSubmission(userId, command)
  }
  const taskId = command?.taskId ?? taskIdOrCommand as string
  const decision = command?.decision ?? decisionOrClock as 'approved' | 'returned'
  const score = Math.max(0, Math.min(100, command?.score ?? legacyScore))
  const comment = normalizedText(command?.comment ?? legacyComment)
  const assignmentId = command?.assignmentId ?? legacyAssignmentId
  const clock = command && typeof decisionOrClock !== 'string' ? decisionOrClock : legacyClock
  const state = getState()
  const teacher = state.users.find(item => item.id === userId)
  const task = state.tasks.find(item => item.id === taskId)
  if (!teacher || !task || !canTeacherManageTask(teacher, task)) return fail('FORBIDDEN', '当前提交不可点评')
  const commandFingerprint = command ? fingerprint({ taskId, assignmentId: command.assignmentId ?? '', expectedVersion: command.expectedVersion, decision, score, comment }) : ''
  if (command) {
    if (!hasValidOperation(command.operationId, command.expectedVersion)) return fail('VALIDATION_ERROR', '操作标识或版本无效')
    const operation = findOperation<ReviewFeedback>(state, 'publish_review', userId, command.operationId.trim(), commandFingerprint)
    if (operation.status === 'conflict') return operationConflict()
    if (operation.status === 'replay') return ok(operation.result!)
  }
  const assignment = assignmentId
    ? state.assignments.find(item => item.taskId === taskId && item.id === assignmentId)
    : state.assignments.find(item => item.taskId === taskId && item.status === 'awaiting_review' && item.latestSubmissionId)
  const submission = assignment ? state.submissions.find(item => item.id === assignment.latestSubmissionId) : undefined
  if (!assignment || !submission) return fail('FORBIDDEN', '当前提交不可点评')
  if (command && command.expectedVersion !== submission.version) return versionConflict()
  if (decision === 'returned' && hasReachedRedoLimit(assignment)) return fail('REDO_LIMIT_REACHED', '该任务已达到退回重做次数上限')
  if (!canPublishReview(assignment, decision, comment)) return fail('VALIDATION_ERROR', '退回重做必须填写原因')
  const publishedAt = clock.now().toISOString()
  let feedbackId = ''
  const next = mutateState(draft => {
    const feedback: ReviewFeedback = { id: id('fbk'), assignmentId: assignment.id, submissionId: submission.id, teacherId: teacher.id, decision, score, textComment: comment, returnReason: decision === 'returned' ? comment : undefined, publishedAt }
    draft.feedback.push(feedback)
    feedbackId = feedback.id
    const target = draft.assignments.find(item => item.id === assignment.id)
    const targetSubmission = draft.submissions.find(item => item.id === submission.id)
    if (targetSubmission) targetSubmission.status = decision === 'approved' ? 'reviewed' : 'returned'
    if (target) {
      target.status = decision === 'approved' ? 'completed' : 'redo_required'
      target.reviewedAt = feedback.publishedAt
      if (decision === 'returned') {
        target.redoCount += 1
        target.redoDueAt = getRedoDueAt(feedback.publishedAt)
      } else {
        target.redoDueAt = undefined
      }
    }
    if (command) addOperationReceipt(draft, { kind: 'publish_review', actorUserId: userId, operationId: command.operationId.trim(), fingerprint: commandFingerprint, result: feedback })
  })
  return ok(next.feedback.find(item => item.id === feedbackId)!)
}

export async function getParentHome(userId: string): Promise<ServiceResult<{ user: UserAccount; child: UserAccount; tasks: TaskDetailView[] }>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.getParentHome(userId)
  const state = getState()
  const parent = state.users.find(item => item.id === userId)
  const activeLink = state.parentStudentLinks.find(item => item.parentId === userId && item.status === 'active')
  const child = activeLink ? state.users.find(item => item.id === activeLink.studentId && item.role === 'student') : undefined
  if (!parent || parent.role !== 'parent' || !child) return fail('FORBIDDEN', '无权查看孩子数据')
  const tasks = state.assignments
    .filter(item => item.studentId === child.id)
    .map(assignment => buildTaskDetail(state, assignment))
    .filter((item): item is TaskDetailView => item !== null)
  return ok({ user: parent, child, tasks })
}

export async function getParentTask(userId: string, taskId: string): Promise<ServiceResult<TaskDetailView>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.getParentTask(userId, taskId)
  const state = getState()
  const parent = state.users.find(item => item.id === userId)
  if (!parent || parent.role !== 'parent') return fail('FORBIDDEN', '无权查看孩子数据')
  const assignment = state.assignments.find(item => item.taskId === taskId && hasActiveParentStudentLink(state, parent.id, item.studentId))
  const detail = assignment ? buildTaskDetail(state, assignment) : null
  return detail ? ok(detail) : fail('NOT_FOUND', '任务不存在或不可查看')
}

export async function getParentFeedback(userId: string, taskId: string): Promise<ServiceResult<ReviewFeedback>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.getParentFeedback(userId, taskId)
  const result = await getParentTask(userId, taskId)
  if (!result.ok) return result
  return result.data.feedback ? ok(result.data.feedback) : fail('NOT_FOUND', '老师暂未发布反馈')
}

export async function getDraftOptions(userId: string, clock: Clock = systemClock): Promise<ServiceResult<TaskDraftOptionsView>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.getDraftOptions(userId, clock.now().toISOString())
  const teacher = getState().users.find(item => item.id === userId && item.role === 'teacher')
  if (!teacher) return fail('FORBIDDEN', '仅教师可布置任务')
  const startsAt = clock.now()
  const dueAt = new Date(startsAt)
  dueAt.setHours(20, 0, 0, 0)
  if (dueAt <= startsAt) dueAt.setDate(dueAt.getDate() + 1)
  const resources: TaskDraftOptionsView['resources'] = [
    { id: 'resource_reading_demo', title: '动物主题绘本', type: 'reading', requiredCount: 3 },
    { id: 'resource_vocabulary_demo', title: '动物主题词包', type: 'vocabulary', requiredCount: 8 },
    { id: 'resource_exercise_demo', title: '动物主题习题', type: 'exercise', requiredCount: 5 },
  ]
  return ok({
    selectedClassName: '三年级 2 班', resources,
    structuredDraft: {
      items: resources.map(item => ({ id: `item_${item.type}`, resourceId: item.id, type: item.type, requiredCount: item.requiredCount, maxScore: 100 })),
      target: { type: 'classes', classIds: [teacher.classId ?? 'cls_grade3_2'] },
      startsAt: startsAt.toISOString(), dueAt: dueAt.toISOString(), latePolicy: { allowLate: true, lateDays: 7 },
    },
  })
}

export async function listTeacherStudents(
  userId: string,
  filters: Readonly<{ classId?: string; keyword?: string; status: TeacherStudentStatusFilter }>,
  cursor?: string,
): Promise<ServiceResult<TeacherStudentPage>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.listTeacherStudents(userId, filters, cursor)
  const teacher = getState().users.find(item => item.id === userId && item.role === 'teacher')
  if (!teacher) return fail('FORBIDDEN', '无权查看学员')
  const students = getState().users.filter(item => item.role === 'student' && (!filters.classId || item.classId === filters.classId))
    .filter(item => !filters.keyword || item.displayName.includes(filters.keyword) || item.id.includes(filters.keyword))
  const offset = cursor ? Number(cursor) : 0
  const items = students.slice(offset, offset + 20).map((student, index) => ({
    studentId: student.id, displayName: student.displayName,
    studentNumber: student.id === 'usr_student_xiaoyu' ? '0321' : String(322 + offset + index).padStart(4, '0'),
    accountStatus: 'active' as const, needsAttention: false,
    classInfo: { id: student.classId ?? '', name: '三年级 2 班', grade: '三年级', term: '上学期' },
    performance: { assignedCount: 1, completedCount: 0, overdueCount: 0, redoCount: 0, completionRate: 0, averageScore: null },
  }))
  return ok({ classes: [{ id: teacher.classId ?? 'cls_grade3_2', name: '三年级 2 班', grade: '三年级', term: '上学期' }], items, total: students.length, nextCursor: offset + 20 < students.length ? String(offset + 20) : null })
}

export async function getTeacherStudent(userId: string, studentId: string): Promise<ServiceResult<TeacherStudentDetail>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.getTeacherStudent(userId, studentId)
  const teacher = getState().users.find(item => item.id === userId && item.role === 'teacher')
  const student = getState().users.find(item => item.id === studentId && item.role === 'student')
  if (!teacher) return fail('FORBIDDEN', '无权查看学员')
  if (!student) return fail('NOT_FOUND', '学员不存在或已不在授权范围')
  return ok({
    studentId: student.id, displayName: student.displayName,
    studentNumber: student.id === 'usr_student_xiaoyu' ? '0321' : student.id.replace(/\D/g, '').padStart(4, '0'),
    accountStatus: 'active', needsAttention: false,
    classInfo: { id: student.classId ?? '', name: '三年级 2 班', grade: '三年级', term: '上学期' },
    parents: student.id === 'usr_student_xiaoyu' ? [{ linkId: 'rel_parent_xiaoyu', displayNameMasked: '小***', mobileMasked: '138****2046', confirmedAt: '2026-09-16T00:00:00.000Z' }] : [],
    performance: { assignedCount: 1, completedCount: 0, overdueCount: 0, redoCount: 0, completionRate: 0, averageScore: null }, recentTasks: [],
  })
}

export async function listParentChildren(userId: string): Promise<ServiceResult<ParentChildLinkView[]>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.listParentChildren(userId)
  const state = getState()
  const links = state.parentStudentLinks.filter(link => link.parentId === userId && link.status === 'active')
  return ok(links.map(link => {
    const child = state.users.find(user => user.id === link.studentId)!
    return { linkId: link.id, linkVersion: link.version ?? 1, childId: child.id, displayName: child.displayName, displayNameMasked: child.displayName.slice(0, 1) + '*', studentNumber: child.id === 'usr_student_xiaoyu' ? 'STU-DEMO-0032' : null, classId: child.classId ?? null, className: '三年级 2 班', confirmedAt: link.confirmedAt ?? null }
  }))
}

export async function bindChild(userId: string, command: BindChildCommand): Promise<ServiceResult<ParentChildLinkView>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.bindChild(userId, command)
  const state = getState()
  const fingerprintValue = fingerprint({ studentNumber: command.studentNumber, code: command.code })
  const receipt = state.relationshipOperationReceipts.find(item => item.operationId === command.operationId)
  if (receipt) return receipt.fingerprint === fingerprintValue && receipt.result ? ok(receipt.result) : operationConflict()
  if (!state.users.some(item => item.id === userId && item.role === 'parent')) return fail('FORBIDDEN', '无权绑定孩子')
  if (state.parentStudentLinks.filter(item => item.parentId === userId && item.status === 'active').length >= 5) return fail('CONFLICT', '最多可绑定 5 个孩子')
  const number = Number(command.studentNumber.replace(/\D/g, ''))
  const childId = number === 32 ? 'usr_student_xiaoyu' : `usr_student_demo_${String(number - 31).padStart(2, '0')}`
  const child = state.users.find(item => item.id === childId && item.role === 'student')
  const bindingCode = state.bindingCodes.find(item => item.studentId === childId)
  if (!child || !bindingCode || bindingCode.status !== 'active' || bindingCode.expiresAt <= new Date().toISOString()) return fail('VALIDATION_ERROR', '学生编号或绑定码无效')
  if (bindingCode.code !== command.code) {
    mutateState(draft => { const target = draft.bindingCodes.find(item => item.id === bindingCode.id); if (target) { target.attemptCount += 1; if (target.attemptCount >= 5) target.status = 'locked' } })
    return fail('VALIDATION_ERROR', '学生编号或绑定码无效')
  }
  if (state.parentStudentLinks.filter(item => item.studentId === childId && item.status === 'active').length >= 3) return fail('CONFLICT', '该学生已达 3 个家长的绑定上限')
  const view: ParentChildLinkView = { linkId: `rel_${userId}_${childId}`, linkVersion: 1, childId, displayName: child.displayName, displayNameMasked: child.displayName.slice(0, 1) + '*', studentNumber: command.studentNumber, classId: child.classId ?? null, className: '三年级 2 班', confirmedAt: new Date().toISOString() }
  mutateState(draft => {
    const existing = draft.parentStudentLinks.find(item => item.parentId === userId && item.studentId === childId)
    if (existing) { existing.status = 'active'; existing.version = 1; existing.confirmedAt = view.confirmedAt ?? undefined }
    else draft.parentStudentLinks.push({ id: view.linkId, parentId: userId, studentId: childId, status: 'active', version: 1, confirmedAt: view.confirmedAt ?? undefined })
    draft.relationshipOperationReceipts.push({ operationId: command.operationId, fingerprint: fingerprintValue, result: view })
  })
  return ok(view)
}

export async function unbindChild(userId: string, command: UnbindChildCommand): Promise<ServiceResult<null>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.unbindChild(userId, command)
  const state = getState()
  const fingerprintValue = fingerprint({ childId: command.childId, expectedVersion: command.expectedVersion, reason: command.reason })
  const receipt = state.relationshipOperationReceipts.find(item => item.operationId === command.operationId)
  if (receipt) return receipt.fingerprint === fingerprintValue ? ok(null) : operationConflict()
  const link = state.parentStudentLinks.find(item => item.parentId === userId && item.studentId === command.childId && item.status === 'active')
  if (!link) return fail('NOT_FOUND', '孩子绑定关系不存在')
  if ((link.version ?? 1) !== command.expectedVersion) return versionConflict()
  mutateState(draft => {
    const target = draft.parentStudentLinks.find(item => item.id === link.id)!
    target.status = 'revoked'; target.version = (target.version ?? 1) + 1
    draft.relationshipOperationReceipts.push({ operationId: command.operationId, fingerprint: fingerprintValue, result: null })
  })
  return ok(null)
}

const DEMO_VOCABULARY: VocabularyPack = { id: 'vocab_animals', title: '动物主题词包', grade: '三年级', unit: 'Unit 1', contentVersion: 'demo-v1', words: [
  { id: 'word_animal', word: 'sunshine', syllables: ['sun', 'shine'], meaning: '阳光', example: 'The sunshine is warm.' },
  { id: 'word_tiger', word: 'tiger', syllables: ['ti', 'ger'], meaning: '老虎', example: 'The tiger is strong.' },
] }

export async function listReadingResources(userId: string): Promise<ServiceResult<ReadingListItem[]>> {
  const cloud = getCloudAppService(); if (cloud) return cloud.listReadingResources(userId)
  return ok([{ id: 'read_zoo', title: '动物园的一天', category: 'picture_book', grade: '三年级', difficulty: '入门', contentVersion: 'demo-v1' }])
}
export async function getReadingResource(userId: string, resourceId: string): Promise<ServiceResult<ReadingResource>> {
  const cloud = getCloudAppService(); if (cloud) return cloud.getReadingResource(userId, resourceId)
  if (resourceId !== 'read_zoo') return fail('NOT_FOUND', '阅读内容不存在')
  return ok({ id: resourceId, title: '动物园的一天', category: 'picture_book', grade: '三年级', difficulty: '入门', contentVersion: 'demo-v1', presentation: 'page_images_only', textVisibility: { ocrExposed: false, standaloneBodyExposed: false }, chapters: [{ id: 'chapter_zoo_1', title: '动物园的一天', order: 1, pages: [
    { id: 'page_zoo_1', pageNumber: 1, order: 1, thumbnailAssetKey: 'demo-zoo-page-01', imageAssetKey: 'demo-zoo-page-01', width: 750, height: 1000, assetVersion: 'demo-v1' },
    { id: 'page_zoo_2', pageNumber: 2, order: 2, thumbnailAssetKey: 'demo-zoo-page-02', imageAssetKey: 'demo-zoo-page-02', width: 750, height: 1000, assetVersion: 'demo-v1' },
  ] }] })
}
export async function listVocabularyPacks(userId: string): Promise<ServiceResult<VocabularyPack[]>> { const cloud = getCloudAppService(); return cloud ? cloud.listVocabularyPacks(userId) : ok([DEMO_VOCABULARY]) }
export async function getVocabularyPack(userId: string, resourceId: string): Promise<ServiceResult<VocabularyPack>> { const cloud = getCloudAppService(); return cloud ? cloud.getVocabularyPack(userId, resourceId) : resourceId === DEMO_VOCABULARY.id ? ok(DEMO_VOCABULARY) : fail('NOT_FOUND', '词包不存在') }
export async function getReadingProgress(userId: string, resourceId: string): Promise<ServiceResult<ReadingProgress | null>> { const cloud = getCloudAppService(); return cloud ? cloud.getReadingProgress(userId, resourceId) : ok(getState().readingProgress.find(item => item.id === `reading_${userId}_${resourceId}`) ?? null) }
export async function saveReadingProgress(userId: string, command: SaveReadingProgressCommand): Promise<ServiceResult<ReadingProgress>> {
  const cloud = getCloudAppService(); if (cloud) return cloud.saveReadingProgress(userId, command)
  const activeUserId = memorySessionUserId()
  if (activeUserId !== null && activeUserId !== userId) return fail('FORBIDDEN', '无权保存该学习进度')
  if (command.resourceId !== 'read_zoo' || command.chapterId !== 'chapter_zoo_1' || !['page_zoo_1', 'page_zoo_2'].includes(command.pageId)) return fail('VALIDATION_ERROR', '阅读页信息无效')
  const state = getState(); const fingerprintValue = fingerprint(command)
  const receipt = state.learningOperationReceipts.find(item => item.operationId === command.operationId)
  if (receipt) return receipt.fingerprint === fingerprintValue ? ok(receipt.result as ReadingProgress) : operationConflict()
  const current = state.readingProgress.find(item => item.id === `reading_${userId}_${command.resourceId}`)
  if ((current?.version ?? 0) !== command.expectedVersion) return versionConflict()
  const saved: ReadingProgress = { id: `reading_${userId}_${command.resourceId}`, resourceId: command.resourceId, chapterId: command.chapterId, pageId: command.pageId, pageNumber: command.pageNumber, favorite: command.favorite, version: command.expectedVersion + 1, updatedAt: new Date().toISOString() }
  mutateState(draft => { draft.readingProgress = draft.readingProgress.filter(item => item.id !== saved.id); draft.readingProgress.push(saved); draft.learningOperationReceipts.push({ operationId: command.operationId, fingerprint: fingerprintValue, result: saved }) })
  return ok(saved)
}
export async function getVocabularyProgress(userId: string, packId: string): Promise<ServiceResult<VocabularyProgress | null>> { const cloud = getCloudAppService(); return cloud ? cloud.getVocabularyProgress(userId, packId) : ok(getState().vocabularyProgress.find(item => item.id === `vocabulary_${userId}_${packId}`) ?? null) }
export async function saveVocabularyProgress(userId: string, command: SaveVocabularyProgressCommand): Promise<ServiceResult<VocabularyProgress>> {
  const cloud = getCloudAppService(); if (cloud) return cloud.saveVocabularyProgress(userId, command)
  const activeUserId = memorySessionUserId()
  if (activeUserId !== null && activeUserId !== userId) return fail('FORBIDDEN', '无权保存该学习进度')
  if (command.packId !== DEMO_VOCABULARY.id || command.completedCount < 0 || command.completedCount > DEMO_VOCABULARY.words.length || command.correctCount < 0 || command.correctCount > command.completedCount || command.wrongWordIds.some(wordId => !DEMO_VOCABULARY.words.some(word => word.id === wordId))) return fail('VALIDATION_ERROR', '单词练习进度无效')
  const state = getState(); const fingerprintValue = fingerprint(command)
  const receipt = state.learningOperationReceipts.find(item => item.operationId === command.operationId)
  if (receipt) return receipt.fingerprint === fingerprintValue ? ok(receipt.result as VocabularyProgress) : operationConflict()
  const current = state.vocabularyProgress.find(item => item.id === `vocabulary_${userId}_${command.packId}`)
  if ((current?.version ?? 0) !== command.expectedVersion) return versionConflict()
  const saved: VocabularyProgress = { id: `vocabulary_${userId}_${command.packId}`, packId: command.packId, completedCount: command.completedCount, correctCount: command.correctCount, correctRate: command.completedCount ? Math.round(command.correctCount * 100 / command.completedCount) : 0, wrongWordIds: [...command.wrongWordIds], version: command.expectedVersion + 1, updatedAt: new Date().toISOString() }
  mutateState(draft => { draft.vocabularyProgress = draft.vocabularyProgress.filter(item => item.id !== saved.id); draft.vocabularyProgress.push(saved); draft.learningOperationReceipts.push({ operationId: command.operationId, fingerprint: fingerprintValue, result: saved }) })
  return ok(saved)
}
export async function logout(userId: string): Promise<ServiceResult<null>> { const cloud = getCloudAppService(); return cloud ? cloud.logout(userId) : ok(null) }

function memorySessionUserId(): string | null {
  try { return (wx.getStorageSync('yarei_session') as Session | null)?.user.id ?? null } catch (_error: unknown) { return null }
}
