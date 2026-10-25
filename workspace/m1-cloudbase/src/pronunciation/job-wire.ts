import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PronunciationJobDispatchPort } from './repository';
import { PronunciationError } from './types';

export interface PronunciationJobPayload {
  readonly organizationId: string;
  readonly studentId: string;
  readonly recordingId: string;
  readonly operationId: string;
}
export interface SignedPronunciationJobEvent {
  readonly job: PronunciationJobPayload;
  readonly timestamp: number;
  readonly signature: string;
}
export interface PronunciationEventTransport {
  /** Must be a durable SCF Event invocation, never a detached Node Promise. */
  invokeEvent(functionName: 'pronunciation-worker', event: SignedPronunciationJobEvent): Promise<void>;
}

// SCF's async event queue retains events for up to six hours. Keep signed jobs
// valid for that same period so queue delay cannot acknowledge work as invalid.
const MAX_EVENT_AGE_SECONDS = 6 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;

const validId = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);
function canonical(job: PronunciationJobPayload): string {
  return JSON.stringify({ operationId: job.operationId, organizationId: job.organizationId,
    recordingId: job.recordingId, studentId: job.studentId });
}
function signature(secret: string, timestamp: number, job: PronunciationJobPayload): string {
  return createHmac('sha256', secret).update(`${timestamp}\n${canonical(job)}`).digest('hex');
}

export function verifyPronunciationJobEvent(event: unknown, secret: string,
  nowUnix: number): PronunciationJobPayload {
  if (secret.length < 32 || !event || typeof event !== 'object' || Array.isArray(event)) {
    throw new PronunciationError('FORBIDDEN');
  }
  const input = event as Record<string, unknown>;
  const job = input.job;
  const timestamp = input.timestamp;
  const ageSeconds = Number.isSafeInteger(timestamp) ? nowUnix - Number(timestamp) : NaN;
  if (!job || typeof job !== 'object' || Array.isArray(job)
    || !Number.isSafeInteger(timestamp) || ageSeconds < -MAX_CLOCK_SKEW_SECONDS
    || ageSeconds > MAX_EVENT_AGE_SECONDS
    || typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature)) {
    throw new PronunciationError('FORBIDDEN');
  }
  const fields = job as Record<string, unknown>;
  if (Object.keys(fields).sort().join(',') !== 'operationId,organizationId,recordingId,studentId'
    || !validId(fields.operationId) || !validId(fields.organizationId)
    || !validId(fields.recordingId) || !validId(fields.studentId)) {
    throw new PronunciationError('FORBIDDEN');
  }
  const payload: PronunciationJobPayload = { operationId: fields.operationId,
    organizationId: fields.organizationId, recordingId: fields.recordingId,
    studentId: fields.studentId };
  const actual = Buffer.from(input.signature, 'hex');
  const expected = Buffer.from(signature(secret, Number(input.timestamp), payload), 'hex');
  if (!timingSafeEqual(actual, expected)) throw new PronunciationError('FORBIDDEN');
  return payload;
}

export class HmacPronunciationJobDispatcher implements PronunciationJobDispatchPort {
  public constructor(private readonly transport: PronunciationEventTransport,
    private readonly secret: string, private readonly clock: { nowUnix(): number }) {}

  public async dispatch(job: PronunciationJobPayload): Promise<void> {
    if (this.secret.length < 32 || !Object.values(job).every(validId)) {
      throw new PronunciationError('SERVICE_UNAVAILABLE');
    }
    const timestamp = this.clock.nowUnix();
    if (!Number.isSafeInteger(timestamp)) throw new PronunciationError('SERVICE_UNAVAILABLE');
    await this.transport.invokeEvent('pronunciation-worker', {
      job, timestamp, signature: signature(this.secret, timestamp, job),
    });
  }
}
