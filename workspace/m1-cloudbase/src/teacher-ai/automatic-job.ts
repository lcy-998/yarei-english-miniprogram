import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface AutomaticSuggestionJob {
  readonly organizationId: string;
  readonly submissionId: string;
}

export interface SignedAutomaticSuggestionJob {
  readonly job: AutomaticSuggestionJob;
  readonly timestamp: number;
  readonly signature: string;
}

const validId = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function automaticSuggestionOperationId(job: AutomaticSuggestionJob): string {
  return `auto_${createHash('sha256').update(JSON.stringify([
    job.organizationId, job.submissionId,
  ])).digest('hex').slice(0, 40)}`;
}

function signature(secret: string, timestamp: number, job: AutomaticSuggestionJob): string {
  return createHmac('sha256', secret).update(`${timestamp}\n${JSON.stringify({
    organizationId: job.organizationId, submissionId: job.submissionId,
  })}`).digest('hex');
}

export function signAutomaticSuggestionJob(job: AutomaticSuggestionJob, secret: string,
  timestamp: number): SignedAutomaticSuggestionJob {
  if (secret.length < 32 || !Number.isSafeInteger(timestamp)
    || !validId(job.organizationId) || !validId(job.submissionId)) throw new Error('AI_JOB_INVALID');
  return { job, timestamp, signature: signature(secret, timestamp, job) };
}

export function verifyAutomaticSuggestionJob(event: unknown, secret: string,
  nowUnix: number): AutomaticSuggestionJob | null {
  if (secret.length < 32 || !event || typeof event !== 'object' || Array.isArray(event)) return null;
  const value = event as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'job,signature,timestamp'
    || !Number.isSafeInteger(value.timestamp) || Math.abs(nowUnix - Number(value.timestamp)) > 60
    || typeof value.signature !== 'string' || !/^[a-f0-9]{64}$/.test(value.signature)
    || !value.job || typeof value.job !== 'object' || Array.isArray(value.job)) return null;
  const job = value.job as Record<string, unknown>;
  if (Object.keys(job).sort().join(',') !== 'organizationId,submissionId'
    || !validId(job.organizationId) || !validId(job.submissionId)) return null;
  const parsed = { organizationId: job.organizationId, submissionId: job.submissionId };
  return timingSafeEqual(Buffer.from(value.signature, 'hex'),
    Buffer.from(signature(secret, Number(value.timestamp), parsed), 'hex')) ? parsed : null;
}
