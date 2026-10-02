import { createHash } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import type { RecordingSealPort } from './repository';
import { StudentWorkError, type SealedRecording } from './types';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DURATION_MS = 5 * 60 * 1000;

export interface CloudBaseWorkStoragePort {
  downloadFile(input: Readonly<{ fileID: string }>): Promise<Readonly<{ fileContent?: string | Buffer }>>;
  uploadFile(input: Readonly<{ cloudPath: string; fileContent: Buffer }>): Promise<Readonly<{ fileID: string }>>;
}

export interface AudioMetadataReader {
  read(buffer: Buffer): Promise<Readonly<{ durationSeconds: number | null; codec: string | null;
    container?: string | null }>>;
}

const defaultMetadataReader: AudioMetadataReader = {
  async read(buffer) {
    const parsed = await parseBuffer(buffer, { size: buffer.length },
      { duration: true, skipCovers: true });
    return { durationSeconds: parsed.format.duration ?? null, codec: parsed.format.codec ?? null,
      container: parsed.format.container ?? null };
  },
};

function cloudPath(fileId: string, environmentId: string): string | null {
  const match = /^cloud:\/\/([^/]+)\/(.+)$/.exec(fileId);
  if (!match || (match[1] !== environmentId && !match[1]?.startsWith(`${environmentId}.`))) return null;
  return match[2] ?? null;
}

export class CloudBaseRecordingSeal implements RecordingSealPort {
  public constructor(private readonly storage: CloudBaseWorkStoragePort,
    private readonly environmentId: string,
    private readonly metadata: AudioMetadataReader = defaultMetadataReader) {}

  public async inspectAndSeal(input: Readonly<{ stagingFileId: string; stagingPath: string;
    organizationId: string; studentId: string; workId: string }>): Promise<SealedRecording> {
    if (!this.environmentId.trim() || cloudPath(input.stagingFileId, this.environmentId) !== input.stagingPath
      || !/^student-works\/staging\/[a-f0-9]+\/[A-Za-z0-9_-]+\.mp3$/.test(input.stagingPath)) {
      throw new StudentWorkError('MEDIA_INVALID');
    }
    let buffer: Buffer;
    try {
      const downloaded = await this.storage.downloadFile({ fileID: input.stagingFileId });
      if (!Buffer.isBuffer(downloaded.fileContent)) throw new StudentWorkError('SERVICE_UNAVAILABLE');
      buffer = downloaded.fileContent;
    } catch (error: unknown) {
      if (error instanceof StudentWorkError) throw error;
      throw new StudentWorkError('SERVICE_UNAVAILABLE');
    }
    if (buffer.length < 1 || buffer.length > MAX_BYTES) throw new StudentWorkError('MEDIA_INVALID');
    let parsed: Awaited<ReturnType<AudioMetadataReader['read']>>;
    try { parsed = await this.metadata.read(buffer); }
    catch { throw new StudentWorkError('MEDIA_INVALID'); }
    const codec = parsed.codec?.toLowerCase() ?? '';
    const durationMs = parsed.durationSeconds === null ? NaN : Math.round(parsed.durationSeconds * 1000);
    const normalizedCodec = codec.includes('mp3') || codec.includes('layer 3') ? 'mp3'
      : codec.includes('aac') ? 'aac' : null;
    if (normalizedCodec === null) throw new StudentWorkError('MEDIA_INVALID');
    if (!Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > MAX_DURATION_MS) {
      throw new StudentWorkError('MEDIA_INVALID');
    }
    const contentSha256 = createHash('sha256').update(buffer).digest('hex');
    const ownerDigest = createHash('sha256').update(JSON.stringify([input.organizationId, input.studentId])).digest('hex');
    const container = parsed.container?.toLowerCase() ?? '';
    const extension = normalizedCodec === 'mp3' ? 'mp3'
      : container.includes('m4a') || container.includes('mp4') || container.includes('mpeg-4') ? 'm4a' : 'aac';
    const privatePath = `student-works/private/${ownerDigest}/${input.workId}/${contentSha256}.${extension}`;
    try {
      const uploaded = await this.storage.uploadFile({ cloudPath: privatePath, fileContent: buffer });
      if (cloudPath(uploaded.fileID, this.environmentId) !== privatePath) {
        throw new StudentWorkError('SERVICE_UNAVAILABLE');
      }
      return { fileId: uploaded.fileID, contentSha256, sizeBytes: buffer.length, durationMs,
        codec: normalizedCodec };
    } catch (error: unknown) {
      if (error instanceof StudentWorkError) throw error;
      throw new StudentWorkError('SERVICE_UNAVAILABLE');
    }
  }
}
