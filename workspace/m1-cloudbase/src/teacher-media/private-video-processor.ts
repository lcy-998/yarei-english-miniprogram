import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { CloudBaseWorkStoragePort } from '../student-work/cloudbase-recording-seal';
import { PRIVATE_VIDEO_MAX_DURATION_MS, PrivateVideoError,
  type PrivateVideoProcessed, type PrivateVideoProcessor } from './private-video';

const exec = promisify(execFile);
const MAX_BYTES = 200 * 1024 * 1024;

export interface PrivateVideoBinaries {
  readonly clamScan: string;
  readonly ffmpeg: string;
  readonly ffprobe: string;
}

/** Real byte scan -> normalize -> output scan. Missing binaries always fail closed. */
export class CloudBasePrivateVideoProcessor implements PrivateVideoProcessor {
  constructor(private readonly storage: CloudBaseWorkStoragePort,
    private readonly environmentId: string,
    private readonly binaries: PrivateVideoBinaries) {}

  async process(stagingFileId: string, stagingPath: string): Promise<PrivateVideoProcessed> {
    const match = /^cloud:\/\/([^/]+)\/(.+)$/.exec(stagingFileId);
    if (!this.environmentId || !match
      || (match[1] !== this.environmentId && !match[1]?.startsWith(`${this.environmentId}.`))
      || match[2] !== stagingPath
      || !/^teacher-videos\/staging\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[a-f0-9]{32}\.mp4$/.test(stagingPath)
      || !this.binaries.clamScan || !this.binaries.ffmpeg || !this.binaries.ffprobe) {
      throw new PrivateVideoError('SERVICE_UNAVAILABLE');
    }
    const folder = await mkdtemp(join(tmpdir(), 'teacher-video-'));
    try {
      const source = join(folder, 'source');
      const output = join(folder, 'normalized.mp4');
      const downloaded = await this.storage.downloadFile({ fileID: stagingFileId });
      if (!Buffer.isBuffer(downloaded.fileContent)
        || downloaded.fileContent.length < 1 || downloaded.fileContent.length > MAX_BYTES) {
        throw new PrivateVideoError('MEDIA_INVALID');
      }
      await writeFile(source, downloaded.fileContent);
      const sourceHash = createHash('sha256').update(downloaded.fileContent).digest('hex');
      const version = (await this.run(this.binaries.clamScan, ['--version'])).stdout.trim();
      const sourceReport = await this.scan(source);
      const sourceScannedAt = new Date().toISOString();
      const inspected = await this.run(this.binaries.ffprobe,
        ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,pix_fmt',
          '-of', 'json', source]);
      const metadata = JSON.parse(inspected.stdout) as { format?: { duration?: string };
        streams?: Array<{ codec_type?: string; codec_name?: string; pix_fmt?: string }> };
      const duration = Number(metadata.format?.duration);
      if (!Number.isFinite(duration) || duration < 1
        || duration * 1000 > PRIVATE_VIDEO_MAX_DURATION_MS) throw new PrivateVideoError('MEDIA_INVALID');
      const video = metadata.streams?.find(stream => stream.codec_type === 'video');
      const audio = metadata.streams?.find(stream => stream.codec_type === 'audio');
      if (!video) throw new PrivateVideoError('MEDIA_INVALID');
      const copy = video.codec_name === 'h264' && video.pix_fmt === 'yuv420p'
        && (!audio || audio.codec_name === 'aac');
      await this.run(this.binaries.ffmpeg, ['-nostdin', '-y', '-i', source,
        '-map', '0:v:0', '-map', '0:a:0?',
        ...(copy ? ['-c', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast',
          '-pix_fmt', 'yuv420p', '-b:v', '2200k', '-maxrate', '2600k', '-bufsize', '5200k',
          '-c:a', 'aac', '-b:a', '128k']),
        '-movflags', '+faststart', output], 480_000);
      const transcodedAt = new Date().toISOString();
      const finalProbe = await this.run(this.binaries.ffprobe,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', output]);
      const finalDuration = Number((JSON.parse(finalProbe.stdout) as { format?: { duration?: string } }).format?.duration);
      if (!Number.isFinite(finalDuration) || finalDuration < 1
        || finalDuration * 1000 > PRIVATE_VIDEO_MAX_DURATION_MS) throw new PrivateVideoError('MEDIA_INVALID');
      const outputInfo = await stat(output);
      if (outputInfo.size < 1 || outputInfo.size > MAX_BYTES) throw new PrivateVideoError('MEDIA_INVALID');
      const finalReport = await this.scan(output);
      const outputScannedAt = new Date().toISOString();
      const bytes = await readFile(output);
      const outputHash = createHash('sha256').update(bytes).digest('hex');
      const privatePath = `teacher-videos/private/${createHash('sha256').update(stagingPath).digest('hex')}/${outputHash}.mp4`;
      const uploaded = await this.storage.uploadFile({ cloudPath: privatePath, fileContent: bytes });
      const uploadedMatch = /^cloud:\/\/([^/]+)\/(.+)$/.exec(uploaded.fileID);
      if (!uploadedMatch || (uploadedMatch[1] !== this.environmentId
        && !uploadedMatch[1]?.startsWith(`${this.environmentId}.`))
        || uploadedMatch[2] !== privatePath) throw new PrivateVideoError('SERVICE_UNAVAILABLE');
      return { mediaAssetKey: uploaded.fileID, mediaSha256: outputHash,
        durationMs: Math.round(finalDuration * 1000),
        sourceScanEvidence: { engine: 'clamav', signatureVersion: version,
          scannedAt: sourceScannedAt, scannedSha256: sourceHash,
          reportId: createHash('sha256').update(sourceReport).digest('hex') },
        transcodeEvidence: { engine: 'ffmpeg', engineVersion: (await this.run(this.binaries.ffmpeg, ['-version'])).stdout.split('\n')[0] ?? 'ffmpeg',
          transcodedAt, sourceSha256: sourceHash, outputSha256: outputHash,
          outputAssetKey: uploaded.fileID },
        scanEvidence: { engine: 'clamav', signatureVersion: version,
          scannedAt: outputScannedAt, scannedSha256: outputHash,
          reportId: createHash('sha256').update(finalReport).digest('hex') } };
    } catch (error: unknown) {
      if (error instanceof PrivateVideoError) throw error;
      throw new PrivateVideoError('SERVICE_UNAVAILABLE');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  private async scan(path: string): Promise<string> {
    try {
      const result = await exec(this.binaries.clamScan, ['--no-summary', path],
        { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
      if (!result.stdout.includes('OK')) throw new PrivateVideoError('MEDIA_INVALID');
      return result.stdout;
    } catch (error: unknown) {
      if (error instanceof PrivateVideoError) throw error;
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 1) {
        throw new PrivateVideoError('MEDIA_INVALID');
      }
      throw new PrivateVideoError('SERVICE_UNAVAILABLE');
    }
  }

  private async run(binary: string, args: string[], timeout = 30_000): Promise<{ stdout: string; stderr: string }> {
    try { return await exec(binary, args, { timeout, maxBuffer: 2 * 1024 * 1024 }); }
    catch { throw new PrivateVideoError('SERVICE_UNAVAILABLE'); }
  }
}
