import { describe, expect, it } from 'vitest';
import { CloudBasePronunciationInference, CloudBasePronunciationInferenceMedia } from '../../src/pronunciation/cloudbase-adapters';

const input = { operationId: 'score_virtual_01', recordingId: 'recording_virtual_01',
  fileId: 'cloud://virtual/private.mp3', contentSha256: 'a'.repeat(64),
  sizeBytes: 20000, durationMs: 2000 };

describe('private Vosk worker adapter', () => {
  it('requests CloudBase temporary URLs with the compatibility maxAge in milliseconds', async () => {
    let maxAge: number | null = null;
    const media = new CloudBasePronunciationInferenceMedia({ async getTempFileURL(input) {
      maxAge = input.fileList[0].maxAge;
      return { fileList: [{ fileID: input.fileList[0].fileID,
        tempFileURL: 'https://media.example.test/private?sign=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&t=1790993160',
        code: 'SUCCESS' }] };
    } });
    await media.temporaryUrl(input.fileId);
    expect(maxAge).toBe(360000);
  });

  it('requires an explicit reviewed timeout before contacting the worker', async () => {
    let invoked = false;
    const adapter = new CloudBasePronunciationInference(
      { async callFunction() { invoked = true; return { result: null }; } },
      { async temporaryUrl() { return 'https://media.example.test/private'; } },
      'test-only-internal-secret-0000000000000000', 0);
    await expect(adapter.infer(input)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(invoked).toBe(false);
  });

  it('requests parsed server-only invocation and validates the recognition shape', async () => {
    const calls: Array<{ name: string; parse: true }> = [];
    const adapter = new CloudBasePronunciationInference(
      { async callFunction(event) {
        calls.push({ name: event.name, parse: event.parse });
        return { result: { ok: true, result: { modelVersion: 'vosk-model-small-en-us-0.15',
          durationMs: 2000, words: [{ word: 'hello', start: 0, end: 0.5, confidence: 0.9 }] } } };
      } },
      { async temporaryUrl() { return 'https://media.example.test/private'; } },
      'test-only-internal-secret-0000000000000000', 3000);
    expect((await adapter.infer(input)).words).toHaveLength(1);
    expect(calls).toEqual([{ name: 'pronunciation-inference', parse: true }]);
  });
});
