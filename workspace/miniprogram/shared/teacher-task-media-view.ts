import type { TeacherTaskMediaReviewEvidenceView } from '../domain/teacher-media'

type Question = TeacherTaskMediaReviewEvidenceView['questions'][number]

export interface TeacherMediaQuestionRow {
  questionId: string
  stem: string
  responseLabel: string
  correctLabel: string
  verdict: string
  explanation: string
  options: Array<{ value: string; selected: boolean; correct: boolean }>
  clip: Question['clip']
  clipLabel: string
}

function answerLabel(value: unknown): string {
  if (typeof value === 'string') return value || '未记录'
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value.join('、') || '未记录'
  return '未记录'
}

export function teacherMediaQuestionRows(questions: readonly Question[]): TeacherMediaQuestionRow[] {
  return questions.map(question => {
    const selected = question.recorded
      ? Array.isArray(question.studentResponse) ? question.studentResponse
        : typeof question.studentResponse === 'string' ? [question.studentResponse] : [] : []
    const correct = Array.isArray(question.correctAnswer) ? question.correctAnswer
      : typeof question.correctAnswer === 'string' ? [question.correctAnswer] : []
    return { questionId: question.questionId, stem: question.stem,
      responseLabel: question.recorded ? answerLabel(question.studentResponse) : '未记录',
      correctLabel: question.correctAnswer === null ? '由教师评分' : answerLabel(question.correctAnswer),
      verdict: !question.recorded ? '本次提交未记录本题作答'
        : question.isCorrect === true ? '正确' : question.isCorrect === false ? '错误' : '待教师评分',
      explanation: question.explanation,
      options: question.options.map(value => ({ value,
        selected: selected.includes(value), correct: correct.includes(value) })),
      clip: question.clip,
      clipLabel: question.clip
        ? `${(question.clip.startMs / 1000).toFixed(3)}—${(question.clip.endMs / 1000).toFixed(3)} 秒` : '',
    }
  })
}

export function teacherMediaProgressLabel(evidence: TeacherTaskMediaReviewEvidenceView): string {
  if (evidence.kind === 'listening') {
    return `已核对 ${evidence.verifiedPlayedSegmentIds.length} 段音频；共 ${evidence.questions.length} 题`
  }
  const ranges = evidence.verifiedRanges
    .map(range => ({ start: Math.max(0, Math.min(evidence.durationMs, range.startMs)),
      end: Math.max(0, Math.min(evidence.durationMs, range.endMs)) }))
    .filter(range => range.end > range.start)
    .sort((left, right) => left.start - right.start)
  let covered = 0
  let end = 0
  for (const range of ranges) {
    covered += Math.max(0, range.end - Math.max(end, range.start))
    end = Math.max(end, range.end)
  }
  const percent = evidence.durationMs > 0 ? Math.min(100, Math.round(covered * 100 / evidence.durationMs)) : 0
  return `服务端核对有效观看约 ${percent}%`
}
