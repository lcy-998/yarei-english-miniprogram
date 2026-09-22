import {
  HomeView,
  ParentChildLinkView,
  ReviewFeedback,
  ReadingListItem,
  ReadingProgress,
  ReadingResource,
  Role,
  ServiceResult,
  Session,
  Submission,
  Task,
  TaskAssignment,
  TaskCompletionRule,
  TaskCompletionValue,
  TaskDetailView,
  TeacherStudentDetail,
  TeacherStudentPage,
  TeacherStudentStatusFilter,
  UserAccount,
  VocabularyPack,
  VocabularyProgress,
} from '../domain/types'
import {
  CloudAuthenticationPort,
  CloudClientContextProvider,
  CloudRepositoryClient,
} from '../repositories/cloudbase/protocol'
import type {
  BindChildCommand,
  PublishClassroomTaskCommand as CloudPublishTaskCommand,
  SaveReadingProgressCommand,
  SaveSubmissionDraftCommand as CloudSubmissionCommand,
  SaveVocabularyProgressCommand,
  StructuredSubmissionAnswer,
  StructuredTaskDraft,
  TaskDraftOptionsView,
  UnbindChildCommand,
} from './app-service'

export interface CloudReviewCommand {
  operationId: string
  expectedVersion: number
  taskId: string
  assignmentId?: string
  decision: 'approved' | 'returned'
  score: number
  comment: string
}

export interface CloudReviewAssignmentView {
  studentName: string
  assignmentId: string
  taskId: string
  status: string
  submissionId?: string
  submissionVersion?: number
  assignmentVersion?: number
  score?: number
  comment?: string
}

export interface CloudAppService {
  login(mobile: string, password: string): Promise<ServiceResult<Session>>
  requestPasswordResetCode(mobile: string): Promise<ServiceResult<{ expiresInMinutes: number }>>
  resetPassword(mobile: string, code: string, newPassword: string): Promise<ServiceResult<null>>
  listRoles(userId: string): Promise<ServiceResult<Role[]>>
  selectRole(userId: string, role: Role): Promise<ServiceResult<Session>>
  getUser(userId: string): Promise<ServiceResult<UserAccount>>
  getHome(userId: string): Promise<ServiceResult<HomeView>>
  getTaskDetail(userId: string, taskId: string): Promise<ServiceResult<TaskDetailView>>
  listStudentTasks(userId: string): Promise<ServiceResult<TaskDetailView[]>>
  saveDraft(userId: string, command: CloudSubmissionCommand): Promise<ServiceResult<Submission>>
  submitTask(userId: string, command: CloudSubmissionCommand): Promise<ServiceResult<Submission>>
  getTeacherTasks(userId: string): Promise<ServiceResult<TeacherTasksView>>
  getDraftOptions(userId: string, nowIso: string): Promise<ServiceResult<TaskDraftOptionsView>>
  getCompletion(userId: string, taskId: string): Promise<ServiceResult<CloudReviewAssignmentView[]>>
  listTeacherStudents(userId: string, filters: Readonly<{ classId?: string; keyword?: string; status: TeacherStudentStatusFilter }>, cursor?: string): Promise<ServiceResult<TeacherStudentPage>>
  getTeacherStudent(userId: string, studentId: string): Promise<ServiceResult<TeacherStudentDetail>>
  publishClassroomTask(userId: string, command: CloudPublishTaskCommand): Promise<ServiceResult<Task>>
  reviewSubmission(userId: string, command: CloudReviewCommand): Promise<ServiceResult<ReviewFeedback>>
  listParentChildren(userId: string): Promise<ServiceResult<ParentChildLinkView[]>>
  bindChild(userId: string, command: BindChildCommand): Promise<ServiceResult<ParentChildLinkView>>
  unbindChild(userId: string, command: UnbindChildCommand): Promise<ServiceResult<null>>
  getParentHome(userId: string): Promise<ServiceResult<ParentHomeView>>
  getParentTask(userId: string, taskId: string): Promise<ServiceResult<TaskDetailView>>
  getParentFeedback(userId: string, taskId: string): Promise<ServiceResult<ReviewFeedback>>
  listReadingResources(userId: string): Promise<ServiceResult<ReadingListItem[]>>
  getReadingResource(userId: string, resourceId: string): Promise<ServiceResult<ReadingResource>>
  listVocabularyPacks(userId: string): Promise<ServiceResult<VocabularyPack[]>>
  getVocabularyPack(userId: string, resourceId: string): Promise<ServiceResult<VocabularyPack>>
  getReadingProgress(userId: string, resourceId: string): Promise<ServiceResult<ReadingProgress | null>>
  saveReadingProgress(userId: string, command: SaveReadingProgressCommand): Promise<ServiceResult<ReadingProgress>>
  getVocabularyProgress(userId: string, packId: string): Promise<ServiceResult<VocabularyProgress | null>>
  saveVocabularyProgress(userId: string, command: SaveVocabularyProgressCommand): Promise<ServiceResult<VocabularyProgress>>
  logout(userId: string): Promise<ServiceResult<null>>
}

interface TeacherTasksView {
  tasks: Task[]
  pendingCount: number
  progressByTask: Record<string, number>
  pendingByTask: Record<string, number>
}

interface ParentHomeView { user: UserAccount; child: UserAccount; tasks: TaskDetailView[] }

interface AuthSessionWire {
  sessionId: string
  userId: string
  organizationId: string
  activeRole: Role | null
  roles: Role[]
  displayName?: string
}

interface PageWire<T> { items: T[]; total: number; nextCursor: string | null }

interface TeacherStudentPageWire extends TeacherStudentPage {}

interface TeacherStudentDetailWire extends TeacherStudentDetail {}

interface StudentListItemWire {
  taskId: string
  title: string
  status: TaskAssignment['status']
  startsAt: string
  dueAt: string
  submittedAt: string | null
}

