export interface TeacherReviewScoreDraft {
  submissionId: string
  itemId: string
  input: string
  inputs?: Record<string, string>
  questionInputs?: Record<string, string>
}

let current: TeacherReviewScoreDraft | null = null
let ownerSessionId = ''
const STORAGE_KEY = 'yarei_teacher_review_score_draft'

interface StoredDraft { ownerSessionId: string; draft: TeacherReviewScoreDraft }

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
  try {
    if (!draft) wx.removeStorageSync(STORAGE_KEY)
    else if (ownerSessionId) wx.setStorageSync(STORAGE_KEY, { ownerSessionId, draft: copy(draft) } satisfies StoredDraft)
  } catch (_error: unknown) { /* Keep the in-package draft available if storage is unavailable. */ }
}

export function getTeacherReviewScoreDraft(): TeacherReviewScoreDraft | null {
  const activeSessionId = sessionId()
  try {
    const stored = wx.getStorageSync(STORAGE_KEY) as StoredDraft | null
    if (stored?.draft && stored.ownerSessionId === activeSessionId && activeSessionId) return copy(stored.draft)
    if (stored) wx.removeStorageSync(STORAGE_KEY)
  } catch (_error: unknown) { /* Fall back to the in-package draft. */ }
  if (current !== null && ownerSessionId !== activeSessionId) {
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
