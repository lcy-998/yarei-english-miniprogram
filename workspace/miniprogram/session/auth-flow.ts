import { Role, Session } from '../domain/types'
import { homePath } from './session'

export const ROLE_SELECT_PATH = '/pages/auth/role-select/role-select'

function availableRoles(session: Session): Role[] {
  return session.availableRoles?.length ? session.availableRoles : [session.user.role]
}

export function defaultRoleSelection(session: Session): Role | '' {
  const roles = availableRoles(session)
  if (roles.length === 1) return roles[0] ?? ''
  return session.activeRole && roles.includes(session.activeRole) ? session.activeRole : ''
}

export function postLoginPath(session: Session): string {
  const roles = availableRoles(session)
  const role = session.activeRole && roles.includes(session.activeRole)
    ? session.activeRole
    : roles.length === 1 ? roles[0] : undefined
  return role ? homePath(role) : ROLE_SELECT_PATH
}
