import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DirectMp4PrivateVideoProcessor, inspectDirectMp4 } from '../../src/teacher-media/direct-mp4-processor';

function box(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, body]);
}

function sample(durationSeconds = 10, videoFormat = 'avc1'): Buffer {
  const mvhd = Buffer.alloc(20);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(durationSeconds * 1000, 16);
  const hdlr = Buffer.alloc(12);
  hdlr.write('vide', 8, 'ascii');
  const stsd = Buffer.alloc(8);
  stsd.writeUInt32BE(1, 4);
  const trak = box('trak', box('mdia', Buffer.concat([
    box('mdhd', mvhd), box('hdlr', hdlr), box('minf', box('stbl', box('stsd', Buffer.concat([
      stsd, box(videoFormat, Buffer.concat([Buffer.alloc(78), box('avcC', Buffer.alloc(7))])),
    ])))),
  ])));
  return Buffer.concat([box('ftyp', Buffer.from('isom0000', 'ascii')),
    box('mdat', Buffer.from('test-video-data')), box('moov', Buffer.concat([box('mvhd', mvhd), trak]))]);
}

describe('direct teacher MP4 acceptance', () => {
  it('accepts a real locally prepared teaching MP4', async () => {
    const bytes = await readFile(resolve(import.meta.dirname,
      '../../../m2-acceptance/2026-09-29/assets/zoo-friends-demo.mp4'));
    expect(inspectDirectMp4(bytes).durationMs).toBeGreaterThan(1000);
    const narrated = await readFile(resolve(import.meta.dirname,
      '../../../m3-real-samples/2026-09-30/review-bundle/dubbing_video/narrated_video.mp4'));
    expect(inspectDirectMp4(narrated).audioCodec).toBe('aac');
  });
  it('checks actual MP4 bytes and seals an immutable copy', async () => {
    const original = sample();
    expect(inspectDirectMp4(original)).toEqual({ durationMs: 10_000,
      videoCodec: 'h264', audioCodec: 'none' });
    const path = `teacher-videos/staging/org_demo/teacher_demo/teacher_video_${'a'.repeat(32)}/${'b'.repeat(32)}.mp4`;
    let sealed: Buffer | null = null;
    const processor = new DirectMp4PrivateVideoProcessor({
      async downloadFile() { return { fileContent: original }; },
      async uploadFile({ cloudPath, fileContent }) {
        sealed = Buffer.from(fileContent);
        return { fileID: `cloud://env_demo/${cloudPath}` };
      },
    }, 'env_demo');
    const result = await processor.process(`cloud://env_demo/${path}`, path);
    expect(result.mediaAssetKey).toContain('teacher-videos/private/');
    expect(result.directUploadEvidence).toMatchObject({ durationMs: 10_000,
      videoCodec: 'h264', mediaAssetKey: result.mediaAssetKey });
    expect(sealed).toEqual(original);
    await expect(processor.process(`cloud://other/${path}`, path))
      .rejects.toMatchObject({ code: 'MEDIA_INVALID' });
  });

  it('rejects malformed, unsupported, and overlong files', () => {
    expect(() => inspectDirectMp4(Buffer.from('not a video'))).toThrow();
    expect(() => inspectDirectMp4(sample(10, 'hev1'))).toThrow();
    expect(() => inspectDirectMp4(sample(601))).toThrow();
  });
});