interface StudentHomeWire {
  localDate: string
  completedCount: number
  totalCount: number
  nextTask: StudentListItemWire | null
}

interface SafeTaskItemWire {
  id: string
  title: string
  type: 'reading' | 'vocabulary' | 'exercise'
  completionRule: object
}

interface FeedbackWire {
  id: string
  decision: 'approved' | 'returned'
  score: number | null
  textComment: string | null
  returnReason: string | null
  publishedAt: string
}

interface StudentTaskDetailWire {
  taskId: string
  title: string
  description: string | null
  startsAt: string
  dueAt: string
  items: SafeTaskItemWire[]
  assignment: {
    status: TaskAssignment['status']
    submittedAt: string | null
    redoCount: number
    redoDueAt: string | null
    version: number
  }
  submission: {
    id: string
    version: number
    status: Submission['status']
    answers: { itemId: string; value: unknown }[]
    submittedAt: string | null
    recordVersion: number
    assignmentVersion: number
  } | null
  feedback: FeedbackWire | null
}

interface TeacherTaskWire {
  taskId: string
  title: string
  status: Task['status']
  startsAt: string
  dueAt: string
  classIds: string[]
  completedCount: number
  totalCount: number
  pendingReviewCount: number
  version: number
}

interface CompletionWire {
  task: TeacherTaskWire
  assignments: PageWire<{
    assignmentId: string
    studentId: string
    classId: string
    status: TaskAssignment['status']
    latestSubmissionId: string | null
    latestSubmissionVersion: number
    submittedAt: string | null
    reviewedAt: string | null
  }>
}

interface ReviewSubmissionWire {
  taskId: string
  assignmentId: string
  assignmentVersion: number
  submissionId: string
  submissionVersion: number
  feedback: FeedbackWire | null
}

interface SubmissionReceiptWire {
  submissionId: string
  submissionVersion: number
  recordVersion: number
  assignmentVersion: number
  status: Submission['status']
  submittedAt: string | null
}

interface TaskDraftReceiptWire { taskId: string; status: Task['status']; version: number }

interface TaskDraftOptionsWire {
  classes: { id: string; name: string }[]
  resources: {
    id: string
    title: string
    type: 'reading' | 'vocabulary' | 'exercise'
    allowedClassIds: string[]
    completionRule: Record<string, unknown>
    scoringRule: Record<string, unknown>
  }[]
}

interface ReviewReceiptWire {
  feedbackId: string
  submissionId: string
  submissionVersion: number
  decision: 'approved' | 'returned'
  assignmentVersion: number
}

interface ParentTaskWire {
  taskId: string
  title: string
  studentId: string
  assignmentStatus: TaskAssignment['status']
  submission: { id: string; version: number; answers: { itemId: string; value: unknown }[]; submittedAt: string } | null
  feedback: FeedbackWire | null
}

interface ParentTaskListWire {
  taskId: string
  title: string
  status: TaskAssignment['status']
  startsAt: string
  dueAt: string
  submittedAt: string | null
  feedbackId: string | null
}

interface ParentHomeWire {
  childId: string
  child?: { id: string; displayName: string; displayNameMasked: string; classId: string | null; className: string | null }
  pendingTaskCount: number
  completedTaskCount: number
  recentTasks: ParentTaskListWire[]
  recentFeedback: { feedbackId: string; taskId: string; taskTitle: string; decision: 'approved' | 'returned'; score: number | null; publishedAt: string }[]
}

interface ParentChildWire {
  linkId: string
  linkVersion: number
  childId: string
  displayName: string
  displayNameMasked: string
  studentNumber: string | null
  classId: string | null
  className: string | null
  confirmedAt: string | null
}

interface BoundChildWire {
  id: string
  child: {
    id: string
    displayName: string
    displayNameMasked: string
    studentNumber?: string
    classIds?: string[]
  }
  confirmedAt: string
  version: number
}

interface FeedbackDetailWire {
  feedbackId: string
  childId: string
  taskId: string
  taskTitle: string
  submission: { id: string; version: number; answers: { itemId: string; value: unknown }[]; submittedAt: string }
  feedback: Omit<FeedbackWire, 'id'>
}

