import type { ParentPronunciationEvidence } from '../../../services/cloudbase-app-service'

export interface ParentPronunciationRow { segmentId: string; label: string; detail: string; mediaNote: string }

/** Deliberately omits trial scores, recording IDs and playback fields from page data. */
export function parentPronunciationRows(items: readonly ParentPronunciationEvidence[]): ParentPronunciationRow[] {
  return items.map((item, index) => ({ segmentId: item.segmentId, label: `跟读句段 ${index + 1}`,
    detail: item.status === 'scored' ? '已生成试验性结果，不计正式成绩'
      : item.status === 'unreliable' ? '暂无法可靠评分' : '结果未记录',
    mediaNote: item.mediaExpired ? '原始录音已过保留期，提交与点评记录保留'
      : item.durationMs === null ? '录音时长未记录' : `录音时长 ${Math.ceil(item.durationMs / 1000)} 秒` }))
}
