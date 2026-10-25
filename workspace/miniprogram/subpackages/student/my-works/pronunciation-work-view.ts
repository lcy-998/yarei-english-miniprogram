import type { MyPronunciationWork } from '../../../services/cloudbase-app-service'

export interface PronunciationWorkRow {
  id: string
  recordingId: string
  canPlay: boolean
  title: string
  referencePreview: string
  statusLabel: string
  scoreLabel: string
  timeLabel: string
  mediaLabel: string
  submissionLabel: string
  canRetry: boolean
  expectedVersion: number
}

export function pronunciationWorkRow(work: MyPronunciationWork): PronunciationWorkRow {
  const validScore = work.status === 'scored' && work.experimental === true && work.score
    && [work.score.total, work.score.pronunciation, work.score.fluency, work.score.completeness]
      .every(value => Number.isInteger(value) && value >= 0 && value <= 100)
  const statusLabel = work.status === 'scored' && validScore ? '试验性评分'
    : work.status === 'unreliable' ? '暂无法可靠评分'
      : work.status === 'processing' ? '试验评分处理中'
        : work.status === 'failed' ? '试验评分失败' : '录音已保留'
  return {
    id: work.scoreId, recordingId: work.recordingId,
    canPlay: work.playbackAvailable === true && work.mediaExpired !== true,
    title: work.displayTitle || '跟读练习',
    referencePreview: work.referencePreview,
    statusLabel,
    scoreLabel: validScore ? `试验分 ${work.score!.total}（不计正式成绩）`
      : work.status === 'unreliable' ? work.qualityReason || '本次没有可靠分数' : '无正式分数',
    timeLabel: work.scoredAt ? work.scoredAt.replace('T', ' ').slice(0, 16) : '评分时间未记录',
    mediaLabel: work.mediaExpired === true ? '录音已过保留期，结果记录仍保留'
      : work.playbackAvailable === false ? '当前暂无试听入口' : '',
    submissionLabel: work.submissionVersion === null ? '' : `第 ${work.submissionVersion} 次任务提交`,
    canRetry: work.retryable && work.mediaExpired !== true, expectedVersion: work.expectedVersion,
  }
}
