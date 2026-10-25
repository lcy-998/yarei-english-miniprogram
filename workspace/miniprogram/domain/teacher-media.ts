export interface TeacherMediaReviewReceiptView {
  mediaId: string
  status: 'draft' | 'transcoding' | 'pending_review' | 'rejected' | 'approved' | 'published' | 'offline'
  mediaVersion: number
  reviewVersion: number | null
  recordVersion: number
  rejectionReason: string | null
}

export interface TeacherAssetFilters {
  kind: 'listening' | 'video' | 'dubbing'
  scope?: 'mine'
  keyword?: string
  grade?: string
  textbook?: string
  unit?: string
  targetClassIds?: string[]
}

export interface TeacherAssetListItem {
  id: string
  kind: TeacherAssetFilters['kind']
  title: string
  contentVersion: number
  grade: string
  textbook: string | null
  unit: string | null
  durationMs: number
  questionCount: number
  allowedClassIds: string[]
  acceptanceStatus?: 'pending_user_acceptance'
  privateToTeacher?: true
}

export interface TeacherAssetPage {
  items: TeacherAssetListItem[]
  nextOffset: number | null
}

export interface TeacherAssetFacet { grade: string; textbook: string | null; unit: string | null }

export interface TeacherAssetPreview extends TeacherAssetListItem {
  scoringKind: 'automatic' | 'manual' | 'completion_only'
  questions: { questionId: string; stem: string; options: string[] }[]
  clips: { questionId: string; segmentId: string; startMs: number; endMs: number }[]
  subtitles: { startMs: number; endMs: number; text: string; translationText?: string }[]
  playback: { temporaryUrl: string; expiresAt: string }
}

export interface TeacherTaskMediaReviewEvidenceView {
  taskId: string
  assignmentId: string
  submissionId: string
  submissionVersion: number
  itemId: string
  title: string
  kind: 'listening' | 'video' | 'dubbing'
  mediaVersion: number
  durationMs: number
  sourcePlayback: { available: boolean; temporaryUrl: string | null; expiresAt: string | null }
  questions: Array<{ questionId: string; questionType: string; stem: string; options: string[]
    studentResponse: unknown; correctAnswer: unknown; explanation: string
    isCorrect: boolean | null; recorded: boolean
    clip: { segmentId: string; startMs: number; endMs: number } | null }>
  verifiedPlayedSegmentIds: string[]
  verifiedRanges: Array<{ startMs: number; endMs: number }>
  subtitleCues: Array<{ startMs: number; endMs: number; text: string; translationText?: string }>
  finalWork: { available: boolean; durationMs: number | null
    temporaryUrl: string | null; expiresAt: string | null } | null
}
