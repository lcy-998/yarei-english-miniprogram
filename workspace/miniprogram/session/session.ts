import { Role, Session, TaskTemplateView } from '../domain/types'

const SESSION_KEY = 'yarei_session'
let currentTaskId = ''
let currentBookId = ''
let currentStudentId = 'usr_student_xiaoyu'
let currentChildId = ''
let currentAssignmentId = ''
let readingFavoritesOnly = false
export interface TeacherTaskCopy {
  title: string
  description: string
  itemRefs: Array<{ id: string; resourceId: string; completionRule?: Record<string, unknown>;
    scoringRule?: Record<string, unknown>; order: number }>
  items: Array<{ resourceId: string; title: string; type: 'reading' | 'vocabulary' | 'exercise' | 'recording' }>
}
let teacherTaskCopy: TeacherTaskCopy | null = null
let teacherTemplateSeed: TaskTemplateView | null = null
let teacherTaskTargetStudentId = ''
let teacherStatsTargetStudentId = ''
let teacherSelectedResourceIds: string[] = []
let teacherCatalogInitialIds: string[] | null = null
let teacherCatalogResultIds: string[] | null = null
let teacherTextbookSelectedIds: string[] | null = null
let teacherReadingSelection: { resourceId: string; pageIds?: string[]; targetClassId?: string } | null = null
export interface TeacherReviewScoreDraft { submissionId: string; itemId: string; input: string }
let teacherReviewScoreDraft: TeacherReviewScoreDraft | null = null

export function saveSession(session: Session): void {
  wx.setStorageSync(SESSION_KEY, session)
}

export function getSession(): Session | null {
  return wx.getStorageSync(SESSION_KEY) as Session | null
}

export function clearSession(): void {
  wx.removeStorageSync(SESSION_KEY)
  teacherTaskCopy = null
  teacherTaskTargetStudentId = ''
  teacherStatsTargetStudentId = ''
  teacherTemplateSeed = null
  teacherSelectedResourceIds = []
  teacherCatalogInitialIds = null
  teacherCatalogResultIds = null
  teacherTextbookSelectedIds = null
  teacherReadingSelection = null
  teacherReviewScoreDraft = null
}

export function homePath(role: Role): string {
  if (role === 'teacher') return '/pages/teacher/workbench/workbench'
  if (role === 'parent') return '/pages/parent/home/home'
  return '/pages/index/index'
}