export function createCloudAppService(
  repository: CloudRepositoryClient,
  authentication: CloudAuthenticationPort,
  contextProvider: CloudClientContextProvider,
): CloudAppService {
  let currentUser: UserAccount | null = null

  const currentContextUser = (userId: string, role: Role): UserAccount =>
    currentUser?.id === userId ? currentUser : { id: userId, displayName: userId, role }

  const activeChildId = (): ServiceResult<string> => {
    const childId = contextProvider().activeChildId
    return childId
      ? { ok: true, data: childId }
      : failure('VALIDATION_ERROR', '请先选择孩子')
  }

  const getStudentDetail = async (taskId: string): Promise<ServiceResult<TaskDetailView>> => {
    const result = await repository.call<'getMyTask', { taskId: string }, StudentTaskDetailWire>(
      'student-task-query', 'getMyTask', { taskId },
    )
    return mapResult(result, mapStudentTaskDetail)
  }

  const getCompletionRows = async (taskId: string): Promise<ServiceResult<CloudReviewAssignmentView[]>> => {
    const result = await repository.call<'getCompletion', { taskId: string; filter: object; page: { limit: number } }, CompletionWire>(
      'task-query', 'getCompletion', { taskId, filter: {}, page: { limit: 100 } },
    )
    return mapResult(result, value => value.assignments.items.map(item => ({
      studentName: item.studentId,
      assignmentId: item.assignmentId,
      taskId,
      status: item.status,
      ...(item.latestSubmissionId === null ? {} : { submissionId: item.latestSubmissionId }),
      ...(item.latestSubmissionVersion < 1 ? {} : { submissionVersion: item.latestSubmissionVersion }),
    })))
  }

  return {
    async login(mobile, password) {
      if (!mobile || !password) return failure('VALIDATION_ERROR', '请输入手机号和密码')
      try {
        await authentication.signIn({ mobile, password })
      } catch (error: unknown) {
        return authenticationFailure(error)
      }
      const result = await repository.call<'bootstrap', Record<string, never>, AuthSessionWire>(
        'auth-session',
        'bootstrap',
        {},
        { businessSessionToken: null },
      )
      if (!result.ok) return result
      const role = result.data.activeRole ?? result.data.roles[0]
      if (role === undefined) return withMeta(failure('FORBIDDEN', '当前账号没有可用身份'), result)
      if (result.data.activeRole === null && result.data.roles.length > 1) {
        currentUser = { id: result.data.userId, displayName: result.data.displayName ?? result.data.userId, role }
        return { ok: true, data: { sessionId: result.data.sessionId, user: currentUser, availableRoles: [...result.data.roles], activeRole: null }, meta: result.meta }
      }
      const selected = result.data.activeRole === null
        ? await repository.call<'selectRole', { role: Role }, AuthSessionWire>('auth-session', 'selectRole', { role }, { businessSessionToken: result.data.sessionId })
        : result
      if (!selected.ok) return selected
      currentUser = { id: selected.data.userId, displayName: selected.data.displayName ?? selected.data.userId, role }
      return { ok: true, data: { sessionId: selected.data.sessionId, user: currentUser, availableRoles: [...selected.data.roles], activeRole: role }, meta: selected.meta }
    },

    async requestPasswordResetCode(mobile) {
      if (!/^1\d{10}$/.test(mobile)) return failure('VALIDATION_ERROR', '请输入正确的手机号')
      if (authentication.requestPasswordResetCode === undefined) return failure('SERVICE_UNAVAILABLE', '密码找回服务暂不可用，请稍后重试')
      try {
        await authentication.requestPasswordResetCode(`+86 ${mobile}`)
        return { ok: true, data: { expiresInMinutes: 10 } }
      } catch (error: unknown) {
        return passwordResetFailure(error)
      }
    },

    async resetPassword(mobile, code, newPassword) {
      if (!/^1\d{10}$/.test(mobile) || !/^\d{6}$/.test(code)) {
        return failure('VALIDATION_ERROR', '手机号或验证码格式不正确')
      }
      if (newPassword.length < 6 || newPassword.length > 32) {
        return failure('VALIDATION_ERROR', '新密码需为 6—32 位')
      }
      if (authentication.resetPassword === undefined) return failure('SERVICE_UNAVAILABLE', '密码找回服务暂不可用，请稍后重试')
      try {
        await authentication.resetPassword(`+86 ${mobile}`, code, newPassword)
        return { ok: true, data: null }
      } catch (error: unknown) {
        return passwordResetFailure(error)
      }
    },

    async listRoles(_userId) {
      const result = await repository.call<'getCurrentSession', Record<string, never>, AuthSessionWire>('auth-session', 'getCurrentSession', {})
      return mapResult(result, value => value.roles)
    },

    async selectRole(_userId, role) {
      const result = await repository.call<'selectRole', { role: Role }, AuthSessionWire>('auth-session', 'selectRole', { role })
      if (!result.ok) return result
      currentUser = { id: result.data.userId, displayName: result.data.displayName ?? result.data.userId, role }
      return { ok: true, data: { sessionId: result.data.sessionId, user: currentUser, availableRoles: [...result.data.roles], activeRole: role }, meta: result.meta }
    },

    async getUser(userId) {
      return currentUser?.id === userId ? { ok: true, data: currentUser } : failure('NOT_FOUND', '用户不存在')
    },

    async getHome(userId) {
      const localDate = contextProvider().localDate ?? new Date().toISOString().slice(0, 10)
      const result = await repository.call<'getHome', { localDate: string }, StudentHomeWire>('student-task-query', 'getHome', { localDate })
      if (!result.ok) return result
      if (result.data.nextTask === null) {
        return { ok: true, data: { user: currentContextUser(userId, 'student'), task: null, assignment: null, completedCount: result.data.completedCount, totalCount: result.data.totalCount }, meta: result.meta }
      }
      const detail = await getStudentDetail(result.data.nextTask.taskId)
      if (!detail.ok) return detail
      return { ok: true, data: { user: currentContextUser(userId, 'student'), ...detail.data, completedCount: result.data.completedCount, totalCount: result.data.totalCount }, meta: result.meta }
    },

    async getTaskDetail(_userId, taskId) { return getStudentDetail(taskId) },

    async listStudentTasks(_userId) {
      const listed = await repository.call<'listMyTasks', { filters: object; page: { limit: number } }, PageWire<StudentListItemWire>>(
        'student-task-query', 'listMyTasks', { filters: {}, page: { limit: 100 } },
      )
      if (!listed.ok) return listed
      const details = await Promise.all(listed.data.items.map(item => getStudentDetail(item.taskId)))
      const failureResult = details.find((item): item is Extract<ServiceResult<TaskDetailView>, { ok: false }> => !item.ok)
      if (failureResult) return failureResult
      return { ok: true, data: details.map(item => (item as Extract<typeof item, { ok: true }>).data), meta: listed.meta }
    },

    async saveDraft(userId, command) {
      return submit(repository, userId, command, 'saveDraft')
    },

    async submitTask(userId, command) {
      return submit(repository, userId, command, 'submit')
    },

    async getTeacherTasks(_userId) {
      const result = await repository.call<'listTeacherTasks', { filters: object; page: { limit: number } }, PageWire<TeacherTaskWire>>(
        'task-query', 'listTeacherTasks', { filters: {}, page: { limit: 100 } },
      )
      return mapResult(result, value => {
        const progressByTask: Record<string, number> = {}
        const pendingByTask: Record<string, number> = {}
        for (const item of value.items) {
          progressByTask[item.taskId] = item.totalCount === 0 ? 0 : Math.round(item.completedCount * 100 / item.totalCount)
          pendingByTask[item.taskId] = item.pendingReviewCount
        }
        return {
          tasks: value.items.map(mapTeacherTask),
          pendingCount: value.items.reduce((sum, item) => sum + item.pendingReviewCount, 0),
          progressByTask,
          pendingByTask,
        }
      })
    },

    async getDraftOptions(_userId, nowIso) {
      const result = await repository.call<'getDraftOptions', Record<string, never>, TaskDraftOptionsWire>(
        'task-query', 'getDraftOptions', {},
      )
      if (!result.ok) return result
      const mapped = mapDraftOptions(result.data, nowIso)
      return mapped.ok && result.meta !== undefined ? { ...mapped, meta: result.meta } : mapped
    },

    async getCompletion(_userId, taskId) { return getCompletionRows(taskId) },

    async listTeacherStudents(_userId, filters, cursor) {
      return repository.call<
        'listStudents',
        { filters: Readonly<{ classId?: string; keyword?: string; status: TeacherStudentStatusFilter }>; page: { limit: number; cursor?: string } },
        TeacherStudentPageWire
      >(
        'teacher-student-query',
        'listStudents',
        { filters, page: { limit: 20, ...(cursor === undefined ? {} : { cursor }) } },
      )
    },

    async getTeacherStudent(_userId, studentId) {
      return repository.call<'getStudent', { studentId: string }, TeacherStudentDetailWire>(
        'teacher-student-query',
        'getStudent',
        { studentId },
      )
    },

    async publishClassroomTask(userId, command) {
      const mappedDraft = mapStructuredTaskDraft(command.structuredDraft)
      if (!mappedDraft.ok) return mappedDraft
      const draft = await repository.call<'saveDraft', object, TaskDraftReceiptWire>('task-command', 'saveDraft', {
        title: command.title.trim(),
        description: command.description.trim(),
        ...mappedDraft.data,
      }, { operationId: command.operationId })
      if (!draft.ok) return draft
      const published = await repository.call<'publishTask', { taskId: string }, TaskDraftReceiptWire>(
        'task-command', 'publishTask', { taskId: draft.data.taskId },
        { operationId: command.operationId, expectedVersion: draft.data.version },
      )
      if (!published.ok) return published
      return {
        ok: true,
        data: {
          id: published.data.taskId,
          title: command.title.trim(),
          deliveryType: 'classroom',
          status: published.data.status,
          creatorTeacherId: userId,
          classId: command.structuredDraft?.target.type === 'classes' ? command.structuredDraft.target.classIds[0] ?? '' : '',
          startsAt: command.structuredDraft?.startsAt ?? '',
          dueAt: command.structuredDraft?.dueAt ?? '',
          description: command.description.trim(),
          items: command.structuredDraft?.items.map(item => ({
            id: item.id,
            type: item.type,
            title: taskItemTitle(item.type),
            completionRule: completionRuleLabel(item.type, item.requiredCount),
          })) ?? [],
          version: published.data.version,
        },
        meta: published.meta,
      }
    },

    async reviewSubmission(userId, command) {
      const completion = await getCompletionRows(command.taskId)
      if (!completion.ok) return completion
      const row = command.assignmentId
        ? completion.data.find(item => item.assignmentId === command.assignmentId)
        : completion.data.find(item => item.status === 'awaiting_review' && item.submissionId !== undefined)
      if (!row?.submissionId || row.submissionVersion === undefined) return withMeta(failure('FORBIDDEN', '当前提交不可点评'), completion)
      const target = await repository.call<'getSubmissionForReview', { submissionId: string }, ReviewSubmissionWire>(
        'review-query', 'getSubmissionForReview', { submissionId: row.submissionId },
      )
      if (!target.ok) return target
      const result = await repository.call<'publishReview', object, ReviewReceiptWire>('review-command', 'publishReview', {
        submissionId: row.submissionId,
        decision: command.decision,
        expectedSubmissionVersion: command.expectedVersion,
        score: command.score,
        textComment: command.comment.trim(),
        ...(command.decision === 'returned' ? { returnReason: command.comment.trim() } : {}),
      }, { operationId: command.operationId, expectedVersion: target.data.assignmentVersion })
      if (!result.ok) return result
      const refreshed = await repository.call<'getSubmissionForReview', { submissionId: string }, ReviewSubmissionWire>(
        'review-query', 'getSubmissionForReview', { submissionId: row.submissionId },
      )
      if (refreshed.ok && refreshed.data.feedback !== null) {
        return { ok: true, data: mapFeedback(refreshed.data.feedback, row.assignmentId, row.submissionId), meta: result.meta }
      }
      return {
        ok: true,
        data: {
        id: result.data.feedbackId,
        assignmentId: row.assignmentId,
        submissionId: result.data.submissionId,
        teacherId: userId,
        decision: result.data.decision,
        score: command.score,
        textComment: command.comment.trim(),
        ...(command.decision === 'returned' ? { returnReason: command.comment.trim() } : {}),
        publishedAt: new Date().toISOString(),
        },
        meta: result.meta,
      }
    },

    async listParentChildren(_userId) {
      const result = await repository.call<'listChildren', Record<string, never>, ParentChildWire[]>(
        'parent-query', 'listChildren', {},
      )
      return mapResult(result, items => items.map(item => ({
        linkId: item.linkId,
        linkVersion: item.linkVersion,
        childId: item.childId,
        displayName: item.displayName,
        displayNameMasked: item.displayNameMasked,
        ...(item.studentNumber === null ? {} : { studentNumber: item.studentNumber }),
        ...(item.classId === null ? {} : { classId: item.classId }),
        ...(item.className === null ? {} : { className: item.className }),
        confirmedAt: item.confirmedAt ?? '',
      })))
    },

    async bindChild(_userId, command) {
      const result = await repository.call<'bindChild', { studentNumber: string; code: string }, BoundChildWire>(
        'relationship-command', 'bindChild',
        { studentNumber: command.studentNumber.trim(), code: command.code.trim() },
        { operationId: command.operationId },
      )
      return mapResult(result, value => ({
        linkId: value.id,
        linkVersion: value.version,
        childId: value.child.id,
        displayName: value.child.displayName,
        displayNameMasked: value.child.displayNameMasked,
        ...(value.child.studentNumber === undefined ? {} : { studentNumber: value.child.studentNumber }),
        ...(value.child.classIds?.[0] === undefined ? {} : { classId: value.child.classIds[0] }),
        confirmedAt: value.confirmedAt,
      }))
    },

    async unbindChild(_userId, command) {
      return repository.call<'unbindChild', { childId: string; reason: string }, null>(
        'relationship-command', 'unbindChild',
        { childId: command.childId, reason: command.reason.trim() },
        { operationId: command.operationId, expectedVersion: command.expectedVersion },
      )
    },

    async getParentHome(userId) {
      const child = activeChildId()
      if (!child.ok) return child
      const result = await repository.call<'getHome', { childId: string }, ParentHomeWire>('parent-query', 'getHome', { childId: child.data })
      if (!result.ok) return result
      const details = await Promise.all(result.data.recentTasks.map(async item => {
        const detail = await repository.call<'getChildTask', { childId: string; taskId: string }, ParentTaskWire>(
          'parent-query', 'getChildTask', { childId: result.data.childId, taskId: item.taskId },
        )
        return detail.ok ? mapParentTask(detail.data, item) : mapParentSummary(item, result.data.childId)
      }))
      return {
        ok: true,
        data: {
          user: currentContextUser(userId, 'parent'),
          child: {
            id: result.data.childId,
            displayName: result.data.child?.displayName ?? result.data.childId,
            role: 'student',
            ...(result.data.child?.classId === null || result.data.child?.classId === undefined ? {} : { classId: result.data.child.classId }),
            ...(result.data.child?.className === null || result.data.child?.className === undefined ? {} : { className: result.data.child.className }),
          },
          tasks: details,
        },
        meta: result.meta,
      }
    },

    async getParentTask(_userId, taskId) {
      const child = activeChildId()
      if (!child.ok) return child
      const result = await repository.call<'getChildTask', { childId: string; taskId: string }, ParentTaskWire>(
        'parent-query', 'getChildTask', { childId: child.data, taskId },
      )
      return mapResult(result, value => mapParentTask(value))
    },

    async getParentFeedback(_userId, taskId) {
      const child = activeChildId()
      if (!child.ok) return child
      const task = await repository.call<'getChildTask', { childId: string; taskId: string }, ParentTaskWire>(
        'parent-query', 'getChildTask', { childId: child.data, taskId },
      )
      if (!task.ok) return task
      if (task.data.feedback === null) return withMeta(failure('NOT_FOUND', '老师暂未发布反馈'), task)
      const result = await repository.call<'getFeedback', { childId: string; feedbackId: string }, FeedbackDetailWire>(
        'parent-query', 'getFeedback', { childId: child.data, feedbackId: task.data.feedback.id },
      )
      return mapResult(result, value => mapFeedback(
        { id: value.feedbackId, ...value.feedback },
        `asn_${value.taskId}_${value.childId}`,
        value.submission.id,
      ))
    },

    async listReadingResources(_userId) {
      return repository.call<'listReadingResources', Record<string, never>, ReadingListItem[]>(
        'content-query', 'listReadingResources', {},
      )
    },

    async getReadingResource(_userId, resourceId) {
      return repository.call<'getReadingResource', { resourceId: string }, ReadingResource>(
        'content-query', 'getReadingResource', { resourceId },
      )
    },

    async listVocabularyPacks(_userId) {
      return repository.call<'listVocabularyPacks', Record<string, never>, VocabularyPack[]>(
        'content-query', 'listVocabularyPacks', {},
      )
    },

    async getVocabularyPack(_userId, resourceId) {
      return repository.call<'getVocabularyPack', { resourceId: string }, VocabularyPack>(
        'content-query', 'getVocabularyPack', { resourceId },
      )
    },

    async getReadingProgress(_userId, resourceId) {
      return repository.call<'getReadingProgress', { resourceId: string }, ReadingProgress | null>(
        'learning-progress-query', 'getReadingProgress', { resourceId },
      )
    },

    async saveReadingProgress(_userId, command) {
      return repository.call<'saveReadingProgress', object, ReadingProgress>(
        'learning-progress-command', 'saveReadingProgress', {
          resourceId: command.resourceId,
          chapterId: command.chapterId,
          pageId: command.pageId,
          pageNumber: command.pageNumber,
          favorite: command.favorite,
        }, {
          operationId: command.operationId,
          ...(command.expectedVersion === 0 ? {} : { expectedVersion: command.expectedVersion }),
        },
      )
    },

    async getVocabularyProgress(_userId, packId) {
      return repository.call<'getVocabularyProgress', { packId: string }, VocabularyProgress | null>(
        'learning-progress-query', 'getVocabularyProgress', { packId },
      )
    },

    async saveVocabularyProgress(_userId, command) {
      return repository.call<'saveVocabularyProgress', object, VocabularyProgress>(
        'learning-progress-command', 'saveVocabularyProgress', {
          packId: command.packId,
          completedCount: command.completedCount,
          correctCount: command.correctCount,
          wrongWordIds: command.wrongWordIds,
        }, {
          operationId: command.operationId,
          ...(command.expectedVersion === 0 ? {} : { expectedVersion: command.expectedVersion }),
        },
      )
    },

    async logout(_userId) {
      const result = await repository.call<'logout', Record<string, never>, null>(
        'auth-session', 'logout', {}, { operationId: `logout_${Date.now()}` },
      )
      if (result.ok) currentUser = null
      return result
    },
  }
}

