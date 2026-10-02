import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CloudBaseRecordingSeal, type AudioMetadataReader, type CloudBaseWorkStoragePort } from '../../src/student-work/cloudbase-recording-seal';

const stagingPath = 'student-works/staging/abc123/student_work_demo_1.mp3';
const input = { stagingFileId: `cloud://demo-env.bucket/${stagingPath}`, stagingPath,
  organizationId: 'org_demo', studentId: 'student_demo', workId: 'student_work_demo_1' };
const audio = Buffer.from('fictional-mp3-bytes-for-port-test');

function fixture(metadata: AudioMetadataReader = { async read() { return { durationSeconds: 12, codec: 'MPEG 1 Layer 3' }; } }) {
  const downloadFile = vi.fn<CloudBaseWorkStoragePort['downloadFile']>(async () => ({ fileContent: audio }));
  const uploadFile = vi.fn<CloudBaseWorkStoragePort['uploadFile']>(async ({ cloudPath }) => ({ fileID: `cloud://demo-env.bucket/${cloudPath}` }));
  const seal = new CloudBaseRecordingSeal({ downloadFile, uploadFile }, 'demo-env', metadata);
  return { seal, downloadFile, uploadFile };
}

describe('M2 CloudBase recording seal', () => {
  it('checks the issued staging path, validates audio metadata and copies a digest-named private file', async () => {
    const { seal, downloadFile, uploadFile } = fixture();
    const result = await seal.inspectAndSeal(input);
    expect(result).toMatchObject({ sizeBytes: audio.length, durationMs: 12_000, codec: 'mp3',
      contentSha256: createHash('sha256').update(audio).digest('hex') });
    expect(result.fileId).toContain('/student-works/private/');
    expect(result.fileId).not.toContain(input.studentId);
    expect(downloadFile).toHaveBeenCalledWith({ fileID: input.stagingFileId });
    expect(uploadFile).toHaveBeenCalledWith({ cloudPath: expect.stringContaining(result.contentSha256), fileContent: audio });
  });

  it('rejects a foreign environment or different upload path before reading the file', async () => {
    const { seal, downloadFile } = fixture();
    await expect(seal.inspectAndSeal({ ...input, stagingFileId: `cloud://foreign.bucket/${stagingPath}` }))
      .rejects.toMatchObject({ code: 'MEDIA_INVALID' });
    await expect(seal.inspectAndSeal({ ...input, stagingFileId: 'cloud://demo-env.bucket/other.mp3' }))
      .rejects.toMatchObject({ code: 'MEDIA_INVALID' });
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('keeps storage read failures retryable and rejects oversized, unrecognized or overlong audio', async () => {
    const unreadable = fixture();
    unreadable.downloadFile.mockResolvedValueOnce({ fileContent: undefined });
    await expect(unreadable.seal.inspectAndSeal(input)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    const failedDownload = fixture();
    failedDownload.downloadFile.mockRejectedValueOnce(new Error('temporary storage failure'));
    await expect(failedDownload.seal.inspectAndSeal(input)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    const oversized = fixture();
    oversized.downloadFile.mockResolvedValueOnce({ fileContent: Buffer.alloc(20 * 1024 * 1024 + 1) });
    await expect(oversized.seal.inspectAndSeal(input)).rejects.toMatchObject({ code: 'MEDIA_INVALID' });
    const wrongCodec = fixture({ async read() { return { durationSeconds: 12, codec: 'FLAC' }; } });
    await expect(wrongCodec.seal.inspectAndSeal(input)).rejects.toMatchObject({ code: 'MEDIA_INVALID' });
    const long = fixture({ async read() { return { durationSeconds: 301, codec: 'MPEG 1 Layer 3' }; } });
    await expect(long.seal.inspectAndSeal(input)).rejects.toMatchObject({ code: 'MEDIA_INVALID' });
  });

  it('accepts verified AAC audio with an extension matching the actual container', async () => {
    const adts = fixture({ async read() { return { durationSeconds: 12, codec: 'AAC', container: 'ADTS' }; } });
    expect(await adts.seal.inspectAndSeal(input)).toMatchObject({ codec: 'aac', durationMs: 12_000,
      fileId: expect.stringMatching(/\.aac$/) });
    const mp4 = fixture({ async read() { return { durationSeconds: 12, codec: 'AAC', container: 'MPEG-4' }; } });
    expect(await mp4.seal.inspectAndSeal(input)).toMatchObject({ codec: 'aac',
      fileId: expect.stringMatching(/\.m4a$/) });
  });

  it('rejects a provider result that does not point to the verified private path', async () => {
    const { seal, uploadFile } = fixture();
    uploadFile.mockResolvedValueOnce({ fileID: 'cloud://demo-env.bucket/other-user.mp3' });
    await expect(seal.inspectAndSeal(input)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});
