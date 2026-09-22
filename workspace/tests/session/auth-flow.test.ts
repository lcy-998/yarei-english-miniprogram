import { describe, expect, it } from 'vitest'
import { Session } from '../../miniprogram/domain/types'
import { defaultRoleSelection, postLoginPath, ROLE_SELECT_PATH } from '../../miniprogram/session/auth-flow'

function session(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'ses_auth_flow',
    user: { id: 'usr_demo', displayName: '演示账号', role: 'student' },
    availableRoles: ['student'],
    activeRole: 'student',
    ...overrides,
  }
}

describe('authentication UI flow', () => {
  it('does not preselect a role for a multi-role session without an active role', () => {
    const value = session({ availableRoles: ['student', 'teacher'], activeRole: null })

    expect(defaultRoleSelection(value)).toBe('')
    expect(postLoginPath(value)).toBe(ROLE_SELECT_PATH)
  })

  it('automatically selects and enters the only available role', () => {
    const value = session({ user: { id: 'usr_teacher', displayName: '林老师', role: 'teacher' }, availableRoles: ['teacher'], activeRole: null })

    expect(defaultRoleSelection(value)).toBe('teacher')
    expect(postLoginPath(value)).toBe('/pages/teacher/workbench/workbench')
  })

  it('enters the active role directly when a multi-role session already has one', () => {
    const value = session({ user: { id: 'usr_multi', displayName: '多身份账号', role: 'parent' }, availableRoles: ['student', 'parent'], activeRole: 'parent' })

    expect(defaultRoleSelection(value)).toBe('parent')
    expect(postLoginPath(value)).toBe('/pages/parent/home/home')
  })
})
