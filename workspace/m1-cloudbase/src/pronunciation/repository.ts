import type { TrustedActorContext } from '../auth/trusted-actor';
import type { PronunciationReceipt, PronunciationRecording, PronunciationSourceInput,
  RecognitionResult, ResolvedPronunciationSource } from './types';

export interface PronunciationTransaction {
  findRecording(organizationId: string, recordingId: string): Promise<PronunciationRecording | null>;
  listRecordings(organizationId: string, studentId: string): Promise<readonly PronunciationRecording[]>;
  listSubmissionRecordings(organizationId: string, taskId: string, assignmentId: string,
    submissionVersion: number): Promise<readonly PronunciationRecording[]>;
  saveRecording(record: PronunciationRecording, expectedVersion: number): Promise<boolean>;
  findReceipt(organizationId: string, actorId: string, operationId: string): Promise<PronunciationReceipt | null>;
  saveReceipt(receipt: PronunciationReceipt): Promise<boolean>;
  appendAudit(actor: TrustedActorContext, action: string, recordingId: string, occurredAt: string,
    metadata: Readonly<Record<string, string | number | boolean | null>>): Promise<boolean>;
  appendWorkerAudit(organizationId: string, action: string, recordingId: string, operationId: string,
    occurredAt: string, metadata: Readonly<Record<string, string | number | boolean | null>>): Promise<boolean>;
}

export interface PronunciationUnitOfWork {
  transaction<T>(work: (transaction: PronunciationTransaction) => Promise<T>): Promise<T>;
}

export interface PronunciationSourcePort {
  resolve(actor: TrustedActorContext, source: PronunciationSourceInput, writable: boolean): Promise<ResolvedPronunciationSource>;
  current(actor: TrustedActorContext, source: ResolvedPronunciationSource, writable: boolean): Promise<boolean>;
  /** Rechecks an async score against either the still-open task round or the exact submitted recording. */
  currentForScoring?(actor: TrustedActorContext, recording: PronunciationRecording): Promise<boolean>;
  /** Returns the formal submission time, or null when current teacher access is denied. */
  teacherSubmittedAt(actor: TrustedActorContext, recording: PronunciationRecording,
    submissionVersion: number): Promise<string | null>;
  parentSubmittedAt(actor: TrustedActorContext, recording: PronunciationRecording,
    submissionVersion: number): Promise<string | null>;
  parentSubmissionRecordingIds(actor: TrustedActorContext, input: Readonly<{
    studentId: string; taskId: string; assignmentId: string; submissionVersion: number;
    itemId: string }>): Promise<Readonly<{ submittedAt: string; recordingIds: readonly string[] }> | null>;
}

export interface PronunciationSealPort {
  seal(input: Readonly<{ stagingFileId: string; stagingPath: string; organizationId: string;
    studentId: string; recordingId: string }>): Promise<Readonly<{
      fileId: string; contentSha256: string; sizeBytes: number; durationMs: number }>>;
}

export interface PronunciationInferencePort {
  infer(input: Readonly<{ operationId: string; recordingId: string; fileId: string;
    contentSha256: string; sizeBytes: number; durationMs: number }>): Promise<RecognitionResult>;
}

export interface PronunciationJobDispatchPort {
  dispatch(input: Readonly<{ organizationId: string; studentId: string;
    recordingId: string; operationId: string }>): Promise<void>;
}

export interface PronunciationWorkerIdentityPort {
  /** Re-resolve an active student without trusting a queued client session. */
  currentStudent(organizationId: string, studentId: string,
    platformSubjectDigest: string): Promise<TrustedActorContext | null>;
}

export interface PronunciationPlaybackPort {
  temporaryUrl(fileId: string): Promise<string>;
}

export interface PronunciationFormalSubmissionPort {
  submittedAt(record: PronunciationRecording): Promise<string | null>;
}
