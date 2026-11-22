import { isLegalReady, legalConfig } from '../../../legal/legal-config'
import { legalDocument, LegalSection } from '../../../legal/legal-documents'

// The project's pinned typings predate this WeChat API.
type PrivacyWx = WechatMiniprogram.Wx & { openPrivacyContract?: (options: { fail: () => void }) => void }

Page({
  data: { title: '', sections: [] as LegalSection[], version: legalConfig.version, ready: isLegalReady(), isPrivacy: false },
  onLoad(options: { kind?: string }) {
    this.setData({ ...legalDocument(options.kind ?? 'privacy'), isPrivacy: options.kind !== 'service' })
  },
  openWechatPrivacy() {
    const privacyWx: PrivacyWx = wx
    if (typeof privacyWx.openPrivacyContract !== 'function') {
      wx.showToast({ title: '请更新微信后查看平台隐私指引', icon: 'none' }); return
    }
    privacyWx.openPrivacyContract({ fail: () => wx.showToast({ title: '平台隐私指引暂不可用，请稍后重试', icon: 'none' }) })
  },
})
