import { createHash } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import type { CloudBaseWorkStoragePort, AudioMetadataReader } from '../student-work/cloudbase-recording-seal';
import type { TaskRecordingSealPort } from './repository';
import { TaskRecordingError } from './types';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DURATION_MS = 5 * 60 * 1000;
const metadataReader: AudioMetadataReader = { async read(buffer) {
  const parsed = await parseBuffer(buffer, { mimeType: 'audio/mpeg', size: buffer.length },
    { duration: true, skipCovers: true });
  return { durationSeconds: parsed.format.duration ?? null, codec: parsed.format.codec ?? null };
} };
function cloudPath(fileId: string, environmentId: string): string | null {
  const match = /^cloud:\/\/([^/]+)\/(.+)$/.exec(fileId);
  return match && (match[1] === environmentId || match[1]?.startsWith(`${environmentId}.`)) ? match[2] ?? null : null;
}
export class CloudBaseTaskRecordingSeal implements TaskRecordingSealPort {
  public constructor(private readonly storage: CloudBaseWorkStoragePort, private readonly environmentId: string,
    private readonly metadata: AudioMetadataReader = metadataReader) {}
  public async inspectAndSeal(input: Readonly<{ stagingFileId: string; stagingPath: string;
    organizationId: string; studentId: string; recordingId: string }>) {
    const ownerDigest = createHash('sha256').update(JSON.stringify([input.organizationId, input.studentId])).digest('hex');
    if (!this.environmentId.trim() || cloudPath(input.stagingFileId, this.environmentId) !== input.stagingPath
      || input.stagingPath !== `task-recordings/staging/${ownerDigest}/${input.recordingId}.mp3`
      || !/^[A-Za-z0-9_-]{8,128}$/.test(input.recordingId)) {
      throw new TaskRecordingError('MEDIA_INVALID');
    }
    let buffer: Buffer;
    try {
      const downloaded = await this.storage.downloadFile({ fileID: input.stagingFileId });
      if (!Buffer.isBuffer(downloaded.fileContent)) throw new TaskRecordingError('MEDIA_INVALID');
      buffer = downloaded.fileContent;
    } catch (error: unknown) {
      if (error instanceof TaskRecordingError) throw error;
      throw new TaskRecordingError('MEDIA_INVALID');
    }
    if (buffer.length < 1 || buffer.length > MAX_BYTES) throw new TaskRecordingError('MEDIA_INVALID');
    let parsed: Awaited<ReturnType<AudioMetadataReader['read']>>;
    try { parsed = await this.metadata.read(buffer); }
    catch { throw new TaskRecordingError('MEDIA_INVALID'); }
    const codec = parsed.codec?.toLowerCase() ?? '';
    const durationMs = parsed.durationSeconds === null ? NaN : Math.round(parsed.durationSeconds * 1000);
    if ((!codec.includes('mp3') && !codec.includes('layer 3'))
      || !Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > MAX_DURATION_MS) {
      throw new TaskRecordingError('MEDIA_INVALID');
    }
    const contentSha256 = createHash('sha256').update(buffer).digest('hex');
    const privatePath = `task-recordings/private/${ownerDigest}/${input.recordingId}/${contentSha256}.mp3`;
    try {
      const uploaded = await this.storage.uploadFile({ cloudPath: privatePath, fileContent: buffer });
      if (cloudPath(uploaded.fileID, this.environmentId) !== privatePath) throw new TaskRecordingError('SERVICE_UNAVAILABLE');
      return { fileId: uploaded.fileID, contentSha256, sizeBytes: buffer.length, durationMs, codec: 'mp3' as const };
    } catch (error: unknown) {
      if (error instanceof TaskRecordingError) throw error;
      throw new TaskRecordingError('SERVICE_UNAVAILABLE');
    }
  }
}
