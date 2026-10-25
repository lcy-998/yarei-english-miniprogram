import type { SubmissionAnswer } from '../../../domain/types'

export interface ParentQuestionRow { key: string; questionId: string; stem: string; response: string; result: string }
export interface ParentEvidenceRow { key: string; itemId: string; kind: string; title: string;
  summary: string; note: string;
  questions?: ParentQuestionRow[] }
export interface ParentRecordingItem { itemId: string; title: string }
export interface ParentTaskMediaItem { itemId: string; title: string; kind: 'listening' | 'video' | 'dubbing' }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
function parse(value: string): unknown {
  try { return JSON.parse(value) as unknown } catch { return value }
}
function questionRows(value: Record<string, unknown>): ParentQuestionRow[] {
  if (!Array.isArray(value.questions)) return []
  return value.questions.flatMap((entry, index) => {
    if (!record(entry) || typeof entry.questionId !== 'string') return []
    const response = typeof entry.response === 'string' ? entry.response
      : Array.isArray(entry.response) && entry.response.every(part => typeof part === 'string')
        ? entry.response.join('、') : '未记录'
    return [{ key: `${entry.questionId}|${index}`, questionId: entry.questionId,
      stem: typeof entry.stem === 'string' ? entry.stem : '题目未记录', response,
      result: entry.isCorrect === true ? '正确' : entry.isCorrect === false ? '需订正' : '待老师评分' }]
  })
}

/** Use only the parent-safe server projection; never expose raw media IDs or proof objects. */
export function parentEvidenceRows(answers: readonly SubmissionAnswer[],
  summaries: readonly Readonly<{ itemId: string; title: string }>[] = []): ParentEvidenceRow[] {
  const titles = new Map(summaries.map(item => [item.itemId, item.title]))
  return answers.map((answer, index) => {
    const value = parse(answer.value)
    const base = { key: `${answer.taskItemId}|${index}`, itemId: answer.taskItemId,
      kind: record(value) && typeof value.kind === 'string' ? value.kind : 'legacy',
      title: titles.get(answer.taskItemId) ?? `内容 ${index + 1}` }
    if (!record(value)) return { ...base,
      summary: typeof value === 'string' ? value : '旧版本未记录详细作答', note: '' }
    if (value.kind === 'reading') return { ...base, summary: safeCount(value.completedPageCount) === null
      ? '阅读记录未提供' : `已核对 ${value.completedPageCount} 页`, note: '' }
    if (value.kind === 'vocabulary') return { ...base,
      summary: safeCount(value.completedWordCount) === null ? '单词记录未提供' : `已练习 ${value.completedWordCount} 词`,
      note: safeCount(value.correctWordCount) === null ? '' : `首次正确 ${value.correctWordCount} 词` }
    if (value.kind === 'exercise') return { ...base,
      summary: safeCount(value.answeredQuestionCount) === null ? '习题记录未提供' : `已作答 ${value.answeredQuestionCount} 题`,
      note: Array.isArray(value.questionResponses) ? `逐题记录 ${value.questionResponses.length} 条` : '' }
    if (value.kind === 'recording') return { ...base,
      summary: safeCount(value.durationMs) === null ? '录音已提交' : `录音时长 ${Math.ceil(Number(value.durationMs) / 1000)} 秒`,
      note: value.mediaExpired === true ? '录音已过保留期，评分与点评仍保留' : '家长端仅可只读查看' }
    if (value.kind === 'listening') return { ...base,
      summary: safeCount(value.playedSegmentCount) === null || safeCount(value.requiredSegmentCount) === null
        ? '听力记录未提供' : `已核对 ${value.playedSegmentCount}/${value.requiredSegmentCount} 段音频`,
      note: safeCount(value.answeredQuestionCount) === null ? '' : `已作答 ${value.answeredQuestionCount} 题`,
      questions: questionRows(value) }
    if (value.kind === 'video') {
      const played = safeCount(value.verifiedPlayedMs)
      const duration = safeCount(value.durationMs)
      return { ...base,
        summary: played === null || duration === null || duration === 0 ? '视频观看记录未提供'
          : `有效观看 ${Math.min(100, Math.round(played * 100 / duration))}%`,
        note: safeCount(value.answeredQuestionCount) === null ? '' : `已作答 ${value.answeredQuestionCount} 题`,
        questions: questionRows(value) }
    }
    if (value.kind === 'dubbing') return { ...base,
      summary: value.submitted === true ? '最终配音作品已提交' : '配音记录未提供',
      note: safeCount(value.durationMs) === null ? '作品时长未记录'
        : `作品时长 ${Math.ceil(Number(value.durationMs) / 1000)} 秒` }
    return { ...base, summary: '已提交的内容', note: '详细证据待正式授权投影后查看' }
  })
}

export function parentSubmittedRecordingItems(answers: readonly SubmissionAnswer[],
  summaries: readonly Readonly<{ itemId: string; title: string; type: string }>[]): ParentRecordingItem[] {
  const submitted = new Set(answers.flatMap(answer => {
    const value = parse(answer.value)
    return record(value) && value.kind === 'recording' ? [answer.taskItemId] : []
  }))
  return summaries.filter(item => item.type === 'recording' && submitted.has(item.itemId))
    .map(item => ({ itemId: item.itemId, title: item.title }))
}

export function parentSubmittedTaskMediaItems(answers: readonly SubmissionAnswer[],
  summaries: readonly Readonly<{ itemId: string; title: string; type: string }>[]): ParentTaskMediaItem[] {
  const submitted = new Map(answers.flatMap(answer => {
    const value = parse(answer.value)
    return record(value) && (value.kind === 'listening' || value.kind === 'video'
      || value.kind === 'dubbing')
      ? [[answer.taskItemId, value.kind] as const] : []
  }))
  return summaries.filter(item => item.type === submitted.get(item.itemId)
    && (item.type === 'listening' || item.type === 'video' || item.type === 'dubbing'))
    .map(item => ({ itemId: item.itemId, title: item.title,
      kind: item.type as 'listening' | 'video' | 'dubbing' }))
}
