export interface TeacherTaskItemSummary {
  id: string
  title: string
  type: 'reading' | 'vocabulary' | 'exercise' | 'recording'
  completionRule: Record<string, unknown>
}

export interface TeacherSubmissionAnswer {
  itemId: string
  value: unknown
}

export interface TeacherExerciseEvidence {
  itemId: string
  questionId: string
  questionType?: 'single_choice' | 'multiple_choice' | 'fill' | 'subjective'
  stem: string
  options: string[]
  studentResponse: unknown
  correctAnswer: unknown
  explanation: string
  isCorrect: boolean | null
  recorded: boolean
}

export interface TeacherVocabularyEvidence {
  itemId: string
  wordId: string
  targetWord: string
  meaning?: string
  example?: string
  syllables?: string[]
  firstCorrect: boolean | null
  attempts: Array<{ studentInput: string; isCorrect: boolean; firstAttempt: boolean; attemptNumber: number; attemptedAt: string }>
}

export interface TeacherSubmissionDetailRow {
  id: string
  title: string
  typeLabel: string
  requirement: string
  result: string
  detail: string
  tone: 'success' | 'neutral'
  recordingId?: string
  exercise?: { stem: string; options: string[]; studentAnswer: string; correctAnswer: string;
    explanation: string; verdict: string; recorded: boolean }
  words?: Array<{ wordId: string; targetWord: string; firstCorrect: boolean | null;
    attempts: TeacherVocabularyEvidence['attempts'] }>
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
  exerciseEvidence: readonly TeacherExerciseEvidence[] = [],
  vocabularyEvidence: readonly TeacherVocabularyEvidence[] = [],
): TeacherSubmissionDetailRow[] {
  const byItem = new Map(answers.map(answer => [answer.itemId, answer.value]))
  return items.map(item => {
    const value = byItem.get(item.id)
    const structured = record(value)
    if (item.type === 'reading') {
      const completed = structured?.kind === 'reading' ? count(structured.completedPageCount) : null
      const required = requiredCount(item.completionRule, 'requiredPageCount')
      const pageIds = Array.isArray(item.completionRule.pageIds)
        && item.completionRule.pageIds.every(id => typeof id === 'string')
        ? item.completionRule.pageIds as string[] : null
      const rawEvents = Array.isArray(structured?.verifiedPageEvents) ? structured.verifiedPageEvents : []
      const verified = pageIds !== null && rawEvents.length === pageIds.length
        && rawEvents.every(entry => {
          const event = record(entry)
          return event !== null && typeof event.pageId === 'string' && pageIds.includes(event.pageId)
            && count(event.pageNumber) !== null && Number(event.pageNumber) > 0
            && typeof event.visitedAt === 'string' && Number.isFinite(Date.parse(event.visitedAt))
        }) && new Set(rawEvents.map(entry => record(entry)?.pageId)).size === pageIds.length
      return {
        id: item.id, title: item.title, typeLabel: '阅读',
        requirement: pageIds === null ? required === null ? '完成指定阅读范围' : `需完成 ${required} 页`
          : `需完成指定 ${pageIds.length} 页`,
        result: pageIds === null ? completed === null ? '未提供页数记录' : `已完成 ${completed} 页`
          : verified ? `已核验 ${pageIds.length} 页` : '逐页证据未记录',
        detail: pageIds === null ? typeof value === 'string' ? value : '当前提交仅记录阅读进度，未附带朗读录音。'
          : verified ? rawEvents.map(entry => { const event = record(entry)!;
            return `第 ${event.pageNumber} 页：${event.visitedAt}` }).join('\n') : '此提交版本缺少指定页的逐页证据。',
        tone: pageIds === null ? completed !== null && required !== null && completed >= required ? 'success' : 'neutral'
          : verified ? 'success' : 'neutral',
      }
    }
    if (item.type === 'vocabulary') {
      const completed = structured?.kind === 'vocabulary' ? count(structured.completedWordCount) : null
      const correct = structured?.kind === 'vocabulary' ? count(structured.correctWordCount) : null
      const required = requiredCount(item.completionRule, 'requiredWordCount')
      const words = vocabularyEvidence.filter(entry => entry.itemId === item.id)
      return {
        id: item.id, title: item.title, typeLabel: '单词',
        requirement: required === null ? '完成指定词量' : `需完成 ${required} 词`,
        result: completed === null ? '未提供练习记录' : `已完成 ${completed} 词`,
        detail: words.length ? words.map(word => word.attempts.length
          ? `目标词：${word.targetWord}\n${word.attempts.map(attempt => `${attempt.firstAttempt ? '首次' : `第 ${attempt.attemptNumber} 次`}：${attempt.studentInput}（${attempt.isCorrect ? '正确' : '错误'}）`).join('\n')}`
          : `目标词：${word.targetWord}；本次提交未作答`).join('\n\n')
          : correct === null || completed === null ? '本次提交没有逐词判定记录。' : `首次正确 ${correct}/${completed} 词；当前提交没有逐词判定记录。`,
        tone: completed !== null && required !== null && completed >= required ? 'success' : 'neutral',
        words: words.map(word => ({ wordId: word.wordId, targetWord: word.targetWord,
          firstCorrect: word.firstCorrect, attempts: word.attempts })),
      }
    }
    if (item.type === 'recording') {
      const recordingId = structured?.kind === 'recording' && typeof structured.recordingId === 'string'
        ? structured.recordingId : ''
      const durationMs = count(structured?.durationMs)
      return { id: item.id, title: item.title, typeLabel: '录音', requirement: '提交有效录音，由教师评分',
        result: recordingId ? '已提交录音' : '本次提交没有录音证据',
        detail: recordingId ? `录音时长：${durationMs === null ? '未记录' : `${Math.round(durationMs / 1000)} 秒`}；请试听后评分。`
          : '本次提交没有可核验的录音引用。', tone: recordingId ? 'success' : 'neutral',
        ...(recordingId ? { recordingId } : {}) }
    }
    const answered = structured?.kind === 'exercise' ? count(structured.answeredQuestionCount) : null
    const required = requiredCount(item.completionRule, 'requiredQuestionCount')
    const evidence = exerciseEvidence.find(entry => entry.itemId === item.id)
    if (evidence) return {
      id: item.id, title: item.title, typeLabel: '习题',
      requirement: required === null ? '完成全部习题' : `需完成 ${required} 题`,
      result: evidence.recorded ? evidence.isCorrect === true ? '已答　客观题正确'
        : evidence.isCorrect === false ? '已答　客观题错误' : '已答　待教师评分' : '逐题作答未记录',
      detail: evidence.recorded
        ? `题目：${evidence.stem}\n学生答案：${answerLabel(evidence.studentResponse)}\n正确答案：${answerLabel(evidence.correctAnswer)}\n解析：${evidence.explanation}`
        : `题目：${evidence.stem}；旧提交没有逐题作答记录。`,
      tone: evidence.isCorrect === true ? 'success' : 'neutral',
      exercise: { stem: evidence.stem, options: [...evidence.options],
        studentAnswer: answerLabel(evidence.studentResponse), correctAnswer: answerLabel(evidence.correctAnswer),
        explanation: evidence.explanation, verdict: evidence.isCorrect === true ? '正确'
          : evidence.isCorrect === false ? '错误' : '待教师评分', recorded: evidence.recorded },
    }
    return {
      id: item.id, title: item.title, typeLabel: '习题',
      requirement: required === null ? '完成全部习题' : `需完成 ${required} 题`,
      result: answered === null ? '未提供答题记录' : `已答 ${answered} 题`,
      detail: '当前提交没有逐题答案与对错判定，无法标出具体错题。',
      tone: 'neutral',
    }
  })
}

function answerLabel(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(item => String(item)).join('、')
  return value === null || value === undefined ? '未记录' : JSON.stringify(value)
}
