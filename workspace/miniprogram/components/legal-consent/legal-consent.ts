import { isLegalReady } from '../../legal/legal-config'

Component({
  properties: { accepted: Boolean, disabled: Boolean },
  data: { ready: isLegalReady() },
  methods: {
    change(event: WechatMiniprogram.CheckboxGroupChange) {
      if (this.properties.disabled || !isLegalReady()) return
      this.triggerEvent('change', { accepted: event.detail.value.includes('accepted') })
    },
    openService() { wx.navigateTo({ url: '/pages/legal/document/document?kind=service' }) },
    openPrivacy() { wx.navigateTo({ url: '/pages/legal/document/document?kind=privacy' }) },
  },
})
