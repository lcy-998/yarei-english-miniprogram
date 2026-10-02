import type { StudentWork } from '../domain/types'
import type { WriteIntentState } from './write-intent'

export interface DubbingLocalDraft {
  ownerUserId: string
  ownerSessionId: string
  materialId: string
  materialVersion: string
  localPath: string
  durationMs: number
  fileSize: number
  note: string
  draft: StudentWork | null
  beginIntent: WriteIntentState
  submitIntent: WriteIntentState
}

let current: DubbingLocalDraft | null = null

/** Keep an unfinished recording only in this app process and only for its signed-in student. */
export function saveDubbingLocalDraft(value: DubbingLocalDraft): void {
  current = { ...value, draft: value.draft ? { ...value.draft } : null,
    beginIntent: { ...value.beginIntent }, submitIntent: { ...value.submitIntent } }
}

export function readDubbingLocalDraft(ownerUserId: string, ownerSessionId: string): DubbingLocalDraft | null {
  if (current?.ownerUserId !== ownerUserId || current.ownerSessionId !== ownerSessionId) {
    current = null; return null
  }
  return { ...current, draft: current.draft ? { ...current.draft } : null,
    beginIntent: { ...current.beginIntent }, submitIntent: { ...current.submitIntent } }
}

export function clearDubbingLocalDraft(): void { current = null }
