import { Role, Session } from '../domain/types'

const SESSION_KEY = 'yarei_session'
let currentTaskId = ''

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
