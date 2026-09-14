Component({
  properties: { active: { type: String, value: 'home' } },
  data: {
    tabs: [
      { key: 'home', label: '首页', url: '/pages/index/index' },
      { key: 'reading', label: '阅读', url: '' },
      { key: 'class', label: '班级', url: '' },
      { key: 'mine', label: '我的', url: '/pages/student/task-list/task-list' },
    ],
  },
  methods: {
    onTap(event: WechatMiniprogram.TouchEvent) {
      const key = event.currentTarget.dataset.key as string
      const url = event.currentTarget.dataset.url as string
      if (url) { wx.reLaunch({ url }); return }
      wx.showToast({ title: `${key === 'reading' ? '阅读' : key === 'class' ? '班级' : '我的'}将在后续里程碑开放`, icon: 'none' })
    },
  },
})
