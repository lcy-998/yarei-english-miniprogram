/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo,
    taskMediaDrafts?: Record<string, {
      savedAt: string
      answers: Record<string, string | string[]>
    }>,
    preferredDubbingMaterial?: {
      userId: string
      sessionId: string
      materialId: string
    },
  }
  userInfoReadyCallback?: WechatMiniprogram.GetUserInfoSuccessCallback,
}
