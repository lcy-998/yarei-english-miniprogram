import { createHash, createHmac } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import type { AudioMetadataReader, CloudBaseWorkStoragePort } from '../student-work/cloudbase-recording-seal';
import { transcodeWebmOpusToMp3, type NormalizedAudio } from '../task-recording/webm-opus-transcode';
import type { CloudBasePlaybackSdkPort } from '../student-work/cloudbase-playback';
import type { PronunciationInferencePort, PronunciationPlaybackPort, PronunciationSealPort } from './repository';
import type { PronunciationPrivateMediaPort } from './long-inference-adapter';
import { PronunciationError, type RecognitionResult } from './types';

export interface CloudBaseVoiceInvokePort {
  callFunction(input: Readonly<{ name: string; data: Record<string, unknown>; parse: true }>): Promise<Readonly<{ result?: unknown }>>;
}

const defaultAudioMetadataReader: AudioMetadataReader = {
  async read(buffer) {
    const metadata = await parseBuffer(buffer, { size: buffer.length }, { duration: true, skipCovers: true });
    return { durationSeconds: metadata.format.duration ?? null, codec: metadata.format.codec ?? null,
      container: metadata.format.container ?? null, numberOfChannels: metadata.format.numberOfChannels ?? null };
  },
};

function cloudPath(fileId: string, environmentId: string): string | null {
  const match = /^cloud:\/\/([^/]+)\/(.+)$/.exec(fileId);
  return match && (match[1] === environmentId || match[1]?.startsWith(`${environmentId}.`))
    ? match[2] ?? null : null;
}

export class CloudBasePronunciationSeal implements PronunciationSealPort {
  public constructor(private readonly storage: CloudBaseWorkStoragePort,
    private readonly environmentId: string,
    private readonly metadataReader: AudioMetadataReader = defaultAudioMetadataReader,
    private readonly transcodeWebm: (buffer: Buffer, channels: 1 | 2) => Promise<NormalizedAudio>
      = transcodeWebmOpusToMp3) {}
  public async seal(input: Readonly<{ stagingFileId: string; stagingPath: string;
    organizationId: string; studentId: string; recordingId: string }>) {
    const ownerDigest = createHash('sha256').update(JSON.stringify([input.organizationId, input.studentId])).digest('hex');
    if (!this.environmentId || cloudPath(input.stagingFileId, this.environmentId) !== input.stagingPath
      || input.stagingPath !== `pronunciation/staging/${ownerDigest}/${input.recordingId}.mp3`) {
      throw new PronunciationError('MEDIA_INVALID');
    }
    let buffer: Buffer;
    try {
      const downloaded = await this.storage.downloadFile({ fileID: input.stagingFileId });
      if (!Buffer.isBuffer(downloaded.fileContent)) throw new Error('download unavailable');
      buffer = downloaded.fileContent;
    } catch { throw new PronunciationError('SERVICE_UNAVAILABLE'); }
    if (buffer.length < 1 || buffer.length > 20 * 1024 * 1024) throw new PronunciationError('MEDIA_INVALID');
    let metadata: Awaited<ReturnType<AudioMetadataReader['read']>>;
    try {
      metadata = await this.metadataReader.read(buffer);
    } catch { throw new PronunciationError('MEDIA_INVALID'); }
    const codec = metadata.codec?.toLowerCase() ?? '';
    const container = metadata.container?.toLowerCase() ?? '';
    let durationMs = metadata.durationSeconds === null ? NaN : Math.round(metadata.durationSeconds * 1000);
    const ebml = buffer.length >= 4 && buffer.readUInt32BE(0) === 0x1a45dfa3;
    if ((codec.includes('opus') || (ebml && !codec))
      && (ebml || container.includes('webm') || container.includes('ebml')
        || container.includes('matroska'))) {
      if (metadata.numberOfChannels !== 1 && metadata.numberOfChannels !== 2) {
        throw new PronunciationError('MEDIA_INVALID');
      }
      try {
        const normalized = await this.transcodeWebm(buffer, metadata.numberOfChannels);
        buffer = normalized.buffer;
        durationMs = normalized.durationMs;
      } catch { throw new PronunciationError('MEDIA_INVALID'); }
    } else if (!codec.includes('mp3') && !codec.includes('layer 3')) {
      throw new PronunciationError('MEDIA_INVALID');
    }
    if (buffer.length < 1 || buffer.length > 20 * 1024 * 1024
      || !Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 300000) {
      throw new PronunciationError('MEDIA_INVALID');
    }
    const contentSha256 = createHash('sha256').update(buffer).digest('hex');
    const path = `pronunciation/private/${ownerDigest}/${input.recordingId}/${contentSha256}.mp3`;
    try {
      const uploaded = await this.storage.uploadFile({ cloudPath: path, fileContent: buffer });
      if (cloudPath(uploaded.fileID, this.environmentId) !== path) throw new Error('invalid destination');
      return { fileId: uploaded.fileID, contentSha256, sizeBytes: buffer.length, durationMs };
    } catch { throw new PronunciationError('SERVICE_UNAVAILABLE'); }
  }
}

