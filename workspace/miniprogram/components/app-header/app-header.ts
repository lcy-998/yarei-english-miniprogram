Component({
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: false },
    backUrl: { type: String, value: '' },
    backIntercept: { type: Boolean, value: false },
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
    onBack() {
      if (this.properties.backIntercept) { this.triggerEvent('back'); return }
      if (getCurrentPages().length > 1) { wx.navigateBack(); return }
      if (this.properties.backUrl) { wx.reLaunch({ url: this.properties.backUrl }); return }
      wx.navigateBack()
    },
    onBell() { wx.navigateTo({ url: '/pages/notifications/notifications' }) },
  },
})