async function submit(
  repository: CloudRepositoryClient,
  userId: string,
  command: CloudSubmissionCommand,
  action: 'saveDraft' | 'submit',
): Promise<ServiceResult<Submission>> {
  if (!isPositiveInteger(command.assignmentVersion)) {
    return validationFailure('assignmentVersion', '请刷新任务后再操作')
  }
  if (!isStructuredAnswers(command.structuredAnswers)) {
    return validationFailure('structuredAnswers', '请完成结构化任务内容后再保存或提交')
  }
  const result = await repository.call<typeof action, object, SubmissionReceiptWire>('submission-command', action, {
    taskId: command.taskId,
    answers: command.structuredAnswers,
    ...(command.draftVersion === undefined ? {} : { draftVersion: command.draftVersion }),
  }, { operationId: command.operationId, expectedVersion: command.assignmentVersion })
  return mapResult(result, value => ({
    id: value.submissionId,
    assignmentId: `asn_${command.taskId}_${userId}`,
    studentId: userId,
    version: value.submissionVersion,
    status: value.status,
    answers: command.structuredAnswers?.map(answer => ({ taskItemId: answer.itemId, value: stringValue(answer.value) })) ?? [],
    ...(value.submittedAt === null ? {} : { submittedAt: value.submittedAt }),
    recordVersion: value.recordVersion,
    assignmentVersion: value.assignmentVersion,
  }))
}

