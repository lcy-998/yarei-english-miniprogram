import { getReviewSubmission } from '../services/app-service'
import type { TeacherReviewSubmissionView } from '../services/cloudbase-app-service'
import { getSession } from '../session/session'

export interface TeacherReviewRoute {
  submissionId: string
  itemId: string
}

export function teacherReviewRoute(options?: Record<string, string>): TeacherReviewRoute | null {
  if (options?.teacherReview !== '1' || !options.submissionId?.trim() || !options.itemId?.trim()) return null
  return { submissionId: options.submissionId, itemId: options.itemId }
}

type ReviewItem = NonNullable<TeacherReviewSubmissionView['taskItems']>[number]
type ExerciseEvidence = NonNullable<TeacherReviewSubmissionView['exerciseEvidence']>[number]

export function teacherReviewManualScoreRequired(submission: TeacherReviewSubmissionView, item: ReviewItem): boolean {
  if (!submission.answers.some(answer => answer.itemId === item.id)) return false
  const scoring = submission.scoringItems?.find(entry => entry.itemId === item.id)
  if (scoring) return scoring.teacherScoreRequired
  if (item.type === 'recording') return true
  if (item.type !== 'exercise') return false
  const evidence = submission.exerciseEvidence?.find(entry => entry.itemId === item.id)
  return !evidence || evidence.questionType === 'subjective' && evidence.recorded
}

function answerLabel(value: unknown): string {
  if (value === null || value === undefined) return '未记录'
  if (Array.isArray(value)) return value.map(item => String(item)).join('、')
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function teacherExerciseView(evidence: ExerciseEvidence | null) {
  const response = evidence?.studentResponse
  const selectedValues = Array.isArray(response) ? response : typeof response === 'string' ? [response] : []
  const correct = evidence?.correctAnswer
  const correctValues = Array.isArray(correct) ? correct : correct === null || correct === undefined ? [] : [correct]
  return {
    choices: (evidence?.options ?? []).map((value, id) => ({ id, value,
      selected: evidence?.recorded === true && selectedValues.includes(value),
      correct: correctValues.includes(value) })),
    answerLabel: evidence?.recorded ? answerLabel(response) : '未记录',
    correctLabel: evidence ? answerLabel(correct) : '未记录',
    verdict: !evidence?.recorded ? '本次提交未记录逐题作答'
      : evidence.isCorrect === true ? '正确' : evidence.isCorrect === false ? '错误' : '待教师评分',
  }
}

export async function loadTeacherReviewItem(route: TeacherReviewRoute,
  expectedType: ReviewItem['type'] | readonly ReviewItem['type'][]): Promise<
  { ok: true; submission: TeacherReviewSubmissionView; item: ReviewItem } | { ok: false; message: string }
> {
  const session = getSession()
  if (!session || (session.activeRole ?? session.user.role) !== 'teacher') {
    return { ok: false, message: '仅授权教师可查看学生作答。' }
  }
  const result = await getReviewSubmission(session.user.id, route.submissionId)
  if (!result.ok) return { ok: false, message: result.error.message }
  const item = result.data.taskItems?.find(candidate => candidate.id === route.itemId)
  const allowedTypes: readonly ReviewItem['type'][] = typeof expectedType === 'string' ? [expectedType] : expectedType
  if (!item || !allowedTypes.includes(item.type)) return { ok: false, message: '本次提交没有对应的作业内容。' }
  return { ok: true, submission: result.data, item }
}
