import { Role, Session } from '../domain/types'

const SESSION_KEY = 'yarei_session'
let currentTaskId = ''
let currentBookId = ''
let currentStudentId = 'usr_student_xiaoyu'
let currentChildId = ''
let currentAssignmentId = ''
let readingFavoritesOnly = false
let teacherTaskCopy: { title: string; description: string; items: Array<{ resourceId: string; type: 'reading' | 'vocabulary' | 'exercise' }> } | null = null
let teacherTaskTargetStudentId = ''

export function saveSession(session: Session): void {
  wx.setStorageSync(SESSION_KEY, session)
}

export function getSession(): Session | null {
  return wx.getStorageSync(SESSION_KEY) as Session | null
}

export function clearSession(): void {
  wx.removeStorageSync(SESSION_KEY)
  teacherTaskTargetStudentId = ''
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
export function setTeacherTaskCopy(copy: NonNullable<typeof teacherTaskCopy>): void { teacherTaskCopy = copy }
export function takeTeacherTaskCopy(): typeof teacherTaskCopy { const copy = teacherTaskCopy; teacherTaskCopy = null; return copy }
export function setTeacherTaskTargetStudentId(studentId: string): void { teacherTaskTargetStudentId = studentId }
export function takeTeacherTaskTargetStudentId(): string { const studentId = teacherTaskTargetStudentId; teacherTaskTargetStudentId = ''; return studentId }
