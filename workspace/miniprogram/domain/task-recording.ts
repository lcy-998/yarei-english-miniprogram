export interface RecordingPromptView {
  id: string
  title: string
  promptText: string
  grade: string
  unit: string
  contentVersion: number
  allowedClassIds: string[]
}
export interface RecordingPromptPage { items: RecordingPromptView[]; nextOffset: number | null }
export interface TaskRecordingView {
  id: string
  taskId: string
  itemId: string
  assignmentId: string
  submissionVersion: number
  studentId: string
  classId: string
  resourceVersion: number
  stagingPath: string
  status: 'draft' | 'submitted'
  fileId: string | null
  durationMs: number | null
  sizeBytes: number | null
  version: number
  createdAt: string
  submittedAt: string | null
  mediaDeletedAt?: string | null
  mediaExpired?: boolean
}
export interface TaskRecordingPlayback { recordingId: string; temporaryUrl: string; expiresAt: string }
export interface TaskRecordingMediaState { recordingId: string; mediaDeletedAt: string | null; mediaExpired: boolean }
