import { describe, expect, it } from 'vitest'
import type { TeacherTaskMediaReviewEvidenceView } from '../miniprogram/domain/teacher-media'
import { teacherMediaProgressLabel, teacherMediaQuestionRows } from '../miniprogram/shared/teacher-task-media-view'

const evidence: TeacherTaskMediaReviewEvidenceView = {
  taskId: 'task_demo', assignmentId: 'assignment_demo', submissionId: 'submission_demo',
  submissionVersion: 2, itemId: 'item_demo', title: '虚构听力', kind: 'listening', mediaVersion: 1,
  durationMs: 10000, sourcePlayback: { available: false, temporaryUrl: null, expiresAt: null },
  questions: [{ questionId: 'q1', questionType: 'single_choice', stem: 'Select one',
    options: ['cat', 'dog'], studentResponse: 'dog', correctAnswer: 'cat', explanation: '',
    isCorrect: false, recorded: true, clip: { segmentId: 'segment_1', startMs: 0, endMs: 5000 } },
  { questionId: 'q2', questionType: 'subjective', stem: 'Explain', options: [],
    studentResponse: null, correctAnswer: null, explanation: '', isCorrect: null,
    recorded: false, clip: null }],
  verifiedPlayedSegmentIds: ['segment_1'], verifiedRanges: [], subtitleCues: [], finalWork: null,
}

describe('teacher media review projection', () => {
  it('keeps the original answer, correct option and missing answer distinct', () => {
    const rows = teacherMediaQuestionRows(evidence.questions)
    expect(rows[0]).toMatchObject({ responseLabel: 'dog', correctLabel: 'cat', verdict: '错误',
      options: [{ value: 'cat', correct: true, selected: false },
        { value: 'dog', correct: false, selected: true }] })
    expect(rows[1]).toMatchObject({ responseLabel: '未记录', correctLabel: '由教师评分',
      verdict: '本次提交未记录本题作答' })
  })

  it('counts overlapping verified video ranges only once', () => {
    expect(teacherMediaProgressLabel({ ...evidence, kind: 'video',
      verifiedRanges: [{ startMs: 0, endMs: 6000 }, { startMs: 4000, endMs: 9000 }] }))
      .toBe('服务端核对有效观看约 90%')
  })
})
