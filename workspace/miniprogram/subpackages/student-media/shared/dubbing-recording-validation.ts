const MIN_DURATION_MS = 1000
const MAX_DURATION_MS = 300000
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024

export function recordingMediaIssue(durationMs: number, fileSize: number, filePath: string): string {
  if (!filePath || !Number.isFinite(fileSize) || fileSize <= 0) return '录音文件无效，请重新录制'
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '录音时长无效，请重新录制'
  if (durationMs < MIN_DURATION_MS) return '录音不足 1 秒，请重新录制'
  if (durationMs > MAX_DURATION_MS) return '录音超过 5 分钟，请重新录制'
  if (fileSize > MAX_FILE_SIZE_BYTES) return '录音文件超过 20 MB，请重新录制'
  return ''
}

export const dubbingRecordingIssue = recordingMediaIssue
