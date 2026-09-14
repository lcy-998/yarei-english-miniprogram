interface TabItem { key: string; label: string; url: string }

const G0_STUDENT_TABS: TabItem[] = [
  { key: 'home', label: '首页', url: '/pages/index/index' },
  { key: 'reading', label: '阅读', url: '' },
  { key: 'class', label: '班级', url: '' },
  { key: 'mine', label: '我的', url: '/pages/student/task-list/task-list' },
]
const G0_PARENT_TABS: TabItem[] = [
  { key: 'home', label: '首页', url: '/pages/parent/home/home' },
  { key: 'children', label: '孩子', url: '' },
  { key: 'report', label: '报告', url: '' },
  { key: 'mine', label: '我的', url: '' },
]
const G0_TEACHER_TABS: TabItem[] = [
  { key: 'workbench', label: '工作台', url: '/pages/teacher/workbench/workbench' },
  { key: 'tasks', label: '任务', url: '/pages/teacher/task-center/task-center' },
  { key: 'materials', label: '教材', url: '' },
  { key: 'students', label: '学员', url: '' },
  { key: 'mine', label: '我的', url: '' },
]

const tabsForRole = (role: string): TabItem[] => role === 'student' ? G0_STUDENT_TABS : role === 'parent' ? G0_PARENT_TABS : G0_TEACHER_TABS

Component({
  properties: { role: { type: String, value: 'student' }, active: { type: String, value: '' } },
  data: { tabs: G0_STUDENT_TABS },
  observers: {
    role(role: string) { this.setData({ tabs: tabsForRole(role) }) },
  },
  methods: {
    onTap(event: WechatMiniprogram.TouchEvent) {
      const url = event.currentTarget.dataset.url as string
      const label = event.currentTarget.dataset.label as string
      if (url) { wx.reLaunch({ url }); return }
      wx.showToast({ title: `${label}将在后续里程碑开放`, icon: 'none' })
    },
  },
})
