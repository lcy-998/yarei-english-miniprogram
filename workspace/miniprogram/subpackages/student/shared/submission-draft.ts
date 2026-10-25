import { Submission } from '../domain/types'

/**
 * A returned submission is historical evidence, not an editable draft for the
 * next redo attempt. Only an actual draft participates in draft CAS.
 */
export function activeDraftRecordVersion(submission: Submission | undefined): number | undefined {
  return submission?.status === 'draft' ? submission.recordVersion : undefined
}
