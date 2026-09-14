interface RoleTab { key: string; label: string; url: string }

const TEACHER_TABS: RoleTab[] = [
  { key: 'workbench', label: '工作台', url: '/pages/teacher/workbench/workbench' },
  { key: 'tasks', label: '任务', url: '/pages/teacher/task-center/task-center' },
  { key: 'materials', label: '教材', url: '' },
  { key: 'students', label: '学员', url: '' },
  { key: 'mine', label: '我的', url: '' },
]

const PARENT_TABS: RoleTab[] = [
  { key: 'home', label: '首页', url: '/pages/parent/home/home' },
  { key: 'children', label: '孩子', url: '' },
  { key: 'report', label: '报告', url: '' },
  { key: 'mine', label: '我的', url: '' },
]

Component({
  properties: { role: { type: String, value: 'teacher' }, active: { type: String, value: '' } },
  data: { tabs: TEACHER_TABS },
  observers: { role(value: string) { this.setData({ tabs: value === 'parent' ? PARENT_TABS : TEACHER_TABS }) } },
  methods: {
    onTap(event: WechatMiniprogram.TouchEvent) {
      const url = event.currentTarget.dataset.url as string
      const label = event.currentTarget.dataset.label as string
      if (url) { wx.reLaunch({ url }); return }
      wx.showToast({ title: `${label}将在后续里程碑开放`, icon: 'none' })
    },
  },
})
