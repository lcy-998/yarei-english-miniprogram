interface TabItem { key: string; label: string; url: string }

const G0_STUDENT_TABS: TabItem[] = [
  { key: 'home', label: '首页', url: '/pages/index/index' },
  { key: 'reading', label: '阅读', url: '/pages/student/reading-library/reading-library' },
  { key: 'class', label: '班级', url: '/pages/student/class-home/class-home' },
  { key: 'mine', label: '我的', url: '/pages/profile/profile' },
]
const G0_PARENT_TABS: TabItem[] = [
  { key: 'home', label: '首页', url: '/pages/parent/home/home' },
  { key: 'children', label: '孩子', url: '/pages/parent/children/children' },
  { key: 'report', label: '报告', url: '/pages/parent/learning-report/learning-report' },
  { key: 'mine', label: '我的', url: '/pages/profile/profile' },
]
const G0_TEACHER_TABS: TabItem[] = [
  { key: 'workbench', label: '工作台', url: '/pages/teacher/workbench/workbench' },
  { key: 'tasks', label: '任务', url: '/pages/teacher/task-center/task-center' },
  { key: 'materials', label: '教材', url: '/pages/teacher/materials-home/materials-home' },
  { key: 'students', label: '学员', url: '/pages/teacher/student-list/student-list' },
  { key: 'mine', label: '我的', url: '/pages/profile/profile' },
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
