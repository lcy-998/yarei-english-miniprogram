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
  getVerification(input: Readonly<{ phone_number: string; usage: 'recovery' }>): Promise<Readonly<{ verification_id?: string }>>
  verify(input: Readonly<{ verification_id: string; verification_code: string }>): Promise<Readonly<{ verification_token?: string }>>
  resetPassword(input: Readonly<{ phone_number: string; new_password: string; verification_token: string }>): Promise<void>
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

  let recoveryVerification: Readonly<{ mobile: string; verificationId: string }> | null = null

  return {
    authentication: {
      async signIn(input) {
        const response = await auth.signInWithPassword({ phone: input.mobile, password: input.password })
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
        const response = await auth.getVerification({ phone_number: mobile, usage: 'recovery' })
        if (typeof response.verification_id !== 'string' || response.verification_id.length === 0) {
          throw { code: 'INVALID_AUTH_RESPONSE' }
        }
        recoveryVerification = { mobile, verificationId: response.verification_id }
      },
      async resetPassword(mobile, code, newPassword) {
        if (recoveryVerification === null || recoveryVerification.mobile !== mobile) {
          throw { code: 'VERIFICATION_EXPIRED' }
        }
        const verified = await auth.verify({ verification_id: recoveryVerification.verificationId, verification_code: code })
        if (typeof verified.verification_token !== 'string' || verified.verification_token.length === 0) {
          throw { code: 'INVALID_AUTH_RESPONSE' }
        }
        await auth.resetPassword({ phone_number: mobile, new_password: newPassword, verification_token: verified.verification_token })
        recoveryVerification = null
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

function normalizedSdkError(error: unknown, fallbackCode: string): Readonly<{ code: string }> {
  if (typeof error !== 'object' || error === null || !('code' in error)) return { code: fallbackCode }
  const code = error.code
  return { code: typeof code === 'string' || typeof code === 'number' ? String(code) : fallbackCode }
}

function isServiceResult<T>(value: unknown): value is ServiceResult<T> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  return value.ok ? 'data' in value : isRecord(value.error) && typeof value.error.code === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
