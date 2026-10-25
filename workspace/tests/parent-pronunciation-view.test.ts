import { describe, expect, it } from 'vitest'
import { parentPronunciationRows } from '../miniprogram/subpackages/parent/task-detail/parent-pronunciation-view'
import type { ParentPronunciationEvidence } from '../miniprogram/services/cloudbase-app-service'

describe('G-03 家长跟读记录投影', () => {
  it('只显示正式提交的状态和录音保留说明，不泄露试验分或私有地址', () => {
    const malicious = { segmentId: 'segment_demo', status: 'scored', experimental: true,
      sourceVersion: 'v1', submissionVersion: 1, modelVersion: 'vosk-demo', algorithmVersion: 'a1',
      scoredAt: '2026-10-03T00:00:00.000Z', qualityReason: null, score: { total: 92 },
      durationMs: 1500, mediaExpired: true, playback: { temporaryUrl: 'https://private.invalid/audio' },
      officialScoreAvailable: false, recordingId: 'private_recording' } as unknown as ParentPronunciationEvidence
    const rows = parentPronunciationRows([malicious])
    expect(rows).toEqual([{ segmentId: 'segment_demo', label: '跟读句段 1',
      detail: '已生成试验性结果，不计正式成绩',
      mediaNote: '原始录音已过保留期，提交与点评记录保留' }])
    expect(JSON.stringify(rows)).not.toMatch(/92|private\.invalid|private_recording|vosk-demo/)
  })
})
