import { getSession, homePath } from '../../../session/session'

Component({
  data: { name: '', avatarText: '', role: '', roleLabel: '', roleSummary: '' },
  lifetimes: { attached() { const session = getSession(); if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return } const roleLabel=session.user.role === 'student' ? '学生' : session.user.role === 'teacher' ? '教师' : '家长'; const roleSummary=session.user.role === 'student' ? '三年级 2 班' : session.user.role === 'teacher' ? '启航实验学校 · 林老师' : '已绑定学生：小宇'; this.setData({ name: session.user.displayName, avatarText: session.user.displayName.slice(0, 1), role: session.user.role, roleLabel, roleSummary }) } },
  methods: { enter() { const session = getSession(); if (session) wx.reLaunch({ url: homePath(session.user.role) }) } },
})