function mapStudentTaskDetail(value: StudentTaskDetailWire): TaskDetailView {
  const task: Task = {
    id: value.taskId,
    title: value.title,
    deliveryType: 'classroom',
    status: 'active',
    creatorTeacherId: '',
    classId: '',
    startsAt: value.startsAt,
    dueAt: value.dueAt,
    description: value.description ?? '',
    items: value.items.map(item => {
      const rule = taskCompletionRule(item.type, item.completionRule)
      return {
        id: item.id,
        title: item.title,
        type: item.type,
        completionRule: rule === undefined ? '完成规则暂不可用' : completionRuleLabel(item.type, completionRequiredCount(item.type, item.completionRule as Record<string, unknown>) ?? 0),
        ...(rule === undefined ? {} : { completionRuleData: rule }),
      }
    }),
    version: 1,
  }
  const assignment: TaskAssignment = {
    id: `asn_${value.taskId}`,
    taskId: value.taskId,
    studentId: '',
    classId: '',
    status: value.assignment.status,
    progressPercent: value.assignment.status === 'completed' || value.assignment.status === 'awaiting_review' ? 100 : 0,
    redoCount: value.assignment.redoCount,
    version: value.assignment.version,
    ...(value.assignment.redoDueAt === null ? {} : { redoDueAt: value.assignment.redoDueAt }),
    ...(value.assignment.submittedAt === null ? {} : { submittedAt: value.assignment.submittedAt }),
    ...(value.submission === null || value.submission.status === 'draft' ? {} : { latestSubmissionId: value.submission.id }),
  }
  const submission = value.submission === null ? undefined : {
    id: value.submission.id,
    assignmentId: assignment.id,
    studentId: assignment.studentId,
    version: value.submission.version,
    status: value.submission.status,
    answers: value.submission.answers.map(answer => {
      const structuredValue = taskCompletionValue(answer.value)
      return {
        taskItemId: answer.itemId,
        value: stringValue(answer.value),
        ...(structuredValue === undefined ? {} : { structuredValue }),
      }
    }),
    ...(value.submission.submittedAt === null ? {} : { submittedAt: value.submission.submittedAt }),
    recordVersion: value.submission.recordVersion,
    assignmentVersion: value.submission.assignmentVersion,
  }
  const feedback = value.feedback === null || submission === undefined ? undefined : mapFeedback(value.feedback, assignment.id, submission.id)
  return { task, assignment, ...(submission === undefined ? {} : { submission }), ...(feedback === undefined ? {} : { feedback }) }
}

