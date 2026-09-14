import { canPublishReview, canSubmitAssignment, getRedoDueAt, getTodayTask, hasReachedRedoLimit, nextAssignmentStatusAfterSubmit } from '../domain/task-rules'
import { getState, mutateState } from '../repositories/memory/mock-state'
import { addOperationReceipt, findOperation } from '../repositories/memory/write-operations'
import { AppState, HomeView, ReviewFeedback, Role, ServiceError, ServiceResult, Session, Submission, Task, TaskDetailView, UserAccount } from '../domain/types'
import { Clock, systemClock } from './clock'

const id = (prefix: string): string => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`

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
}

export interface SaveSubmissionDraftCommand {
  operationId: string
  expectedVersion: number
  taskId: string
  answer: string
}

export interface SubmitTaskCommand {
  operationId: string
  expectedVersion: number
  taskId: string
  answer: string
}

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
  if (!mobile || !password) return fail('VALIDATION_ERROR', '请输入手机号和密码')
  const state = getState()
  const userId = mobile === '13800000001' ? 'usr_student_xiaoyu' : mobile === '13800000002' ? 'usr_teacher_lin' : mobile === '13800000003' ? 'usr_parent_xiaoyu' : ''
  const user = state.users.find(item => item.id === userId)
  if (!user || password !== '123456') return fail('UNAUTHENTICATED', '手机号或密码不正确')
  return ok({ sessionId: `ses_${user.id}`, user })
}

export async function listRoles(userId: string): Promise<ServiceResult<Role[]>> {
  const user = getState().users.find(item => item.id === userId)
  if (!user) return fail('NOT_FOUND', '身份不存在')
  return ok([user.role])
}

export async function getUser(userId: string): Promise<ServiceResult<UserAccount>> {
  const user = getState().users.find(item => item.id === userId)
  return user ? ok(user) : fail('NOT_FOUND', '用户不存在')
}

export async function getHome(userId: string): Promise<ServiceResult<HomeView>> {
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
  const state = getState()
  const task = state.tasks.find(item => item.id === taskId)
  const assignment = state.assignments.find(item => item.taskId === taskId && item.studentId === userId)
  if (!task || !assignment) return fail('FORBIDDEN', '无权查看该任务')
  const submission = state.submissions.filter(item => item.assignmentId === assignment.id).sort((a, b) => b.version - a.version)[0]
  const feedback = submission ? state.feedback.find(item => item.submissionId === submission.id) : undefined
  return ok({ task, assignment, submission, feedback })
}

export async function listStudentTasks(userId: string): Promise<ServiceResult<TaskDetailView[]>> {
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
  assignmentId: string
  taskId: string
  status: string
  submissionId?: string
  submissionVersion?: number
  score?: number
  comment?: string
}

export async function getCompletion(userId: string, taskId: string): Promise<ServiceResult<ReviewAssignmentView[]>> {
  const state = getState()
  const teacher = state.users.find(item => item.id === userId)
  const task = state.tasks.find(item => item.id === taskId)
  if (!teacher || !task || !canTeacherManageTask(teacher, task)) return fail('FORBIDDEN', '无权检查该任务')
  const rows = state.assignments.filter(item => item.taskId === taskId).map(assignment => {
    const student = state.users.find(item => item.id === assignment.studentId)
    const submission = assignment.latestSubmissionId ? state.submissions.find(item => item.id === assignment.latestSubmissionId) : undefined
    const feedback = submission ? state.feedback.find(item => item.submissionId === submission.id) : undefined
    return { studentName: student?.displayName ?? '学生', assignmentId: assignment.id, taskId, status: assignment.status, submissionId: submission?.id, submissionVersion: submission?.version, score: feedback?.score, comment: feedback?.textComment }
  })
  return ok(rows)
}

export function publishClassroomTask(userId: string, title: string, description: string): Promise<ServiceResult<Task>>
export function publishClassroomTask(userId: string, command: PublishClassroomTaskCommand, clock?: Clock): Promise<ServiceResult<Task>>
export async function publishClassroomTask(userId: string, titleOrCommand: string | PublishClassroomTaskCommand, descriptionOrClock: string | Clock = ''): Promise<ServiceResult<Task>> {
  const command = typeof titleOrCommand === 'string' ? undefined : titleOrCommand
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
  const state = getState()
  const parent = state.users.find(item => item.id === userId)
  if (!parent || parent.role !== 'parent') return fail('FORBIDDEN', '无权查看孩子数据')
  const assignment = state.assignments.find(item => item.taskId === taskId && hasActiveParentStudentLink(state, parent.id, item.studentId))
  const detail = assignment ? buildTaskDetail(state, assignment) : null
  return detail ? ok(detail) : fail('NOT_FOUND', '任务不存在或不可查看')
}

export async function getParentFeedback(userId: string, taskId: string): Promise<ServiceResult<ReviewFeedback>> {
  const result = await getParentTask(userId, taskId)
  if (!result.ok) return result
  return result.data.feedback ? ok(result.data.feedback) : fail('NOT_FOUND', '老师暂未发布反馈')
}
