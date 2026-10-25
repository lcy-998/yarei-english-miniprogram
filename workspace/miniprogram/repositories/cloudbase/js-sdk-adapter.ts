import { ServiceResult } from '../../domain/types'
import {
  CloudAuthenticationPort,
  CloudCallContext,
  CloudFunctionInvoker,
  FunctionRequest,
} from './protocol'

export interface CloudBaseJsSdkAuthResponse {
  readonly data?: unknown
  readonly error?: unknown
}

export interface CloudBaseJsSdkAuthPort {
  signInWithPassword(input: Readonly<{ phone: string; password: string }>): Promise<CloudBaseJsSdkAuthResponse>
  getVerification(input: Readonly<{ phone_number: string; usage: 'recovery'; target: 'USER' }>): Promise<Readonly<{
    verification_id?: string; is_user?: boolean }>>
  verify(input: Readonly<{ verification_id: string; verification_code: string }>): Promise<Readonly<{
    verification_token?: string; expires_in?: number }>>
  resetPassword(input: Readonly<{ phone_number: string; new_password: string; verification_token: string }>): Promise<void>
  signOut?(): Promise<unknown>
}

export interface CloudBaseJsSdkAppPort {
  auth(options: Readonly<{ persistence: 'local' }>): CloudBaseJsSdkAuthPort
  callFunction(options: Readonly<{ name: string; data: object; parse: true }>): Promise<Readonly<{ result?: unknown }>>
}

export interface CloudBaseJsSdkPort {
  init(configuration: Readonly<{ env: string }>): CloudBaseJsSdkAppPort
}

export interface CloudBaseJsSdkAdapter {
  readonly authentication: CloudAuthenticationPort
  readonly invoker: CloudFunctionInvoker
}

/**
 * Binds Auth v2 and cloud-function calls to one @cloudbase/js-sdk v3 app.
 * The SDK owns and propagates its access token; business passwords never enter
 * a function request, and business-session tokens stay in the strict envelope.
 */
export function createCloudBaseJsSdkAdapter(app: CloudBaseJsSdkAppPort): CloudBaseJsSdkAdapter {
  if (typeof app.auth !== 'function' || typeof app.callFunction !== 'function') {
    throw new Error('CLOUDBASE_CLIENT_CAPABILITY_UNAVAILABLE')
  }
  const auth = app.auth({ persistence: 'local' })
  if (auth === null || typeof auth !== 'object'
    || typeof auth.signInWithPassword !== 'function'
    || typeof auth.getVerification !== 'function'
    || typeof auth.verify !== 'function'
    || typeof auth.resetPassword !== 'function') {
    throw new Error('CLOUDBASE_AUTH_CAPABILITY_UNAVAILABLE')
  }

  let recoveryVerification: Readonly<{ mobile: string; verificationId: string;
    verificationToken?: string; expiresAt?: number }> | null = null

  return {
    authentication: {
      async signIn(input) {
        let response: CloudBaseJsSdkAuthResponse
        try {
          response = await auth.signInWithPassword({ phone: normalizePhone(input.mobile), password: input.password })
        } catch (error: unknown) {
          throw normalizedSdkError(error, 'AUTHENTICATION_FAILED')
        }
        if (response === null || typeof response !== 'object') {
          throw { code: 'INVALID_AUTH_RESPONSE' }
        }
        if (response.error !== undefined && response.error !== null) {
          throw normalizedSdkError(response.error, 'AUTHENTICATION_FAILED')
        }
        if (response.data === undefined || response.data === null) {
          throw { code: 'INVALID_AUTH_RESPONSE' }
        }
      },
      async requestPasswordResetCode(mobile) {
        let response: Awaited<ReturnType<CloudBaseJsSdkAuthPort['getVerification']>>
        try {
          response = await auth.getVerification({ phone_number: normalizeVerificationPhone(mobile),
            usage: 'recovery', target: 'USER' })
        } catch (error: unknown) {
          throw normalizedRecoverySdkError(error)
        }
        if (response.is_user === false) throw { code: 'ACCOUNT_NOT_FOUND' }
        if (typeof response.verification_id !== 'string' || response.verification_id.length === 0) {
          throw { code: 'INVALID_AUTH_RESPONSE' }
        }
        recoveryVerification = { mobile, verificationId: response.verification_id }
      },
      async verifyPasswordResetCode(mobile, code) {
        const pending = recoveryVerification
        if (pending === null || pending.mobile !== mobile) {
          throw { code: 'VERIFICATION_EXPIRED' }
        }
        let verified: Awaited<ReturnType<CloudBaseJsSdkAuthPort['verify']>>
        try {
          verified = await auth.verify({ verification_id: pending.verificationId, verification_code: code })
        } catch (error: unknown) {
          throw normalizedRecoverySdkError(error)
        }
        if (typeof verified.verification_token !== 'string' || verified.verification_token.length === 0) {
          throw { code: 'INVALID_VERIFICATION_CODE' }
        }
        const expiresInSeconds = Number.isSafeInteger(verified.expires_in) && Number(verified.expires_in) > 0
          ? Number(verified.expires_in) : 600
        recoveryVerification = { ...pending, verificationToken: verified.verification_token,
          expiresAt: Date.now() + expiresInSeconds * 1000 }
        return expiresInSeconds
      },
      async resetPassword(mobile, newPassword) {
        const pending = recoveryVerification
        if (pending === null || pending.mobile !== mobile
          || typeof pending.verificationToken !== 'string' || pending.verificationToken.length === 0
          || typeof pending.expiresAt !== 'number' || Date.now() >= pending.expiresAt) {
          throw { code: 'VERIFICATION_EXPIRED' }
        }
        try {
          await auth.resetPassword({ phone_number: normalizeVerificationPhone(mobile), new_password: newPassword,
            verification_token: pending.verificationToken })
        } catch (error: unknown) {
          throw normalizedRecoverySdkError(error)
        }
        recoveryVerification = null
        if (typeof auth.signOut === 'function') await auth.signOut()
      },
    },
    invoker: {
      async call<TAction extends string, TPayload extends object, TResult>(
        functionName: Parameters<CloudFunctionInvoker['call']>[0],
        request: FunctionRequest<TAction, TPayload>,
        context: CloudCallContext,
      ): Promise<ServiceResult<TResult>> {
        const data = {
          ...request,
          ...(context.businessSessionToken === null
            ? {}
            : { businessSessionToken: context.businessSessionToken }),
        }
        const response = await app.callFunction({ name: functionName, data, parse: true })
        if (!isServiceResult<TResult>(response.result)) {
          throw { code: 'INVALID_CLOUD_FUNCTION_RESPONSE' }
        }
        return response.result
      },
    },
  }
}

