import { describe, expect, it } from 'vitest'
import type { M3TaskMediaPlaybackView, M3TaskMediaSnapshotView, TaskDetailView } from '../miniprogram/domain/types'
import { listeningClipForQuestion, mediaDraftValue, mediaQuestionRows, mediaSubmissionValue, sealedTaskDubbingWorkId,
  savedTaskMediaAnswers, taskMediaSubmissionReady, taskMediaPlaybackReady,
  taskMediaSeekTarget } from '../miniprogram/shared/student-task-media-policy'

const snapshot: M3TaskMediaSnapshotView = {
  kind: 'listening', mediaId: 'media_1', mediaVersion: 2, reviewVersion: 2,
  durationMs: 120000, questionIds: ['q1'],
  clips: [{ questionId: 'q1', segmentId: 'segment_1', startMs: 2000, endMs: 10000 }],
  subtitleAvailable: false, continuousPlaybackEnforced: true,
}
const playback: M3TaskMediaPlaybackView = {
  status: 'ready', mediaId: 'media_1', mediaVersion: 2, sessionId: 'session_1',
  temporaryUrl: 'https://example.invalid/signed', expiresAt: '2026-10-04T00:00:00Z',
  confirmedThroughMs: 15000, seekForwardAllowed: false,
}

describe('S-09 task media fail-closed projection', () => {
  it('restores saved listening answers after a new login or renewed media session', () => {
    const detail = { submission: { status: 'draft', answers: [{ taskItemId: 'item_1',
      structuredValue: { kind: 'listening', mediaSessionId: 'session_1',
        questionResponses: [{ questionId: 'q1', response: 'B' }] } }] } } as TaskDetailView
    expect(savedTaskMediaAnswers(detail, 'item_1', snapshot)).toEqual({ q1: 'B' })
    expect(savedTaskMediaAnswers(detail, 'other_item', snapshot)).toEqual({})
  })

  it('saves answered questions as a draft without treating them as a complete submission', () => {
    const twoQuestions = { ...snapshot, questionIds: ['q1', 'q2'] }
    expect(mediaDraftValue(twoQuestions, 'session_1', { q1: 'A' })).toEqual({
      kind: 'listening', mediaSessionId: 'session_1',
      questionResponses: [{ questionId: 'q1', response: 'A' }],
    })
    expect(mediaSubmissionValue(twoQuestions, 'session_1', { q1: 'A' })).toBeNull()
  })

  it('rejects missing, expired or mismatched playback sessions', () => {
    const now = Date.parse('2026-10-03T10:00:00Z')
    expect(taskMediaPlaybackReady(snapshot, playback, now)).toBe(true)
    expect(taskMediaPlaybackReady(snapshot, { ...playback, mediaVersion: 1 }, now)).toBe(false)
    expect(taskMediaPlaybackReady(snapshot, { ...playback, temporaryUrl: 'cloud://private' }, now)).toBe(false)
    expect(taskMediaPlaybackReady(snapshot, { ...playback, seekForwardAllowed: true }, now)).toBe(false)
    expect(taskMediaPlaybackReady(snapshot, playback, Date.parse(playback.expiresAt!))).toBe(false)
  })

  it('allows backward replay but clamps forward seek to server confirmation', () => {
    expect(taskMediaSeekTarget(5000, snapshot, playback)).toBe(5000)
    expect(taskMediaSeekTarget(90000, snapshot, playback)).toBe(15000)
  })

  it('uses only confirmed server position for each formal media threshold', () => {
    const now = Date.parse('2026-10-03T10:00:00Z')
    expect(taskMediaSubmissionReady(snapshot, playback, now)).toBe(false)
    expect(taskMediaSubmissionReady(snapshot, { ...playback, confirmedThroughMs: snapshot.durationMs }, now)).toBe(true)
    expect(taskMediaSubmissionReady({ ...snapshot, kind: 'video' },
      { ...playback, confirmedThroughMs: 108000 }, now)).toBe(true)
    expect(taskMediaSubmissionReady({ ...snapshot, kind: 'video' },
      { ...playback, confirmedThroughMs: 107999 }, now)).toBe(false)
    expect(taskMediaSubmissionReady(snapshot, { ...playback, confirmedThroughMs: snapshot.durationMs,
      sessionId: null }, now)).toBe(false)
  })

  it('does not reuse a sealed task dubbing work from an older submission round', () => {
    const work = { workId: 'work_1', taskId: 'task_1', itemId: 'item_1', round: 1,
      stagingPath: 'cloud://private', status: 'submitted' as const, durationMs: 2000,
      submittedAt: '2026-10-03T10:00:00Z', version: 2 }
    expect(sealedTaskDubbingWorkId(work, 'task_1', 'item_1', 1)).toBe('work_1')
    expect(sealedTaskDubbingWorkId(work, 'task_1', 'item_1', 2)).toBe('')
    expect(sealedTaskDubbingWorkId({ ...work, status: 'draft' }, 'task_1', 'item_1', 1)).toBe('')
  })

  it('binds each listening question only to its frozen valid clip', () => {
    expect(listeningClipForQuestion(snapshot, 'q1')).toEqual({
      segmentId: 'segment_1', startMs: 2000, endMs: 10000,
    })
    expect(listeningClipForQuestion(snapshot, 'other')).toBeNull()
    expect(listeningClipForQuestion({ ...snapshot, clips: [{ ...snapshot.clips[0]!, endMs: 130000 }] },
      'q1')).toBeNull()
  })

  it('keeps original answers in published order without self-reported playback proof', () => {
    const withQuestions = { ...snapshot, questions: [{ questionId: 'q1', questionType: 'single_choice' as const,
      stem: '虚构题目', options: ['A', 'B'] }] }
    expect(mediaQuestionRows(withQuestions, { q1: 'B' })[0]).toMatchObject({
      stem: '虚构题目', options: [{ value: 'A', selected: false }, { value: 'B', selected: true }],
    })
    expect(mediaSubmissionValue(withQuestions, 'session_1', { q1: 'B' })).toEqual({
      kind: 'listening', mediaSessionId: 'session_1', questionResponses: [{ questionId: 'q1', response: 'B' }],
    })
    expect(mediaSubmissionValue(withQuestions, 'session_1', {})).toBeNull()
    expect(mediaSubmissionValue({ ...snapshot, kind: 'dubbing', questionIds: [], questions: [], clips: [] },
      'session_1', {}, '')).toBeNull()
  })

  it('presents single and multiple choice separately from fill and subjective answers', () => {
    const questions = [
      { questionId: 'single', questionType: 'single_choice' as const, stem: 'Choose one', options: ['A', 'B'] },
      { questionId: 'multiple', questionType: 'multiple_choice' as const, stem: 'Choose two', options: ['A', 'B', 'C'] },
      { questionId: 'fill', questionType: 'fill' as const, stem: 'Complete the word', options: [] },
      { questionId: 'subjective', questionType: 'subjective' as const, stem: 'Answer in words', options: [] },
    ]
    const rows = mediaQuestionRows({ ...snapshot, questionIds: questions.map(item => item.questionId),
      questions }, { single: 'B', multiple: ['A', 'C'], fill: 'rabbit', subjective: 'In a burrow' })
    expect(rows.map(row => [row.typeLabel, row.choiceQuestion])).toEqual([
      ['单选题', true], ['多选题', true], ['填空题', false], ['问答题', false],
    ])
    expect(rows[1]?.options.map(option => option.selected)).toEqual([true, false, true])
    expect(rows[2]?.answerText).toBe('rabbit')
    expect(rows[3]?.answerText).toBe('In a burrow')
  })
})