function mapTeacherTask(value: TeacherTaskWire): Task {
  return {
    id: value.taskId,
    title: value.title,
    deliveryType: 'classroom',
    status: value.status,
    creatorTeacherId: '',
    classId: value.classIds[0] ?? '',
    startsAt: value.startsAt,
    dueAt: value.dueAt,
    description: '',
    items: [],
    version: value.version,
  }
}

function mapParentTask(value: ParentTaskWire, summary?: ParentTaskListWire): TaskDetailView {
  const assignmentId = `asn_${value.taskId}_${value.studentId}`
  const task: Task = {
    id: value.taskId,
    title: value.title,
    deliveryType: 'classroom',
    status: 'active',
    creatorTeacherId: '',
    classId: '',
    startsAt: summary?.startsAt ?? value.submission?.submittedAt ?? new Date(0).toISOString(),
    dueAt: summary?.dueAt ?? value.submission?.submittedAt ?? new Date(0).toISOString(),
    description: '',
    items: [],
    version: 1,
  }
  const assignment: TaskAssignment = {
    id: assignmentId,
    taskId: value.taskId,
    studentId: value.studentId,
    classId: '',
    status: value.assignmentStatus,
    progressPercent: value.submission === null ? 0 : 100,
    redoCount: value.assignmentStatus === 'redo_required' ? 1 : 0,
    ...(value.submission === null ? {} : { latestSubmissionId: value.submission.id, submittedAt: value.submission.submittedAt }),
  }
  const submission: Submission | undefined = value.submission === null ? undefined : {
    id: value.submission.id,
    assignmentId,
    studentId: value.studentId,
    version: value.submission.version,
    status: value.feedback === null ? 'submitted' : value.feedback.decision === 'approved' ? 'reviewed' : 'returned',
    answers: value.submission.answers.map(answer => ({ taskItemId: answer.itemId, value: stringValue(answer.value) })),
    submittedAt: value.submission.submittedAt,
  }
  const feedback = value.feedback === null || submission === undefined ? undefined : mapFeedback(value.feedback, assignmentId, submission.id)
  return { task, assignment, ...(submission === undefined ? {} : { submission }), ...(feedback === undefined ? {} : { feedback }) }
}

