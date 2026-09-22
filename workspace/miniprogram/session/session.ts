import { Role, Session } from '../domain/types'

const SESSION_KEY = 'yarei_session'
let currentTaskId = ''
let currentBookId = 'book_zoo'
let currentStudentId = 'usr_student_xiaoyu'
let currentChildId = ''
let currentAssignmentId = ''
let readingFavoritesOnly = false

export function saveSession(session: Session): void {
  wx.setStorageSync(SESSION_KEY, session)
}

export function getSession(): Session | null {
  return wx.getStorageSync(SESSION_KEY) as Session | null
}

export function clearSession(): void {
  wx.removeStorageSync(SESSION_KEY)
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
