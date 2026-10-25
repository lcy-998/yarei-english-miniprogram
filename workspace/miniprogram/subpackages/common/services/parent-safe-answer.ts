import type { SubmissionAnswer, TaskItem } from '../../../domain/types'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
function safeResponse(value: unknown): string | string[] | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return [...value]
  return null
}

/** Mirrors the deployed parent projection for the M0 memory fallback. */
export function parentSafeMemoryAnswer(answer: SubmissionAnswer, items: readonly TaskItem[]): SubmissionAnswer {
  const item = items.find(candidate => candidate.id === answer.taskItemId)
  let raw: unknown
  try { raw = JSON.parse(answer.value) as unknown } catch { raw = answer.value }
  if (!item) return { taskItemId: answer.taskItemId,
    value: items.length === 0 && typeof raw === 'string' ? raw : JSON.stringify({ kind: 'unavailable' }) }
  if (!record(raw)) return { taskItemId: answer.taskItemId, value: JSON.stringify({ kind: 'unavailable' }) }
  if (item.type === 'reading' && raw.kind === 'reading') return { taskItemId: answer.taskItemId,
    value: JSON.stringify({ kind: 'reading', completedPageCount: count(raw.completedPageCount) }) }
  if (item.type === 'vocabulary' && raw.kind === 'vocabulary') return { taskItemId: answer.taskItemId,
    value: JSON.stringify({ kind: 'vocabulary', completedWordCount: count(raw.completedWordCount),
      correctWordCount: count(raw.correctWordCount) }) }
  if (item.type === 'exercise' && raw.kind === 'exercise') return { taskItemId: answer.taskItemId,
    value: JSON.stringify({ kind: 'exercise', answeredQuestionCount: count(raw.answeredQuestionCount),
      questionResponses: Array.isArray(raw.questionResponses) ? raw.questionResponses.flatMap(entry => {
        if (!record(entry) || typeof entry.questionId !== 'string') return []
        return [{ questionId: entry.questionId, response: safeResponse(entry.response),
          isCorrect: typeof entry.isCorrect === 'boolean' ? entry.isCorrect : null }]
      }) : [] }) }
  if (item.type === 'recording' && raw.kind === 'recording') return { taskItemId: answer.taskItemId,
    value: JSON.stringify({ kind: 'recording', durationMs: count(raw.durationMs) }) }
  return { taskItemId: answer.taskItemId, value: JSON.stringify({ kind: 'unavailable' }) }
}
