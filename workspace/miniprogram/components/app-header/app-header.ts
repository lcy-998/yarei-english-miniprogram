Component({
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: false },
    showBell: { type: Boolean, value: false },
    bellCount: { type: Number, value: 0 },
  },
  data: { topInset: 72, headerHeight: 116 },
  lifetimes: {
    attached() {
      const menuRect = wx.getMenuButtonBoundingClientRect()
      const topInset = Math.max(64, Math.ceil(menuRect.bottom + 8))
      this.setData({ topInset, headerHeight: topInset + 48 })
    },
  },
  methods: {
    onBack() { wx.navigateBack() },
    onBell() { wx.showToast({ title: '暂无新通知', icon: 'none' }) },
  },
})
