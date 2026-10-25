import { createHash } from 'node:crypto';
import type { CloudBaseWorkStoragePort } from '../student-work/cloudbase-recording-seal';
import { PRIVATE_VIDEO_MAX_DURATION_MS, PrivateVideoError,
  type PrivateVideoProcessed, type PrivateVideoProcessor } from './private-video';

const MAX_BYTES = 200 * 1024 * 1024;
type Box = Readonly<{ type: string; start: number; end: number; body: number }>;

function boxes(bytes: Buffer, start: number, end: number): Box[] {
  const result: Box[] = [];
  for (let at = start; at + 8 <= end;) {
    let size = bytes.readUInt32BE(at);
    const type = bytes.toString('ascii', at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) throw new PrivateVideoError('MEDIA_INVALID');
      const extended = bytes.readBigUInt64BE(at + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new PrivateVideoError('MEDIA_INVALID');
      size = Number(extended); header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) throw new PrivateVideoError('MEDIA_INVALID');
    result.push({ type, start: at, body: at + header, end: at + size });
    at += size;
  }
  if (result.length === 0 || result[result.length - 1]!.end !== end) {
    throw new PrivateVideoError('MEDIA_INVALID');
  }
  return result;
}

function child(bytes: Buffer, parent: Box, type: string): Box | null {
  return boxes(bytes, parent.body, parent.end).find(box => box.type === type) ?? null;
}

function requireChild(bytes: Buffer, parent: Box, type: string): Box {
  const found = child(bytes, parent, type);
  if (!found) throw new PrivateVideoError('MEDIA_INVALID');
  return found;
}

function durationMs(bytes: Buffer, header: Box): number {
  const version = bytes[header.body];
  const scaleAt = header.body + (version === 1 ? 20 : 12);
  const ticksAt = header.body + (version === 1 ? 24 : 16);
  if ((version !== 0 && version !== 1) || ticksAt + (version === 1 ? 8 : 4) > header.end) {
    throw new PrivateVideoError('MEDIA_INVALID');
  }
  const scale = bytes.readUInt32BE(scaleAt);
  const ticks = version === 1 ? Number(bytes.readBigUInt64BE(ticksAt)) : bytes.readUInt32BE(ticksAt);
  const exactMs = ticks * 1000 / scale;
  const result = Math.round(exactMs);
  if (!scale || !Number.isSafeInteger(result) || exactMs < 1000
    || exactMs > PRIVATE_VIDEO_MAX_DURATION_MS) throw new PrivateVideoError('MEDIA_INVALID');
  return result;
}

function hasAacDecoderConfig(bytes: Buffer, esds: Box): boolean {
  // DecoderConfigDescriptor (tag 0x04) must name MPEG-4 Audio (object type 0x40).
  for (let at = esds.body + 4; at + 3 < esds.end; at++) {
    if (bytes[at] !== 0x04) continue;
    let length = 0;
    let sizeBytes = 0;
    do {
      sizeBytes++;
      const part = bytes[at + sizeBytes];
      if (part === undefined) break;
      length = (length << 7) | (part & 0x7f);
      if ((part & 0x80) === 0) break;
    } while (sizeBytes < 4);
    const objectAt = at + 1 + sizeBytes;
    if (length >= 1 && objectAt + length <= esds.end && bytes[objectAt] === 0x40) return true;
  }
  return false;
}

