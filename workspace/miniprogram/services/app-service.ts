import { canPublishReview, canSubmitAssignment, getTodayTask, nextAssignmentStatusAfterSubmit } from '../domain/task-rules'
import { getState, mutateState } from '../repositories/memory/mock-state'
import { AppState, HomeView, ReviewFeedback, Role, ServiceResult, Session, Submission, Task, TaskDetailView, UserAccount } from '../domain/types'

const id = (prefix: string): string => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`

function ok<T>(data: T): ServiceResult<T> { return { ok: true, data } }
function fail<T>(code: 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'NETWORK_ERROR', message: string, retryable = false): ServiceResult<T> { return { ok: false, error: { code, message, retryable } } }

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

export async function saveDraft(userId: string, taskId: string, answer: string): Promise<ServiceResult<Submission>> {
  const state = getState()
  const assignment = state.assignments.find(item => item.taskId === taskId && item.studentId === userId)
  if (!assignment) return fail('FORBIDDEN', '无权提交该任务')
  const existing = state.submissions.filter(item => item.assignmentId === assignment.id).sort((a, b) => b.version - a.version)[0]
  const submission = mutateState(draft => {
    const target = draft.submissions.find(item => item.id === existing?.id)
    if (target && target.status === 'draft') {
      target.answers = [{ taskItemId: 'tki_reading', value: answer }]
      return target
    }
    const next: Submission = { id: id('sub'), assignmentId: assignment.id, studentId: userId, version: (existing?.version ?? 0) + 1, status: 'draft', answers: [{ taskItemId: 'tki_reading', value: answer }] }
    draft.submissions.push(next)
    return next
  })
  const saved = submission.submissions.find(item => item.assignmentId === assignment.id && item.status === 'draft')
  return saved ? ok(saved) : fail('CONFLICT', '草稿保存失败，请重试', true)
}

export async function submitTask(userId: string, taskId: string, answer: string): Promise<ServiceResult<Submission>> {
  const state = getState()
  const assignment = state.assignments.find(item => item.taskId === taskId && item.studentId === userId)
  if (!assignment || !canSubmitAssignment(assignment)) return fail('FORBIDDEN', '当前任务不可提交')
  const existing = state.submissions.filter(item => item.assignmentId === assignment.id).sort((a, b) => b.version - a.version)[0]
  const next = mutateState(draft => {
    const submission: Submission = { id: id('sub'), assignmentId: assignment.id, studentId: userId, version: (existing?.version ?? 0) + 1, status: 'submitted', answers: [{ taskItemId: 'tki_reading', value: answer }], submittedAt: new Date().toISOString() }
    draft.submissions.push(submission)
    const item = draft.assignments.find(current => current.id === assignment.id)
    if (item) { item.status = nextAssignmentStatusAfterSubmit(); item.progressPercent = 100; item.latestSubmissionId = submission.id; item.submittedAt = submission.submittedAt }
    return submission
  })
  return ok(next.submissions[next.submissions.length - 1])
}

export async function getTeacherTasks(userId: string): Promise<ServiceResult<{ tasks: AppState['tasks']; pendingCount: number; progressByTask: Record<string, number>; pendingByTask: Record<string, number> }>> {
  const state = getState()
  const user = state.users.find(item => item.id === userId)
  if (!user || user.role !== 'teacher') return fail('FORBIDDEN', '仅教师可查看')
  const taskIds = state.tasks.filter(item => item.creatorTeacherId === user.id).map(item => item.id)
  const pendingCount = state.assignments.filter(item => taskIds.includes(item.taskId) && item.status === 'awaiting_review').length
  const progressByTask: Record<string, number> = {}
  const pendingByTask: Record<string, number> = {}
  for (const taskId of taskIds) {
    const assignments = state.assignments.filter(item => item.taskId === taskId)
    progressByTask[taskId] = assignments.length ? Math.round(assignments.reduce((total, item) => total + item.progressPercent, 0) / assignments.length) : 0
    pendingByTask[taskId] = assignments.filter(item => item.status === 'awaiting_review').length
  }
  return ok({ tasks: state.tasks.filter(item => taskIds.includes(item.id)), pendingCount, progressByTask, pendingByTask })
}

export interface ReviewAssignmentView {
  studentName: string
  assignmentId: string
  taskId: string
  status: string
  submissionId?: string
  score?: number
  comment?: string
}

export async function getCompletion(userId: string, taskId: string): Promise<ServiceResult<ReviewAssignmentView[]>> {
  const state = getState()
  const teacher = state.users.find(item => item.id === userId)
  const task = state.tasks.find(item => item.id === taskId)
  if (!teacher || teacher.role !== 'teacher' || !task || task.creatorTeacherId !== teacher.id) return fail('FORBIDDEN', '无权检查该任务')
  const rows = state.assignments.filter(item => item.taskId === taskId).map(assignment => {
    const student = state.users.find(item => item.id === assignment.studentId)
    const submission = assignment.latestSubmissionId ? state.submissions.find(item => item.id === assignment.latestSubmissionId) : undefined
    const feedback = submission ? state.feedback.find(item => item.submissionId === submission.id) : undefined
    return { studentName: student?.displayName ?? '学生', assignmentId: assignment.id, taskId, status: assignment.status, submissionId: submission?.id, score: feedback?.score, comment: feedback?.textComment }
  })
  return ok(rows)
}

export async function publishClassroomTask(userId: string, title: string, description: string): Promise<ServiceResult<Task>> {
  const state = getState()
  const user = state.users.find(item => item.id === userId)
  if (!user || user.role !== 'teacher') return fail('FORBIDDEN', '仅教师可布置任务')
  if (!title.trim()) return fail('VALIDATION_ERROR', '请输入任务名称')
  const task = mutateState(draft => {
    const nextTask: Task = {
      id: id('tsk'),
      title: title.trim(),
      deliveryType: 'classroom',
      status: 'active',
      creatorTeacherId: user.id,
      classId: 'cls_grade3_2',
      startsAt: new Date().toISOString(),
      dueAt: '2026-09-11T20:00:00+08:00',
      description: description.trim(),
      items: [
        { id: id('tki_reading'), type: 'reading', title: '阅读练习', completionRule: '完成指定阅读内容' },
        { id: id('tki_vocabulary'), type: 'vocabulary', title: '单词练习', completionRule: '完成指定词量' },
        { id: id('tki_exercise'), type: 'exercise', title: '习题练习', completionRule: '完成全部题目' },
      ],
      version: 1,
    }
    draft.tasks.push(nextTask)
    draft.assignments.push({ id: id('asn'), taskId: nextTask.id, studentId: 'usr_student_xiaoyu', classId: nextTask.classId, status: 'not_started', progressPercent: 0, redoCount: 0 })
    return nextTask
  })
  return ok(task.tasks[task.tasks.length - 1])
}

export async function reviewSubmission(userId: string, taskId: string, decision: 'approved' | 'returned', score: number, comment: string): Promise<ServiceResult<ReviewFeedback>> {
  const state = getState()
  const teacher = state.users.find(item => item.id === userId)
  const assignment = state.assignments.find(item => item.taskId === taskId)
  const submission = assignment ? state.submissions.find(item => item.id === assignment.latestSubmissionId) : undefined
  if (!teacher || teacher.role !== 'teacher' || !assignment || !submission) return fail('FORBIDDEN', '当前提交不可点评')
  if (!canPublishReview(assignment, decision, comment)) return fail('VALIDATION_ERROR', '退回重做必须填写原因')
  const next = mutateState(draft => {
    const feedback: ReviewFeedback = { id: id('fbk'), assignmentId: assignment.id, submissionId: submission.id, teacherId: teacher.id, decision, score: Math.max(0, Math.min(100, score)), textComment: comment.trim(), returnReason: decision === 'returned' ? comment.trim() : undefined, publishedAt: new Date().toISOString() }
    draft.feedback.push(feedback)
    const target = draft.assignments.find(item => item.id === assignment.id)
    if (target) { target.status = decision === 'approved' ? 'completed' : 'redo_required'; target.reviewedAt = feedback.publishedAt; if (decision === 'returned') target.redoCount += 1 }
    return feedback
  })
  return ok(next.feedback[next.feedback.length - 1])
}

export async function getParentHome(userId: string): Promise<ServiceResult<{ user: UserAccount; child: UserAccount; tasks: TaskDetailView[] }>> {
  const state = getState()
  const parent = state.users.find(item => item.id === userId)
  const child = state.users.find(item => item.role === 'student')
  if (!parent || parent.role !== 'parent' || !child) return fail('FORBIDDEN', '无权查看孩子数据')
  const tasks: TaskDetailView[] = []
  state.assignments.filter(item => item.studentId === child.id).forEach(assignment => {
    const task = state.tasks.find(item => item.id === assignment.taskId)
    if (!task) return
    const submission = assignment.latestSubmissionId ? state.submissions.find(item => item.id === assignment.latestSubmissionId) : undefined
    const feedback = submission ? state.feedback.find(item => item.submissionId === submission.id) : undefined
    const view: TaskDetailView = { task, assignment }
    if (submission) view.submission = submission
    if (feedback) view.feedback = feedback
    tasks.push(view)
  })
  return ok({ user: parent, child, tasks })
}

export async function getParentTask(userId: string, taskId: string): Promise<ServiceResult<TaskDetailView>> {
  const result = await getParentHome(userId)
  if (!result.ok) return result
  const detail = result.data.tasks.find(item => item.task.id === taskId)
  return detail ? ok(detail) : fail('NOT_FOUND', '任务不存在或不可查看')
}

export async function getParentFeedback(userId: string, taskId: string): Promise<ServiceResult<ReviewFeedback>> {
  const result = await getParentTask(userId, taskId)
  if (!result.ok) return result
  return result.data.feedback ? ok(result.data.feedback) : fail('NOT_FOUND', '老师暂未发布反馈')
}