function normalizePhone(value: string): string {
  const compact = value.replace(/\s/g, '')
  if (/^1\d{10}$/.test(compact)) return `+86${compact}`
  if (/^\+86\d{11}$/.test(compact)) return compact
  return value
}

function normalizeVerificationPhone(value: string): string {
  const compact = value.replace(/\s/g, '')
  if (/^1\d{10}$/.test(compact)) return `+86 ${compact}`
  if (/^\+86\d{11}$/.test(compact)) return `+86 ${compact.slice(3)}`
  return value
}

function normalizedSdkError(error: unknown, fallbackCode: string): Readonly<{ code: string }> {
  if (typeof error !== 'object' || error === null) return { code: fallbackCode }
  const fields = ['code', 'message', 'error', 'error_code'].map(key => key in error ? error[key as keyof typeof error] : undefined)
  const detail = fields.filter(value => typeof value === 'string' || typeof value === 'number').map(String).join(' ').toLowerCase()
  for (const known of ['invalid_username_or_password', 'captcha_required', 'password_not_set', 'invalid_status', 'login_disabled']) {
    if (detail.includes(known)) return { code: known.toUpperCase() }
  }
  const code = 'code' in error ? error.code : undefined
  return { code: typeof code === 'string' || typeof code === 'number' ? String(code) : fallbackCode }
}

function normalizedRecoverySdkError(error: unknown): Readonly<{ code: string }> {
  if (typeof error !== 'object' || error === null) return { code: 'AUTH_PROVIDER_ERROR' }
  const fields = ['code', 'error', 'error_code', 'message', 'error_description']
    .map(key => key in error ? error[key as keyof typeof error] : undefined)
  const detail = fields.filter(value => typeof value === 'string' || typeof value === 'number')
    .map(String).join(' ').toUpperCase()
  if (/NETWORK|TIMEOUT|ECONN|FETCH_FAILED/u.test(detail)) return { code: 'NETWORK_ERROR' }
  if (/USER_NOT_FOUND|ACCOUNT_NOT_FOUND|NO_SUCH_USER|USER_DOES_NOT_EXIST/u.test(detail)) {
    return { code: 'ACCOUNT_NOT_FOUND' }
  }
  if (/EXPIRED|INVALID_VERIFICATION|INVALID_GRANT|TOKEN_USED|TOKEN_INVALID/u.test(detail)) {
    return { code: 'VERIFICATION_EXPIRED' }
  }
  if (/WEAK_PASSWORD|PASSWORD_POLICY|INVALID_PASSWORD|PASSWORD_TOO/u.test(detail)) {
    return { code: 'PASSWORD_POLICY' }
  }
  if (/CAPTCHA_REQUIRED|RESOURCE_EXHAUSTED|TOO_MANY_REQUESTS/u.test(detail)) {
    return { code: 'RESOURCE_EXHAUSTED' }
  }
  const record = error as Record<string, unknown>
  const providerCode = ['error', 'code', 'error_code']
    .map(key => record[key])
    .find((value): value is string => typeof value === 'string'
      && /^(?:invalid|failed|not|user|password|account|captcha|resource|service|unimplemented)_[A-Za-z_]{2,48}$/iu.test(value))
  return { code: typeof providerCode === 'string'
    ? `AUTH_PROVIDER_${providerCode.toUpperCase()}` : 'AUTH_PROVIDER_ERROR' }
}

function isServiceResult<T>(value: unknown): value is ServiceResult<T> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  return value.ok ? 'data' in value : isRecord(value.error) && typeof value.error.code === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
