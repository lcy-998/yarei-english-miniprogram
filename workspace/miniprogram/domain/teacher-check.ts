import type { TaskStatus } from './types'

export interface TeacherCheckFilters {
  type?: 'classroom' | 'checkin'
  classId?: string
  status?: TaskStatus
  startsOn?: string
  endsOn?: string
  keyword?: string
}

export interface TeacherCheckItem {
  id: string
  kind: 'classroom' | 'checkin'
  title: string
  status: TaskStatus
  startsOn: string
  dueOn: string
  classIds: string[]
  completedCount: number | null
  totalCount: number
  pendingReviewCount: number
  restDayCount: number
  version: number
  canDeleteDraft: boolean
}

export interface TeacherCheckPage {
  classes: Array<{ id: string; name: string }>
  items: TeacherCheckItem[]
  total: number
  nextOffset: number | null
}
