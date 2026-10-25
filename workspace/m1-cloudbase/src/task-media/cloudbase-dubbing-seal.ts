import { createHash } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import type { CloudBaseWorkStoragePort, AudioMetadataReader } from '../student-work/cloudbase-recording-seal';
import type { TaskDubbingWorkPort } from './dubbing-work-service';
import { transcodeWebmOpusToMp3 } from '../task-recording/webm-opus-transcode';

const metadataReader: AudioMetadataReader = { async read(buffer) {
  const parsed = await parseBuffer(buffer, { size: buffer.length }, { duration: true, skipCovers: true });
  return { durationSeconds: parsed.format.duration ?? null, codec: parsed.format.codec ?? null,
    container: parsed.format.container ?? null, numberOfChannels: parsed.format.numberOfChannels ?? null };
} };

export class CloudBaseTaskDubbingSeal implements Pick<TaskDubbingWorkPort, 'inspectAndSeal'> {
  public constructor(private readonly storage: CloudBaseWorkStoragePort,
    private readonly environmentId: string,
    private readonly metadata: AudioMetadataReader = metadataReader) {}

  public async inspectAndSeal(stagingPath: string, stagingFileId: string): Promise<Readonly<{
    fileId: string; contentSha256: string; durationMs: number; sizeBytes: number;
  }> | null> {
    if (!/^task-dubbing\/staging\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(stagingPath)
      || cloudPath(stagingFileId, this.environmentId) !== stagingPath) return null;
    let bytes: Buffer;
    try {
      const downloaded = await this.storage.downloadFile({ fileID: stagingFileId });
      if (!Buffer.isBuffer(downloaded.fileContent)) return null;
      bytes = downloaded.fileContent;
    } catch { return null; }
    if (bytes.length < 1 || bytes.length > 20 * 1024 * 1024) return null;
    let read: Awaited<ReturnType<AudioMetadataReader['read']>>;
    try { read = await this.metadata.read(bytes); }
    catch { return null; }
    const codec = read.codec?.toLowerCase() ?? '';
    const container = read.container?.toLowerCase() ?? '';
    let extension = codec.includes('mp3') || codec.includes('layer 3') ? 'mp3'
      : codec.includes('aac') ? 'aac' : null;
    let durationMs = read.durationSeconds === null ? NaN : Math.round(read.durationSeconds * 1000);
    if (codec === 'opus' && (container.includes('webm') || container.includes('ebml'))) {
      if (read.numberOfChannels !== 1 && read.numberOfChannels !== 2) return null;
      try {
        const converted = await transcodeWebmOpusToMp3(bytes, read.numberOfChannels);
        bytes = converted.buffer;
        durationMs = converted.durationMs;
        extension = 'mp3';
      } catch { return null; }
    }
    if (!extension || bytes.length < 1 || bytes.length > 20 * 1024 * 1024
      || !Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 300000) return null;
    const contentSha256 = createHash('sha256').update(bytes).digest('hex');
    const ownerDigest = createHash('sha256').update(stagingPath).digest('hex').slice(0, 32);
    const privatePath = `task-dubbing/private/${ownerDigest}/${contentSha256}.${extension}`;
    try {
      const uploaded = await this.storage.uploadFile({ cloudPath: privatePath, fileContent: bytes });
      return cloudPath(uploaded.fileID, this.environmentId) === privatePath
        ? { fileId: uploaded.fileID, contentSha256, durationMs, sizeBytes: bytes.length } : null;
    } catch { return null; }
  }
}

function cloudPath(fileId: string, environmentId: string): string | null {
  const match = /^cloud:\/\/([^/]+)\/(.+)$/.exec(fileId);
  return match && (match[1] === environmentId || match[1]?.startsWith(`${environmentId}.`))
    ? match[2] ?? null : null;
}