export class CloudBasePronunciationPlayback implements PronunciationPlaybackPort {
  public constructor(private readonly storage: CloudBasePlaybackSdkPort) {}
  public async temporaryUrl(fileId: string): Promise<string> {
    const result = await this.storage.getTempFileURL({ fileList: [{ fileID: fileId, maxAge: 60 }] });
    const entry = result.fileList?.find(item => item.fileID === fileId);
    if (!entry?.tempFileURL || (entry.code !== undefined && entry.code !== 'SUCCESS')
      || !entry.tempFileURL.startsWith('https://')) throw new PronunciationError('SERVICE_UNAVAILABLE');
    return entry.tempFileURL;
  }
}

/** Longer private capability for an internal 1s–5min inference job only. */
export class CloudBasePronunciationInferenceMedia implements PronunciationPrivateMediaPort {
  public constructor(private readonly storage: CloudBasePlaybackSdkPort) {}
  public async temporaryUrl(fileId: string): Promise<string> {
    // Legacy maxAge is compatibility-only for classic CloudBase storage.
    const result = await this.storage.getTempFileURL({ fileList: [{ fileID: fileId, maxAge: 360000 }] });
    const entry = result.fileList?.find(item => item.fileID === fileId);
    if (!entry?.tempFileURL || (entry.code !== undefined && entry.code !== 'SUCCESS')
      || !entry.tempFileURL.startsWith('https://')) throw new PronunciationError('SERVICE_UNAVAILABLE');
    return entry.tempFileURL;
  }
}

function validRecognition(value: unknown): value is RecognitionResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.modelVersion === 'string' && Number.isSafeInteger(record.durationMs)
    && Array.isArray(record.words) && record.words.length <= 2000
    && record.words.every(item => item !== null && typeof item === 'object' && !Array.isArray(item)
      && typeof item.word === 'string' && item.word.length <= 100
      && typeof item.start === 'number' && typeof item.end === 'number'
      && typeof item.confidence === 'number');
}

export class CloudBasePronunciationInference implements PronunciationInferencePort {
  public constructor(private readonly invoker: CloudBaseVoiceInvokePort,
    private readonly playback: PronunciationPlaybackPort,
    private readonly internalSecret: string,
    private readonly attemptTimeoutMs: number) {}

  public async infer(input: Readonly<{ operationId: string; recordingId: string; fileId: string;
    contentSha256: string; sizeBytes: number; durationMs: number }>): Promise<RecognitionResult> {
    if (this.internalSecret.length < 32 || !Number.isSafeInteger(this.attemptTimeoutMs)
      || this.attemptTimeoutMs < 1000 || this.attemptTimeoutMs > 900000) {
      throw new PronunciationError('SERVICE_UNAVAILABLE');
    }
    const url = await this.playback.temporaryUrl(input.fileId);
    const job = { operationId: input.operationId, recordingId: input.recordingId,
      fileUrl: url, sha256: input.contentSha256, sizeBytes: input.sizeBytes,
      durationMs: input.durationMs };
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `${timestamp}\n${JSON.stringify(Object.fromEntries(Object.entries(job).sort(([a], [b]) => a.localeCompare(b))))}`;
    const signature = createHmac('sha256', this.internalSecret).update(message).digest('hex');
    const event = { job, timestamp, signature };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await new Promise<Readonly<{ result?: unknown }>>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), this.attemptTimeoutMs);
          this.invoker.callFunction({ name: 'pronunciation-inference', data: event, parse: true })
            .then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
        });
        const result = typeof response.result === 'string' && response.result.length <= 200000
          ? JSON.parse(response.result) as unknown : response.result;
        if (result === null || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid result');
        const body = result as Record<string, unknown>;
        if (body.ok === true && validRecognition(body.result)) return body.result;
        if (body.code === 'MEDIA_INVALID') throw new PronunciationError('MEDIA_INVALID');
      } catch (error: unknown) {
        if (error instanceof PronunciationError && error.code === 'MEDIA_INVALID') throw error;
      }
    }
    throw new PronunciationError('SERVICE_UNAVAILABLE');
  }
}
