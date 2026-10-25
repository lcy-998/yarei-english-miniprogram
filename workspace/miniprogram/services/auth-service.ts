import type { Role, ServiceError, ServiceResult, Session } from '../domain/types'
import { getState } from '../repositories/memory/mock-state'
import { getCloudAppService } from '../repositories/repository-factory'

let demoStudentPassword = '123456'
let memoryPasswordResetVerifiedMobile: string | null = null

function ok<T>(data: T): ServiceResult<T> { return { ok: true, data } }
function fail<T>(code: ServiceError['code'], message: string): ServiceResult<T> {
  return { ok: false, error: { code, message, retryable: false } }
}

export async function login(mobile: string, password: string): Promise<ServiceResult<Session>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.login(mobile, password)
  if (!mobile || !password) return fail('VALIDATION_ERROR', '请输入手机号和密码')
  const state = getState()
  const userId = mobile === '13800000001' ? 'usr_student_xiaoyu'
    : mobile === '13800000002' ? 'usr_teacher_lin'
      : mobile === '13800000003' ? 'usr_parent_xiaoyu' : ''
  const user = state.users.find(item => item.id === userId)
  const expectedPassword = mobile === '13800000001' ? demoStudentPassword : '123456'
  if (!user || password !== expectedPassword) return fail('UNAUTHENTICATED', '手机号或密码不正确')
  return ok({ sessionId: `ses_${user.id}`, user })
}

export async function requestPasswordResetCode(mobile: string): Promise<ServiceResult<{ expiresInMinutes: number }>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.requestPasswordResetCode(mobile)
  if (!/^1\d{10}$/.test(mobile)) return fail('VALIDATION_ERROR', '请输入正确的手机号')
  memoryPasswordResetVerifiedMobile = null
  return ok({ expiresInMinutes: 10 })
}

export async function verifyPasswordResetCode(mobile: string, code: string): Promise<ServiceResult<{ expiresInSeconds: number }>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.verifyPasswordResetCode(mobile, code)
  if (!/^1\d{10}$/.test(mobile) || !/^\d{6}$/.test(code)) return fail('VALIDATION_ERROR', '手机号或验证码格式不正确')
  if (code !== '246810') return fail('VALIDATION_ERROR', '验证码无效或已过期')
  memoryPasswordResetVerifiedMobile = mobile
  return ok({ expiresInSeconds: 600 })
}

export async function resetPassword(mobile: string, newPassword: string): Promise<ServiceResult<null>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.resetPassword(mobile, newPassword)
  if (!/^1\d{10}$/.test(mobile) || newPassword.length < 6 || newPassword.length > 32) {
    return fail('VALIDATION_ERROR', '手机号或新密码格式不正确')
  }
  if (memoryPasswordResetVerifiedMobile !== mobile) return fail('VALIDATION_ERROR', '验证码无效或已过期')
  if (mobile === '13800000001') demoStudentPassword = newPassword
  memoryPasswordResetVerifiedMobile = null
  return ok(null)
}

export async function selectRole(userId: string, role: Role): Promise<ServiceResult<Session>> {
  const cloud = getCloudAppService()
  if (cloud) return cloud.selectRole(userId, role)
  const user = getState().users.find(item => item.id === userId && item.role === role)
  return user ? ok({ sessionId: `ses_${user.id}`, user, availableRoles: [role], activeRole: role })
    : fail('FORBIDDEN', '身份不可用')
}
