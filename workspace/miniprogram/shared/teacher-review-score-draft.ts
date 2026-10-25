export interface TeacherReviewScoreDraft {
  submissionId: string
  itemId: string
  input: string
  inputs?: Record<string, string>
  questionInputs?: Record<string, string>
}

let current: TeacherReviewScoreDraft | null = null
let ownerSessionId = ''

function sessionId(): string {
  try { return (wx.getStorageSync('yarei_session') as { sessionId?: string } | null)?.sessionId ?? '' }
  catch (_error: unknown) { return '' }
}

function copy(draft: TeacherReviewScoreDraft): TeacherReviewScoreDraft {
  return { ...draft,
    ...(draft.inputs ? { inputs: { ...draft.inputs } } : {}),
    ...(draft.questionInputs ? { questionInputs: { ...draft.questionInputs } } : {}) }
}

export function setTeacherReviewScoreDraft(draft: TeacherReviewScoreDraft | null): void {
  current = draft === null ? null : copy(draft)
  ownerSessionId = draft === null ? '' : sessionId()
}

export function getTeacherReviewScoreDraft(): TeacherReviewScoreDraft | null {
  if (current !== null && ownerSessionId !== sessionId()) {
    current = null
    ownerSessionId = ''
  }
  return current === null ? null : copy(current)
}

export function takeTeacherReviewScoreDraft(): TeacherReviewScoreDraft | null {
  const draft = getTeacherReviewScoreDraft()
  setTeacherReviewScoreDraft(null)
  return draft
}
