import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { legalConfig, isLegalReady } from '../../miniprogram/legal/legal-config'
import { legalDocument } from '../../miniprogram/legal/legal-documents'

const capabilities = vi.hoisted(() => ({ smsPasswordRecovery: true }))
vi.mock('../../miniprogram/runtime/backend-config', () => ({ backendCapabilities: capabilities, miniProgramVersion: 'test' }))

const services = vi.hoisted(() => ({ login: vi.fn(), requestPasswordResetCode: vi.fn(),
  verifyPasswordResetCode: vi.fn(), resetPassword: vi.fn() }))
vi.mock('../../miniprogram/services/auth-service', () => services)
vi.mock('../../miniprogram/repositories/repository-factory', () => ({ getRepositoryMode: () => 'cloudbase' }))
vi.mock('../../miniprogram/session/session', () => ({ saveSession: vi.fn() }))
vi.mock('../../miniprogram/session/auth-flow', () => ({ postLoginPath: () => '/home', ROLE_SELECT_PATH: '/roles' }))

type Definition = { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> }
async function load(kind: 'login' | 'forgot' | 'consent') {
  let definition: Definition | undefined
  vi.stubGlobal('Component', (value: Definition) => { definition = value })
  if (kind === 'login') await import('../../miniprogram/pages/auth/login/login')
  else if (kind === 'forgot') await import('../../miniprogram/pages/auth/forgot-password/forgot-password')
  else await import('../../miniprogram/components/legal-consent/legal-consent')
  if (!definition) throw new Error('Component not loaded')
  const context = { data: { ...definition.data }, properties: { disabled: false }, triggerEvent: vi.fn(),
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
  Object.assign(context, definition.methods)
  const methods = definition.methods
  return { context, call: (name: string, event?: unknown) => methods[name]!.call(context, event as never) }
}
const input = (value: string) => ({ detail: { value } })
const consent = (accepted: boolean) => ({ detail: { accepted } })
beforeEach(() => {
  capabilities.smsPasswordRecovery = true
  vi.stubGlobal('wx', { navigateTo: vi.fn(), redirectTo: vi.fn(), reLaunch: vi.fn(), showToast: vi.fn() })
  services.login.mockResolvedValue({ ok: false, error: { message: '模拟账号验证失败' } })
  services.requestPasswordResetCode.mockResolvedValue({ ok: false, error: { message: '短信未配置' } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules() })

describe('手机号采集前的主动同意', () => {
  it('登录默认未同意：不接收输入，直接调用提交也不请求后台', async () => {
    const p = await load('login')
    expect(p.context.data.accepted).toBe(false)
    p.call('onMobile', input('19900000000')); p.call('onPassword', input('fictional-password'))
    await p.call('submit')
    expect(p.context.data.mobile).toBe(''); expect(p.context.data.password).toBe('')
    expect(services.login).not.toHaveBeenCalled()
    expect(p.context.data.error).toContain('请先阅读并同意')
  })
  it('明确同意后登录正常；取消同意清空输入并阻断再次提交', async () => {
    const p = await load('login')
    p.call('onConsent', consent(true)); p.call('onMobile', input('19900000000')); p.call('onPassword', input('fictional-password'))
    await p.call('submit')
    expect(services.login).toHaveBeenCalledWith('19900000000', 'fictional-password')
    p.call('onConsent', consent(false)); await p.call('submit')
    expect(p.context.data).toMatchObject({ accepted: false, mobile: '', password: '' })
    expect(services.login).toHaveBeenCalledTimes(1)
  })
  it('重新打开登录页不继承其他用户的同意', async () => {
    const first = await load('login'); first.call('onConsent', consent(true))
    vi.resetModules()
    const next = await load('login'); expect(next.context.data.accepted).toBe(false)
  })
  it('登录请求进行中不改变同意和账号，阻止重复提交', async () => {
    let finish: ((value: unknown) => void) | undefined
    services.login.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const p = await load('login'); p.call('onConsent', consent(true)); p.call('onMobile', input('19900000000'))
    const pending = p.call('submit'); p.call('onConsent', consent(false)); p.call('onMobile', input('19900000001')); await p.call('submit')
    expect(p.context.data).toMatchObject({ accepted: true, mobile: '19900000000' })
    expect(services.login).toHaveBeenCalledTimes(1)
    finish?.({ ok: false, error: { message: '模拟失败' } }); await pending
  })
  it('直接进入找回密码页也不能绕过同意发送、验证或重置', async () => {
    const p = await load('forgot')
    p.call('onMobile', input('19900000000')); p.call('onCode', input('246810'))
    p.call('onNewPassword', input('fictional-password')); p.call('onConfirmPassword', input('fictional-password'))
    await p.call('sendCode'); await p.call('nextStep'); await p.call('submit')
    expect(p.context.data).toMatchObject({ accepted: false, mobile: '', code: '', newPassword: '', confirmPassword: '' })
    for (const name of ['requestPasswordResetCode', 'verifyPasswordResetCode', 'resetPassword'] as const) expect(services[name]).not.toHaveBeenCalled()
  })
  it('找回密码同意后可请求，取消后清空验证状态并阻断请求', async () => {
    const p = await load('forgot'); p.call('onConsent', consent(true)); p.call('onMobile', input('19900000000'))
    await p.call('sendCode'); expect(services.requestPasswordResetCode).toHaveBeenCalledWith('19900000000')
    p.context.setData({ step: 2, code: '246810', newPassword: 'fictional-password', codeSent: true, verificationSecondsRemaining: 100 })
    p.call('onConsent', consent(false)); await p.call('submit')
    expect(p.context.data).toMatchObject({ accepted: false, mobile: '', code: '', newPassword: '', step: 1, codeSent: false, verificationSecondsRemaining: 0 })
    expect(services.resetPassword).not.toHaveBeenCalled()
  })
  it('未配置短信服务时只展示联系信息，即使直接调用处理函数也不收集或请求', async () => {
    capabilities.smsPasswordRecovery = false
    const p = await load('forgot')
    expect(p.context.data.recoveryAvailable).toBe(false)
    expect(p.context.data.privacyContact).toBe(legalConfig.privacyContact)
    p.call('onConsent', consent(true))
    p.context.setData({ accepted: true })
    p.call('onMobile', input('19900000000')); p.call('onCode', input('246810'))
    p.call('onNewPassword', input('fictional-password')); p.call('onConfirmPassword', input('fictional-password'))
    await p.call('sendCode'); await p.call('nextStep'); await p.call('submit')
    expect(p.context.data).toMatchObject({ mobile: '', code: '', newPassword: '', confirmPassword: '' })
    for (const name of ['requestPasswordResetCode', 'verifyPasswordResetCode', 'resetPassword'] as const) expect(services[name]).not.toHaveBeenCalled()
  })
  it('协议链接只导航，不自动代表同意', async () => {
    const p = await load('consent'); p.call('openService'); p.call('openPrivacy')
    expect(wx.navigateTo).toHaveBeenNthCalledWith(1, { url: '/pages/legal/document/document?kind=service' })
    expect(wx.navigateTo).toHaveBeenNthCalledWith(2, { url: '/pages/legal/document/document?kind=privacy' })
    expect(p.context.triggerEvent).not.toHaveBeenCalled()
    p.call('change', { detail: { value: ['accepted'] } })
    expect(p.context.triggerEvent).toHaveBeenLastCalledWith('change', { accepted: true })
    p.context.properties.disabled = true; p.call('change', { detail: { value: [] } })
    expect(p.context.triggerEvent).toHaveBeenCalledTimes(1)
  })
  it('待上传文本具备真实主体、公开联系渠道和必要处理说明', () => {
    expect(isLegalReady()).toBe(true)
    for (const kind of ['privacy', 'service']) {
      const body = legalDocument(kind).sections.map(section => section.body).join('\n')
      expect(body).toContain(legalConfig.operatorName); expect(body).toContain(legalConfig.privacyContact)
      expect(body).not.toMatch(/待补充|李\*|启航实验学校/)
    }
    const privacy = legalDocument('privacy').sections.map(section => section.body).join('\n')
    for (const item of ['手机号', '手动输入', 'HTTPS', '账号', '阿里云', '录音', '注销', '未满十四周岁', '撤回同意']) expect(privacy).toContain(item)
  })
})
