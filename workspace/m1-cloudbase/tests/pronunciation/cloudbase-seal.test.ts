import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CloudBasePronunciationSeal } from '../../src/pronunciation/cloudbase-adapters';

describe('pronunciation recording seal', () => {
  it('accepts the WebM/Opus recording format produced by the simulator', async () => {
    const organizationId = 'organization_demo';
    const studentId = 'student_demo';
    const recordingId = 'pronunciation_demo';
    const ownerDigest = createHash('sha256').update(JSON.stringify([organizationId, studentId])).digest('hex');
    const stagingPath = `pronunciation/staging/${ownerDigest}/${recordingId}.mp3`;
    const file = readFileSync(join(__dirname, '../task-recording/fixtures/synthetic-440hz-two-seconds.webm'));
    let privatePath = '';
    const adapter = new CloudBasePronunciationSeal({
      async downloadFile() { return { fileContent: file }; },
      async uploadFile(input) { privatePath = input.cloudPath;
        return { fileID: `cloud://test-env/${input.cloudPath}` }; },
    }, 'test-env');
    const result = await adapter.seal({ stagingFileId: `cloud://test-env/${stagingPath}`,
      stagingPath, organizationId, studentId, recordingId });
    expect(result.durationMs).toBeGreaterThanOrEqual(1000);
    expect(result.fileId).toBe(`cloud://test-env/${privatePath}`);
    expect(privatePath).toMatch(/^pronunciation\/private\/.*\.mp3$/);
  });

  it('normalizes an EBML Opus recording when metadata uses the Matroska codec labels', async () => {
    const organizationId = 'organization_demo';
    const studentId = 'student_demo';
    const recordingId = 'pronunciation_variant';
    const ownerDigest = createHash('sha256').update(JSON.stringify([organizationId, studentId])).digest('hex');
    const stagingPath = `pronunciation/staging/${ownerDigest}/${recordingId}.mp3`;
    const file = readFileSync(join(__dirname, '../task-recording/fixtures/synthetic-440hz-two-seconds.webm'));
    const adapter = new CloudBasePronunciationSeal({
      async downloadFile() { return { fileContent: file }; },
      async uploadFile(input) { return { fileID: `cloud://test-env/${input.cloudPath}` }; },
    }, 'test-env', { async read() { return { durationSeconds: null,
      codec: 'A_OPUS', container: 'Matroska', numberOfChannels: 1 }; } });
    const result = await adapter.seal({ stagingFileId: `cloud://test-env/${stagingPath}`,
      stagingPath, organizationId, studentId, recordingId });
    expect(result.durationMs).toBeGreaterThanOrEqual(1000);
  });
});
