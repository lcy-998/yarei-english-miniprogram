import { describe, expect, it } from 'vitest';
import { CloudBaseRetentionStorage } from '../../src/media-retention/cloudbase-storage';

describe('CloudBase retention deletion receipt', () => {
  const fileId = 'cloud://test-env/task-recordings/private/owner/record/hash.mp3';

  it('accepts only a matching single SUCCESS receipt', async () => {
    const calls: string[][] = [];
    const storage = new CloudBaseRetentionStorage({ async deleteFile(input) {
      calls.push([...input.fileList]);
      return { fileList: [{ fileID: fileId, code: 'SUCCESS' }] };
    } });
    expect(await storage.deleteFile(fileId)).toBe('deleted');
    expect(calls).toEqual([[fileId]]);
  });

  it('fails closed on a mismatched or unrecognized receipt', async () => {
    const storage = new CloudBaseRetentionStorage({ async deleteFile() {
      return { fileList: [{ fileID: 'cloud://other-env/file.mp3', code: 'SUCCESS' }] };
    } });
    await expect(storage.deleteFile(fileId)).rejects.toThrow('mismatch');
    const unknown = new CloudBaseRetentionStorage({ async deleteFile() {
      return { fileList: [{ fileID: fileId, code: 'UNKNOWN' }] };
    } });
    await expect(unknown.deleteFile(fileId)).rejects.toThrow('unconfirmed');
  });

  it('treats the verified absent-object code as an idempotent retry', async () => {
    const storage = new CloudBaseRetentionStorage({ async deleteFile() {
      return { fileList: [{ fileID: fileId, code: 'STORAGE_FILE_NONEXIST' }] };
    } });
    expect(await storage.deleteFile(fileId)).toBe('not_found');
  });
});
