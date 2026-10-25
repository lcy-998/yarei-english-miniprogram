import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBuffer } from 'music-metadata';
import { CloudBaseReviewVoiceSeal } from '../../src/review-voice/cloudbase-seal';

describe('T-08 review voice private sealing', () => {
  it('rejects unrelated staging IDs and seals only inspected MP3 bytes to a private path', async () => {
    let uploads = 0;
    const storage = { async downloadFile() { return { fileContent: Buffer.from('fictional-mp3-bytes') }; },
      async uploadFile(input: { cloudPath: string; fileContent: Buffer }) {
        uploads += 1; return { fileID: `cloud://env_demo/${input.cloudPath}` };
      } };
    const seal = new CloudBaseReviewVoiceSeal(storage, 'env_demo',
      { maxDurationMs: 300000, maxBytes: 20 * 1024 * 1024 },
      { async read() { return { durationSeconds: 3, codec: 'MP3', container: 'MPEG' }; } });
    const path = 'review-voice/org_demo/teacher_demo/submission_demo/review_voice_demo';
    expect(await seal.inspectAndSeal(path, 'cloud://env_demo/other/path')).toBeNull();
    expect(uploads).toBe(0);
    const result = await seal.inspectAndSeal(path, `cloud://env_demo/${path}`);
    expect(result).toMatchObject({ contentType: 'audio/mpeg', durationMs: 3000,
      fileId: expect.stringMatching(/^cloud:\/\/env_demo\/review-voice\/private\//) });
    expect(uploads).toBe(1);
  });

  it('normalizes a simulator WebM/Opus recording before sealing the review comment', async () => {
    const webm = readFileSync(new URL('../task-recording/fixtures/synthetic-440hz-two-seconds.webm', import.meta.url));
    let sealedBytes: Buffer | null = null;
    const storage = { async downloadFile() { return { fileContent: webm }; },
      async uploadFile(input: { cloudPath: string; fileContent: Buffer }) {
        sealedBytes = input.fileContent;
        return { fileID: `cloud://env_demo/${input.cloudPath}` };
      } };
    const seal = new CloudBaseReviewVoiceSeal(storage, 'env_demo',
      { maxDurationMs: 300000, maxBytes: 20 * 1024 * 1024 });
    const path = 'review-voice/org_demo/teacher_demo/submission_demo/review_voice_demo';
    const result = await seal.inspectAndSeal(path, `cloud://env_demo/${path}`);
    expect(result).toMatchObject({ contentType: 'audio/mpeg', durationMs: expect.any(Number),
      fileId: expect.stringMatching(/\.mp3$/) });
    expect(result?.durationMs).toBeGreaterThanOrEqual(1000);
    expect(sealedBytes).not.toBeNull();
    const parsed = await parseBuffer(sealedBytes!, { size: sealedBytes!.length }, { duration: true });
    expect(parsed.format.codec?.toLowerCase()).toMatch(/mp3|layer 3/);
  });
});
