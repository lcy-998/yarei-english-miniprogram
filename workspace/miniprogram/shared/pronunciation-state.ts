import type { PronunciationScoreView, PronunciationSource } from '../services/student-pronunciation-service'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function pronunciationSourceFromOptions(options: Readonly<Record<string, string>>): PronunciationSource | null {
  const segmentId = options.segmentId
  if (!segmentId || !SAFE_ID.test(segmentId)) return null
  if (options.kind === 'reading' && options.resourceId && SAFE_ID.test(options.resourceId)) {
    return { kind: 'reading', resourceId: options.resourceId, segmentId }
  }
  if (options.kind === 'task' && options.taskId && SAFE_ID.test(options.taskId)
    && options.itemId && SAFE_ID.test(options.itemId)) {
    return { kind: 'task', taskId: options.taskId, itemId: options.itemId, segmentId }
  }
  return null
}

export function scoreDisplay(view: PronunciationScoreView, sourceKind?: PronunciationSource['kind']): Readonly<{
  statusLabel: string
  showScore: boolean
  message: string
}> {
  if (view.experimental !== true) return { statusLabel: '结果待核对', showScore: false,
    message: '评分状态暂不可核对，请稍后刷新。' }
  if (view.status === 'processing') return { statusLabel: '试验评分中', showScore: false,
    message: '录音已保留，正在生成试验性结果。' }
  if (view.status === 'draft' || view.status === 'sealed') return { statusLabel: '待请求试验评分',
    showScore: false, message: '录音已保留，可继续请求评分。' }
  if (view.status === 'unreliable') return { statusLabel: view.qualityReason === 'INCOMPLETE' ? '识别内容不足'
    : view.qualityReason === 'NO_SPEECH' ? '未识别到清晰语音'
      : view.qualityReason === 'LOW_CONFIDENCE' ? '语音不够清晰' : '暂无法可靠评分', showScore: false,
    message: view.qualityReason === 'NO_SPEECH' ? '没有识别到清晰语音，请靠近麦克风并完整重读。'
      : view.qualityReason === 'INCOMPLETE' ? '识别到的原文不足一半，请读完整句子后再录一次。'
        : view.qualityReason === 'LOW_CONFIDENCE' ? '录音声音不够清晰，请在安静环境中重录。'
          : '暂时无法可靠评分，请在安静环境中完整重读。' }
  if (view.status === 'failed') return { statusLabel: '试验评分失败', showScore: false,
    message: view.retryable ? '录音已保留，可用同一录音重试。'
      : sourceKind === 'reading' ? '本次录音暂无法评分，请重新录制并评分；自主练习分数不记入历史。' : '此评分作业已结束，无法对该录音再次评分。' }
  const values = view.score && [view.score.total, view.score.pronunciation,
    view.score.fluency, view.score.completeness]
  if (!values || !values.every(value => Number.isInteger(value) && value >= 0 && value <= 100)) {
    return { statusLabel: '结果待核对', showScore: false,
      message: '评分结果不完整，请稍后刷新。' }
  }
  return { statusLabel: '试验性评分', showScore: true,
    message: '此分数仅供练习参考，暂不计入正式任务成绩或打卡。' }
}

export function recordingIssue(durationMs: number, sizeBytes: number, localPath: string): string {
  if (!localPath) return '录音文件暂不可用，请重新录制'
  if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 300000) {
    return '录音需在 1 秒至 5 分钟之间'
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 20971520) {
    return '录音文件需小于 20 MB'
  }
  return ''
}
