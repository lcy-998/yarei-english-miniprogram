import { createHash, createHmac } from 'node:crypto';
import type { SignedPronunciationJobEvent, PronunciationEventTransport } from './job-wire';
import type { ScfSynchronousInvocationPort } from './long-inference-adapter';
import { PronunciationError } from './types';
import type { SignedAutomaticSuggestionJob } from '../teacher-ai/automatic-job';

type FetchPort = (url: string, init: RequestInit) => Promise<Response>;
type ScfCredentials = Readonly<{ secretId: string; secretKey: string; sessionToken?: string }>;
export type ScfCredentialProvider = () => ScfCredentials;

/** One explicit TC3 SCF call per method; runtime-role credentials are resolved per invocation. */
export class DirectScfPronunciationTransport implements ScfSynchronousInvocationPort,
  PronunciationEventTransport {
  private readonly credentials: ScfCredentialProvider;
  public constructor(credentials: ScfCredentials | ScfCredentialProvider,
    private readonly region: string, private readonly namespace: string,
    private readonly fetcher: FetchPort = globalThis.fetch,
    private readonly clock: { nowUnix(): number } = { nowUnix: () => Math.floor(Date.now() / 1000) }) {
    this.credentials = typeof credentials === 'function' ? credentials : () => credentials;
    if (!/^ap-[a-z-]+$/.test(region)
      || !namespace) throw new PronunciationError('SERVICE_UNAVAILABLE');
  }

  public invoke(input: Readonly<{ functionName: 'pronunciation-inference';
    event: Readonly<Record<string, unknown>>; timeoutMs: 290000 }>): Promise<unknown>;
  public invoke(input: Readonly<{ functionName: 'teacher-suggestion-inference-trial';
    event: Readonly<Record<string, unknown>>; timeoutMs: 180000 }>): Promise<unknown>;
  public async invoke(input: Readonly<{ functionName: 'pronunciation-inference' | 'teacher-suggestion-inference-trial';
    event: Readonly<Record<string, unknown>>; timeoutMs: 180000 | 290000 }>): Promise<unknown> {
    if ((input.functionName === 'pronunciation-inference' && input.timeoutMs !== 290000)
      || (input.functionName === 'teacher-suggestion-inference-trial' && input.timeoutMs !== 180000)) {
      throw new PronunciationError('SERVICE_UNAVAILABLE');
    }
    const response = await this.send(input.functionName, input.event, 'RequestResponse', input.timeoutMs);
    const result = response.Result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new PronunciationError('SERVICE_UNAVAILABLE', 'scf_result_invalid');
    }
    const entry = result as Record<string, unknown>;
    if (entry.InvokeResult !== 0 || entry.ErrMsg !== ''
      || typeof entry.RetMsg !== 'string' || entry.RetMsg.length > 200000) {
      throw new PronunciationError('SERVICE_UNAVAILABLE', 'scf_function_invoke_failed');
    }
    try { return JSON.parse(entry.RetMsg) as unknown; }
    catch { throw new PronunciationError('SERVICE_UNAVAILABLE', 'scf_function_result_invalid'); }
  }

  public async invokeEvent(functionName: 'pronunciation-worker',
    event: SignedPronunciationJobEvent): Promise<void> {
    if (functionName !== 'pronunciation-worker') throw new PronunciationError('SERVICE_UNAVAILABLE');
    const response = await this.send(functionName, event, 'Event', 10000);
    if (!response.Result || typeof response.Result !== 'object' || Array.isArray(response.Result)) {
      throw new PronunciationError('SERVICE_UNAVAILABLE');
    }
  }

  public async invokeTeacherSuggestionEvent(event: SignedAutomaticSuggestionJob): Promise<void> {
    const response = await this.send('teacher-suggestion-worker', event, 'Event', 10000);
    if (!response.Result || typeof response.Result !== 'object' || Array.isArray(response.Result)) {
      throw new PronunciationError('SERVICE_UNAVAILABLE');
    }
  }

  public async invokePrivateVideoEvent(event: Readonly<{ organizationId: string;
    videoId: string; processingToken: string }>): Promise<void> {
    const response = await this.send('teacher-private-video-worker', event, 'Event', 10000);
    if (!response.Result || typeof response.Result !== 'object' || Array.isArray(response.Result)) {
      throw new PronunciationError('SERVICE_UNAVAILABLE');
    }
  }

  private async send(functionName: string, event: unknown,
    invocationType: 'Event' | 'RequestResponse', timeoutMs: number): Promise<Record<string, unknown>> {
    const credentials = this.credentials();
    if (!credentials.secretId || !credentials.secretKey
      || (credentials.sessionToken !== undefined && !credentials.sessionToken.trim())) {
      throw new PronunciationError('SERVICE_UNAVAILABLE', 'scf_credentials_missing');
    }
    const host = 'scf.tencentcloudapi.com';
    const timestamp = this.clock.nowUnix();
    if (!Number.isSafeInteger(timestamp)) throw new PronunciationError('SERVICE_UNAVAILABLE');
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const scope = `${date}/scf/tc3_request`;
    const contentType = 'application/json; charset=utf-8';
    const body = JSON.stringify({ FunctionName: functionName, Namespace: this.namespace,
      InvocationType: invocationType, ClientContext: JSON.stringify(event),
      ...(invocationType === 'Event' ? { Qualifier: '$LATEST' } : {}) });
    const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
    const canonical = `POST\n/\n\ncontent-type:${contentType}\nhost:${host}\nx-tc-action:invoke\n\n`
      + `content-type;host;x-tc-action\n${sha(body)}`;
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha(canonical)}`;
    const hmac = (key: Buffer | string, value: string): Buffer => createHmac('sha256', key).update(value).digest();
    const dateKey = hmac(`TC3${credentials.secretKey}`, date);
    const serviceKey = hmac(dateKey, 'scf');
    const signingKey = hmac(serviceKey, 'tc3_request');
    const signature = hmac(signingKey, stringToSign).toString('hex');
    const authorization = `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${scope}, `
      + `SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`;
    let response: Response;
    try {
      const headers: Record<string, string> = { 'content-type': contentType,
        'x-tc-action': 'Invoke', 'x-tc-version': '2018-04-16',
        'x-tc-timestamp': String(timestamp), 'x-tc-region': this.region,
        authorization };
      if (credentials.sessionToken) headers['x-tc-token'] = credentials.sessionToken;
      response = await this.fetcher(`https://${host}/`, { method: 'POST', body, redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs), headers });
    } catch { throw new PronunciationError('SERVICE_UNAVAILABLE', 'scf_transport_failed'); }
    if (!response.ok) throw new PronunciationError('SERVICE_UNAVAILABLE', 'scf_http_failed');
    let parsed: unknown;
    try { parsed = await response.json(); }
    catch { throw new PronunciationError('SERVICE_UNAVAILABLE', 'scf_response_invalid'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new PronunciationError('SERVICE_UNAVAILABLE', 'scf_response_invalid');
    }
    const outer = parsed as Record<string, unknown>;
    const inner = outer.Response;
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
      throw new PronunciationError('SERVICE_UNAVAILABLE', 'scf_response_invalid');
    }
    if ((inner as Record<string, unknown>).Error) {
      const error = (inner as Record<string, unknown>).Error as Record<string, unknown>;
      const code = typeof error.Code === 'string' ? error.Code : '';
      throw new PronunciationError('SERVICE_UNAVAILABLE', /UnauthorizedOperation|AccessDenied/i.test(code)
        ? 'scf_api_denied' : 'scf_api_error');
    }
    return inner as Record<string, unknown>;
  }
}
