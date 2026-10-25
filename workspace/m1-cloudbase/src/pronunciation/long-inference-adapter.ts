import { createHmac } from 'node:crypto';
import type { PronunciationInferencePort } from './repository';
import { PronunciationError, type RecognitionResult } from './types';

export interface PronunciationPrivateMediaPort {
  temporaryUrl(fileId: string): Promise<string>;
}
export interface ScfSynchronousInvocationPort {
  /** One SCF RequestResponse call with an actual HTTP timeout; this port must never auto-retry. */
  invoke(input: Readonly<{ functionName: 'pronunciation-inference' | 'teacher-suggestion-inference-trial';
    event: Readonly<Record<string, unknown>>; timeoutMs: 180000 | 290000 }>): Promise<unknown>;
}

function validRecognition(value: unknown): value is RecognitionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return body.modelVersion === 'vosk-model-small-en-us-0.15'
    && Number.isSafeInteger(body.durationMs) && Array.isArray(body.words) && body.words.length <= 2000
    && body.words.every(word => word && typeof word === 'object' && !Array.isArray(word)
      && typeof word.word === 'string' && word.word.length <= 100
      && typeof word.start === 'number' && typeof word.end === 'number'
      && typeof word.confidence === 'number');
}

/** Model invocation is one attempt; the durable job owns the sole system retry. */
export class LongPronunciationInference implements PronunciationInferencePort {
  public constructor(private readonly media: PronunciationPrivateMediaPort,
    private readonly scf: ScfSynchronousInvocationPort,
    private readonly secret: string,
    private readonly allowedMediaHost: string,
    private readonly clock: { nowUnix(): number }) {}

  public async infer(input: Readonly<{ operationId: string; recordingId: string; fileId: string;
    contentSha256: string; sizeBytes: number; durationMs: number }>): Promise<RecognitionResult> {
    if (this.secret.length < 32 || !this.allowedMediaHost || !/^[a-f0-9]{64}$/.test(input.contentSha256)
      || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > 20 * 1024 * 1024
      || !Number.isSafeInteger(input.durationMs) || input.durationMs < 1000 || input.durationMs > 300000) {
      throw new PronunciationError('SERVICE_UNAVAILABLE', 'inference_input_invalid');
    }
    const fileUrl = await this.media.temporaryUrl(input.fileId);
    let url: URL;
    try { url = new URL(fileUrl); }
    catch { throw new PronunciationError('SERVICE_UNAVAILABLE', 'media_url_invalid'); }
    if (url.protocol !== 'https:' || url.hostname !== this.allowedMediaHost) {
      throw new PronunciationError('SERVICE_UNAVAILABLE', 'media_url_host_invalid');
    }
    const now = this.clock.nowUnix();
    // Classic CloudBase URLs use a hexadecimal `sign` and an epoch-seconds `t`
    // issuance time. The legacy maxAge option does not set TTL in classic mode,
    // so require a freshly minted URL and keep it only in this internal request.
    const signedValue = url.searchParams.get('sign') ?? '';
    const signedAt = url.searchParams.get('t') ?? '';
    if (!/^[a-f0-9]{32}$/i.test(signedValue) || !/^\d{10}$/.test(signedAt)
      || now - Number(signedAt) < -10 || now - Number(signedAt) > 60) {
      throw new PronunciationError('SERVICE_UNAVAILABLE', 'media_url_signature_invalid');
    }
    const job = { operationId: input.operationId, recordingId: input.recordingId, fileUrl,
      sha256: input.contentSha256, sizeBytes: input.sizeBytes, durationMs: input.durationMs };
    const timestamp = now;
    const canonical = JSON.stringify(Object.fromEntries(Object.entries(job)
      .sort(([left], [right]) => left.localeCompare(right))));
    const signature = createHmac('sha256', this.secret).update(`${timestamp}\n${canonical}`).digest('hex');
    const response = await this.scf.invoke({ functionName: 'pronunciation-inference',
      event: { job, timestamp, signature }, timeoutMs: 290000 });
    const payload = typeof response === 'string' && response.length <= 200000
      ? JSON.parse(response) as unknown : response;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new PronunciationError('SERVICE_UNAVAILABLE', 'inference_response_invalid');
    }
    const body = payload as Record<string, unknown>;
    if (body.ok === true && validRecognition(body.result)) return body.result;
    if (body.code === 'MEDIA_INVALID') throw new PronunciationError('MEDIA_INVALID');
    throw new PronunciationError('SERVICE_UNAVAILABLE', body.code === 'SERVICE_UNAVAILABLE'
      ? 'inference_runtime_unavailable' : 'inference_response_rejected');
  }
}
