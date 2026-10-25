import { Readable } from 'node:stream';
import WebmDemuxer from 'prism-media/src/opus/WebmDemuxer';
import { OpusDecoder } from 'opus-decoder';
import encodeMp3 from '@audio/encode-mp3';

const MAX_DURATION_MS = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export interface NormalizedAudio {
  readonly buffer: Buffer;
  readonly durationMs: number;
}

/** Normalize the WebM/Opus bytes returned by some recorder implementations to the MP3 media baseline. */
export async function transcodeWebmOpusToMp3(input: Buffer, channels: 1 | 2): Promise<NormalizedAudio> {
  const demuxer = new WebmDemuxer();
  const decoder = new OpusDecoder({ channels, sampleRate: 48000 });
  await decoder.ready;
  const encoder = await encodeMp3({ sampleRate: 48000, channels, bitrate: 64 });
  const output: Buffer[] = [];
  let samples = 0;
  let outputBytes = 0;
  let packets = 0;
  try {
    Readable.from([input]).pipe(demuxer);
    for await (const value of demuxer) {
      if (!Buffer.isBuffer(value) || value.length === 0) throw new Error('INVALID_OPUS_PACKET');
      const frame = decoder.decodeFrame(value);
      if (frame.errors.length > 0 || frame.channelData.length !== channels || frame.samplesDecoded < 1) {
        throw new Error('INVALID_OPUS_FRAME');
      }
      samples += frame.samplesDecoded;
      packets += 1;
      if (Math.round(samples / 48) > MAX_DURATION_MS) throw new Error('AUDIO_TOO_LONG');
      const chunk = Buffer.from(encoder.encode(frame.channelData));
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) throw new Error('AUDIO_TOO_LARGE');
      output.push(chunk);
    }
    if (packets === 0 || samples < 48000) throw new Error('AUDIO_TOO_SHORT');
    const tail = Buffer.from(encoder.flush());
    outputBytes += tail.length;
    if (outputBytes > MAX_OUTPUT_BYTES) throw new Error('AUDIO_TOO_LARGE');
    output.push(tail);
    const buffer = Buffer.concat(output, outputBytes);
    const head = encoder.head?.();
    if (head && head.length <= buffer.length) Buffer.from(head).copy(buffer, 0);
    return { buffer, durationMs: Math.round(samples / 48) };
  } finally {
    demuxer.destroy();
    decoder.free();
    encoder.free();
  }
}
