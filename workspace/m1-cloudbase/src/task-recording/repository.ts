import type { TaskRecordingRecord, TaskRecordingReceipt } from './types';
import type { TrustedActorContext } from '../auth/trusted-actor';

export interface TaskRecordingTransaction {
  findRecording(organizationId: string, recordingId: string): Promise<TaskRecordingRecord | null>;
  listMyRecordings(organizationId: string, studentId: string, taskId: string, itemId: string,
    submissionVersion: number): Promise<readonly TaskRecordingRecord[]>;
  saveRecording(record: TaskRecordingRecord, expectedVersion: number): Promise<boolean>;
  findReceipt(organizationId: string, actorId: string, operationId: string): Promise<TaskRecordingReceipt | null>;
  saveReceipt(receipt: TaskRecordingReceipt): Promise<boolean>;
}
export interface TaskRecordingUnitOfWork {
  transaction<T>(work: (transaction: TaskRecordingTransaction) => Promise<T>): Promise<T>;
}
export interface TaskRecordingSealPort {
  inspectAndSeal(input: Readonly<{ stagingFileId: string; stagingPath: string;
    organizationId: string; studentId: string; recordingId: string }>): Promise<Readonly<{
      fileId: string; contentSha256: string; sizeBytes: number; durationMs: number; codec: 'mp3' }>>;
}
export interface TaskRecordingPlaybackPort { temporaryUrl(fileId: string): Promise<string> }
export interface TaskRecordingAccessAuditPort {
  recordTeacherPlayback(actor: TrustedActorContext, recording: TaskRecordingRecord, occurredAt: string): Promise<void>;
}
