import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LongPronunciationInference } from '../../src/pronunciation/long-inference-adapter';

const now = 1790992800;
const secret = 'fictional-inference-secret-' + 'x'.repeat(32);
const input = { operationId: 'score_virtual_01', recordingId: 'pronunciation_virtual_01',
  fileId: 'cloud://test-env/private/virtual.mp3', contentSha256: 'a'.repeat(64),
  sizeBytes: 12000, durationMs: 2000 };
const url = `https://media.example.test/private.mp3?sign=${'a'.repeat(32)}&t=${now}`;
const result = { modelVersion: 'vosk-model-small-en-us-0.15', durationMs: 2000,
  words: [{ word: 'hello', start: 0, end: 1, confidence: 0.9 }] };

describe('M3 long-inference one-call adapter', () => {
  it('signs one private job and leaves system retries to the durable worker', async () => {
    let calls = 0;
    const inference = new LongPronunciationInference(
      { async temporaryUrl(fileId) { expect(fileId).toBe(input.fileId); return url; } },
      { async invoke(request) {
        calls += 1;
        expect(request.functionName).toBe('pronunciation-inference');
        expect(request.timeoutMs).toBe(290000);
        const event = request.event;
        const job = event.job as Record<string, unknown>;
        expect(job.fileUrl).toBe(url);
        const canonical = JSON.stringify(Object.fromEntries(Object.entries(job)
          .sort(([left], [right]) => left.localeCompare(right))));
        expect(event.signature).toBe(createHmac('sha256', secret)
          .update(`${event.timestamp}\n${canonical}`).digest('hex'));
        return { ok: true, result };
      } }, secret, 'media.example.test', { nowUnix: () => now });
    expect(await inference.infer(input)).toEqual(result);
    expect(calls).toBe(1);
  });

  it('rejects stale signed URL, wrong host and invalid result before a second call', async () => {
    let calls = 0;
    const transport = { async invoke() { calls += 1; return { ok: false, code: 'SERVICE_UNAVAILABLE' }; } };
    const expired = new LongPronunciationInference({ async temporaryUrl() {
      return `https://media.example.test/file?sign=${'b'.repeat(32)}&t=${now - 61}`;
    } }, transport, secret, 'media.example.test', { nowUnix: () => now });
    await expect(expired.infer(input)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(calls).toBe(0);
    const wrongHost = new LongPronunciationInference({ async temporaryUrl() {
      return url.replace('media.example.test', 'other.example.test');
    } }, transport, secret, 'media.example.test', { nowUnix: () => now });
    await expect(wrongHost.infer(input)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(calls).toBe(0);
    const serverFailure = new LongPronunciationInference({ async temporaryUrl() { return url; } },
      transport, secret, 'media.example.test', { nowUnix: () => now });
    await expect(serverFailure.infer(input)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(calls).toBe(1);
  });
});