export function setCurrentTaskId(taskId: string): void { currentTaskId = taskId }
export function getCurrentTaskId(): string { return currentTaskId }
export function setCurrentBookId(bookId: string): void { currentBookId = bookId }
export function getCurrentBookId(): string { return currentBookId }
export function setCurrentStudentId(studentId: string): void { currentStudentId = studentId }
export function getCurrentStudentId(): string { return currentStudentId }
export function setCurrentChildId(childId: string): void { currentChildId = childId }
export function getCurrentChildId(): string { return currentChildId }
export function setCurrentAssignmentId(assignmentId: string): void { currentAssignmentId = assignmentId }
export function getCurrentAssignmentId(): string { return currentAssignmentId }
export function setReadingFavoritesOnly(value: boolean): void { readingFavoritesOnly = value }
export function takeReadingFavoritesOnly(): boolean { const value = readingFavoritesOnly; readingFavoritesOnly = false; return value }
export function setTeacherTaskCopy(copy: TeacherTaskCopy): void { teacherTaskCopy = JSON.parse(JSON.stringify(copy)) as TeacherTaskCopy }
export function takeTeacherTaskCopy(): TeacherTaskCopy | null {
  const copy = teacherTaskCopy
  teacherTaskCopy = null
  return copy === null ? null : JSON.parse(JSON.stringify(copy)) as TeacherTaskCopy
}
export function setTeacherTemplateSeed(template: TaskTemplateView): void { teacherTemplateSeed = JSON.parse(JSON.stringify(template)) as TaskTemplateView }
export function takeTeacherTemplateSeed(): TaskTemplateView | null {
  const template = teacherTemplateSeed
  teacherTemplateSeed = null
  return template === null ? null : JSON.parse(JSON.stringify(template)) as TaskTemplateView
}
export function setTeacherTaskTargetStudentId(studentId: string): void { teacherTaskTargetStudentId = studentId }
export function setTeacherStatsTargetStudentId(studentId: string): void { teacherStatsTargetStudentId = studentId }
export function takeTeacherStatsTargetStudentId(): string { const id = teacherStatsTargetStudentId; teacherStatsTargetStudentId = ''; return id }
export function takeTeacherTaskTargetStudentId(): string { const studentId = teacherTaskTargetStudentId; teacherTaskTargetStudentId = ''; return studentId }
export function setTeacherSelectedResourceIds(resourceIds: readonly string[]): void { teacherSelectedResourceIds = [...new Set(resourceIds)] }
export function getTeacherSelectedResourceIds(): readonly string[] { return [...teacherSelectedResourceIds] }
export function clearTeacherSelectedResourceIds(): void { teacherSelectedResourceIds = [] }
export function setTeacherCatalogInitialIds(resourceIds: readonly string[]): void { teacherCatalogInitialIds = [...new Set(resourceIds)] }
export function takeTeacherCatalogInitialIds(): readonly string[] { const ids = teacherCatalogInitialIds ?? []; teacherCatalogInitialIds = null; return [...ids] }
export function setTeacherCatalogResultIds(resourceIds: readonly string[]): void { teacherCatalogResultIds = [...new Set(resourceIds)] }
export function getTeacherCatalogResultIds(): readonly string[] | null { return teacherCatalogResultIds === null ? null : [...teacherCatalogResultIds] }
export function clearTeacherCatalogResultIds(): void { teacherCatalogResultIds = null }
export function setTeacherTextbookSelectedIds(ids: readonly string[]): void { teacherTextbookSelectedIds = [...new Set(ids)] }
export function takeTeacherTextbookSelectedIds(): readonly string[] | null {
  const ids = teacherTextbookSelectedIds
  teacherTextbookSelectedIds = null
  return ids === null ? null : [...ids]
}
export function setTeacherReadingSelection(selection: { resourceId: string; pageIds?: readonly string[]; targetClassId?: string }): void {
  teacherReadingSelection = { resourceId: selection.resourceId,
    ...(selection.pageIds === undefined ? {} : { pageIds: [...selection.pageIds] }),
    ...(selection.targetClassId === undefined ? {} : { targetClassId: selection.targetClassId }) }
}
export function getTeacherReadingSelection(): { resourceId: string; pageIds?: string[]; targetClassId?: string } | null {
  return teacherReadingSelection === null ? null : { resourceId: teacherReadingSelection.resourceId,
    ...(teacherReadingSelection.pageIds === undefined ? {} : { pageIds: [...teacherReadingSelection.pageIds] }),
    ...(teacherReadingSelection.targetClassId === undefined ? {} : { targetClassId: teacherReadingSelection.targetClassId }) }
}
export function takeTeacherReadingSelection(): { resourceId: string; pageIds?: string[]; targetClassId?: string } | null {
  const selection = teacherReadingSelection
  teacherReadingSelection = null
  return selection === null ? null : { resourceId: selection.resourceId,
    ...(selection.pageIds === undefined ? {} : { pageIds: [...selection.pageIds] }),
    ...(selection.targetClassId === undefined ? {} : { targetClassId: selection.targetClassId }) }
}
export function setTeacherReviewScoreDraft(draft: TeacherReviewScoreDraft | null): void {
  teacherReviewScoreDraft = draft === null ? null : { ...draft }
}
export function getTeacherReviewScoreDraft(): TeacherReviewScoreDraft | null {
  return teacherReviewScoreDraft === null ? null : { ...teacherReviewScoreDraft }
}
export function takeTeacherReviewScoreDraft(): TeacherReviewScoreDraft | null {
  const draft = getTeacherReviewScoreDraft()
  teacherReviewScoreDraft = null
  return draft
}
