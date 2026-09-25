export interface TeacherTaskItemSummary {
  id: string
  title: string
  type: 'reading' | 'vocabulary' | 'exercise'
  completionRule: Record<string, unknown>
}

export interface TeacherSubmissionAnswer {
  itemId: string
  value: unknown
}

export interface TeacherSubmissionDetailRow {
  id: string
  title: string
  typeLabel: string
  requirement: string
  result: string
  detail: string
  tone: 'success' | 'neutral'
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function requiredCount(rule: Record<string, unknown>, field: string): number | null { return count(rule[field]) }

export function teacherSubmissionDetails(
  items: readonly TeacherTaskItemSummary[],
  answers: readonly TeacherSubmissionAnswer[],
): TeacherSubmissionDetailRow[] {
  const byItem = new Map(answers.map(answer => [answer.itemId, answer.value]))
  return items.map(item => {
    const value = byItem.get(item.id)
    const structured = record(value)
    if (item.type === 'reading') {
      const completed = structured?.kind === 'reading' ? count(structured.completedPageCount) : null
      const required = requiredCount(item.completionRule, 'requiredPageCount')
      return {
        id: item.id, title: item.title, typeLabel: '阅读',
        requirement: required === null ? '完成指定阅读范围' : `需完成 ${required} 页`,
        result: completed === null ? '未提供页数记录' : `已完成 ${completed} 页`,
        detail: typeof value === 'string' ? value : '当前提交仅记录阅读进度，未附带朗读录音。',
        tone: completed !== null && required !== null && completed >= required ? 'success' : 'neutral',
      }
    }
    if (item.type === 'vocabulary') {
      const completed = structured?.kind === 'vocabulary' ? count(structured.completedWordCount) : null
      const correct = structured?.kind === 'vocabulary' ? count(structured.correctWordCount) : null
      const required = requiredCount(item.completionRule, 'requiredWordCount')
      return {
        id: item.id, title: item.title, typeLabel: '单词',
        requirement: required === null ? '完成指定词量' : `需完成 ${required} 词`,
        result: completed === null ? '未提供练习记录' : `已完成 ${completed} 词`,
        detail: correct === null || completed === null ? '本次提交没有逐词判定记录。' : `首次正确 ${correct}/${completed} 词；当前提交没有逐词判定记录。`,
        tone: completed !== null && required !== null && completed >= required ? 'success' : 'neutral',
      }
    }
    const answered = structured?.kind === 'exercise' ? count(structured.answeredQuestionCount) : null
    const required = requiredCount(item.completionRule, 'requiredQuestionCount')
    return {
      id: item.id, title: item.title, typeLabel: '习题',
      requirement: required === null ? '完成全部习题' : `需完成 ${required} 题`,
      result: answered === null ? '未提供答题记录' : `已答 ${answered} 题`,
      detail: '当前提交没有逐题答案与对错判定，无法标出具体错题。',
      tone: 'neutral',
    }
  })
}
