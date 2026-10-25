import { describe, expect, it } from 'vitest'
import type { MyPronunciationWork } from '../miniprogram/services/cloudbase-app-service'
import { pronunciationWorkRow } from '../miniprogram/subpackages/student/my-works/pronunciation-work-view'

const work: MyPronunciationWork = {
  scoreId: 'score_1', recordingId: 'recording_1',
  source: { kind: 'reading', resourceId: 'book_1', segmentId: 'segment_1' },
  displayTitle: 'A Day at the Zoo', referencePreview: 'The lion sleeps.',
  status: 'scored', experimental: true,
  score: { total: 86, pronunciation: 88, fluency: 82, completeness: 90 },
  qualityReason: null, modelVersion: 'test', algorithmVersion: 'test',
  scoredAt: '2026-10-03T10:00:00+08:00', mediaExpired: null, playbackAvailable: true,
}

describe('S-12 pronunciation work projection', () => {
  it('keeps experimental score distinct and permits authorized audio when expiry is undecided', () => {
    expect(pronunciationWorkRow(work)).toMatchObject({ canPlay: true,
      statusLabel: '试验性评分', scoreLabel: '试验分 86（不计正式成绩）', mediaLabel: '' })
  })

  it('shows expiry only when the server confirms it and hides unreliable numeric scores', () => {
    expect(pronunciationWorkRow({ ...work, mediaExpired: true })).toMatchObject({ canPlay: false,
      mediaLabel: '录音已过保留期，结果记录仍保留' })
    expect(pronunciationWorkRow({ ...work, status: 'unreliable',
      score: null, qualityReason: '背景噪声过大' })).toMatchObject({ canPlay: true,
      statusLabel: '暂无法可靠评分', scoreLabel: '背景噪声过大' })
  })
})
