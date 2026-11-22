/** Public operator information only. Never put an identity-card number here. */
export const legalConfig = {
  version: '2026-11-22',
  operatorName: '李焱思浩',
  privacyContact: '联系电话：15372348518',
  // Set only after the complete, factual text and operator details are reviewed.
  reviewed: true,
}

export function isLegalReady(): boolean {
  return legalConfig.reviewed && legalConfig.operatorName.trim().length > 0
    && legalConfig.privacyContact.trim().length > 0
}

export const CONSENT_REQUIRED_MESSAGE = '请先阅读并同意《用户服务协议》和《隐私政策》'
export const LEGAL_NOT_READY_MESSAGE = '协议信息正在完善，暂不能提交个人信息'
export function consentError(accepted: boolean): string {
  if (!isLegalReady()) return LEGAL_NOT_READY_MESSAGE
  return accepted ? '' : CONSENT_REQUIRED_MESSAGE
}
