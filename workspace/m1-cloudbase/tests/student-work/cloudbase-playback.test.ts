import { describe, expect, it, vi } from 'vitest';
import { CloudBaseWorkPlayback, type CloudBasePlaybackSdkPort } from '../../src/student-work/cloudbase-playback';

const fileId = 'cloud://demo-env.bucket/student-works/private/demo/work.mp3';

describe('M2 private work playback', () => {
  it('requests a short-lived URL for exactly the authorized file', async () => {
    const getTempFileURL = vi.fn<CloudBasePlaybackSdkPort['getTempFileURL']>(async () => ({
      fileList: [{ fileID: fileId, tempFileURL: 'https://example.test/private.mp3', code: 'SUCCESS' }],
    }));
    expect(await new CloudBaseWorkPlayback({ getTempFileURL }).temporaryUrl(fileId))
      .toBe('https://example.test/private.mp3');
    expect(getTempFileURL).toHaveBeenCalledWith({ fileList: [{ fileID: fileId, maxAge: 60 }] });
  });
  it('fails closed on mismatched, failed or insecure provider results', async () => {
    for (const fileList of [
      [{ fileID: 'cloud://other/file.mp3', tempFileURL: 'https://example.test/other.mp3' }],
      [{ fileID: fileId, tempFileURL: 'https://example.test/file.mp3', code: 'FAILED' }],
      [{ fileID: fileId, tempFileURL: 'http://example.test/file.mp3', code: 'SUCCESS' }],
    ]) {
      const playback = new CloudBaseWorkPlayback({ async getTempFileURL() { return { fileList }; } });
      await expect(playback.temporaryUrl(fileId)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    }
  });
});
