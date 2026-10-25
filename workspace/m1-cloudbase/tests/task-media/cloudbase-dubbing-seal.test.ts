import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBuffer } from 'music-metadata';
import { CloudBaseTaskDubbingSeal } from '../../src/task-media/cloudbase-dubbing-seal';

const stagingPath = 'task-dubbing/staging/org_demo/student_demo/task_demo/item_demo/work_demo';
const stagingFileId = `cloud://demo-env.bucket/${stagingPath}`;
const webm = readFileSync(new URL('../task-recording/fixtures/synthetic-440hz-two-seconds.webm', import.meta.url));

describe('classroom dubbing audio seal', () => {
  it('converts simulator WebM/Opus to MP3 and preserves the server-checked duration', async () => {
    let saved: Buffer | null = null;
    const seal = new CloudBaseTaskDubbingSeal({
      downloadFile: async () => ({ fileContent: webm }),
      uploadFile: async ({ cloudPath, fileContent }) => {
        saved = fileContent;
        return { fileID: `cloud://demo-env.bucket/${cloudPath}` };
      },
    }, 'demo-env');
    const result = await seal.inspectAndSeal(stagingPath, stagingFileId);
    expect(result).toMatchObject({ durationMs: 2000,
      fileId: expect.stringMatching(/\.mp3$/) });
    expect(saved).not.toBeNull();
    const bytes = saved as Buffer | null;
    if (!bytes) throw new Error('converted audio missing');
    const metadata = await parseBuffer(bytes, { size: bytes.length }, { duration: true });
    expect(metadata.format.codec?.toLowerCase()).toContain('layer 3');
    expect(metadata.format.duration).toBeCloseTo(2, 1);
  });

  it('still rejects a different cloud environment before reading audio', async () => {
    let reads = 0;
    const seal = new CloudBaseTaskDubbingSeal({
      downloadFile: async () => { reads += 1; return { fileContent: webm }; },
      uploadFile: async () => { throw new Error('should not upload'); },
    }, 'demo-env');
    expect(await seal.inspectAndSeal(stagingPath, `cloud://other-env.bucket/${stagingPath}`)).toBeNull();
    expect(reads).toBe(0);
  });
});
