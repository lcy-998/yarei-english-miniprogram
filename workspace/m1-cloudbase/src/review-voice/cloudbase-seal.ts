import { createHash } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import type { CloudBaseWorkStoragePort, AudioMetadataReader } from '../student-work/cloudbase-recording-seal';
import { transcodeWebmOpusToMp3, type NormalizedAudio } from '../task-recording/webm-opus-transcode';
import type { ReviewVoicePort } from './service';

const defaultReader: AudioMetadataReader = { async read(buffer) {
  const parsed = await parseBuffer(buffer, { size: buffer.length }, { duration: true, skipCovers: true });
  return { durationSeconds: parsed.format.duration ?? null, codec: parsed.format.codec ?? null,
    container: parsed.format.container ?? null, numberOfChannels: parsed.format.numberOfChannels ?? null };
} };

/** Inspects exact teacher staging object and seals a versioned private MP3/AAC comment. */
export class CloudBaseReviewVoiceSeal implements Pick<ReviewVoicePort, 'inspectAndSeal'> {
  public constructor(private readonly storage: CloudBaseWorkStoragePort,
    private readonly environmentId: string,
    private readonly limits: Readonly<{ maxDurationMs: number; maxBytes: number }>,
    private readonly metadata: AudioMetadataReader = defaultReader,
    private readonly transcodeWebm: (input: Buffer, channels: 1 | 2) => Promise<NormalizedAudio>
      = transcodeWebmOpusToMp3) {}

  public async inspectAndSeal(stagingPath: string, stagingFileId: string): Promise<Readonly<{
    fileId: string; contentType: 'audio/mpeg' | 'audio/aac'; durationMs: number;
    sizeBytes: number; contentSha256: string;
  }> | null> {
    if (!/^review-voice\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(stagingPath)
      || cloudPath(stagingFileId, this.environmentId) !== stagingPath) return null;
    let buffer: Buffer;
    try {
      const downloaded = await this.storage.downloadFile({ fileID: stagingFileId });
      if (!Buffer.isBuffer(downloaded.fileContent)) return null;
      buffer = downloaded.fileContent;
    } catch { return null; }
    if (buffer.length < 1 || buffer.length > this.limits.maxBytes) return null;
    let metadata: Awaited<ReturnType<AudioMetadataReader['read']>>;
    try { metadata = await this.metadata.read(buffer); }
    catch { return null; }
    const codec = metadata.codec?.toLowerCase() ?? '';
    const container = metadata.container?.toLowerCase() ?? '';
    let contentType: 'audio/mpeg' | 'audio/aac' | null = codec.includes('mp3') || codec.includes('layer 3')
      ? 'audio/mpeg' : codec.includes('aac') ? 'audio/aac' : null;
    let durationMs = metadata.durationSeconds === null ? NaN : Math.round(metadata.durationSeconds * 1000);
    if (codec === 'opus' && (container.includes('webm') || container.includes('ebml'))) {
      if (metadata.numberOfChannels !== 1 && metadata.numberOfChannels !== 2) return null;
      try {
        const normalized = await this.transcodeWebm(buffer, metadata.numberOfChannels);
        buffer = normalized.buffer;
        durationMs = normalized.durationMs;
        contentType = 'audio/mpeg';
      } catch { return null; }
    }
    if (!contentType || buffer.length < 1 || buffer.length > this.limits.maxBytes
      || !Number.isSafeInteger(durationMs) || durationMs < 1000
      || durationMs > this.limits.maxDurationMs) return null;
    const contentSha256 = createHash('sha256').update(buffer).digest('hex');
    const scopeDigest = createHash('sha256').update(stagingPath).digest('hex').slice(0, 32);
    const extension = contentType === 'audio/mpeg' ? 'mp3' : 'aac';
    const privatePath = `review-voice/private/${scopeDigest}/${contentSha256}.${extension}`;
    try {
      const uploaded = await this.storage.uploadFile({ cloudPath: privatePath, fileContent: buffer });
      if (cloudPath(uploaded.fileID, this.environmentId) !== privatePath) return null;
      return { fileId: uploaded.fileID, contentType, durationMs,
        sizeBytes: buffer.length, contentSha256 };
    } catch { return null; }
  }
}

function cloudPath(fileId: string, environmentId: string): string | null {
  const match = /^cloud:\/\/([^/]+)\/(.+)$/.exec(fileId);
  return match && (match[1] === environmentId || match[1]?.startsWith(`${environmentId}.`))
    ? match[2] ?? null : null;
}
