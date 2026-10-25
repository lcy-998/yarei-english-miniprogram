import { describe, expect, it } from 'vitest';
import { createPronunciationWorkerFunction } from '../../functions/pronunciation-worker/function-entry';
import { HmacPronunciationJobDispatcher, verifyPronunciationJobEvent,
  type SignedPronunciationJobEvent } from '../../src/pronunciation/job-wire';

const secret = 'fictional-job-secret-' + 'x'.repeat(32);
const nowUnix = 1790992800;
const job = { organizationId: 'org_virtual_01', studentId: 'student_virtual_01',
  recordingId: 'pronunciation_virtual_01', operationId: 'score_virtual_01' };

describe('M3 internal pronunciation job wire', () => {
  it('dispatches one signed durable event and rejects tampering, expiry and direct clients', async () => {
    let captured: SignedPronunciationJobEvent | null = null;
    let calls = 0;
    const dispatcher = new HmacPronunciationJobDispatcher({ async invokeEvent(name, event) {
      expect(name).toBe('pronunciation-worker');
      calls += 1; captured = event;
    } }, secret, { nowUnix: () => nowUnix });
    await dispatcher.dispatch(job);
    expect(calls).toBe(1);
    expect(verifyPronunciationJobEvent(captured, secret, nowUnix)).toEqual(job);
    expect(() => verifyPronunciationJobEvent({}, secret, nowUnix)).toThrowError('FORBIDDEN');
    expect(() => verifyPronunciationJobEvent(captured, secret, nowUnix + 6 * 60 * 60 + 1)).toThrowError('FORBIDDEN');
    expect(() => verifyPronunciationJobEvent({ ...captured!, job: { ...job,
      studentId: 'student_virtual_other' } }, secret, nowUnix)).toThrowError('FORBIDDEN');
    expect(() => verifyPronunciationJobEvent(captured, 'wrong-secret', nowUnix)).toThrowError('FORBIDDEN');
  });

  it('worker returns only safe status and never echoes event payload or exceptions', async () => {
    let signed: SignedPronunciationJobEvent | null = null;
    await new HmacPronunciationJobDispatcher({ async invokeEvent(_name, event) { signed = event; } },
      secret, { nowUnix: () => nowUnix }).dispatch(job);
    const worker = createPronunciationWorkerFunction({ secret, clock: { nowUnix: () => nowUnix },
      jobs: { async run() { throw new Error('fictional-private-url-token'); } } });
    const result = await worker(signed);
    expect(result).toEqual({ ok: false, status: 'rejected_or_unavailable' });
    expect(JSON.stringify(result)).not.toContain('fictional-private-url-token');
    expect(await worker({})).toEqual({ ok: false, status: 'rejected_or_unavailable' });
  });
});