/** Only accepts ordinary self-contained MP4 with H.264 video and optional AAC audio. */
export function inspectDirectMp4(bytes: Buffer): Readonly<{
  durationMs: number; videoCodec: 'h264'; audioCodec: 'aac' | 'none' }> {
  if (bytes.length < 32 || bytes.length > MAX_BYTES) throw new PrivateVideoError('MEDIA_INVALID');
  const top = boxes(bytes, 0, bytes.length);
  if (top[0]?.type !== 'ftyp' || !top.some(box => box.type === 'mdat')
    || top.some(box => box.type === 'moof')) throw new PrivateVideoError('MEDIA_INVALID');
  const moov = top.find(box => box.type === 'moov');
  if (!moov) throw new PrivateVideoError('MEDIA_INVALID');
  const movieDurationMs = durationMs(bytes, requireChild(bytes, moov, 'mvhd'));
  let videoCount = 0;
  let audioCount = 0;
  for (const trak of boxes(bytes, moov.body, moov.end).filter(box => box.type === 'trak')) {
    const mdia = requireChild(bytes, trak, 'mdia');
    const hdlr = requireChild(bytes, mdia, 'hdlr');
    if (hdlr.body + 12 > hdlr.end) throw new PrivateVideoError('MEDIA_INVALID');
    const handler = bytes.toString('ascii', hdlr.body + 8, hdlr.body + 12);
    if (handler !== 'vide' && handler !== 'soun') continue;
    const trackDurationMs = durationMs(bytes, requireChild(bytes, mdia, 'mdhd'));
    if (Math.abs(trackDurationMs - movieDurationMs) > 1000) {
      throw new PrivateVideoError('MEDIA_INVALID');
    }
    const stsd = requireChild(bytes, requireChild(bytes,
      requireChild(bytes, mdia, 'minf'), 'stbl'), 'stsd');
    if (stsd.body + 16 > stsd.end || bytes.readUInt32BE(stsd.body + 4) !== 1) {
      throw new PrivateVideoError('MEDIA_INVALID');
    }
    const entries = boxes(bytes, stsd.body + 8, stsd.end);
    if (entries.length !== 1) throw new PrivateVideoError('MEDIA_INVALID');
    if (handler === 'vide') {
      videoCount++;
      if (entries[0]!.type !== 'avc1' || entries[0]!.body + 78 > entries[0]!.end
        || !boxes(bytes, entries[0]!.body + 78, entries[0]!.end)
          .some(box => box.type === 'avcC' && box.end - box.body >= 7)) {
        throw new PrivateVideoError('MEDIA_INVALID');
      }
    } else {
      audioCount++;
      if (entries[0]!.type !== 'mp4a' || entries[0]!.body + 28 > entries[0]!.end) {
        throw new PrivateVideoError('MEDIA_INVALID');
      }
      const esds = boxes(bytes, entries[0]!.body + 28, entries[0]!.end)
        .find(box => box.type === 'esds');
      if (!esds || !hasAacDecoderConfig(bytes, esds)) throw new PrivateVideoError('MEDIA_INVALID');
    }
  }
  if (videoCount !== 1 || audioCount > 1) throw new PrivateVideoError('MEDIA_INVALID');
  return { durationMs: movieDurationMs, videoCodec: 'h264', audioCodec: audioCount ? 'aac' : 'none' };
}

export class DirectMp4PrivateVideoProcessor implements PrivateVideoProcessor {
  constructor(private readonly storage: CloudBaseWorkStoragePort,
    private readonly environmentId: string) {}

  async process(stagingFileId: string, stagingPath: string): Promise<PrivateVideoProcessed> {
    const match = /^cloud:\/\/([^/]+)\/(.+)$/.exec(stagingFileId);
    if (!this.environmentId || !match
      || (match[1] !== this.environmentId && !match[1]?.startsWith(`${this.environmentId}.`))
      || match[2] !== stagingPath
      || !/^teacher-videos\/staging\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/teacher_video_[a-f0-9]{32}\/[a-f0-9]{32}\.mp4$/.test(stagingPath)) {
      throw new PrivateVideoError('MEDIA_INVALID');
    }
    let bytes: Buffer;
    try {
      const downloaded = await this.storage.downloadFile({ fileID: stagingFileId });
      if (!Buffer.isBuffer(downloaded.fileContent)) throw new PrivateVideoError('MEDIA_INVALID');
      bytes = downloaded.fileContent;
    } catch (error: unknown) {
      if (error instanceof PrivateVideoError) throw error;
      throw new PrivateVideoError('SERVICE_UNAVAILABLE');
    }
    const media = inspectDirectMp4(bytes);
    const mediaSha256 = createHash('sha256').update(bytes).digest('hex');
    const privatePath = `teacher-videos/private/${createHash('sha256').update(stagingPath).digest('hex')}/${mediaSha256}.mp4`;
    let uploaded: { fileID: string };
    try { uploaded = await this.storage.uploadFile({ cloudPath: privatePath, fileContent: bytes }); }
    catch { throw new PrivateVideoError('SERVICE_UNAVAILABLE'); }
    const output = /^cloud:\/\/([^/]+)\/(.+)$/.exec(uploaded.fileID);
    if (!output || (output[1] !== this.environmentId
      && !output[1]?.startsWith(`${this.environmentId}.`)) || output[2] !== privatePath) {
      throw new PrivateVideoError('SERVICE_UNAVAILABLE');
    }
    return { mediaAssetKey: uploaded.fileID, mediaSha256, durationMs: media.durationMs,
      directUploadEvidence: { verifiedAt: new Date().toISOString(), mediaSha256,
        mediaAssetKey: uploaded.fileID, durationMs: media.durationMs,
        videoCodec: media.videoCodec, audioCodec: media.audioCodec } };
  }
}