function mapParentSummary(value: ParentTaskListWire, childId: string): TaskDetailView {
  return {
    task: {
      id: value.taskId,
      title: value.title,
      deliveryType: 'classroom',
      status: 'active',
      creatorTeacherId: '',
      classId: '',
      startsAt: value.startsAt,
      dueAt: value.dueAt,
      description: '',
      items: [],
      version: 1,
    },
    assignment: {
      id: `asn_${value.taskId}_${childId}`,
      taskId: value.taskId,
      studentId: childId,
      classId: '',
      status: value.status,
      progressPercent: value.status === 'completed' || value.status === 'awaiting_review' ? 100 : 0,
      redoCount: value.status === 'redo_required' ? 1 : 0,
      ...(value.submittedAt === null ? {} : { submittedAt: value.submittedAt }),
    },
  }
}

function mapFeedback(value: FeedbackWire, assignmentId: string, submissionId: string): ReviewFeedback {
  return {
    id: value.id,
    assignmentId,
    submissionId,
    teacherId: '',
    decision: value.decision,
    ...(value.score === null ? {} : { score: value.score }),
    ...(value.textComment === null ? {} : { textComment: value.textComment }),
    ...(value.returnReason === null ? {} : { returnReason: value.returnReason }),
    publishedAt: value.publishedAt,
  }
}

function mapStructuredTaskDraft(value: StructuredTaskDraft | undefined): ServiceResult<object> {
  if (value === undefined) return validationFailure('structuredDraft', '请补全任务内容、完成阈值和评分规则')
  if (value.items.length === 0) return validationFailure('structuredDraft.items', '任务内容至少包含一项')
  if (!isOffsetIso(value.startsAt) || !isOffsetIso(value.dueAt) || Date.parse(value.startsAt) >= Date.parse(value.dueAt)) {
    return validationFailure('structuredDraft.dueAt', '请提供有效的任务开始和截止时间')
  }
  if (!Number.isInteger(value.latePolicy.lateDays) || value.latePolicy.lateDays < 1 || value.latePolicy.lateDays > 30) {
    return validationFailure('structuredDraft.latePolicy.lateDays', '补交天数必须为 1 到 30 天')
  }
  if (value.target.type === 'classes' && value.target.classIds.length === 0) {
    return validationFailure('structuredDraft.target.classIds', '请至少选择一个班级')
  }
  if (value.target.type === 'students' && value.target.studentIds.length === 0) {
    return validationFailure('structuredDraft.target.studentIds', '请至少选择一个学员')
  }
  for (const [index, item] of value.items.entries()) {
    if (!item.id.trim() || !item.resourceId.trim()) return validationFailure(`structuredDraft.items[${index}]`, '任务内容标识不能为空')
    if (!isPositiveInteger(item.requiredCount)) return validationFailure(`structuredDraft.items[${index}].requiredCount`, '完成阈值必须为正整数')
    if (!isPositiveInteger(item.maxScore)) return validationFailure(`structuredDraft.items[${index}].maxScore`, '满分必须为正整数')
  }
  return {
    ok: true,
    data: {
      itemRefs: value.items.map((item, index) => ({
        id: item.id,
        resourceId: item.resourceId,
        completionRule: completionRule(item.type, item.requiredCount),
        scoringRule: { kind: 'manual', maxScore: item.maxScore },
        order: index + 1,
      })),
      target: value.target,
      startsAt: value.startsAt,
      dueAt: value.dueAt,
      latePolicy: value.latePolicy,
      ...(value.teacherNote === undefined ? {} : { teacherNote: value.teacherNote }),
    },
  }
}

function mapDraftOptions(value: TaskDraftOptionsWire, nowIso: string): ServiceResult<TaskDraftOptionsView> {
  const selectedClass = value.classes.find(candidate => (
    ['reading', 'vocabulary', 'exercise'] as const
  ).every(type => value.resources.some(resource => resource.type === type && resource.allowedClassIds.includes(candidate.id))))
  if (selectedClass === undefined) return validationFailure('resources', '当前班级缺少阅读、单词或习题资源')
  const selectedResources: TaskDraftOptionsView['resources'] = []
  const items: StructuredTaskDraft['items'] = []
  for (const type of ['reading', 'vocabulary', 'exercise'] as const) {
    const resource = value.resources.find(candidate => candidate.type === type && candidate.allowedClassIds.includes(selectedClass.id))
    if (resource === undefined) return validationFailure('resources', '当前班级任务资源不完整')
    const requiredCount = completionRequiredCount(type, resource.completionRule)
    const maxScore = resource.scoringRule.kind === 'manual' && isPositiveIntegerValue(resource.scoringRule.maxScore)
      ? resource.scoringRule.maxScore
      : null
    if (requiredCount === null || maxScore === null) return validationFailure('resources', '任务资源缺少有效完成阈值或评分规则')
    selectedResources.push({ id: resource.id, title: resource.title, type, requiredCount })
    items.push({ id: `item_${type}`, resourceId: resource.id, type, requiredCount, maxScore })
  }
  if (!isOffsetIso(nowIso)) return validationFailure('startsAt', '当前时间无效')
  const startsAt = new Date(nowIso)
  const dueAt = new Date(startsAt)
  dueAt.setHours(20, 0, 0, 0)
  if (dueAt <= startsAt) dueAt.setDate(dueAt.getDate() + 1)
  return {
    ok: true,
    data: {
      selectedClassName: selectedClass.name,
      resources: selectedResources,
      structuredDraft: {
        items,
        target: { type: 'classes', classIds: [selectedClass.id] },
        startsAt: startsAt.toISOString(),
        dueAt: dueAt.toISOString(),
        latePolicy: { allowLate: true, lateDays: 7 },
      },
    },
  }
}

