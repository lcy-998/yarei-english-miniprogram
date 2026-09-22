import { Role } from '../../../domain/types'
import { selectRole } from '../../../services/app-service'
import { defaultRoleSelection } from '../../../session/auth-flow'
import { getSession, homePath, saveSession } from '../../../session/session'

interface RoleOption { role: Role; label: string; summary: string }

const roleOption = (role: Role): RoleOption => ({
  role,
  label: role === 'student' ? '学生' : role === 'teacher' ? '教师' : '家长',
  summary: role === 'student' ? '进入学习空间' : role === 'teacher' ? '进入教学工作台' : '查看孩子学习情况',
})

Component({
  data: { name: '', avatarText: '', roles: [] as RoleOption[], selectedRole: '' as Role | '', loading: false, error: '' },
  lifetimes: {
    attached() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      const roles = (session.availableRoles?.length ? session.availableRoles : [session.user.role]).map(roleOption)
      this.setData({ name: session.user.displayName, avatarText: session.user.displayName.slice(0, 1), roles, selectedRole: defaultRoleSelection(session) })
    },
  },
  methods: {
    chooseRole(event: WechatMiniprogram.TouchEvent) { this.setData({ selectedRole: event.currentTarget.dataset.role as Role, error: '' }) },
    async enter() {
      const session = getSession()
      if (!session || !this.data.selectedRole || this.data.loading) return
      this.setData({ loading: true, error: '' })
      const result = await selectRole(session.user.id, this.data.selectedRole)
      this.setData({ loading: false })
      if (!result.ok) { this.setData({ error: result.error.message }); return }
      saveSession(result.data)
      wx.reLaunch({ url: homePath(result.data.user.role) })
    },
  },
})
