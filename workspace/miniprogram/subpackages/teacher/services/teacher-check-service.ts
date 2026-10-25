import type { ServiceResult, TaskStatus } from '../../../domain/types'
import type { TeacherCheckFilters, TeacherCheckItem, TeacherCheckPage } from '../../../domain/teacher-check'
import { schoolDate } from '../domain/student-activity-feed'
import { getCloudAppService } from '../../../repositories/repository-factory'
import { getState } from '../../../repositories/memory/mock-state'
import { getTeacherTasks, listTeacherActivities } from './app-service'

export async function listTeacherCheckItems(userId: string, filters: TeacherCheckFilters,
  limit = 20, offset = 0): Promise<ServiceResult<TeacherCheckPage>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.listTeacherCheckItems(userId, filters, limit, offset)
  const [result, activities] = await Promise.all([getTeacherTasks(userId), listTeacherActivities(userId)])
  if (!result.ok) return result
  if (!activities.ok && activities.error.code !== 'SERVICE_UNAVAILABLE') return activities
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: '分页参数无效', retryable: false } }
  }
  const state = getState()
  const now = Date.now()
  const taskItems: TeacherCheckItem[] = result.data.tasks.map(task => {
    const assignments = state.assignments.filter(item => item.taskId === task.id
      && (!filters.classId || item.classId === filters.classId))
    return { id: task.id, kind: 'classroom', title: task.title,
      status: displayStatus(task.status, task.startsAt, task.dueAt, now),
      startsOn: task.startsAt.slice(0, 10), dueOn: task.dueAt.slice(0, 10),
      classIds: task.classIds ?? [task.classId],
      completedCount: task.status === 'draft' ? null : assignments.filter(item =>
        item.status === 'awaiting_review' || item.status === 'completed').length,
      totalCount: assignments.length, pendingReviewCount: result.data.pendingByTask[task.id] ?? 0,
      restDayCount: 0, version: task.version, canDeleteDraft: task.status === 'draft'
        && !state.assignments.some(item => item.taskId === task.id)
        && !state.submissions.some(item => state.assignments.some(assignment =>
          assignment.id === item.assignmentId && assignment.taskId === task.id)) }
  })
  const activityItems: TeacherCheckItem[] = (activities.ok ? activities.data : [])
    .filter(activity => activity.visibility !== 'recycled')
    .map(activity => ({ id: activity.id, kind: 'checkin', title: activity.title,
      status: activity.status === 'draft' ? 'draft' : activity.status === 'closed' ? 'closed'
        : schoolDate(activity.schedule.schoolTimeZone, new Date(now)) < activity.schedule.startsOn ? 'scheduled'
          : schoolDate(activity.schedule.schoolTimeZone, new Date(now)) > activity.schedule.endsOn ? 'expired' : 'active',
      startsOn: activity.schedule.startsOn, dueOn: activity.schedule.endsOn,
      classIds: [activity.schedule.classId], completedCount: null,
      totalCount: activity.participants.length, pendingReviewCount: 0,
      restDayCount: activity.schedule.restDates.length, version: activity.version,
      canDeleteDraft: activity.status === 'draft' && activity.participants.length === 0 }))
  const items = [...taskItems, ...activityItems]
  const keyword = filters.keyword?.trim().toLocaleLowerCase()
  const filtered = items.filter(item => !filters.type || item.kind === filters.type)
    .filter(item => !filters.classId || item.classIds.includes(filters.classId))
    .filter(item => !filters.status || item.status === filters.status)
    .filter(item => !filters.startsOn || item.dueOn >= filters.startsOn)
    .filter(item => !filters.endsOn || item.dueOn <= filters.endsOn)
    .filter(item => !keyword || item.title.toLocaleLowerCase().includes(keyword))
    .sort((left, right) => right.dueOn.localeCompare(left.dueOn) || left.id.localeCompare(right.id))
  return { ok: true, data: { classes: [...new Set(items.flatMap(item => item.classIds))]
    .map(id => ({ id, name: id })), items: filtered.slice(offset, offset + limit), total: filtered.length,
    nextOffset: offset + limit < filtered.length ? offset + limit : null } }
}

function displayStatus(status: TaskStatus, startsAt: string, dueAt: string, now: number): TaskStatus {
  if (status === 'draft' || status === 'withdrawn' || status === 'closed' || status === 'completed') return status
  const starts = Date.parse(startsAt)
  const due = Date.parse(dueAt)
  if (!Number.isFinite(starts) || !Number.isFinite(due)) return status
  return now < starts ? 'scheduled' : now > due ? 'expired' : 'active'
}
