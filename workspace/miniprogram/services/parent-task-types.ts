import type { TaskAssignment, TaskDetailView, UserAccount } from '../domain/types'

export type ParentTaskStatusGroup = 'active' | 'awaiting_review' | 'completed'

export interface ParentTaskListFilters {
  statusGroup?: ParentTaskStatusGroup
  startsOn: string
  endsOn: string
}

export interface ParentTaskListView {
  taskId: string
  title: string
  contentTypes: string[]
  status: TaskAssignment['status']
  startsAt: string
  dueAt: string
  submittedAt: string | null
  isLate: boolean
  feedbackId: string | null
  score: number | null
}

export interface ParentTaskListPage {
  items: ParentTaskListView[]
  total: number
  nextCursor: string | null
}

export interface ParentRecentFeedbackView {
  feedbackId: string
  taskId: string
  taskTitle: string
  teacherName: string | null
  textComment: string | null
  publishedAt: string
}

export interface ParentHomeView {
  user: UserAccount
  child: UserAccount
  /** Only the five most recent task previews. Use listParentTasks for the complete list. */
  tasks: TaskDetailView[]
  pendingTaskCount: number | null
  weeklyAssignedCount: number | null
  weeklyCompletedCount: number | null
  overdueTaskCount: number | null
  recentFeedback: ParentRecentFeedbackView[]
}