function completionRequiredCount(type: StructuredTaskDraft['items'][number]['type'], rule: Record<string, unknown>): number | null {
  if (type === 'reading' && rule.kind === 'reading_pages' && isPositiveIntegerValue(rule.requiredPageCount)) return rule.requiredPageCount
  if (type === 'vocabulary' && rule.kind === 'vocabulary_words' && isPositiveIntegerValue(rule.requiredWordCount)) return rule.requiredWordCount
  if (type === 'exercise' && rule.kind === 'exercise_questions' && isPositiveIntegerValue(rule.requiredQuestionCount)) return rule.requiredQuestionCount
  return null
}

function taskCompletionRule(type: StructuredTaskDraft['items'][number]['type'], rule: object): TaskCompletionRule | undefined {
  const record = rule as Record<string, unknown>
  const requiredCount = completionRequiredCount(type, record)
  if (requiredCount === null) return undefined
  if (type === 'reading') return { kind: 'reading_pages', requiredPageCount: requiredCount }
  if (type === 'vocabulary') return { kind: 'vocabulary_words', requiredWordCount: requiredCount }
  return { kind: 'exercise_questions', requiredQuestionCount: requiredCount }
}

function taskCompletionValue(value: unknown): TaskCompletionValue | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.kind === 'reading' && isNonNegativeIntegerValue(record.completedPageCount)) {
    return { kind: 'reading', completedPageCount: record.completedPageCount }
  }
  if (record.kind === 'vocabulary'
    && isNonNegativeIntegerValue(record.completedWordCount)
    && isNonNegativeIntegerValue(record.correctWordCount)
    && record.correctWordCount <= record.completedWordCount) {
    return { kind: 'vocabulary', completedWordCount: record.completedWordCount, correctWordCount: record.correctWordCount }
  }
  if (record.kind === 'exercise' && isNonNegativeIntegerValue(record.answeredQuestionCount)) {
    return {
      kind: 'exercise',
      answeredQuestionCount: record.answeredQuestionCount,
      ...(isNonNegativeIntegerValue(record.correctQuestionCount) ? { correctQuestionCount: record.correctQuestionCount } : {}),
    }
  }
  return undefined
}

function isPositiveIntegerValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeIntegerValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function completionRule(type: StructuredTaskDraft['items'][number]['type'], requiredCount: number): object {
  if (type === 'reading') return { kind: 'reading_pages', requiredPageCount: requiredCount }
  if (type === 'vocabulary') return { kind: 'vocabulary_words', requiredWordCount: requiredCount }
  return { kind: 'exercise_questions', requiredQuestionCount: requiredCount }
}

function taskItemTitle(type: StructuredTaskDraft['items'][number]['type']): string {
  if (type === 'reading') return '阅读练习'
  if (type === 'vocabulary') return '单词练习'
  return '习题练习'
}

function completionRuleLabel(type: StructuredTaskDraft['items'][number]['type'], requiredCount: number): string {
  if (type === 'reading') return `完成 ${requiredCount} 页阅读`
  if (type === 'vocabulary') return `完成 ${requiredCount} 个单词`
  return `完成 ${requiredCount} 道习题`
}

function isStructuredAnswers(value: StructuredSubmissionAnswer[] | undefined): value is StructuredSubmissionAnswer[] {
  if (value === undefined || value.length === 0) return false
  return value.every(answer => {
    if (!answer.itemId.trim()) return false
    if (answer.value.kind === 'reading') return isNonNegativeInteger(answer.value.completedPageCount)
    if (answer.value.kind === 'vocabulary') {
      return isNonNegativeInteger(answer.value.completedWordCount)
        && isNonNegativeInteger(answer.value.correctWordCount)
        && answer.value.correctWordCount <= answer.value.completedWordCount
    }
    return isNonNegativeInteger(answer.value.answeredQuestionCount)
      && (answer.value.correctQuestionCount === undefined || (
        isNonNegativeInteger(answer.value.correctQuestionCount)
        && answer.value.correctQuestionCount <= answer.value.answeredQuestionCount
      ))
  })
}

function isPositiveInteger(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

function isOffsetIso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function failure<T>(code: import('../domain/types').ServiceError['code'], message: string): ServiceResult<T> {
  return { ok: false, error: { code, message, retryable: code === 'INTERNAL_ERROR' } }
}

function validationFailure<T>(field: string, message: string): ServiceResult<T> {
  return { ok: false, error: { code: 'VALIDATION_ERROR', message, retryable: false, fieldErrors: { [field]: message } } }
}

function authenticationFailure(error: unknown): ServiceResult<Session> {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code.toUpperCase()
    : ''
  if (code.includes('NETWORK') || code.includes('TIMEOUT')) {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: '网络连接失败，请检查网络后重试', retryable: true } }
  }
  return { ok: false, error: { code: 'UNAUTHENTICATED', message: '手机号或密码不正确', retryable: false } }
}

function passwordResetFailure<T>(error: unknown): ServiceResult<T> {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code).toUpperCase()
    : ''
  if (code.includes('NETWORK') || code.includes('TIMEOUT')) {
    return { ok: false, error: { code: 'NETWORK_ERROR', message: '网络连接失败，请检查网络后重试', retryable: true } }
  }
  if (code.includes('EXPIRED') || code.includes('INVALID_VERIFICATION') || code.includes('VERIFICATION')) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: '验证码无效或已过期', retryable: false } }
  }
  return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '密码找回服务暂不可用，请稍后重试', retryable: true } }
}

function mapResult<TInput, TOutput>(result: ServiceResult<TInput>, mapper: (value: TInput) => TOutput): ServiceResult<TOutput> {
  return result.ok ? { ok: true, data: mapper(result.data), ...(result.meta === undefined ? {} : { meta: result.meta }) } : result
}

function withMeta<T, TMeta>(result: ServiceResult<T>, source: ServiceResult<TMeta>): ServiceResult<T> {
  return source.meta === undefined ? result : { ...result, meta: source.meta }
}
