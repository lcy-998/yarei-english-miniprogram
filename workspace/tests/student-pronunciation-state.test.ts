import { describe, expect, it } from 'vitest'
import { pronunciationSourceFromOptions, recordingIssue, scoreDisplay } from '../miniprogram/shared/pronunciation-state'

describe('S-05 pronunciation state', () => {
  it('accepts only a complete source and never takes a client supplied score or reference', () => {
    expect(pronunciationSourceFromOptions({ kind: 'reading', resourceId: 'book_1', segmentId: 'sentence_2',
      referencePreview: 'forged', score: '100' })).toEqual({ kind: 'reading', resourceId: 'book_1', segmentId: 'sentence_2' })
    expect(pronunciationSourceFromOptions({ kind: 'task', taskId: 'task_1', itemId: 'item_2', segmentId: 'sentence_2' }))
      .toEqual({ kind: 'task', taskId: 'task_1', itemId: 'item_2', segmentId: 'sentence_2' })
    expect(pronunciationSourceFromOptions({ kind: 'task', taskId: 'task_1', segmentId: 'sentence_2' })).toBeNull()
    expect(pronunciationSourceFromOptions({ kind: 'reading', resourceId: '../book', segmentId: 'sentence_2' })).toBeNull()
  })

  it('keeps unreliable and failed results unscored', () => {
    expect(scoreDisplay({ scoreId: 'score_1', status: 'unreliable', experimental: true,
      qualityReason: 'INCOMPLETE' })).toEqual({ statusLabel: '识别内容不足', showScore: false,
        message: '识别到的原文不足一半，请读完整句子后再录一次。' })
    expect(scoreDisplay({ scoreId: 'score_1', status: 'failed', experimental: true }).showScore).toBe(false)
    expect(scoreDisplay({ scoreId: 'score_1', status: 'sealed', experimental: true }).showScore).toBe(false)
    expect(scoreDisplay({ scoreId: 'score_1', status: 'scored', experimental: true,
      score: { total: 86, pronunciation: 88, fluency: 82, completeness: 90 } }).showScore).toBe(true)
    expect(scoreDisplay({ scoreId: 'score_1', status: 'scored', experimental: true,
      score: { total: 101, pronunciation: 88, fluency: 82, completeness: 90 } }).showScore).toBe(false)
  })

  it('requires an actual local recording within the fixed limits', () => {
    expect(recordingIssue(1000, 1, 'tmp.mp3')).toBe('')
    expect(recordingIssue(300000, 20971520, 'tmp.mp3')).toBe('')
    expect(recordingIssue(999, 1, 'tmp.mp3')).toContain('1 秒')
    expect(recordingIssue(1000, 20971521, 'tmp.mp3')).toContain('20 MB')
    expect(recordingIssue(1000, 1, '')).toContain('录音文件')
  })
})
